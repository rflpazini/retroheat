// Command mirror moves the price history between the JSON files and the
// Supabase copy. `-push` sends every point on disk (the one-time backfill,
// and the resync after a replay); `-pull` rebuilds data/history from the copy,
// byte for byte, which is the restore path if the repository ever loses it.
// Both need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/rflpazini/retroheat/internal/mirror"
)

func main() { os.Exit(run()) }

func run() int {
	var (
		dataDir = flag.String("data", "./data", "directory holding history/")
		pull    = flag.Bool("pull", false, "rebuild history/ from the Supabase copy instead of pushing to it")
		only    = flag.String("only", "", "comma-separated game ids to push (default: every history file)")
		timeout = flag.Duration("timeout", 10*time.Minute, "overall timeout")
	)
	flag.Parse()

	url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if url == "" || key == "" {
		fmt.Fprintln(os.Stderr, "mirror: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role)")
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()

	store := mirror.NewSupabase(url, key)
	historyDir := filepath.Join(*dataDir, "history")

	if *pull {
		n, err := mirror.Pull(ctx, store, historyDir)
		if err != nil {
			fmt.Fprintln(os.Stderr, "mirror: pull failed:", err)
			return 1
		}
		fmt.Printf("mirror: rebuilt %d history files under %s from the Supabase copy\n", n, historyDir)
		return 0
	}

	var ids []string
	if strings.TrimSpace(*only) != "" {
		for _, id := range strings.Split(*only, ",") {
			if id = strings.TrimSpace(id); id != "" {
				ids = append(ids, id)
			}
		}
	}
	n, err := mirror.Push(ctx, store, historyDir, ids)
	if err != nil {
		fmt.Fprintln(os.Stderr, "mirror: push failed:", err)
		return 1
	}
	fmt.Printf("mirror: pushed %d points from %s to the Supabase copy\n", n, historyDir)
	return 0
}
