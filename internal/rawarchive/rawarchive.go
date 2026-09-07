// Package rawarchive is the record of what a run saw before it judged
// anything: every listing, per game, with the query that found it. A history
// point is a few numbers derived from those listings by rules that change.
// Keeping the listings means a rule change can be replayed over the same
// market instead of wiping what the old rules wrote.
//
// One file per run, gzip-compressed JSON with short keys, about 400 KB for a
// full catalog. The files are published as release assets rather than
// committed: two a day would outgrow the repository within a year.
package rawarchive

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rflpazini/retroheat/internal/provider"
)

// Schema is bumped when the file format changes incompatibly. Read refuses
// files it does not understand instead of guessing.
const Schema = 1

type Run struct {
	Schema      int    `json:"schema"`
	GeneratedAt string `json:"generated_at"`
	Source      string `json:"source"`
	// SeriesVersion is the classifier version the run itself applied, for
	// the record; a replay applies whatever version is current.
	SeriesVersion int    `json:"series_version"`
	Games         []Game `json:"games"`
}

type Game struct {
	ID    string `json:"id"`
	Query string `json:"q"`
	// Err is set when the search failed and no listings were seen, so a
	// replay can tell "not fetched" from "fetched and nothing usable".
	Err      string    `json:"err,omitempty"`
	Listings []Listing `json:"listings"`
}

type Listing struct {
	ItemID     string `json:"i"`
	Title      string `json:"t"`
	PriceCents int64  `json:"p"`
	Currency   string `json:"c"`
}

// Record appends one game's outcome. It is safe on a nil Run, so callers can
// keep one code path whether or not archiving is on.
func (r *Run) Record(id, query string, ls []provider.Listing, err error) {
	if r == nil {
		return
	}
	g := Game{ID: id, Query: query, Listings: FromListings(ls)}
	if err != nil {
		g.Err = err.Error()
	}
	r.Games = append(r.Games, g)
}

// Day is the UTC calendar day the run happened on, the date its points carry.
func (r *Run) Day() (string, error) {
	t, err := time.Parse(time.RFC3339, r.GeneratedAt)
	if err != nil {
		return "", fmt.Errorf("archive generated_at %q: %w", r.GeneratedAt, err)
	}
	return t.UTC().Format(time.DateOnly), nil
}

func FromListings(ls []provider.Listing) []Listing {
	out := make([]Listing, 0, len(ls))
	for _, l := range ls {
		out = append(out, Listing{ItemID: l.ItemID, Title: l.Title, PriceCents: l.PriceCents, Currency: l.Currency})
	}
	return out
}

func ToListings(ls []Listing) []provider.Listing {
	out := make([]provider.Listing, 0, len(ls))
	for _, l := range ls {
		out = append(out, provider.Listing{ItemID: l.ItemID, Title: l.Title, PriceCents: l.PriceCents, Currency: l.Currency})
	}
	return out
}

// FileName names a run's archive by its UTC start time, so a directory listing
// sorts chronologically and two runs a day never collide.
func FileName(now time.Time) string {
	return "raw-" + now.UTC().Format("20060102T150405Z") + ".json.gz"
}

// Write stores the run at path. The bytes are a pure function of the run:
// compact JSON with a fixed field order inside a gzip stream with an empty
// header, so rewriting the same run produces the same file.
func Write(path string, run *Run) error {
	var buf bytes.Buffer
	gz, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(gz)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(run); err != nil {
		return fmt.Errorf("encode raw archive: %w", err)
	}
	if err := gz.Close(); err != nil {
		return fmt.Errorf("compress raw archive: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return fmt.Errorf("write raw archive: %w", err)
	}
	return os.Rename(tmp, path)
}

func Read(path string) (*Run, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	defer gz.Close()
	var run Run
	if err := json.NewDecoder(gz).Decode(&run); err != nil {
		return nil, fmt.Errorf("%s: decode: %w", path, err)
	}
	if run.Schema != Schema {
		return nil, fmt.Errorf("%s: schema %d, this build reads %d", path, run.Schema, Schema)
	}
	return &run, nil
}
