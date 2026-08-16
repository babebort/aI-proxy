package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func newGroupID() string {
	sum := sha256.Sum256(randomBytes(32))
	return hex.EncodeToString(sum[:])
}

func newGroupAPI() string {
	return "gsg_" + base64.RawURLEncoding.EncodeToString(randomBytes(32))
}

func newUUID() string {
	buf := randomBytes(16)
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:])
}

func randomBytes(size int) []byte {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return buf
}
