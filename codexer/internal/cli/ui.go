package cli

import (
	"fmt"
	"io"

	"github.com/fatih/color"
)

const (
	iconLink = "→"
	iconOK   = "✓"
	iconInfo = "•"
)

type styler struct {
	title *color.Color
	ok    *color.Color
	info  *color.Color
	warn  *color.Color
}

func newStyler() styler {
	return styler{
		title: color.New(color.FgHiCyan, color.Bold),
		ok:    color.New(color.FgHiGreen),
		info:  color.New(color.FgHiBlue),
		warn:  color.New(color.FgHiYellow),
	}
}

func (s styler) Title(w io.Writer, format string, args ...any) {
	_, _ = s.title.Fprintf(w, format+"\n", args...)
}

func (s styler) OK(w io.Writer, format string, args ...any) {
	_, _ = s.ok.Fprintf(w, iconOK+" "+format+"\n", args...)
}

func (s styler) Info(w io.Writer, format string, args ...any) {
	_, _ = s.info.Fprintf(w, iconInfo+" "+format+"\n", args...)
}

func (s styler) Warn(w io.Writer, format string, args ...any) {
	_, _ = s.warn.Fprintf(w, format+"\n", args...)
}

func prompt(w io.Writer, label string) {
	_, _ = fmt.Fprintf(w, "%s %s: ", iconLink, label)
}
