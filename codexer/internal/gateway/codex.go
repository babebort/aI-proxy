package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	defaultCodexResponsesURL = "https://chatgpt.com/backend-api/codex/responses"
	defaultCodexModelsURL    = "https://chatgpt.com/backend-api/codex/models"
	codexOriginator          = "codex_cli_rs"
	codexVersion             = "0.146.0"
	codexUserAgent           = "codex_cli_rs/0.146.0 (Ubuntu 22.4.0; x86_64) xterm-256color"
)

func (g *GatewayServer) doProxyCodex(r *http.Request, upstreamPath string, resolved upstreamAuth) (*http.Response, error) {
	target, err := g.codexTargetURL(upstreamPath, r.URL.RawQuery)
	if err != nil {
		return nil, err
	}
	body, err := codexRequestBody(upstreamPath, r.Body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, body)
	if err != nil {
		return nil, err
	}
	copyRequestHeaders(req.Header, r.Header)
	setCodexHeaders(req, resolved)
	return g.client().Do(req)
}

func (g *GatewayServer) codexTargetURL(upstreamPath, rawQuery string) (string, error) {
	target := strings.TrimSpace(g.CodexResponsesURL)
	if upstreamPath == "/v1/models" {
		target = strings.TrimSpace(g.CodexModelsURL)
	}
	if target == "" {
		if upstreamPath == "/v1/models" {
			target = defaultCodexModelsURL
		} else {
			target = defaultCodexResponsesURL
		}
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid codex upstream url %q", target)
	}
	if rawQuery != "" {
		if parsed.RawQuery == "" {
			parsed.RawQuery = rawQuery
		} else {
			parsed.RawQuery += "&" + rawQuery
		}
	}
	return parsed.String(), nil
}

func codexRequestBody(upstreamPath string, body io.Reader) (io.Reader, error) {
	switch upstreamPath {
	case "/v1/chat/completions":
		return convertChatCompletionsToCodexResponses(body)
	case "/v1/completions":
		return convertCompletionsToCodexResponses(body)
	case "/v1/models":
		return nil, nil
	default:
		return normalizeCodexResponsesBody(body)
	}
}

func convertChatCompletionsToCodexResponses(body io.Reader) (io.Reader, error) {
	var raw map[string]any
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse chat completions request: %w", err)
	}
	messages, _ := raw["messages"].([]any)
	input := make([]any, 0, len(messages))
	for _, item := range messages {
		msg, ok := item.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msg["role"].(string)
		content := codexMessageContent(role, msg["content"])
		input = append(input, map[string]any{
			"type":    "message",
			"role":    role,
			"content": content,
		})
	}
	delete(raw, "messages")
	raw["input"] = input
	normalizeCodexRequestFields(raw)
	return marshalBody(raw)
}

func codexMessageContent(role string, value any) []any {
	textType := codexTextContentType(role)
	switch v := value.(type) {
	case string:
		return []any{map[string]any{"type": textType, "text": v}}
	case []any:
		out := make([]any, 0, len(v))
		for _, part := range v {
			partMap, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if partMap["type"] == "text" {
				partMap["type"] = textType
			}
			out = append(out, partMap)
		}
		return out
	default:
		return []any{map[string]any{"type": textType, "text": fmt.Sprint(v)}}
	}
}

func codexTextContentType(role string) string {
	if role == "assistant" {
		return "output_text"
	}
	return "input_text"
}

func convertCompletionsToCodexResponses(body io.Reader) (io.Reader, error) {
	var raw map[string]any
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse completions request: %w", err)
	}
	if prompt, ok := raw["prompt"]; ok {
		raw["input"] = []any{
			map[string]any{
				"type":    "message",
				"role":    "user",
				"content": codexMessageContent("user", prompt),
			},
		}
		delete(raw, "prompt")
	}
	normalizeCodexRequestFields(raw)
	return marshalBody(raw)
}

func normalizeCodexResponsesBody(body io.Reader) (io.Reader, error) {
	var raw map[string]any
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse responses request: %w", err)
	}
	normalizeCodexRequestFields(raw)
	return marshalBody(raw)
}

func normalizeCodexRequestFields(raw map[string]any) {
	raw["store"] = false
	raw["stream"] = true
}

func marshalBody(value any) (io.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func setCodexHeaders(req *http.Request, resolved upstreamAuth) {
	req.Header.Del("Authorization")
	req.Header.Set("Authorization", "Bearer "+resolved.Token)
	req.Header.Set("Originator", codexOriginator)
	req.Header.Set("Version", codexVersion)
	req.Header.Set("User-Agent", codexUserAgent)
	if resolved.Tokens.ChatGPTAccountID != "" {
		req.Header.Set("chatgpt-account-id", resolved.Tokens.ChatGPTAccountID)
	}
	if strings.EqualFold(req.URL.Host, "chatgpt.com") {
		req.Host = "chatgpt.com"
	}
}
