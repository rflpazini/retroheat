// Package catalog loads the hand-curated list of tracked games. The files are
// the contribution surface of the project, so parsing is strict and every
// rule that a pull request could break is checked in CI.
package catalog

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/goccy/go-yaml"
)

type Platform string

const (
	PS2       Platform = "ps2"
	GameCube  Platform = "gamecube"
	PSP       Platform = "psp"
	Vita      Platform = "vita"
	N64       Platform = "n64"
	Dreamcast Platform = "dreamcast"
)

var Platforms = []Platform{PS2, GameCube, PSP, Vita, N64, Dreamcast}

var platformLabels = map[Platform]string{
	PS2:       "PlayStation 2",
	GameCube:  "GameCube",
	PSP:       "PSP",
	Vita:      "PS Vita",
	N64:       "Nintendo 64",
	Dreamcast: "Dreamcast",
}

func (p Platform) Label() string {
	if l, ok := platformLabels[p]; ok {
		return l
	}
	return string(p)
}

func (p Platform) Valid() bool { return slices.Contains(Platforms, p) }

type Region string

const (
	RegionNTSCU Region = "NTSC-U"
	RegionNTSCJ Region = "NTSC-J"
	RegionPAL   Region = "PAL"
)

var regions = []Region{RegionNTSCU, RegionNTSCJ, RegionPAL}

type Variant string

const (
	VariantNone          Variant = "none"
	VariantBlackLabel    Variant = "black-label"
	VariantGreatestHits  Variant = "greatest-hits"
	VariantPlayersChoice Variant = "players-choice"
	VariantPlatinum      Variant = "platinum"
)

var variants = []Variant{VariantNone, VariantBlackLabel, VariantGreatestHits, VariantPlayersChoice, VariantPlatinum}

// Info is the editorial layer: evergreen facts about a release and why
// collectors chase it. Annotations cover dated market events; this covers what
// is true about the game regardless of what the price did this week.
type Info struct {
	Developer string `yaml:"developer,omitempty" json:"developer,omitempty"`
	Publisher string `yaml:"publisher,omitempty" json:"publisher,omitempty"`
	Year      int    `yaml:"year,omitempty" json:"year,omitempty"`
	Genre     string `yaml:"genre,omitempty" json:"genre,omitempty"`
	CoverURL  string `yaml:"cover_url,omitempty" json:"cover_url,omitempty"`
	Trivia    string `yaml:"trivia,omitempty" json:"trivia,omitempty"`
	Why       string `yaml:"why,omitempty" json:"why,omitempty"`
}

type EbayHints struct {
	Query    string   `yaml:"query" json:"query"`
	Negative []string `yaml:"negative,omitempty" json:"negative,omitempty"`
}

type Game struct {
	ID       string    `yaml:"id" json:"id"`
	Title    string    `yaml:"title" json:"title"`
	Region   Region    `yaml:"region,omitempty" json:"region"`
	Variant  Variant   `yaml:"variant,omitempty" json:"variant"`
	IGDBID   int       `yaml:"igdb_id,omitempty" json:"igdb_id,omitempty"`
	Ebay     EbayHints `yaml:"ebay" json:"-"`
	Info     *Info     `yaml:"info,omitempty" json:"info,omitempty"`
	Platform Platform  `yaml:"-" json:"platform"`
}

type Annotation struct {
	GameID    string `yaml:"game_id" json:"-"`
	Date      string `yaml:"date" json:"date"`
	Note      string `yaml:"note" json:"note"`
	SourceURL string `yaml:"source_url,omitempty" json:"source_url,omitempty"`
}

type platformFile struct {
	Platform Platform `yaml:"platform"`
	Games    []Game   `yaml:"games"`
}

const AnnotationsFile = "annotations.yaml"

// Load parses every platform file in dir, ordered by filename so that output
// is byte-identical between runs.
func Load(dir string) ([]Game, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read catalog dir: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || name == AnnotationsFile {
			continue
		}
		if ext := filepath.Ext(name); ext != ".yaml" && ext != ".yml" {
			continue
		}
		names = append(names, name)
	}
	slices.Sort(names)

	var games []Game
	for _, name := range names {
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", name, err)
		}
		var f platformFile
		if err := yaml.UnmarshalWithOptions(data, &f, yaml.Strict()); err != nil {
			return nil, fmt.Errorf("parse %s: %w", name, err)
		}
		if !f.Platform.Valid() {
			return nil, fmt.Errorf("parse %s: unsupported platform %q", name, f.Platform)
		}
		for _, g := range f.Games {
			g.Platform = f.Platform
			if g.Region == "" {
				g.Region = RegionNTSCU
			}
			if g.Variant == "" {
				g.Variant = VariantNone
			}
			games = append(games, g)
		}
	}
	return games, nil
}

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

func Validate(games []Game) error {
	seen := make(map[string]bool, len(games))
	var errs []error
	// Every problem is reported, not just the first, so a contributor fixes
	// them in one round trip rather than one CI run per mistake.
	for _, g := range games {
		if !idRe.MatchString(g.ID) {
			errs = append(errs, fmt.Errorf("id %q: must be a lowercase slug", g.ID))
		}
		if !strings.HasSuffix(g.ID, "-"+string(g.Platform)) {
			errs = append(errs, fmt.Errorf("id %q: must end in -%s", g.ID, g.Platform))
		}
		if seen[g.ID] {
			errs = append(errs, fmt.Errorf("id %q: duplicated", g.ID))
		}
		seen[g.ID] = true

		if strings.TrimSpace(g.Title) == "" {
			errs = append(errs, fmt.Errorf("%s: title is required", g.ID))
		}
		if strings.TrimSpace(g.Ebay.Query) == "" {
			errs = append(errs, fmt.Errorf("%s: ebay.query is required", g.ID))
		}
		if !slices.Contains(variants, g.Variant) {
			errs = append(errs, fmt.Errorf("%s: unknown variant %q", g.ID, g.Variant))
		}
		if !slices.Contains(regions, g.Region) {
			errs = append(errs, fmt.Errorf("%s: unknown region %q", g.ID, g.Region))
		}
		if !g.Platform.Valid() {
			errs = append(errs, fmt.Errorf("%s: unknown platform %q", g.ID, g.Platform))
		}
		if g.Info != nil {
			// A wrong year is worse than no year, and a cover served over
			// plain HTTP would be blocked on the deployed site anyway.
			if y := g.Info.Year; y != 0 && (y < 1970 || y > 2035) {
				errs = append(errs, fmt.Errorf("%s: implausible release year %d", g.ID, y))
			}
			if u := g.Info.CoverURL; u != "" && !strings.HasPrefix(u, "https://") {
				errs = append(errs, fmt.Errorf("%s: cover_url must be https", g.ID))
			}
		}
	}
	return errors.Join(errs...)
}

// LoadAnnotations reads the curated "why it is trending" notes. A missing file
// is normal: the notes are optional.
func LoadAnnotations(path string, games []Game) ([]Annotation, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read annotations: %w", err)
	}

	var anns []Annotation
	if err := yaml.UnmarshalWithOptions(data, &anns, yaml.Strict()); err != nil {
		return nil, fmt.Errorf("parse annotations: %w", err)
	}

	known := make(map[string]bool, len(games))
	for _, g := range games {
		known[g.ID] = true
	}
	var errs []error
	for i, a := range anns {
		if !known[a.GameID] {
			errs = append(errs, fmt.Errorf("annotation %d: unknown game_id %q", i, a.GameID))
		}
		if _, err := time.Parse(time.DateOnly, a.Date); err != nil {
			errs = append(errs, fmt.Errorf("annotation %d: date %q must be YYYY-MM-DD", i, a.Date))
		}
		if strings.TrimSpace(a.Note) == "" {
			errs = append(errs, fmt.Errorf("annotation %d: note is required", i))
		}
	}
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return anns, nil
}

// Latest returns the most recent annotation per game.
func Latest(anns []Annotation) map[string]Annotation {
	out := make(map[string]Annotation, len(anns))
	for _, a := range anns {
		if cur, ok := out[a.GameID]; !ok || a.Date > cur.Date {
			out[a.GameID] = a
		}
	}
	return out
}
