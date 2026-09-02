// Package history maintains the append-only price series that the site charts.
// Two properties matter more than anything else here: re-running the collector
// on the same day must not grow the file, and identical data must serialize to
// identical bytes, or every scheduled run would commit a spurious diff.
package history

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/rflpazini/retroheat/internal/aggregate"
)

const (
	ResDaily  = "d"
	ResWeekly = "w"

	// DailyWindow is how long full-resolution points are kept before being
	// compacted to one point per ISO week.
	DailyWindow = 90 * 24 * time.Hour
)

type Point struct {
	Date  string `json:"d"`
	Res   string `json:"r"`
	Loose *int64 `json:"loose"`
	CIB   *int64 `json:"cib"`
	New   *int64 `json:"new"`
	NL    int    `json:"nl"`
	NC    int    `json:"nc"`
	NN    int    `json:"nn"`
}

type File struct {
	ID     string  `json:"id"`
	Points []Point `json:"points"`
}

// Upsert records p, replacing any point already stored for the same date.
func Upsert(f *File, p Point) {
	for i := range f.Points {
		if f.Points[i].Date == p.Date {
			f.Points[i] = p
			return
		}
	}
	f.Points = append(f.Points, p)
	slices.SortFunc(f.Points, func(a, b Point) int {
		switch {
		case a.Date < b.Date:
			return -1
		case a.Date > b.Date:
			return 1
		}
		return 0
	})
}

// Rollup compacts points older than window into a single weekly median,
// leaving recent points at full resolution. Running it repeatedly is a no-op.
func Rollup(f *File, now time.Time, window time.Duration) {
	cutoff := now.Add(-window).Format(time.DateOnly)

	var recent []Point
	weeks := map[string][]Point{}
	var order []string
	for _, p := range f.Points {
		key := weekStart(p.Date)
		// A week is folded only once all seven of its days are behind the
		// cutoff. The window advances a day at a time, so folding a week the
		// moment its Monday ages out would rebuild that week from a smaller
		// subset of its days on each of the next six runs: the stored value
		// would change daily and end up describing whichever day crossed last.
		if weekEnd(key) >= cutoff {
			recent = append(recent, p)
			continue
		}
		if _, seen := weeks[key]; !seen {
			order = append(order, key)
		}
		weeks[key] = append(weeks[key], p)
	}
	slices.Sort(order)

	out := make([]Point, 0, len(order)+len(recent))
	for _, key := range order {
		out = append(out, compactWeek(key, weeks[key]))
	}
	out = append(out, recent...)
	f.Points = out
}

func compactWeek(weekStartDate string, points []Point) Point {
	dailies := make([]Point, 0, len(points))
	for _, p := range points {
		if p.Res == ResDaily {
			dailies = append(dailies, p)
		}
	}
	if len(dailies) == 0 {
		// Already compacted on an earlier run.
		p := points[0]
		p.Date = weekStartDate
		p.Res = ResWeekly
		return p
	}
	return Point{
		Date:  weekStartDate,
		Res:   ResWeekly,
		Loose: medianPtr(dailies, func(p Point) *int64 { return p.Loose }),
		CIB:   medianPtr(dailies, func(p Point) *int64 { return p.CIB }),
		New:   medianPtr(dailies, func(p Point) *int64 { return p.New }),
		NL:    medianInt(dailies, func(p Point) int { return p.NL }),
		NC:    medianInt(dailies, func(p Point) int { return p.NC }),
		NN:    medianInt(dailies, func(p Point) int { return p.NN }),
	}
}

func medianPtr(points []Point, pick func(Point) *int64) *int64 {
	var vals []int64
	for _, p := range points {
		if v := pick(p); v != nil {
			vals = append(vals, *v)
		}
	}
	if len(vals) == 0 {
		return nil
	}
	m := aggregate.Median(vals)
	return &m
}

func medianInt(points []Point, pick func(Point) int) int {
	vals := make([]int64, 0, len(points))
	for _, p := range points {
		vals = append(vals, int64(pick(p)))
	}
	return int(aggregate.Median(vals))
}

func weekStart(date string) string {
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	return t.AddDate(0, 0, -(wd - 1)).Format(time.DateOnly)
}

func weekEnd(weekStartDate string) string {
	t, err := time.Parse(time.DateOnly, weekStartDate)
	if err != nil {
		return weekStartDate
	}
	return t.AddDate(0, 0, 6).Format(time.DateOnly)
}

func Path(dir, id string) string { return filepath.Join(dir, id+".json") }

// Read returns the stored history, or an empty one for a newly tracked game.
func Read(dir, id string) (*File, error) {
	data, err := os.ReadFile(Path(dir, id))
	if errors.Is(err, os.ErrNotExist) {
		return &File{ID: id}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read history %s: %w", id, err)
	}
	var f File
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("parse history %s: %w", id, err)
	}
	if f.ID == "" {
		f.ID = id
	}
	return &f, nil
}

func Write(dir string, f *File) error {
	if f.Points == nil {
		f.Points = []Point{}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(f); err != nil {
		return fmt.Errorf("encode history %s: %w", f.ID, err)
	}
	data := buf.Bytes()

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := Path(dir, f.ID)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write history %s: %w", f.ID, err)
	}
	return os.Rename(tmp, path)
}
