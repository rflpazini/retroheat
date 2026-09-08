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
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/trending"
)

type Price struct {
	MedianCents int64 `json:"median_cents"`
	// ModeCents is omitted for providers that supply one figure per condition
	// rather than a sample of listings.
	ModeCents int64 `json:"mode_cents,omitempty"`
	// Q1Cents and Q3Cents bound the middle half of the asking prices, so a
	// reader can tell whether one high listing is the top of the market or a
	// fantasy. Omitted for single-figure providers.
	Q1Cents int64 `json:"q1_cents,omitempty"`
	Q3Cents int64 `json:"q3_cents,omitempty"`
	N       int   `json:"n"`
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
	Pct1d   *float64        `json:"pct_1d"`
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
	// PerPlatform is how many games each board holds, so a page that only
	// needs the number does not have to download the board.
	PerPlatform map[catalog.Platform]int `json:"per_platform,omitempty"`
}

type Meta struct {
	GeneratedAt string `json:"generated_at"`
	Source      string `json:"source"`
	PriceKind   string `json:"price_kind"`
	// SeriesVersion is the classifier version this run wrote, so a bump can
	// be confirmed on the live site without reading a history file.
	SeriesVersion int                `json:"series_version"`
	Counts        Counts             `json:"counts"`
	APICallsUsed  int                `json:"api_calls_used"`
	Platforms     []catalog.Platform `json:"platforms"`
}

// CatalogInfo is the part of a game's editorial info that a list or a search
// result shows. The paragraphs live in the game's own file.
type CatalogInfo struct {
	Developer string `json:"developer,omitempty"`
	Publisher string `json:"publisher,omitempty"`
	Year      int    `json:"year,omitempty"`
	Genre     string `json:"genre,omitempty"`
	CoverURL  string `json:"cover_url,omitempty"`
}

// CatalogGame is one row of catalog.json: what search, boards and shelves
// need to name a game, and nothing a game page alone would read. With
// several hundred games the file is fetched on every search and every shelf,
// so every byte here is paid for many times over.
type CatalogGame struct {
	ID       string           `json:"id"`
	Title    string           `json:"title"`
	Platform catalog.Platform `json:"platform"`
	Region   catalog.Region   `json:"region"`
	Variant  catalog.Variant  `json:"variant"`
	IGDBID   int              `json:"igdb_id,omitempty"`
	Info     *CatalogInfo     `json:"info,omitempty"`
}

type Catalog struct {
	AsOf  string        `json:"as_of"`
	Games []CatalogGame `json:"games"`
}

// GameDetail is games/<id>.json: everything a game page shows beyond the
// prices, fetched by the one page that needs it.
type GameDetail struct {
	ID       string           `json:"id"`
	Title    string           `json:"title"`
	Platform catalog.Platform `json:"platform"`
	Region   catalog.Region   `json:"region"`
	Variant  catalog.Variant  `json:"variant"`
	IGDBID   int              `json:"igdb_id,omitempty"`
	EbayURL  string           `json:"ebay_url,omitempty"`
	// Editorial facts about the release, when a contributor has written them.
	Info *catalog.Info `json:"info,omitempty"`
	// Annotation travels with the game so its page can always explain why a
	// price moved, not only while the game sits on a trending board.
	Annotation *catalog.Annotation `json:"annotation,omitempty"`
}

// PriceEntry is one game in prices.json: the latest median per priced
// condition, the week's move and staleness. It is what a search result or a
// shelf line prints, in a tenth of the bytes of the boards.
type PriceEntry struct {
	Prices map[classify.Condition]int64 `json:"prices"`
	Pct7d  *float64                     `json:"pct_7d"`
	Stale  bool                         `json:"stale,omitempty"`
}

type PriceIndex struct {
	AsOf  string                `json:"as_of"`
	Games map[string]PriceEntry `json:"games"`
}

// PriceIndexFrom reduces the boards to the index. Conditions without a price
// are absent rather than zero.
func PriceIndexFrom(asOf string, boards []Latest) PriceIndex {
	idx := PriceIndex{AsOf: asOf, Games: map[string]PriceEntry{}}
	for _, b := range boards {
		for _, g := range b.Games {
			e := PriceEntry{Prices: map[classify.Condition]int64{}, Pct7d: round2p(g.Pct7d), Stale: g.Stale}
			if g.Prices.Loose != nil {
				e.Prices[classify.Loose] = g.Prices.Loose.MedianCents
			}
			if g.Prices.CIB != nil {
				e.Prices[classify.CIB] = g.Prices.CIB.MedianCents
			}
			if g.Prices.New != nil {
				e.Prices[classify.New] = g.Prices.New.MedianCents
			}
			idx.Games[g.ID] = e
		}
	}
	return idx
}

func WriteLatest(dataDir string, l Latest) error {
	for i := range l.Games {
		l.Games[i].Pct1d = round2p(l.Games[i].Pct1d)
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

// ReadTrending returns the board as last written, or an empty board when the
// file does not exist yet.
func ReadTrending(dataDir, board string) (Trending, error) {
	path := filepath.Join(dataDir, "trending", board+".json")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Trending{Board: board}, nil
	}
	if err != nil {
		return Trending{}, fmt.Errorf("read trending %s: %w", board, err)
	}
	var t Trending
	if err := json.Unmarshal(data, &t); err != nil {
		return Trending{}, fmt.Errorf("parse trending %s: %w", board, err)
	}
	return t, nil
}

func WriteTrending(dataDir string, t Trending) error {
	for i := range t.Entries {
		t.Entries[i].Score = round2(t.Entries[i].Score)
		t.Entries[i].Pct1d = round2p(t.Entries[i].Pct1d)
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

func WriteGame(dataDir string, g GameDetail) error {
	return writeJSON(filepath.Join(dataDir, "games", g.ID+".json"), g)
}

// WritePrices stores the index compactly: it is fetched far more often than
// it is read by a person.
func WritePrices(dataDir string, p PriceIndex) error {
	games := make(map[string]PriceEntry, len(p.Games))
	for id, e := range p.Games {
		e.Pct7d = round2p(e.Pct7d)
		games[id] = e
	}
	p.Games = games
	return writeJSONWith(filepath.Join(dataDir, "prices.json"), p, false)
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
func encodeWith(v any, indent bool) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if indent {
		enc.SetIndent("", " ")
	}
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

func writeJSON(path string, v any) error { return writeJSONWith(path, v, true) }

func writeJSONWith(path string, v any, indent bool) error {
	data, err := encodeWith(v, indent)
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
