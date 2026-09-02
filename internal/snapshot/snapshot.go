// Package snapshot writes the JSON the site reads. Every writer here is
// deterministic: the scheduled run commits its output to git, so identical
// data must always produce identical bytes.
package snapshot

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/trending"
)

type Price struct {
	MedianCents int64 `json:"median_cents"`
	N           int   `json:"n"`
}

type Prices struct {
	Loose *Price `json:"loose,omitempty"`
	CIB   *Price `json:"cib,omitempty"`
	New   *Price `json:"new,omitempty"`
}

// Sparks carries one smoothed series per condition so each price column on a
// board can chart its own history.
type Sparks struct {
	Loose []int64 `json:"loose,omitempty"`
	CIB   []int64 `json:"cib,omitempty"`
	New   []int64 `json:"new,omitempty"`
}

type LatestGame struct {
	ID      string          `json:"id"`
	Title   string          `json:"title"`
	Region  catalog.Region  `json:"region"`
	Variant catalog.Variant `json:"variant"`
	Prices  Prices          `json:"prices"`
	Pct7d   *float64        `json:"pct_7d"`
	Pct30d  *float64        `json:"pct_30d"`
	Sparks  Sparks          `json:"sparks"`
	Stale   bool            `json:"stale"`
	AsOf    string          `json:"as_of"`
}

type Latest struct {
	Platform  catalog.Platform `json:"platform"`
	AsOf      string           `json:"as_of"`
	Source    string           `json:"source"`
	PriceKind string           `json:"price_kind"`
	Games     []LatestGame     `json:"games"`
}

type Trending struct {
	Board   string           `json:"board"`
	AsOf    string           `json:"as_of"`
	Entries []trending.Entry `json:"entries"`
}

type Counts struct {
	Tracked int `json:"tracked"`
	OK      int `json:"ok"`
	Stale   int `json:"stale"`
	Failed  int `json:"failed"`
}

type Meta struct {
	GeneratedAt  string             `json:"generated_at"`
	Source       string             `json:"source"`
	PriceKind    string             `json:"price_kind"`
	Counts       Counts             `json:"counts"`
	APICallsUsed int                `json:"api_calls_used"`
	Platforms    []catalog.Platform `json:"platforms"`
}

type CatalogGame struct {
	ID       string           `json:"id"`
	Title    string           `json:"title"`
	Platform catalog.Platform `json:"platform"`
	Region   catalog.Region   `json:"region"`
	Variant  catalog.Variant  `json:"variant"`
	IGDBID   int              `json:"igdb_id,omitempty"`
	EbayURL  string           `json:"ebay_url,omitempty"`

	// Editorial facts about the release, when a contributor has written them.
	Info *catalog.Info `json:"info,omitempty"`

	// Annotation travels with the catalog so a game page can always explain
	// why a price moved, not only while the game sits on a trending board.
	Annotation *catalog.Annotation `json:"annotation,omitempty"`
}

type Catalog struct {
	AsOf  string        `json:"as_of"`
	Games []CatalogGame `json:"games"`
}

func WriteLatest(dataDir string, l Latest) error {
	for i := range l.Games {
		l.Games[i].Pct7d = round2p(l.Games[i].Pct7d)
		l.Games[i].Pct30d = round2p(l.Games[i].Pct30d)
	}
	if l.Games == nil {
		l.Games = []LatestGame{}
	}
	return writeJSON(filepath.Join(dataDir, "latest", string(l.Platform)+".json"), l)
}

func ReadLatest(dataDir string, p catalog.Platform) (Latest, error) {
	path := filepath.Join(dataDir, "latest", string(p)+".json")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Latest{Platform: p}, nil
	}
	if err != nil {
		return Latest{}, fmt.Errorf("read latest %s: %w", p, err)
	}
	var l Latest
	if err := json.Unmarshal(data, &l); err != nil {
		return Latest{}, fmt.Errorf("parse latest %s: %w", p, err)
	}
	return l, nil
}

func WriteTrending(dataDir string, t Trending) error {
	for i := range t.Entries {
		t.Entries[i].Score = round2(t.Entries[i].Score)
		t.Entries[i].Pct7d = round2p(t.Entries[i].Pct7d)
		t.Entries[i].Pct30d = round2p(t.Entries[i].Pct30d)
	}
	if t.Entries == nil {
		t.Entries = []trending.Entry{}
	}
	return writeJSON(filepath.Join(dataDir, "trending", t.Board+".json"), t)
}

func WriteMeta(dataDir string, m Meta) error {
	return writeJSON(filepath.Join(dataDir, "meta.json"), m)
}

func WriteCatalog(dataDir string, c Catalog) error {
	if c.Games == nil {
		c.Games = []CatalogGame{}
	}
	return writeJSON(filepath.Join(dataDir, "catalog.json"), c)
}

// encode writes indented JSON without HTML escaping, so a title like
// "Beyond Good & Evil" stays readable in the committed diff instead of
// becoming "Beyond Good & Evil".
func encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func round2p(f *float64) *float64 {
	if f == nil {
		return nil
	}
	r := round2(*f)
	return &r
}

func writeJSON(path string, v any) error {
	data, err := encode(v)
	if err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return os.Rename(tmp, path)
}
