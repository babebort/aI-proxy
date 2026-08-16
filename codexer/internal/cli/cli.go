package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"

	"gpt_server/internal/auth"
	"gpt_server/internal/config"
)

func RunCLI(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer, store *config.Store, oauth auth.Client) error {
	if len(args) == 0 {
		printUsage(stdout)
		return nil
	}
	switch args[0] {
	case "auth":
		return runAuth(ctx, stdin, stdout, store, oauth)
	case "api":
		return runAPI(args[1:], stdout, store)
	case "users":
		return runUsers(args[1:], stdout, store)
	case "server":
		return runServer(ctx, args[1:], stdout, store, oauth)
	case "help", "-h", "--help":
		printUsage(stdout)
		return nil
	default:
		_, _ = fmt.Fprintf(stderr, "unknown command: %s\n", args[0])
		printUsage(stderr)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printUsage(w io.Writer) {
	_, _ = fmt.Fprintln(w, "usage:")
	_, _ = fmt.Fprintln(w, "  ./main auth")
	_, _ = fmt.Fprintln(w, "  ./main api --list")
	_, _ = fmt.Fprintln(w, "  ./main users --list [--gid ID] [--gname NAME] [--uuid UUID] [--alias ALIAS]")
	_, _ = fmt.Fprintln(w, "  ./main users --get --uuid UUID [--gid ID|--gname NAME]")
	_, _ = fmt.Fprintln(w, "  ./main server --singleuser --gid ID --alias USER --host 127.0.0.1 --port 9090")
	_, _ = fmt.Fprintln(w, "  ./main server --singleuser --gname NAME --uuid USER_UUID --host 127.0.0.1 --port 9090")
	_, _ = fmt.Fprintln(w, "  ./main server --multiuser --gid ID --host 127.0.0.1 --port 9090")
	_, _ = fmt.Fprintln(w, "  ./main server --multiuser --gname NAME --host 127.0.0.1 --port 9090")
}

func parseFlagSet(name string, args []string) (*flag.FlagSet, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return fs, nil
}

func requireStore(store *config.Store) error {
	if store == nil {
		return errors.New("store is not configured")
	}
	return nil
}
