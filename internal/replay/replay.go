// Package replay rebuilds history points from archived listings using the
// rules in force now. It is how a classifier change reaches the past without
// deleting anything: the same market, judged again. A replay replaces the
// points for the dates it covers and leaves every other point alone.
package replay

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"slices"
	"sort"
	"time"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/pipeline"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
	"github.com/rflpazini/retroheat/internal/rawarchive"
)

type Options struct {
	ArchiveDir string
	DataDir    string
	CatalogDir string
	// From and To bound the run days replayed, inclusive, as YYYY-MM-DD;
	// empty means unbounded.
	From, To string
	// Prune removes a day's point when no archived run can price it. Off by
	// default: the archive does not cover every run that ever wrote a point,
	// so an unpriceable day is more likely a gap in the archive than a market
	// that offered nothing.
	Prune  bool
	DryRun bool
	Now    time.Time
	Log    *slog.Logger
}

type Summary struct {
	// Runs is the number of archives that fell inside the date bounds.
	Runs int
	// Games is the number of history files that changed, or would change.
	Games    int
	Replaced int
	Added    int
	// Unpriceable counts dates the archive could not price that were left
	// standing; Removed counts those pruned. Removing a point is the one thing
	// the data guard refuses, so a commit carrying removals needs a Data-Reset
	// trailer.
	Unpriceable int
	Removed     int
	// Skipped counts records for games that have since left the catalog.
	Skipped int
}

// Run reads every archive under ArchiveDir, judges each game's listings with
// the current eBay rules and classifier, and writes the resulting points into
// the history files. Later runs on the same day win, as they do in production.
func Run(o Options) (Summary, error) {
	log := o.Log
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	var sum Summary

	games, err := catalog.Load(o.CatalogDir)
	if err != nil {
		return sum, err
	}
	if err := catalog.Validate(games); err != nil {
		return sum, fmt.Errorf("catalog validation failed: %w", err)
	}
	byID := make(map[string]catalog.Game, len(games))
	for _, g := range games {
		byID[g.ID] = g
	}

	runs, err := readArchives(o.ArchiveDir)
	if err != nil {
		return sum, err
	}

	// desired[id][day] is the point the archives imply for that day, or nil
	// when the listings yield nothing publishable under today's rules.
	desired := map[string]map[string]*history.Point{}
	for _, r := range runs {
		if r.Source != ebay.Name {
			log.Warn("archive from another provider skipped", slog.String("source", r.Source))
			continue
		}
		day, err := r.Day()
		if err != nil {
			return sum, err
		}
		if (o.From != "" && day < o.From) || (o.To != "" && day > o.To) {
			continue
		}
		sum.Runs++
		for _, rec := range r.Games {
			if rec.Err != "" {
				continue
			}
			g, ok := byID[rec.ID]
			if !ok {
				sum.Skipped++
				log.Warn("archived game no longer in the catalog", slog.String("game", rec.ID))
				continue
			}
			if desired[rec.ID] == nil {
				desired[rec.ID] = map[string]*history.Point{}
			}
			quotes, err := ebay.QuotesFromListings(g, rawarchive.ToListings(rec.Listings))
			if err != nil {
				// Nothing publishable in this run. Live, that run would have
				// failed the game and left an earlier run's point standing,
				// so only mark the day for removal if no run priced it.
				if _, priced := desired[rec.ID][day]; !priced {
					desired[rec.ID][day] = nil
				}
				continue
			}
			pt := pipeline.PointFrom(quotes, day, classify.SeriesVersion)
			desired[rec.ID][day] = &pt
		}
	}

	historyDir := filepath.Join(o.DataDir, "history")
	ids := make([]string, 0, len(desired))
	for id := range desired {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		hf, err := history.Read(historyDir, id)
		if err != nil {
			return sum, err
		}
		before := make(map[string]history.Point, len(hf.Points))
		for _, p := range hf.Points {
			before[p.Date] = p
		}
		days := make([]string, 0, len(desired[id]))
		for d := range desired[id] {
			days = append(days, d)
		}
		sort.Strings(days)

		changed := false
		for _, day := range days {
			pt := desired[id][day]
			if pt == nil {
				if _, had := before[day]; !had {
					continue
				}
				if !o.Prune {
					sum.Unpriceable++
					log.Info("point kept: the archive cannot price this day", slog.String("game", id), slog.String("date", day))
					continue
				}
				if history.Remove(hf, day) {
					sum.Removed++
					changed = true
					log.Info("point removed: nothing publishable under current rules", slog.String("game", id), slog.String("date", day))
				}
				continue
			}
			// A day inside an already compacted week goes back to daily
			// resolution; Rollup folds the week again below.
			if history.RemoveWeekly(hf, day) {
				changed = true
			}
			prev, had := before[day]
			history.Upsert(hf, *pt)
			switch {
			case !had:
				sum.Added++
				changed = true
			case !prev.Equal(*pt):
				sum.Replaced++
				changed = true
			}
		}
		if !changed {
			continue
		}
		sum.Games++
		history.Rollup(hf, o.Now.UTC(), history.DailyWindow)
		if o.DryRun {
			continue
		}
		if err := history.Write(historyDir, hf); err != nil {
			return sum, err
		}
	}
	return sum, nil
}

func readArchives(dir string) ([]*rawarchive.Run, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "raw-*.json.gz"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no raw-*.json.gz archives under %s", dir)
	}
	runs := make([]*rawarchive.Run, 0, len(paths))
	for _, p := range paths {
		r, err := rawarchive.Read(p)
		if err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	slices.SortFunc(runs, func(a, b *rawarchive.Run) int {
		switch {
		case a.GeneratedAt < b.GeneratedAt:
			return -1
		case a.GeneratedAt > b.GeneratedAt:
			return 1
		}
		return 0
	})
	return runs, nil
}
