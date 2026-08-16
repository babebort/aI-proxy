package gateway

import (
	"errors"

	"gpt_server/internal/auth"
)

type upstreamMode string

type ServerMode string

const (
	upstreamModeAPIKey     upstreamMode = "api_key"
	upstreamModeOAuthCodex upstreamMode = "oauth_codex"

	ServerModeCodex ServerMode = "codex"
	ServerModeGPT   ServerMode = "gpt"
)

type upstreamAuth struct {
	Mode     upstreamMode
	Token    string
	Tokens   auth.TokenSet
	UserUUID string
}

func normalizeServerMode(mode ServerMode) ServerMode {
	if mode == "" {
		return ServerModeCodex
	}
	return mode
}

func ParseServerMode(value string) (ServerMode, error) {
	switch ServerMode(value) {
	case "", ServerModeCodex:
		return ServerModeCodex, nil
	case ServerModeGPT:
		return ServerModeGPT, nil
	default:
		return "", errors.New("server mode must be codex or gpt")
	}
}
