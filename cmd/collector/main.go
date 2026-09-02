// Command collector runs one price-collection pass and rewrites the JSON the
// site serves. It is the program the scheduled GitHub Actions workflow runs.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/pipeline"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
	"github.com/rflpazini/retroheat/internal/provider/fake"
	"github.com/rflpazini/retroheat/internal/provider/pricecharting"
)

// minSuccessRatio is the share of games that must price successfully for the
// run to count. Below it the data is too patchy to publish and the workflow
// should fail loudly instead of committing a half-empty board.
const minSuccessRatio = 0.5

func main() { os.Exit(run()) }

func run() int {
	var (
		dataDir    = flag.String("data", "./data", "directory for generated JSON")
		catalogDir = flag.String("catalog", "./catalog", "directory holding the game catalog")
		useFake    = flag.Bool("fake", false, "generate deterministic sample data instead of calling an API")
		platforms  = flag.String("platforms", "", "comma-separated platforms to collect (default: all)")
		callBudget = flag.Int("budget", 2000, "maximum upstream API calls for this run (0 = unlimited)")
		backfill   = flag.Int("backfill", 60, "days of synthetic history to seed for newly tracked games (fake only)")
		audit      = flag.Bool("audit", false, "print per-listing classification decisions and exit")
		verbose    = flag.Bool("v", false, "verbose logging")
		timeout    = flag.Duration("timeout", 30*time.Minute, "overall run timeout")
	)
	flag.Parse()

	level := slog.LevelInfo
	if *verbose {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()

	selected, err := parsePlatforms(*platforms)
	if err != nil {
		log.Error("invalid -platforms", slog.String("err", err.Error()))
		return 2
	}

	now := time.Now().UTC()
	p, err := selectProvider(*useFake, now)
	if err != nil {
		log.Error("no price provider available", slog.String("err", err.Error()))
		return 2
	}
	log.Info("collecting", slog.String("provider", p.Name()), slog.String("kind", p.Kind()))

	if *audit {
		if err := runAudit(ctx, p, *catalogDir, selected); err != nil {
			log.Error("audit failed", slog.String("err", err.Error()))
			return 1
		}
		return 0
	}

	res, err := pipeline.Run(ctx, pipeline.Options{
		DataDir:      *dataDir,
		CatalogDir:   *catalogDir,
		Platforms:    selected,
		Provider:     p,
		Budget:       budget.New(*callBudget),
		Now:          now,
		BackfillDays: *backfill,
		Log:          log,
	})
	if err != nil {
		log.Error("run failed", slog.String("err", err.Error()))
		return 1
	}

	log.Info("done",
		slog.Int("tracked", res.Tracked),
		slog.Int("ok", res.OK),
		slog.Int("stale", res.Stale),
		slog.Int("failed", res.Failed),
		slog.Int("api_calls", res.APICalls),
	)

	if res.Tracked > 0 && float64(res.OK)/float64(res.Tracked) < minSuccessRatio {
		log.Error("too many games failed to price; not treating this run as healthy",
			slog.Int("ok", res.OK), slog.Int("tracked", res.Tracked))
		return 1
	}
	return 0
}

func selectProvider(useFake bool, now time.Time) (provider.Provider, error) {
	if useFake {
		return fake.New(now), nil
	}
	if token := os.Getenv("PRICECHARTING_TOKEN"); token != "" {
		return pricecharting.New(token), nil
	}
	id, secret := os.Getenv("EBAY_CLIENT_ID"), os.Getenv("EBAY_CLIENT_SECRET")
	if id != "" && secret != "" {
		return ebay.New(id, secret), nil
	}
	return nil, fmt.Errorf("set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET, or pass -fake")
}

func parsePlatforms(s string) ([]catalog.Platform, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var out []catalog.Platform
	for _, part := range strings.Split(s, ",") {
		p := catalog.Platform(strings.ToLower(strings.TrimSpace(part)))
		if !p.Valid() {
			return nil, fmt.Errorf("unknown platform %q", part)
		}
		out = append(out, p)
	}
	return out, nil
}

// runAudit prints how each live listing was bucketed, which is how catalog
// query hints get tuned.
func runAudit(ctx context.Context, p provider.Provider, catalogDir string, selected []catalog.Platform) error {
	auditor, ok := p.(interface {
		Audit(context.Context, catalog.Game, io.Writer) error
	})
	if !ok {
		return fmt.Errorf("provider %q does not support -audit", p.Name())
	}
	games, err := catalog.Load(catalogDir)
	if err != nil {
		return err
	}
	if len(selected) > 0 {
		games = slices.DeleteFunc(games, func(g catalog.Game) bool {
			return !slices.Contains(selected, g.Platform)
		})
	}
	for _, g := range games {
		if err := auditor.Audit(ctx, g, os.Stdout); err != nil {
			fmt.Fprintf(os.Stdout, "%s: ERROR %v\n", g.ID, err)
		}
	}
	return nil
}
