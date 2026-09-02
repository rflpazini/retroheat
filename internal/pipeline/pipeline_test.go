package pipeline_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/pipeline"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/fake"
	"github.com/rflpazini/retroheat/internal/snapshot"
)

const ps2YAML = `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    ebay: {query: "Silent Hill 2 PS2"}
  - id: god-hand-ps2
    title: "God Hand"
    ebay: {query: "God Hand PS2"}
`

var runDay = time.Date(2026, 9, 1, 9, 23, 41, 0, time.UTC)

func setup(t *testing.T) (dataDir, catalogDir string) {
	t.Helper()
	catalogDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(catalogDir, "ps2.yaml"), []byte(ps2YAML), 0o600); err != nil {
		t.Fatal(err)
	}
	return t.TempDir(), catalogDir
}

func opts(dataDir, catalogDir string, p provider.Provider) pipeline.Options {
	return pipeline.Options{
		DataDir:      dataDir,
		CatalogDir:   catalogDir,
		Provider:     p,
		Budget:       budget.New(0),
		Now:          runDay,
		BackfillDays: 60,
	}
}

func TestRunWritesEveryDataFile(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)

	res, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay)))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Tracked != 2 || res.OK != 2 {
		t.Fatalf("result = %+v, want 2 tracked and 2 ok", res)
	}

	for _, rel := range []string{
		"meta.json",
		"catalog.json",
		filepath.Join("latest", "ps2.json"),
		filepath.Join("trending", "ps2.json"),
		filepath.Join("trending", "all.json"),
		filepath.Join("history", "god-hand-ps2.json"),
		filepath.Join("history", "silent-hill-2-ps2.json"),
	} {
		if _, err := os.Stat(filepath.Join(dataDir, rel)); err != nil {
			t.Errorf("missing %s: %v", rel, err)
		}
	}
}

// The scheduled workflow runs twice a day. When prices have not moved, the
// second run of the day must not rewrite the data files, or every run would
// commit a diff across the whole catalog. Only meta.json, which carries the
// run timestamp, is allowed to change.
func TestSecondRunOfTheDayRewritesOnlyMeta(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	ctx := context.Background()

	morning := opts(dataDir, catalogDir, fake.New(runDay))
	if _, err := pipeline.Run(ctx, morning); err != nil {
		t.Fatal(err)
	}
	before := snapshotTree(t, dataDir)

	eveningRun := runDay.Add(12 * time.Hour)
	evening := opts(dataDir, catalogDir, fake.New(runDay))
	evening.Now = eveningRun
	if _, err := pipeline.Run(ctx, evening); err != nil {
		t.Fatal(err)
	}
	after := snapshotTree(t, dataDir)

	if len(before) != len(after) {
		t.Fatalf("file count changed: %d then %d", len(before), len(after))
	}
	for path, body := range before {
		if path == "meta.json" {
			continue
		}
		if after[path] != body {
			t.Errorf("%s changed on the second run of the same day; the scrape job would commit a spurious diff", path)
		}
	}
	if after["meta.json"] == before["meta.json"] {
		t.Error("meta.json did not change; the site would show a stale last-updated time")
	}
}

func TestRunPopulatesTrendingFromBackfilledHistory(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)

	if _, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay))); err != nil {
		t.Fatal(err)
	}
	latest, err := snapshot.ReadLatest(dataDir, catalog.PS2)
	if err != nil {
		t.Fatal(err)
	}
	if len(latest.Games) != 2 {
		t.Fatalf("latest has %d games, want 2", len(latest.Games))
	}
	for _, g := range latest.Games {
		if g.Pct7d == nil {
			t.Errorf("%s has no 7-day change despite 60 days of backfill", g.ID)
		}
		if len(g.Sparks.CIB) == 0 && len(g.Sparks.Loose) == 0 {
			t.Errorf("%s has an empty sparkline", g.ID)
		}
		if g.Prices.CIB == nil {
			t.Errorf("%s has no CIB price", g.ID)
		}
	}
}

// The curated "why it moved" note is the thing no competitor publishes, so it
// has to reach every game page, not only the games currently on a board.
func TestAnnotationsReachTheCatalogRegardlessOfRanking(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	if err := os.WriteFile(filepath.Join(catalogDir, "annotations.yaml"),
		[]byte("- game_id: god-hand-ps2\n  date: 2026-08-20\n  note: \"Clover nostalgia\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay))); err != nil {
		t.Fatal(err)
	}

	body, err := os.ReadFile(filepath.Join(dataDir, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat struct {
		Games []struct {
			ID         string `json:"id"`
			Annotation *struct {
				Note string `json:"note"`
			} `json:"annotation"`
		} `json:"games"`
	}
	if err := json.Unmarshal(body, &cat); err != nil {
		t.Fatal(err)
	}
	for _, g := range cat.Games {
		if g.ID != "god-hand-ps2" {
			continue
		}
		if g.Annotation == nil || g.Annotation.Note != "Clover nostalgia" {
			t.Fatalf("catalog.json lost the annotation for %s: %+v", g.ID, g.Annotation)
		}
		return
	}
	t.Fatal("god-hand-ps2 missing from catalog.json")
}

type failingProvider struct{}

func (failingProvider) Name() string     { return "failing" }
func (failingProvider) Kind() string     { return provider.KindAsking }
func (failingProvider) CostPerGame() int { return 1 }
func (failingProvider) Quotes(context.Context, catalog.Game) ([]provider.Quote, error) {
	return nil, errors.New("upstream down")
}

func TestRunKeepsPreviousPricesWhenTheProviderFails(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	ctx := context.Background()

	if _, err := pipeline.Run(ctx, opts(dataDir, catalogDir, fake.New(runDay))); err != nil {
		t.Fatal(err)
	}
	good, _ := snapshot.ReadLatest(dataDir, catalog.PS2)

	res, err := pipeline.Run(ctx, opts(dataDir, catalogDir, failingProvider{}))
	if err != nil {
		t.Fatalf("a total provider outage must still produce a snapshot: %v", err)
	}
	if res.Failed != 2 || res.Stale != 2 {
		t.Errorf("result = %+v, want 2 failed and 2 carried over as stale", res)
	}

	after, _ := snapshot.ReadLatest(dataDir, catalog.PS2)
	if len(after.Games) != len(good.Games) {
		t.Fatalf("games dropped out of the board: %d then %d", len(good.Games), len(after.Games))
	}
	for i, g := range after.Games {
		if !g.Stale {
			t.Errorf("%s not marked stale", g.ID)
		}
		if g.Prices.CIB == nil || good.Games[i].Prices.CIB == nil {
			t.Fatal("lost prices entirely")
		}
		if g.Prices.CIB.MedianCents != good.Games[i].Prices.CIB.MedianCents {
			t.Errorf("%s price changed during an outage", g.ID)
		}
	}
}

func TestRunStopsSpendingWhenTheBudgetRunsOut(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)

	o := opts(dataDir, catalogDir, countingProvider{})
	o.Budget = budget.New(1)
	res, err := pipeline.Run(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if res.APICalls != 1 {
		t.Errorf("APICalls = %d, want 1 (the budget caps the run)", res.APICalls)
	}
	if res.OK != 1 {
		t.Errorf("OK = %d, want 1 game priced before the budget ran out", res.OK)
	}
}

type countingProvider struct{}

func (countingProvider) Name() string     { return "counting" }
func (countingProvider) Kind() string     { return provider.KindAsking }
func (countingProvider) CostPerGame() int { return 1 }
func (countingProvider) Quotes(context.Context, catalog.Game) ([]provider.Quote, error) {
	return []provider.Quote{{Condition: "cib", MedianCents: 5000, SampleSize: 9}}, nil
}

type rateLimitedProvider struct{ calls atomic.Int32 }

func (p *rateLimitedProvider) Name() string     { return "limited" }
func (p *rateLimitedProvider) Kind() string     { return provider.KindAsking }
func (p *rateLimitedProvider) CostPerGame() int { return 1 }
func (p *rateLimitedProvider) Quotes(context.Context, catalog.Game) ([]provider.Quote, error) {
	p.calls.Add(1)
	return nil, fmt.Errorf("ebay search: %w", provider.ErrRateLimited)
}

// Hitting the daily quota means every remaining call fails the same way while
// still costing quota, so the run must stop asking rather than work through
// the rest of the catalog.
func TestRunStopsCallingTheProviderOnceRateLimited(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)

	p := &rateLimitedProvider{}
	res, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, p))
	if err != nil {
		t.Fatalf("a rate-limited run must still write a snapshot: %v", err)
	}
	if got := p.calls.Load(); got != 1 {
		t.Errorf("provider called %d times, want 1: the run kept spending quota after being rate limited", got)
	}
	if res.Failed != 2 {
		t.Errorf("Failed = %d, want both games reported as failed", res.Failed)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "meta.json")); err != nil {
		t.Errorf("no meta.json written: %v", err)
	}
}

func TestRunFiltersByPlatform(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	if err := os.WriteFile(filepath.Join(catalogDir, "n64.yaml"),
		[]byte("platform: n64\ngames:\n  - {id: conker-n64, title: \"Conker\", ebay: {query: \"Conker N64\"}}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	o := opts(dataDir, catalogDir, fake.New(runDay))
	o.Platforms = []catalog.Platform{catalog.PS2}
	res, err := pipeline.Run(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tracked != 2 {
		t.Errorf("Tracked = %d, want only the 2 PS2 games", res.Tracked)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "latest", "n64.json")); err == nil {
		t.Error("wrote an n64 board despite the platform filter")
	}
}

func TestRunRejectsAnInvalidCatalog(t *testing.T) {
	t.Parallel()
	dataDir := t.TempDir()
	catalogDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(catalogDir, "ps2.yaml"),
		[]byte("platform: ps2\ngames:\n  - {id: wrong-suffix, title: \"X\", ebay: {query: \"x\"}}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay))); err == nil {
		t.Error("Run accepted a catalog that fails validation")
	}
}

func snapshotTree(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		out[rel] = string(body)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}
