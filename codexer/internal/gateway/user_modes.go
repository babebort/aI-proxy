package gateway

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
)

func (g *GatewayServer) proxySingleuser(w http.ResponseWriter, r *http.Request, upstreamPath string) error {
	userIdentifier := strings.TrimSpace(g.UserIdentifier)
	if userIdentifier == "" {
		return errors.New("singleuser server requires a user selector")
	}
	resolved, err := ResolveUpstreamAuthForUser(r.Context(), g.Store, g.OAuth, normalizeServerMode(g.Mode), g.GroupSelector, userIdentifier)
	if err != nil {
		return err
	}
	return g.proxy(w, r, upstreamPath, resolved)
}

func (g *GatewayServer) proxyMultiuser(w http.ResponseWriter, r *http.Request, upstreamPath string) error {
	cfg, err := g.Store.Load()
	if err != nil {
		return err
	}
	group, ok := cfg.FindGroup(g.GroupSelector)
	if !ok {
		return errors.New("group not found")
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	attempts := len(group.Users)
	if attempts == 0 {
		return errors.New("group has no users")
	}
	var lastUUID string
	for attempt := 0; attempt < attempts; attempt++ {
		user, err := g.Balancer.Next(group, lastUUID)
		if err != nil {
			return err
		}
		lastUUID = user.UUID
		resolved, err := ResolveUpstreamAuthForUser(r.Context(), g.Store, g.OAuth, normalizeServerMode(g.Mode), g.GroupSelector, user.UUID)
		if err != nil {
			return err
		}
		clone := r.Clone(r.Context())
		clone.Body = io.NopCloser(bytes.NewReader(body))
		resp, err := g.doProxy(clone, upstreamPath, resolved)
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt < attempts-1 {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			continue
		}
		defer resp.Body.Close()
		return writeProxyResponse(w, resp)
	}
	return errors.New("all group users are rate limited")
}
