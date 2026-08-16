package gateway

import (
	"errors"
	"sync"

	"gpt_server/internal/config"
)

type GroupBalancer struct {
	mu      sync.Mutex
	offsets map[string]int
}

func NewGroupBalancer() *GroupBalancer {
	return &GroupBalancer{offsets: map[string]int{}}
}

func (b *GroupBalancer) Next(group config.Group, skipUUID string) (config.User, error) {
	if len(group.Users) == 0 {
		return config.User{}, errors.New("group has no users")
	}
	if b == nil {
		b = NewGroupBalancer()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.offsets == nil {
		b.offsets = map[string]int{}
	}
	start := b.offsets[group.GID] % len(group.Users)
	for i := 0; i < len(group.Users); i++ {
		idx := (start + i) % len(group.Users)
		user := group.Users[idx]
		if skipUUID != "" && user.UUID == skipUUID && len(group.Users) > 1 {
			continue
		}
		b.offsets[group.GID] = (idx + 1) % len(group.Users)
		return user, nil
	}
	return config.User{}, errors.New("no alternate group user available")
}
