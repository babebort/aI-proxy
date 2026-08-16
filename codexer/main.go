package main

import (
	"context"
	"fmt"
	"os"

	"gpt_server/internal/auth"
	"gpt_server/internal/cli"
	"gpt_server/internal/config"
)

func main() {
	path, err := config.DefaultStorePath()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	store := config.NewStore(path)
	oauth := auth.NewOAuthClientFromEnv()
	if err := cli.RunCLI(context.Background(), os.Args[1:], os.Stdin, os.Stdout, os.Stderr, store, oauth); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
