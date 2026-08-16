package cli

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"gpt_server/internal/auth"
	"gpt_server/internal/config"
)

func runAuth(ctx context.Context, stdin io.Reader, stdout io.Writer, store *config.Store, oauth auth.Client) error {
	if err := requireStore(store); err != nil {
		return err
	}
	if oauth == nil {
		return errors.New("oauth client is not configured")
	}
	style := newStyler()
	session, authURL, err := oauth.GenerateAuthURL()
	if err != nil {
		return err
	}
	style.Title(stdout, "interactive auth")
	style.Info(stdout, "open this oauth link in your browser:")
	_, _ = fmt.Fprintln(stdout, authURL)

	scanner := bufio.NewScanner(stdin)
	prompt(stdout, "paste returned code or callback url")
	line, err := scanRequired(scanner, "oauth code was not provided")
	if err != nil {
		return err
	}
	code, state, err := auth.ParseCodeInput(line)
	if err != nil {
		return err
	}
	if state != "" && state != session.State {
		return errors.New("oauth state mismatch")
	}
	tokens, err := oauth.ExchangeCode(ctx, session, code)
	if err != nil {
		return err
	}

	group, createNew, err := chooseGroup(scanner, stdout, store)
	if err != nil {
		return err
	}
	prompt(stdout, "user alias")
	alias, err := scanRequired(scanner, "user alias was not provided")
	if err != nil {
		return err
	}

	var user config.User
	if createNew {
		group, user, err = store.CreateGroupWithUser(group.GName, alias, code, tokens)
	} else {
		group, user, err = store.AddUserToGroup(config.GroupSelector{GID: group.GID}, alias, code, tokens)
	}
	if err != nil {
		return err
	}
	style.OK(stdout, "auth saved")
	_, _ = fmt.Fprintf(stdout, "config: %s\n", store.Path)
	printAuthSummary(stdout, group, user)
	return nil
}

func chooseGroup(scanner *bufio.Scanner, stdout io.Writer, store *config.Store) (config.Group, bool, error) {
	cfg, err := store.Load()
	if err != nil {
		return config.Group{}, false, err
	}
	if len(cfg.Groups) == 0 {
		prompt(stdout, "group name")
		gname, err := scanRequired(scanner, "group name was not provided")
		if err != nil {
			return config.Group{}, false, err
		}
		return config.Group{GName: gname}, true, nil
	}
	_, _ = fmt.Fprintln(stdout, "select group:")
	for idx, group := range cfg.Groups {
		_, _ = fmt.Fprintf(stdout, "  %d. %s (%s)\n", idx+1, group.GName, group.GID)
	}
	_, _ = fmt.Fprintln(stdout, "  n. create new group")
	prompt(stdout, "group")
	choice, err := scanRequired(scanner, "group selection was not provided")
	if err != nil {
		return config.Group{}, false, err
	}
	if strings.EqualFold(choice, "n") || strings.EqualFold(choice, "new") {
		prompt(stdout, "group name")
		gname, err := scanRequired(scanner, "group name was not provided")
		if err != nil {
			return config.Group{}, false, err
		}
		return config.Group{GName: gname}, true, nil
	}
	number, err := strconv.Atoi(choice)
	if err != nil || number < 1 || number > len(cfg.Groups) {
		return config.Group{}, false, errors.New("invalid group selection")
	}
	return cfg.Groups[number-1], false, nil
}

func scanRequired(scanner *bufio.Scanner, message string) (string, error) {
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", errors.New(message)
	}
	value := strings.TrimSpace(scanner.Text())
	if value == "" {
		return "", errors.New(message)
	}
	return value, nil
}

func printAuthSummary(stdout io.Writer, group config.Group, user config.User) {
	_, _ = fmt.Fprintf(stdout, "group_name: %s\n", group.GName)
	_, _ = fmt.Fprintf(stdout, "gid: %s\n", group.GID)
	_, _ = fmt.Fprintf(stdout, "uuid: %s\n", user.UUID)
	_, _ = fmt.Fprintf(stdout, "alias: %s\n", user.Alias)
	_, _ = fmt.Fprintf(stdout, "api: %s\n", group.API)
}
