package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"

	"gpt_server/internal/config"
)

func runUsers(args []string, stdout io.Writer, store *config.Store) error {
	if err := requireStore(store); err != nil {
		return err
	}
	fs := flag.NewFlagSet("users", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	list := fs.Bool("list", false, "list users")
	get := fs.Bool("get", false, "get user data")
	gid := fs.String("gid", "", "group id filter")
	gname := fs.String("gname", "", "group name filter")
	uuid := fs.String("uuid", "", "user uuid filter")
	alias := fs.String("alias", "", "user alias filter")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *list == *get {
		return errors.New("users requires exactly one of --list or --get")
	}
	cfg, err := store.Load()
	if err != nil {
		return err
	}
	filter := config.UserFilter{GID: *gid, GName: *gname, UUID: *uuid, Alias: *alias}
	records := cfg.UserRecords(filter)
	if *list {
		return printUserList(stdout, records)
	}
	if *uuid == "" {
		return errors.New("users --get requires --uuid")
	}
	if len(records) == 0 {
		return errors.New("user not found")
	}
	if len(records) > 1 {
		return errors.New("user filter matched more than one user")
	}
	printUserDetails(stdout, records[0])
	return nil
}

func printUserList(stdout io.Writer, records []config.UserRecord) error {
	if len(records) == 0 {
		_, _ = fmt.Fprintln(stdout, "no users")
		return nil
	}
	for _, record := range records {
		_, _ = fmt.Fprintf(stdout, "%s\t%s\t%s\t%s\n", record.Group.GName, record.Group.GID, record.User.UUID, record.User.Alias)
	}
	return nil
}

func printUserDetails(stdout io.Writer, record config.UserRecord) {
	_, _ = fmt.Fprintf(stdout, "group_name: %s\n", record.Group.GName)
	_, _ = fmt.Fprintf(stdout, "gid: %s\n", record.Group.GID)
	_, _ = fmt.Fprintf(stdout, "uuid: %s\n", record.User.UUID)
	_, _ = fmt.Fprintf(stdout, "alias: %s\n", record.User.Alias)
	_, _ = fmt.Fprintf(stdout, "api: %s\n", record.Group.API)
	_, _ = fmt.Fprintf(stdout, "oauth_code_saved: %t\n", record.User.OAuthCode != "")
	_, _ = fmt.Fprintf(stdout, "token_saved: %t\n", record.User.Tokens.AccessToken != "")
}
