package pipeline_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/pipeline"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
	"github.com/rflpazini/retroheat/internal/provider/fake"
	"github.com/rflpazini/retroheat/internal/rawarchive"
	"github.com/rflpazini/retroheat/internal/snapshot"
	"github.com/rflpazini/retroheat/internal/trending"
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

func TestPartialRunKeepsOtherPlatformsOnTheSite(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	if err := os.WriteFile(filepath.Join(catalogDir, "n64.yaml"),
		[]byte("platform: n64\ngames:\n  - {id: conker-n64, title: \"Conker\", ebay: {query: \"Conker N64\"}}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// A full run first, then a run limited to PS2, as a manual dispatch with
	// a platforms input would do.
	if _, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay))); err != nil {
		t.Fatal(err)
	}
	o := opts(dataDir, catalogDir, fake.New(runDay))
	o.Platforms = []catalog.Platform{catalog.PS2}
	if _, err := pipeline.Run(context.Background(), o); err != nil {
		t.Fatal(err)
	}

	all, err := snapshot.ReadTrending(dataDir, "all")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(all.Entries, func(e trending.Entry) bool { return e.Platform == catalog.N64 }) {
		t.Error("the global board lost its N64 entry after a PS2-only run")
	}

	raw, err := os.ReadFile(filepath.Join(dataDir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta snapshot.Meta
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(meta.Platforms, catalog.N64) {
		t.Errorf("meta.platforms = %v, want N64 still listed after a PS2-only run", meta.Platforms)
	}

	// The search palette and the game pages read catalog.json, so it must
	// keep every game, not only the platforms that were priced.
	rawCat, err := os.ReadFile(filepath.Join(dataDir, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat snapshot.Catalog
	if err := json.Unmarshal(rawCat, &cat); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(cat.Games, func(g snapshot.CatalogGame) bool { return g.ID == "conker-n64" }) {
		t.Error("catalog.json lost the N64 game after a PS2-only run")
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

func TestPointFromStampsTheGivenVersion(t *testing.T) {
	t.Parallel()
	p := pipeline.PointFrom([]provider.Quote{{Condition: "cib", MedianCents: 5000, SampleSize: 9}}, "2026-09-01", 7)
	if p.V != 7 {
		t.Errorf("v = %d, want 7", p.V)
	}
	if p.CIB == nil || *p.CIB != 5000 || p.NC != 9 {
		t.Errorf("point = %+v, want cib 5000 from 9 listings", p)
	}
}

// Every point a run writes, live or backfilled, belongs to the current series.
// An unstamped backfill would sit at version 0 and the boards it exists to
// populate would stay empty.
func TestRunStampsNewAndBackfilledPointsWithTheSeriesVersion(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	if _, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, fake.New(runDay))); err != nil {
		t.Fatal(err)
	}
	hf, err := history.Read(filepath.Join(dataDir, "history"), "god-hand-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if len(hf.Points) < 2 {
		t.Fatalf("points = %d, want the backfill plus today", len(hf.Points))
	}
	for _, p := range hf.Points {
		if p.V != classify.SeriesVersion {
			t.Errorf("point %s has v=%d, want %d", p.Date, p.V, classify.SeriesVersion)
		}
	}

	raw, err := os.ReadFile(filepath.Join(dataDir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta snapshot.Meta
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.SeriesVersion != classify.SeriesVersion {
		t.Errorf("meta.series_version = %d, want %d", meta.SeriesVersion, classify.SeriesVersion)
	}
}

// listingProvider is the shape of the live eBay client: it exposes what it
// saw and judges it with the real eBay rules, over synthetic titles.
type listingProvider struct{ fail map[string]bool }

func (listingProvider) Name() string     { return ebay.Name }
func (listingProvider) Kind() string     { return provider.KindAsking }
func (listingProvider) CostPerGame() int { return 1 }

func (p listingProvider) Listings(_ context.Context, g catalog.Game) (provider.Sample, error) {
	if p.fail[g.ID] {
		return provider.Sample{}, errors.New("upstream down")
	}
	return provider.Sample{Query: g.Ebay.Query, Listings: syntheticListings(g)}, nil
}

func (listingProvider) QuotesFromListings(g catalog.Game, ls []provider.Listing) ([]provider.Quote, error) {
	return ebay.QuotesFromListings(g, ls)
}

func (p listingProvider) Quotes(ctx context.Context, g catalog.Game) ([]provider.Quote, error) {
	s, err := p.Listings(ctx, g)
	if err != nil {
		return nil, err
	}
	return ebay.QuotesFromListings(g, s.Listings)
}

func syntheticListings(g catalog.Game) []provider.Listing {
	var out []provider.Listing
	for i := range 5 {
		out = append(out,
			provider.Listing{ItemID: fmt.Sprintf("v1|c%d|0", i), Title: g.Title + " PS2 Complete CIB", PriceCents: 9000 + int64(i)*200, Currency: "USD"},
			provider.Listing{ItemID: fmt.Sprintf("v1|l%d|0", i), Title: g.Title + " (PlayStation 2) Disc Only", PriceCents: 4000 + int64(i)*200, Currency: "USD"},
		)
	}
	return out
}

func TestRunWritesARawArchiveForListingProviders(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)
	rawDir := t.TempDir()

	o := opts(dataDir, catalogDir, listingProvider{fail: map[string]bool{"god-hand-ps2": true}})
	o.RawDir = rawDir
	res, err := pipeline.Run(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if res.OK != 1 || res.Failed != 1 {
		t.Fatalf("result = %+v, want 1 ok and 1 failed", res)
	}

	files, _ := filepath.Glob(filepath.Join(rawDir, "raw-*.json.gz"))
	if len(files) != 1 {
		t.Fatalf("archives = %v, want exactly one", files)
	}
	run, err := rawarchive.Read(files[0])
	if err != nil {
		t.Fatal(err)
	}
	if run.Source != ebay.Name || run.SeriesVersion != classify.SeriesVersion || run.GeneratedAt != runDay.Format(time.RFC3339) {
		t.Errorf("archive header = %+v, want the run's provider, version and time", run)
	}
	if len(run.Games) != 2 {
		t.Fatalf("archive has %d games, want a record for every tracked game", len(run.Games))
	}
	byID := map[string]rawarchive.Game{}
	for _, g := range run.Games {
		byID[g.ID] = g
	}
	if got := byID["silent-hill-2-ps2"]; len(got.Listings) != 10 || got.Query != "Silent Hill 2 PS2" || got.Err != "" {
		t.Errorf("priced game record = %+v, want its 10 listings and query", got)
	}
	if got := byID["god-hand-ps2"]; got.Err == "" || len(got.Listings) != 0 {
		t.Errorf("failed game record = %+v, want the error and no listings", got)
	}
}

func TestRunWithoutARawDirWritesNoArchive(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir := setup(t)

	res, err := pipeline.Run(context.Background(), opts(dataDir, catalogDir, listingProvider{}))
	if err != nil {
		t.Fatal(err)
	}
	if res.OK != 2 {
		t.Errorf("OK = %d, want 2: a listing provider prices normally without archiving", res.OK)
	}
	files, _ := filepath.Glob(filepath.Join(dataDir, "**", "raw-*.json.gz"))
	if len(files) != 0 {
		t.Errorf("an archive appeared under the data directory: %v", files)
	}
}
