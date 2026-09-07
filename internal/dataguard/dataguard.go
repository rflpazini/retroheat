// Package dataguard compares two snapshots of the collector's data directory
// and reports anything the newer one lost. The collector only ever adds or
// replaces points, so a history file or a date that disappears means a wipe,
// a bad merge, or an overlapping run overwriting another; none of those should
// reach the default branch unnoticed.
package dataguard

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/snapshot"
)

// Violation is one thing the newer snapshot lost.
type Violation struct {
	// Path is relative to the data directory, e.g. history/bully-ps2.json.
	Path   string
	Detail string
}

func (v Violation) String() string { return v.Path + ": " + v.Detail }

// Report summarises a comparison. Replaced counts same-date points whose
// values changed, which is what a second run on the same day does and is
// always allowed; it is reported so a reader can see the guard looked.
type Report struct {
	Violations []Violation
	Replaced   int
	Added      int
}

// OK reports whether nothing was lost.
func (r Report) OK() bool { return len(r.Violations) == 0 }

// Compare reads the history files, boards and catalog under beforeDir and
// afterDir and reports what after lost. A daily point may disappear only when
// its ISO week has been compacted into a weekly point; a game may leave a
// board only when it has also left the catalog.
func Compare(beforeDir, afterDir string) (Report, error) {
	var rep Report
	if err := compareHistory(beforeDir, afterDir, &rep); err != nil {
		return rep, err
	}
	if err := compareLatest(beforeDir, afterDir, &rep); err != nil {
		return rep, err
	}
	sort.Slice(rep.Violations, func(i, j int) bool {
		if rep.Violations[i].Path != rep.Violations[j].Path {
			return rep.Violations[i].Path < rep.Violations[j].Path
		}
		return rep.Violations[i].Detail < rep.Violations[j].Detail
	})
	return rep, nil
}

func compareHistory(beforeDir, afterDir string, rep *Report) error {
	beforeHist := filepath.Join(beforeDir, "history")
	afterHist := filepath.Join(afterDir, "history")
	ids, err := historyIDs(beforeHist)
	if err != nil {
		return err
	}
	for _, id := range ids {
		rel := filepath.ToSlash(filepath.Join("history", id+".json"))
		if _, err := os.Stat(history.Path(afterHist, id)); errors.Is(err, os.ErrNotExist) {
			rep.Violations = append(rep.Violations, Violation{rel, "history file deleted"})
			continue
		} else if err != nil {
			return err
		}
		before, err := history.Read(beforeHist, id)
		if err != nil {
			return err
		}
		after, err := history.Read(afterHist, id)
		if err != nil {
			return err
		}
		byDate := make(map[string]history.Point, len(after.Points))
		for _, p := range after.Points {
			byDate[p.Date] = p
		}
		for _, p := range before.Points {
			q, ok := byDate[p.Date]
			switch {
			case ok:
				if !samePoint(p, q) {
					rep.Replaced++
				}
			case p.Res == history.ResDaily && rolledUp(byDate, p.Date):
				// The week aged past the daily window and was compacted;
				// the value lives on in the weekly median.
			default:
				rep.Violations = append(rep.Violations, Violation{rel, fmt.Sprintf("point %s (%s) removed", p.Date, p.Res)})
			}
		}
		if extra := len(after.Points) - len(before.Points); extra > 0 {
			rep.Added += extra
		}
	}
	return nil
}

func rolledUp(after map[string]history.Point, date string) bool {
	w, ok := after[history.WeekStart(date)]
	return ok && w.Res == history.ResWeekly
}

func samePoint(a, b history.Point) bool {
	return a.Res == b.Res && a.V == b.V &&
		sameCents(a.Loose, b.Loose) && sameCents(a.CIB, b.CIB) && sameCents(a.New, b.New) &&
		a.NL == b.NL && a.NC == b.NC && a.NN == b.NN
}

func sameCents(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func historyIDs(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		ids = append(ids, strings.TrimSuffix(e.Name(), ".json"))
	}
	sort.Strings(ids)
	return ids, nil
}

func compareLatest(beforeDir, afterDir string, rep *Report) error {
	entries, err := os.ReadDir(filepath.Join(beforeDir, "latest"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	tracked, err := trackedIDs(afterDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		p := catalog.Platform(strings.TrimSuffix(e.Name(), ".json"))
		rel := "latest/" + e.Name()
		if _, err := os.Stat(filepath.Join(afterDir, "latest", e.Name())); errors.Is(err, os.ErrNotExist) {
			rep.Violations = append(rep.Violations, Violation{rel, "board deleted"})
			continue
		} else if err != nil {
			return err
		}
		before, err := snapshot.ReadLatest(beforeDir, p)
		if err != nil {
			return err
		}
		after, err := snapshot.ReadLatest(afterDir, p)
		if err != nil {
			return err
		}
		present := make(map[string]bool, len(after.Games))
		for _, g := range after.Games {
			present[g.ID] = true
		}
		for _, g := range before.Games {
			if present[g.ID] {
				continue
			}
			if tracked != nil && !tracked[g.ID] {
				// Removed from the catalog on purpose; leaving the board is
				// the expected consequence.
				continue
			}
			rep.Violations = append(rep.Violations, Violation{rel, fmt.Sprintf("tracked game %s dropped from the board", g.ID)})
		}
	}
	return nil
}

// trackedIDs returns the ids in after's catalog.json, or nil when there is no
// catalog to consult, in which case every game counts as tracked.
func trackedIDs(dir string) (map[string]bool, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "catalog.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var c snapshot.Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("parse catalog.json: %w", err)
	}
	out := make(map[string]bool, len(c.Games))
	for _, g := range c.Games {
		out[g.ID] = true
	}
	return out, nil
}

var resetTrailer = regexp.MustCompile(`(?m)^Data-Reset:[ \t]*\S`)

// HasResetTrailer reports whether a commit message carries a Data-Reset
// trailer with a reason, the one deliberate way past the guard.
func HasResetTrailer(messages string) bool {
	return resetTrailer.MatchString(messages)
}
