package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"

	"gpt_server/internal/auth"
	"gpt_server/internal/config"
	"gpt_server/internal/gateway"
)

func runServer(ctx context.Context, args []string, stdout io.Writer, store *config.Store, oauth auth.Client) error {
	if err := requireStore(store); err != nil {
		return err
	}
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	host := fs.String("host", "127.0.0.1", "host to listen on")
	listen := fs.String("listen", "", "deprecated alias for --host")
	port := fs.String("port", "9090", "port to listen on")
	sec := fs.String("sec", "", "optional startup api secret")
	modeValue := fs.String("mode", string(gateway.ServerModeCodex), "upstream auth mode: codex or gpt")
	singleuser := fs.Bool("singleuser", false, "route requests through one selected user in a group")
	multiuser := fs.Bool("multiuser", false, "balance requests between users in a group")
	gid := fs.String("gid", "", "group id for group modes")
	gname := fs.String("gname", "", "group name for group modes")
	alias := fs.String("alias", "", "user alias for singleuser mode")
	uuid := fs.String("uuid", "", "user uuid for singleuser mode")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *singleuser == *multiuser {
		return errors.New("server requires exactly one of --singleuser or --multiuser")
	}
	if *singleuser && strings.TrimSpace(*gid) == "" && strings.TrimSpace(*gname) == "" {
		return errors.New("singleuser server requires --gid or --gname")
	}
	if *singleuser && strings.TrimSpace(*alias) == "" && strings.TrimSpace(*uuid) == "" {
		return errors.New("singleuser server requires --alias or --uuid")
	}
	if *multiuser && strings.TrimSpace(*gid) == "" && strings.TrimSpace(*gname) == "" {
		return errors.New("multiuser server requires --gid or --gname")
	}
	mode, err := gateway.ParseServerMode(strings.TrimSpace(*modeValue))
	if err != nil {
		return err
	}
	hostValue := strings.TrimSpace(*host)
	if strings.TrimSpace(*listen) != "" {
		hostValue = strings.TrimSpace(*listen)
	}
	server := &gateway.GatewayServer{
		Store:          store,
		OAuth:          oauth,
		Listen:         hostValue,
		Port:           *port,
		StartupSecret:  strings.TrimSpace(*sec),
		Mode:           mode,
		SingleUser:     *singleuser,
		MultiUser:      *multiuser,
		GroupSelector:  config.GroupSelector{GID: strings.TrimSpace(*gid), GName: strings.TrimSpace(*gname)},
		UserIdentifier: firstNonEmpty(strings.TrimSpace(*uuid), strings.TrimSpace(*alias)),
		Balancer:       gateway.NewGroupBalancer(),
	}
	newStyler().OK(stdout, "server is up and running on http://%s", server.Addr())
	_, _ = fmt.Fprintln(stdout, "mode:", mode)
	if *singleuser {
		_, _ = fmt.Fprintln(stdout, "singleuser: true")
	}
	if *multiuser {
		_, _ = fmt.Fprintln(stdout, "multiuser: true")
	}
	return server.ListenAndServe(ctx)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
