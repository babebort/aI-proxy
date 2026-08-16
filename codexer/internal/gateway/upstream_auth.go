package gateway

import (
	"context"
	"errors"
	"time"

	"gpt_server/internal/auth"
	"gpt_server/internal/config"
)

func EnsureUsableUpstreamToken(ctx context.Context, store *config.Store, oauth auth.Client) (string, error) {
	resolved, err := ResolveUpstreamAuth(ctx, store, oauth, ServerModeCodex)
	if err != nil {
		return "", err
	}
	return resolved.Token, nil
}

func ResolveUpstreamAuth(ctx context.Context, store *config.Store, oauth auth.Client, mode ServerMode) (upstreamAuth, error) {
	cfg, err := store.Load()
	if err != nil {
		return upstreamAuth{}, err
	}
	group, user, ok := cfg.FirstUser()
	if !ok {
		return upstreamAuth{}, errors.New("auth is not configured; run ./main auth")
	}
	return resolveUserTokens(ctx, store, oauth, mode, config.GroupSelector{GID: group.GID}, user)
}

func ResolveUpstreamAuthForUser(ctx context.Context, store *config.Store, oauth auth.Client, mode ServerMode, selector config.GroupSelector, userIdentifier string) (upstreamAuth, error) {
	cfg, err := store.Load()
	if err != nil {
		return upstreamAuth{}, err
	}
	group, ok := cfg.FindGroup(selector)
	if !ok {
		return upstreamAuth{}, errors.New("group not found")
	}
	for _, user := range group.Users {
		if user.UUID == userIdentifier || user.Alias == userIdentifier {
			return resolveUserTokens(ctx, store, oauth, mode, config.GroupSelector{GID: group.GID}, user)
		}
	}
	return upstreamAuth{}, errors.New("user not found")
}

func resolveUserTokens(ctx context.Context, store *config.Store, oauth auth.Client, mode ServerMode, selector config.GroupSelector, user config.User) (upstreamAuth, error) {
	mode = normalizeServerMode(mode)
	tokens := user.Tokens
	if mode == ServerModeGPT {
		if tokens.UpstreamAPIKey == "" {
			return upstreamAuth{}, errors.New("gpt mode requires upstream api key; run ./main auth")
		}
		return upstreamAuth{Mode: upstreamModeAPIKey, Token: tokens.UpstreamAPIKey, Tokens: tokens, UserUUID: user.UUID}, nil
	}
	if tokens.AccessToken == "" {
		return upstreamAuth{}, errors.New("auth is not configured for user; run ./main auth")
	}
	if time.Until(time.Unix(tokens.ExpiresAt, 0)) > auth.RefreshSkew {
		return upstreamAuth{Mode: upstreamModeOAuthCodex, Token: tokens.AccessToken, Tokens: tokens, UserUUID: user.UUID}, nil
	}
	if tokens.RefreshToken == "" {
		if time.Now().Before(time.Unix(tokens.ExpiresAt, 0)) {
			return upstreamAuth{Mode: upstreamModeOAuthCodex, Token: tokens.AccessToken, Tokens: tokens, UserUUID: user.UUID}, nil
		}
		return upstreamAuth{}, errors.New("access token expired and refresh token is missing; run ./main auth")
	}
	if oauth == nil {
		return upstreamAuth{}, errors.New("oauth client is not configured")
	}
	refreshed, err := oauth.RefreshToken(ctx, tokens.RefreshToken, tokens.ClientID)
	if err != nil {
		return upstreamAuth{}, err
	}
	if refreshed.RefreshToken == "" {
		refreshed.RefreshToken = tokens.RefreshToken
	}
	if refreshed.IDToken == "" {
		refreshed.IDToken = tokens.IDToken
	}
	if refreshed.ChatGPTAccountID == "" {
		refreshed.ChatGPTAccountID = tokens.ChatGPTAccountID
	}
	if err := store.UpdateUserTokens(selector, user.UUID, refreshed); err != nil {
		return upstreamAuth{}, err
	}
	return upstreamAuth{Mode: upstreamModeOAuthCodex, Token: refreshed.AccessToken, Tokens: refreshed, UserUUID: user.UUID}, nil
}
