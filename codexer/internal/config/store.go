package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"

	"gpt_server/internal/auth"
)

const defaultStoreDir = ".gpt_server"

type Config struct {
	Groups []Group `json:"groups" yaml:"groups"`
}

type Group struct {
	GID   string `json:"gid" yaml:"gid"`
	GName string `json:"gname" yaml:"gname"`
	API   string `json:"api" yaml:"api"`
	Users []User `json:"users" yaml:"users"`
}

type User struct {
	UUID      string        `json:"uuid" yaml:"uuid"`
	Alias     string        `json:"alias" yaml:"alias"`
	OAuthCode string        `json:"oauth_code" yaml:"oauth_code"`
	Tokens    auth.TokenSet `json:"tokens" yaml:"tokens"`
}

type GroupSelector struct {
	GID   string
	GName string
}

type UserFilter struct {
	GID   string
	GName string
	UUID  string
	Alias string
}

type UserRecord struct {
	Group Group
	User  User
}

type Store struct {
	Path string
}

type legacyAPIKey struct {
	ID        string `json:"id" yaml:"id"`
	Alias     string `json:"alias" yaml:"alias"`
	Secret    string `json:"secret" yaml:"secret"`
	CreatedAt int64  `json:"created_at" yaml:"created_at"`
}

type rawConfig struct {
	Groups  []Group        `json:"groups" yaml:"groups"`
	Tokens  auth.TokenSet  `json:"tokens" yaml:"tokens"`
	APIKeys []legacyAPIKey `json:"api_keys" yaml:"api_keys"`
}

func NewStore(path string) *Store {
	return &Store{Path: path}
}

func DefaultStorePath() (string, error) {
	if home := strings.TrimSpace(os.Getenv("GPT_GATEWAY_HOME")); home != "" {
		return filepath.Join(home, "config.yml"), nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return filepath.Join(cwd, "config.yml"), nil
}

func (s *Store) Load() (Config, error) {
	var cfg Config
	if s == nil || strings.TrimSpace(s.Path) == "" {
		return cfg, errors.New("store path is empty")
	}
	data, err := os.ReadFile(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		if err := s.Save(cfg); err != nil {
			return Config{}, err
		}
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, nil
	}
	var raw rawConfig
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return cfg, err
	}
	return migrateRawConfig(raw), nil
}

func (s *Store) Save(cfg Config) error {
	if s == nil || strings.TrimSpace(s.Path) == "" {
		return errors.New("store path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), filepath.Base(s.Path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpName, s.Path)
}

func (s *Store) CreateGroupWithUser(gname, alias, oauthCode string, tokens auth.TokenSet) (Group, User, error) {
	gname = strings.TrimSpace(gname)
	if gname == "" {
		return Group{}, User{}, errors.New("group name is required")
	}
	cfg, err := s.Load()
	if err != nil {
		return Group{}, User{}, err
	}
	if _, ok := cfg.FindGroup(GroupSelector{GName: gname}); ok {
		return Group{}, User{}, fmt.Errorf("group %q already exists", gname)
	}
	user, err := newUser(alias, oauthCode, tokens)
	if err != nil {
		return Group{}, User{}, err
	}
	group := Group{
		GID:   newGroupID(),
		GName: gname,
		API:   newGroupAPI(),
		Users: []User{user},
	}
	cfg.Groups = append(cfg.Groups, group)
	return group, user, s.Save(cfg)
}

func (s *Store) AddUserToGroup(selector GroupSelector, alias, oauthCode string, tokens auth.TokenSet) (Group, User, error) {
	cfg, err := s.Load()
	if err != nil {
		return Group{}, User{}, err
	}
	idx, ok := cfg.findGroupIndex(selector)
	if !ok {
		return Group{}, User{}, errors.New("group not found")
	}
	for _, existing := range cfg.Groups[idx].Users {
		if existing.Alias == strings.TrimSpace(alias) {
			return Group{}, User{}, fmt.Errorf("user alias %q already exists in group", strings.TrimSpace(alias))
		}
	}
	user, err := newUser(alias, oauthCode, tokens)
	if err != nil {
		return Group{}, User{}, err
	}
	cfg.Groups[idx].Users = append(cfg.Groups[idx].Users, user)
	return cfg.Groups[idx], user, s.Save(cfg)
}

func (s *Store) SaveTokens(tokens auth.TokenSet) error {
	cfg, err := s.Load()
	if err != nil {
		return err
	}
	if len(cfg.Groups) == 0 {
		group, user, err := s.CreateGroupWithUser("default", "default", "", tokens)
		if err != nil {
			return err
		}
		_ = group
		_ = user
		return nil
	}
	if len(cfg.Groups[0].Users) == 0 {
		cfg.Groups[0].Users = append(cfg.Groups[0].Users, User{UUID: newUUID(), Alias: "default", Tokens: tokens})
	} else {
		cfg.Groups[0].Users[0].Tokens = tokens
	}
	return s.Save(cfg)
}

func (s *Store) UpdateUserTokens(selector GroupSelector, uuid string, tokens auth.TokenSet) error {
	cfg, err := s.Load()
	if err != nil {
		return err
	}
	groupIdx, ok := cfg.findGroupIndex(selector)
	if !ok {
		return errors.New("group not found")
	}
	for idx, user := range cfg.Groups[groupIdx].Users {
		if user.UUID == uuid {
			cfg.Groups[groupIdx].Users[idx].Tokens = tokens
			return s.Save(cfg)
		}
	}
	return errors.New("user not found")
}

func newUser(alias, oauthCode string, tokens auth.TokenSet) (User, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return User{}, errors.New("user alias is required")
	}
	return User{
		UUID:      newUUID(),
		Alias:     alias,
		OAuthCode: strings.TrimSpace(oauthCode),
		Tokens:    tokens,
	}, nil
}
