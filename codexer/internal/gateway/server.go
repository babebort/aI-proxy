package gateway

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"gpt_server/internal/auth"
	"gpt_server/internal/config"
)

type GatewayServer struct {
	Store             *config.Store
	OAuth             auth.Client
	UpstreamBaseURL   string
	CodexResponsesURL string
	CodexModelsURL    string
	HTTPClient        *http.Client
	Listen            string
	Port              string
	StartupSecret     string
	Mode              ServerMode
	SingleUser        bool
	MultiUser         bool
	GroupSelector     config.GroupSelector
	UserIdentifier    string
	Balancer          *GroupBalancer
}

func (g *GatewayServer) Addr() string {
	listen := strings.TrimSpace(g.Listen)
	if listen == "" {
		listen = "127.0.0.1"
	}
	port := strings.TrimSpace(g.Port)
	if port == "" {
		port = "9090"
	}
	return listen + ":" + port
}

func (g *GatewayServer) Handler() http.Handler {
	if g.MultiUser && g.Balancer == nil {
		g.Balancer = NewGroupBalancer()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", g.handle)
	return mux
}

func (g *GatewayServer) ListenAndServe(ctx context.Context) error {
	server := &http.Server{Addr: g.Addr(), Handler: g.Handler()}
	errCh := make(chan error, 1)
	go func() { errCh <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		_ = server.Shutdown(context.Background())
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (g *GatewayServer) handle(w http.ResponseWriter, r *http.Request) {
	upstreamPath, ok := normalizeGatewayPath(r.URL.Path)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "unsupported endpoint")
		return
	}
	if !methodAllowed(r.Method, upstreamPath) {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !g.authorized(r) {
		writeJSONError(w, http.StatusUnauthorized, "missing or invalid bearer token")
		return
	}
	if g.SingleUser {
		if err := g.proxySingleuser(w, r, upstreamPath); err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	if g.MultiUser {
		if err := g.proxyMultiuser(w, r, upstreamPath); err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	resolved, err := ResolveUpstreamAuth(r.Context(), g.Store, g.OAuth, normalizeServerMode(g.Mode))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	if err := g.proxy(w, r, upstreamPath, resolved); err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
	}
}

func (g *GatewayServer) authorized(r *http.Request) bool {
	secret := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if secret == "" {
		return false
	}
	if g.StartupSecret != "" && secret == g.StartupSecret {
		return true
	}
	cfg, err := g.Store.Load()
	if err != nil {
		return false
	}
	if !g.SingleUser && !g.MultiUser {
		return cfg.ValidGroupAPI(secret)
	}
	group, ok := cfg.FindGroup(g.GroupSelector)
	return ok && group.API != "" && subtleSecretEqual(group.API, secret)
}

func (g *GatewayServer) proxy(w http.ResponseWriter, r *http.Request, upstreamPath string, resolved upstreamAuth) error {
	resp, err := g.doProxy(r, upstreamPath, resolved)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return writeProxyResponse(w, resp)
}

func (g *GatewayServer) doProxy(r *http.Request, upstreamPath string, resolved upstreamAuth) (*http.Response, error) {
	if resolved.Mode == upstreamModeOAuthCodex {
		return g.doProxyCodex(r, upstreamPath, resolved)
	}
	target, err := buildUpstreamURL(g.upstreamBase(), upstreamPath, r.URL.RawQuery)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		return nil, err
	}
	copyRequestHeaders(req.Header, r.Header)
	req.Header.Set("Authorization", "Bearer "+resolved.Token)
	return g.client().Do(req)
}

func writeProxyResponse(w http.ResponseWriter, resp *http.Response) error {
	copyResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, err := io.Copy(w, resp.Body)
	return err
}

func (g *GatewayServer) upstreamBase() string {
	if strings.TrimSpace(g.UpstreamBaseURL) != "" {
		return strings.TrimSpace(g.UpstreamBaseURL)
	}
	return envOrDefault("OPENAI_UPSTREAM_BASE_URL", auth.DefaultUpstreamBaseURL)
}

func (g *GatewayServer) client() *http.Client {
	if g.HTTPClient != nil {
		return g.HTTPClient
	}
	return http.DefaultClient
}

func normalizeGatewayPath(path string) (string, bool) {
	path = "/" + strings.TrimLeft(path, "/")
	if strings.HasPrefix(path, "/api/v1/") {
		path = strings.TrimPrefix(path, "/api")
	}
	switch path {
	case "/v1/chat":
		return "/v1/chat/completions", true
	case "/v1/generate":
		return "/v1/completions", true
	case "/v1/models", "/v1/responses", "/v1/chat/completions", "/v1/completions":
		return path, true
	default:
		return "", false
	}
}

func methodAllowed(method, path string) bool {
	if path == "/v1/models" {
		return method == http.MethodGet
	}
	return method == http.MethodPost
}

func buildUpstreamURL(base, endpoint, rawQuery string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid upstream base url %q", base)
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(basePath, "/v1") {
		parsed.Path = basePath + strings.TrimPrefix(endpoint, "/v1")
	} else {
		parsed.Path = basePath + endpoint
	}
	parsed.RawQuery = rawQuery
	return parsed.String(), nil
}

func copyRequestHeaders(dst, src http.Header) {
	for key, values := range src {
		if hopByHopHeader(key) || strings.EqualFold(key, "Authorization") {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func copyResponseHeaders(dst, src http.Header) {
	for key, values := range src {
		if hopByHopHeader(key) {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func hopByHopHeader(key string) bool {
	switch strings.ToLower(key) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":{"message":%q}}`, message)
}
