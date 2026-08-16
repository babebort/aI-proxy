package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	DefaultIssuer          = "https://auth.openai.com"
	DefaultClientID        = "app_EMoamEEZ73f0CkXaXp7hrann"
	DefaultRedirectURI     = "http://localhost:1455/auth/callback"
	DefaultUpstreamBaseURL = "https://api.openai.com"
	RefreshSkew            = 3 * time.Minute
)

type Client interface {
	GenerateAuthURL() (OAuthSession, string, error)
	ExchangeCode(context.Context, OAuthSession, string) (TokenSet, error)
	RefreshToken(context.Context, string, string) (TokenSet, error)
}

type TokenSet struct {
	AccessToken      string `json:"access_token" yaml:"access_token"`
	RefreshToken     string `json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	IDToken          string `json:"id_token,omitempty" yaml:"id_token,omitempty"`
	UpstreamAPIKey   string `json:"upstream_api_key,omitempty" yaml:"upstream_api_key,omitempty"`
	ChatGPTAccountID string `json:"chatgpt_account_id,omitempty" yaml:"chatgpt_account_id,omitempty"`
	TokenType        string `json:"token_type,omitempty" yaml:"token_type,omitempty"`
	ClientID         string `json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ExpiresAt        int64  `json:"expires_at,omitempty" yaml:"expires_at,omitempty"`
}

type OAuthSession struct {
	State        string `json:"state" yaml:"state"`
	CodeVerifier string `json:"code_verifier" yaml:"code_verifier"`
	RedirectURI  string `json:"redirect_uri" yaml:"redirect_uri"`
	ClientID     string `json:"client_id" yaml:"client_id"`
}

type OAuthClient struct {
	Issuer      string
	ClientID    string
	RedirectURI string
	HTTPClient  *http.Client
}

func NewOAuthClientFromEnv() OAuthClient {
	return OAuthClient{
		Issuer:      envOrDefault("OPENAI_OAUTH_ISSUER", DefaultIssuer),
		ClientID:    envOrDefault("OPENAI_OAUTH_CLIENT_ID", DefaultClientID),
		RedirectURI: envOrDefault("OPENAI_OAUTH_REDIRECT_URI", DefaultRedirectURI),
	}
}

func (o OAuthClient) GenerateAuthURL() (OAuthSession, string, error) {
	o = o.withDefaults()
	verifier := randomURLToken(48)
	state := randomURLToken(32)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	session := OAuthSession{
		State:        state,
		CodeVerifier: verifier,
		RedirectURI:  o.RedirectURI,
		ClientID:     o.ClientID,
	}
	values := url.Values{}
	values.Set("response_type", "code")
	values.Set("client_id", o.ClientID)
	values.Set("redirect_uri", o.RedirectURI)
	values.Set("scope", "openid profile email offline_access api.connectors.read api.connectors.invoke")
	values.Set("code_challenge", challenge)
	values.Set("code_challenge_method", "S256")
	values.Set("id_token_add_organizations", "true")
	values.Set("codex_cli_simplified_flow", "true")
	values.Set("originator", "codex_cli_rs")
	values.Set("state", state)
	return session, strings.TrimRight(o.Issuer, "/") + "/oauth/authorize?" + values.Encode(), nil
}

func (o OAuthClient) ExchangeCode(ctx context.Context, session OAuthSession, code string) (TokenSet, error) {
	o = o.withDefaults()
	tokens, err := o.postTokenForm(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {strings.TrimSpace(code)},
		"redirect_uri":  {session.RedirectURI},
		"client_id":     {session.ClientID},
		"code_verifier": {session.CodeVerifier},
	})
	if err != nil {
		return TokenSet{}, err
	}
	tokens.ClientID = session.ClientID
	if tokens.IDToken != "" {
		tokens.ChatGPTAccountID = ChatGPTAccountIDFromIDToken(tokens.IDToken)
		if apiKey, err := o.ExchangeIDTokenForAPIKey(ctx, session.ClientID, tokens.IDToken); err == nil {
			tokens.UpstreamAPIKey = apiKey
		}
	}
	return tokens, nil
}

func ChatGPTAccountIDFromIDToken(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	for _, key := range []string{"chatgpt_account_id", "organization_id"} {
		if value, ok := claims[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (o OAuthClient) ExchangeIDTokenForAPIKey(ctx context.Context, clientID, idToken string) (string, error) {
	tokens, err := o.postTokenForm(ctx, url.Values{
		"grant_type":         {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"client_id":          {clientID},
		"requested_token":    {"openai-api-key"},
		"subject_token":      {idToken},
		"subject_token_type": {"urn:ietf:params:oauth:token-type:id_token"},
	})
	if err != nil {
		return "", err
	}
	return tokens.AccessToken, nil
}

func (o OAuthClient) RefreshToken(ctx context.Context, refreshToken, clientID string) (TokenSet, error) {
	o = o.withDefaults()
	tokens, err := o.postTokenForm(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {strings.TrimSpace(refreshToken)},
		"client_id":     {strings.TrimSpace(clientID)},
	})
	if err != nil {
		return TokenSet{}, err
	}
	tokens.ClientID = strings.TrimSpace(clientID)
	return tokens, nil
}

func (o OAuthClient) postTokenForm(ctx context.Context, form url.Values) (TokenSet, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(o.Issuer, "/")+"/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return TokenSet{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := o.client().Do(req)
	if err != nil {
		return TokenSet{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return TokenSet{}, fmt.Errorf("oauth token endpoint returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var raw struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return TokenSet{}, err
	}
	if strings.TrimSpace(raw.AccessToken) == "" {
		return TokenSet{}, errors.New("oauth token response missing access_token")
	}
	if raw.ExpiresIn <= 0 {
		raw.ExpiresIn = 3600
	}
	return TokenSet{
		AccessToken:  raw.AccessToken,
		RefreshToken: raw.RefreshToken,
		IDToken:      raw.IDToken,
		TokenType:    raw.TokenType,
		ExpiresAt:    time.Now().Add(time.Duration(raw.ExpiresIn) * time.Second).Unix(),
	}, nil
}

func (o OAuthClient) withDefaults() OAuthClient {
	if strings.TrimSpace(o.Issuer) == "" {
		o.Issuer = DefaultIssuer
	}
	if strings.TrimSpace(o.ClientID) == "" {
		o.ClientID = DefaultClientID
	}
	if strings.TrimSpace(o.RedirectURI) == "" {
		o.RedirectURI = DefaultRedirectURI
	}
	return o
}

func (o OAuthClient) client() *http.Client {
	if o.HTTPClient != nil {
		return o.HTTPClient
	}
	return http.DefaultClient
}

func ParseCodeInput(input string) (string, string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", "", errors.New("oauth code is required")
	}
	if strings.Contains(input, "://") {
		parsed, err := url.Parse(input)
		if err != nil {
			return "", "", err
		}
		code := strings.TrimSpace(parsed.Query().Get("code"))
		state := strings.TrimSpace(parsed.Query().Get("state"))
		if code == "" {
			return "", "", errors.New("callback URL missing code")
		}
		return code, state, nil
	}
	return input, "", nil
}

func randomURLToken(size int) string {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
