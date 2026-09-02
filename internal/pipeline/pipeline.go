// Package pipeline runs one collection pass: price every tracked game, extend
// its history, and rewrite the JSON the site serves. A single game failing
// must never cost the whole run, so failures fall back to the last known price
// and are reported as stale.
package pipeline

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"path/filepath"
	"slices"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/snapshot"
	"github.com/rflpazini/retroheat/internal/trending"
)

const (
	PlatformBoardSize = 25
	GlobalBoardSize   = 20
)

type Options struct {
	DataDir      string
	CatalogDir   string
	Platforms    []catalog.Platform
	Provider     provider.Provider
	Budget       *budget.Budget
	Now          time.Time
	BackfillDays int
	Audit        io.Writer
	Log          *slog.Logger
}

type Result struct {
	Tracked  int
	OK       int
	Stale    int
	Failed   int
	APICalls int
}

// backfiller is implemented by providers that can invent a plausible history,
// which is what makes a fresh checkout render charts immediately.
type backfiller interface {
	Backfill(g catalog.Game, days int, asOf time.Time) []history.Point
}

func Run(ctx context.Context, o Options) (Result, error) {
	log := o.Log
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}

	games, err := catalog.Load(o.CatalogDir)
	if err != nil {
		return Result{}, err
	}
	if err := catalog.Validate(games); err != nil {
		return Result{}, fmt.Errorf("catalog validation failed: %w", err)
	}
	anns, err := catalog.LoadAnnotations(filepath.Join(o.CatalogDir, catalog.AnnotationsFile), games)
	if err != nil {
		return Result{}, err
	}
	latestAnn := catalog.Latest(anns)

	if len(o.Platforms) > 0 {
		games = slices.DeleteFunc(games, func(g catalog.Game) bool {
			return !slices.Contains(o.Platforms, g.Platform)
		})
	}
	platforms := platformsOf(games)

	previous := map[catalog.Platform]snapshot.Latest{}
	for _, p := range platforms {
		prev, err := snapshot.ReadLatest(o.DataDir, p)
		if err != nil {
			return Result{}, err
		}
		previous[p] = prev
	}

	historyDir := filepath.Join(o.DataDir, "history")
	generatedAt := o.Now.UTC().Format(time.RFC3339)
	today := o.Now.UTC().Format(time.DateOnly)

	res := Result{Tracked: len(games)}
	boards := map[catalog.Platform][]snapshot.LatestGame{}
	var allEntries []trending.Entry

	// Once the provider reports rate limiting, every remaining call would fail
	// the same way while still spending quota, so the run stops pricing and
	// carries the rest over as stale.
	rateLimited := false

	for _, g := range games {
		var (
			quotes []provider.Quote
			err    error
		)
		if rateLimited {
			err = provider.ErrRateLimited
		} else if quotes, err = priceOne(ctx, o, g); errors.Is(err, provider.ErrRateLimited) {
			log.Error("provider rate limited; not calling it again this run", slog.String("game", g.ID))
			rateLimited = true
		}
		if err != nil {
			log.Warn("pricing failed", slog.String("game", g.ID), slog.String("err", err.Error()))
			res.Failed++
			if carried, ok := carryOver(previous[g.Platform], g.ID); ok {
				carried.Stale = true
				boards[g.Platform] = append(boards[g.Platform], carried)
				res.Stale++
			}
			continue
		}

		hf, err := history.Read(historyDir, g.ID)
		if err != nil {
			return Result{}, err
		}
		if len(hf.Points) == 0 && o.BackfillDays > 0 {
			if bf, ok := o.Provider.(backfiller); ok {
				hf.Points = bf.Backfill(g, o.BackfillDays, o.Now.UTC())
			}
		}
		history.Upsert(hf, pointFrom(quotes, today))
		history.Rollup(hf, o.Now.UTC(), history.DailyWindow)
		if err := history.Write(historyDir, hf); err != nil {
			return Result{}, err
		}

		board := snapshot.LatestGame{
			ID:      g.ID,
			Title:   g.Title,
			Region:  g.Region,
			Variant: g.Variant,
			Prices:  pricesFrom(quotes),
			AsOf:    today,
		}
		if m, ok := trending.Measure(hf.Points, o.Now.UTC()); ok {
			board.Pct7d, board.Pct30d = m.Pct7d, m.Pct30d
		}
		board.Sparks = snapshot.Sparks{
			Loose: trending.SparkFor(hf.Points, classify.Loose),
			CIB:   trending.SparkFor(hf.Points, classify.CIB),
			New:   trending.SparkFor(hf.Points, classify.New),
		}
		boards[g.Platform] = append(boards[g.Platform], board)
		res.OK++

		if e, ok := trending.Compute(trending.Input{
			ID: g.ID, Title: g.Title, Platform: g.Platform, Points: hf.Points,
		}, o.Now.UTC()); ok {
			if a, has := latestAnn[g.ID]; has {
				ann := a
				e.Annotation = &ann
			}
			allEntries = append(allEntries, e)
		}
	}

	for _, p := range platforms {
		if err := snapshot.WriteLatest(o.DataDir, snapshot.Latest{
			Platform:  p,
			AsOf:      today,
			Source:    o.Provider.Name(),
			PriceKind: o.Provider.Kind(),
			Games:     boards[p],
		}); err != nil {
			return Result{}, err
		}

		var forPlatform []trending.Entry
		for _, e := range allEntries {
			if e.Platform == p {
				forPlatform = append(forPlatform, e)
			}
		}
		if err := snapshot.WriteTrending(o.DataDir, snapshot.Trending{
			Board:   string(p),
			AsOf:    today,
			Entries: trending.Rank(forPlatform, PlatformBoardSize),
		}); err != nil {
			return Result{}, err
		}
	}

	if err := snapshot.WriteTrending(o.DataDir, snapshot.Trending{
		Board:   "all",
		AsOf:    today,
		Entries: trending.Rank(allEntries, GlobalBoardSize),
	}); err != nil {
		return Result{}, err
	}

	res.APICalls = o.Budget.Used()
	if err := snapshot.WriteMeta(o.DataDir, snapshot.Meta{
		GeneratedAt:  generatedAt,
		Source:       o.Provider.Name(),
		PriceKind:    o.Provider.Kind(),
		Counts:       snapshot.Counts{Tracked: res.Tracked, OK: res.OK, Stale: res.Stale, Failed: res.Failed},
		APICallsUsed: res.APICalls,
		Platforms:    platforms,
	}); err != nil {
		return Result{}, err
	}
	if err := snapshot.WriteCatalog(o.DataDir, snapshot.Catalog{
		AsOf:  today,
		Games: catalogEntries(games, latestAnn),
	}); err != nil {
		return Result{}, err
	}
	return res, nil
}

func priceOne(ctx context.Context, o Options, g catalog.Game) ([]provider.Quote, error) {
	if !o.Budget.Allow(o.Provider.CostPerGame()) {
		return nil, fmt.Errorf("api budget exhausted")
	}
	quotes, err := o.Provider.Quotes(ctx, g)
	if err != nil {
		return nil, err
	}
	if len(quotes) == 0 {
		return nil, provider.ErrNoData
	}
	return quotes, nil
}

func pointFrom(quotes []provider.Quote, date string) history.Point {
	p := history.Point{Date: date, Res: history.ResDaily}
	for _, q := range quotes {
		cents := q.MedianCents
		switch q.Condition {
		case classify.Loose:
			p.Loose, p.NL = &cents, q.SampleSize
		case classify.CIB:
			p.CIB, p.NC = &cents, q.SampleSize
		case classify.New:
			p.New, p.NN = &cents, q.SampleSize
		}
	}
	return p
}

func pricesFrom(quotes []provider.Quote) snapshot.Prices {
	var out snapshot.Prices
	for _, q := range quotes {
		price := &snapshot.Price{MedianCents: q.MedianCents, ModeCents: q.ModeCents, N: q.SampleSize}
		switch q.Condition {
		case classify.Loose:
			out.Loose = price
		case classify.CIB:
			out.CIB = price
		case classify.New:
			out.New = price
		}
	}
	return out
}

func carryOver(prev snapshot.Latest, id string) (snapshot.LatestGame, bool) {
	for _, g := range prev.Games {
		if g.ID == id {
			return g, true
		}
	}
	return snapshot.LatestGame{}, false
}

func platformsOf(games []catalog.Game) []catalog.Platform {
	var out []catalog.Platform
	for _, p := range catalog.Platforms {
		if slices.ContainsFunc(games, func(g catalog.Game) bool { return g.Platform == p }) {
			out = append(out, p)
		}
	}
	return out
}

// WriteCatalogOnly rewrites catalog.json from the YAML without pricing
// anything, for when only the editorial layer changed and a full run would
// spend the day's API budget to republish a paragraph.
func WriteCatalogOnly(dataDir, catalogDir string, now time.Time) error {
	games, err := catalog.Load(catalogDir)
	if err != nil {
		return err
	}
	if err := catalog.Validate(games); err != nil {
		return fmt.Errorf("catalog validation failed: %w", err)
	}
	anns, err := catalog.LoadAnnotations(filepath.Join(catalogDir, catalog.AnnotationsFile), games)
	if err != nil {
		return err
	}
	return snapshot.WriteCatalog(dataDir, snapshot.Catalog{
		AsOf:  now.UTC().Format(time.DateOnly),
		Games: catalogEntries(games, catalog.Latest(anns)),
	})
}

func catalogEntries(games []catalog.Game, anns map[string]catalog.Annotation) []snapshot.CatalogGame {
	out := make([]snapshot.CatalogGame, 0, len(games))
	for _, g := range games {
		entry := snapshot.CatalogGame{
			ID:       g.ID,
			Title:    g.Title,
			Platform: g.Platform,
			Region:   g.Region,
			Variant:  g.Variant,
			IGDBID:   g.IGDBID,
			EbayURL:  "https://www.ebay.com/sch/i.html?_nkw=" + url.QueryEscape(g.Ebay.Query),
			Info:     g.Info,
		}
		if a, ok := anns[g.ID]; ok {
			ann := a
			entry.Annotation = &ann
		}
		out = append(out, entry)
	}
	return out
}
