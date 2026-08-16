package auth

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type CallbackResult struct {
	Code  string
	State string
}

// WaitForOAuthCallback listens on redirectURI until the OAuth provider redirects
// back with ?code=…&state=…, then returns the parsed values.
func WaitForOAuthCallback(ctx context.Context, redirectURI, expectedState string) (CallbackResult, error) {
	parsed, err := url.Parse(strings.TrimSpace(redirectURI))
	if err != nil {
		return CallbackResult{}, err
	}
	callbackPath := parsed.EscapedPath()
	if callbackPath == "" {
		callbackPath = "/"
	}

	host := parsed.Hostname()
	if host == "" {
		host = "127.0.0.1"
	}
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	addr := net.JoinHostPort(host, port)

	resultCh := make(chan CallbackResult, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	srv := &http.Server{Handler: mux}

	mux.HandleFunc(callbackPath, func(w http.ResponseWriter, r *http.Request) {
		if errParam := strings.TrimSpace(r.URL.Query().Get("error")); errParam != "" {
			desc := strings.TrimSpace(r.URL.Query().Get("error_description"))
			if desc != "" {
				errCh <- fmt.Errorf("oauth error: %s (%s)", errParam, desc)
			} else {
				errCh <- fmt.Errorf("oauth error: %s", errParam)
			}
			http.Error(w, "authorization failed", http.StatusBadRequest)
			go shutdownServer(srv)
			return
		}

		code := strings.TrimSpace(r.URL.Query().Get("code"))
		state := strings.TrimSpace(r.URL.Query().Get("state"))
		if code == "" {
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI-proxy</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Готово</h1><p>Авторизация прошла успешно. Можно закрыть эту вкладку и вернуться в терминал.</p></body></html>`))

		resultCh <- CallbackResult{Code: code, State: state}
		go shutdownServer(srv)
	})

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return CallbackResult{}, fmt.Errorf("callback listener on %s: %w", addr, err)
	}

	go func() {
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errCh <- serveErr
		}
	}()

	select {
	case <-ctx.Done():
		shutdownServer(srv)
		return CallbackResult{}, ctx.Err()
	case serveErr := <-errCh:
		shutdownServer(srv)
		return CallbackResult{}, serveErr
	case res := <-resultCh:
		if expectedState != "" && res.State != "" && res.State != expectedState {
			return CallbackResult{}, errors.New("oauth state mismatch")
		}
		return res, nil
	}
}

func shutdownServer(srv *http.Server) {
	_ = srv.Shutdown(context.Background())
}
