package config

import (
	"crypto/subtle"
	"strings"
)

func migrateRawConfig(raw rawConfig) Config {
	if len(raw.Groups) > 0 {
		return Config{Groups: raw.Groups}
	}
	if raw.Tokens.AccessToken == "" && raw.Tokens.UpstreamAPIKey == "" && len(raw.APIKeys) == 0 {
		return Config{}
	}
	api := ""
	if len(raw.APIKeys) > 0 {
		api = raw.APIKeys[0].Secret
	}
	return Config{Groups: []Group{{
		GID:   "legacy",
		GName: "legacy",
		API:   api,
		Users: []User{{UUID: "legacy", Alias: "legacy", Tokens: raw.Tokens}},
	}}}
}

func (cfg Config) ValidGroupAPI(secret string) bool {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return false
	}
	for _, group := range cfg.Groups {
		if subtle.ConstantTimeCompare([]byte(group.API), []byte(secret)) == 1 {
			return true
		}
	}
	return false
}

func (cfg Config) FindGroup(selector GroupSelector) (Group, bool) {
	idx, ok := cfg.findGroupIndex(selector)
	if !ok {
		return Group{}, false
	}
	return cfg.Groups[idx], true
}

func (cfg Config) FirstUser() (Group, User, bool) {
	for _, group := range cfg.Groups {
		for _, user := range group.Users {
			return group, user, true
		}
	}
	return Group{}, User{}, false
}

func (cfg Config) UserRecords(filter UserFilter) []UserRecord {
	var records []UserRecord
	for _, group := range cfg.Groups {
		if !groupMatches(group, filter) {
			continue
		}
		for _, user := range group.Users {
			if userMatches(user, filter) {
				records = append(records, UserRecord{Group: group, User: user})
			}
		}
	}
	return records
}

func (cfg Config) findGroupIndex(selector GroupSelector) (int, bool) {
	gid := strings.TrimSpace(selector.GID)
	gname := strings.TrimSpace(selector.GName)
	for idx, group := range cfg.Groups {
		if gid != "" && group.GID == gid {
			return idx, true
		}
		if gname != "" && group.GName == gname {
			return idx, true
		}
	}
	return 0, false
}

func groupMatches(group Group, filter UserFilter) bool {
	if filter.GID != "" && group.GID != filter.GID {
		return false
	}
	if filter.GName != "" && group.GName != filter.GName {
		return false
	}
	return true
}

func userMatches(user User, filter UserFilter) bool {
	if filter.UUID != "" && user.UUID != filter.UUID {
		return false
	}
	if filter.Alias != "" && !strings.Contains(user.Alias, filter.Alias) {
		return false
	}
	return true
}
