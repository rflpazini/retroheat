package catalog_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
)

func writeCatalog(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const ps2YAML = `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    region: NTSC-U
    variant: black-label
    igdb_id: 1904
    ebay:
      query: "Silent Hill 2 PS2"
      negative: ["greatest hits", "hd collection"]
  - id: god-hand-ps2
    title: "God Hand"
    ebay:
      query: "God Hand PS2"
`

const n64YAML = `platform: n64
games:
  - id: conkers-bad-fur-day-n64
    title: "Conker's Bad Fur Day"
    ebay:
      query: "Conker's Bad Fur Day N64"
`

const gbaYAML = `platform: gba
games:
  - id: mother-3-gba
    title: "Mother 3"
    region: NTSC-J
    ebay:
      query: "Mother 3 GBA"
`

func TestLoadReadsEveryPlatformFile(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML, "n64.yaml": n64YAML})

	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(games) != 3 {
		t.Fatalf("loaded %d games, want 3", len(games))
	}
}

func TestLoadIsDeterministicallyOrdered(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML, "n64.yaml": n64YAML})

	first, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Fatalf("Load order differs between runs at %d: %q vs %q", i, first[i].ID, second[i].ID)
		}
	}
	if first[0].ID != "conkers-bad-fur-day-n64" {
		t.Errorf("first game = %q, want the n64 entry (files sorted by name)", first[0].ID)
	}
}

func TestLoadAppliesFilePlatformToEveryGame(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML})

	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range games {
		if g.Platform != catalog.PS2 {
			t.Errorf("%s has platform %q, want %q", g.ID, g.Platform, catalog.PS2)
		}
	}
}

func TestLoadDefaultsRegionAndVariant(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML})

	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	var godHand catalog.Game
	for _, g := range games {
		if g.ID == "god-hand-ps2" {
			godHand = g
		}
	}
	if godHand.Region != catalog.RegionNTSCU {
		t.Errorf("Region = %q, want default %q", godHand.Region, catalog.RegionNTSCU)
	}
	if godHand.Variant != catalog.VariantNone {
		t.Errorf("Variant = %q, want default %q", godHand.Variant, catalog.VariantNone)
	}
}

func TestLoadIgnoresAnnotationsFile(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{
		"ps2.yaml":         ps2YAML,
		"annotations.yaml": "- game_id: silent-hill-2-ps2\n  date: 2026-08-20\n  note: \"remake\"\n",
		"SCHEMA.md":        "# not yaml",
	})

	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatalf("Load must skip annotations.yaml and non-yaml files: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("loaded %d games, want 2", len(games))
	}
}

func TestLoadRejectsUnknownPlatform(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"xbox.yaml": "platform: xbox\ngames: []\n"})
	if _, err := catalog.Load(dir); err == nil {
		t.Error("Load accepted an unsupported platform")
	}
}

func TestLoadRejectsMalformedYAML(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": "platform: ps2\ngames: [ unclosed\n"})
	if _, err := catalog.Load(dir); err == nil {
		t.Error("Load accepted malformed YAML")
	}
}

func TestValidateAcceptsGoodCatalog(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML, "n64.yaml": n64YAML})
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := catalog.Validate(games); err != nil {
		t.Errorf("Validate rejected a good catalog: %v", err)
	}
}

func TestValidateRejects(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		yaml string
	}{
		{"duplicate id", `platform: ps2
games:
  - {id: god-hand-ps2, title: "God Hand", ebay: {query: "a"}}
  - {id: god-hand-ps2, title: "God Hand", ebay: {query: "b"}}
`},
		{"id not slug", `platform: ps2
games:
  - {id: "God Hand PS2", title: "God Hand", ebay: {query: "a"}}
`},
		{"id missing platform suffix", `platform: ps2
games:
  - {id: god-hand, title: "God Hand", ebay: {query: "a"}}
`},
		{"empty title", `platform: ps2
games:
  - {id: god-hand-ps2, title: "", ebay: {query: "a"}}
`},
		{"empty ebay query", `platform: ps2
games:
  - {id: god-hand-ps2, title: "God Hand", ebay: {query: ""}}
`},
		{"unknown variant", `platform: ps2
games:
  - {id: god-hand-ps2, title: "God Hand", variant: gold-edition, ebay: {query: "a"}}
`},
		{"unknown region", `platform: ps2
games:
  - {id: god-hand-ps2, title: "God Hand", region: NTSC-X, ebay: {query: "a"}}
`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			dir := writeCatalog(t, map[string]string{"ps2.yaml": c.yaml})
			games, err := catalog.Load(dir)
			if err != nil {
				return // rejected at parse time is equally acceptable
			}
			if err := catalog.Validate(games); err == nil {
				t.Errorf("Validate accepted an invalid catalog (%s)", c.name)
			}
		})
	}
}

func TestLoadAnnotations(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{
		"ps2.yaml": ps2YAML,
		"annotations.yaml": `- game_id: silent-hill-2-ps2
  date: 2026-08-20
  note: "Remake renewed interest in the original"
  source_url: "https://example.com/a"
`,
	})
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	anns, err := catalog.LoadAnnotations(filepath.Join(dir, "annotations.yaml"), games)
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	if len(anns) != 1 || anns[0].GameID != "silent-hill-2-ps2" {
		t.Fatalf("annotations = %+v, want one entry for silent-hill-2-ps2", anns)
	}
}

func TestLoadAnnotationsRejectsUnknownGame(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{
		"ps2.yaml":         ps2YAML,
		"annotations.yaml": "- game_id: not-a-real-game-ps2\n  date: 2026-08-20\n  note: \"x\"\n",
	})
	games, _ := catalog.Load(dir)
	if _, err := catalog.LoadAnnotations(filepath.Join(dir, "annotations.yaml"), games); err == nil {
		t.Error("LoadAnnotations accepted a reference to a game not in the catalog")
	}
}

func TestLoadAnnotationsRejectsBadDate(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{
		"ps2.yaml":         ps2YAML,
		"annotations.yaml": "- game_id: god-hand-ps2\n  date: \"August 2026\"\n  note: \"x\"\n",
	})
	games, _ := catalog.Load(dir)
	if _, err := catalog.LoadAnnotations(filepath.Join(dir, "annotations.yaml"), games); err == nil {
		t.Error("LoadAnnotations accepted a non ISO-8601 date")
	}
}

func TestLoadAnnotationsMissingFileIsNotAnError(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": ps2YAML})
	games, _ := catalog.Load(dir)
	anns, err := catalog.LoadAnnotations(filepath.Join(dir, "annotations.yaml"), games)
	if err != nil {
		t.Errorf("missing annotations file should be tolerated: %v", err)
	}
	if len(anns) != 0 {
		t.Errorf("annotations = %+v, want empty", anns)
	}
}

// Every cartridge platform sold its games in a cardboard box, and the box is
// what separates a complete copy from a "cartridge with manual". Getting this
// wrong for a new platform would silently price bare Game Boy carts as unknown
// instead of loose, so the packaging of every platform is pinned here.
func TestPlatformPackaging(t *testing.T) {
	t.Parallel()
	for _, p := range []catalog.Platform{catalog.N64, catalog.GB, catalog.GBC, catalog.GBA} {
		if !p.Boxed() {
			t.Errorf("%s.Boxed() = false, want true: it sold cartridges in cardboard boxes", p)
		}
	}
	for _, p := range []catalog.Platform{catalog.PS2, catalog.GameCube, catalog.PSP, catalog.Vita, catalog.Dreamcast} {
		if p.Boxed() {
			t.Errorf("%s.Boxed() = true, want false: it sold discs or cards in plastic cases", p)
		}
	}
	// Vita is the only card-in-a-case platform; a Game Boy cartridge is not a
	// card, whatever reproduction sellers call it.
	for _, p := range catalog.Platforms {
		if got, want := p.Carded(), p == catalog.Vita; got != want {
			t.Errorf("%s.Carded() = %v, want %v", p, got, want)
		}
	}
}

// The labels are what the site shows in headings and the collector prints in
// logs, so they must be the names collectors use, not the slugs.
func TestGameBoyPlatformsAreValidAndLabelled(t *testing.T) {
	t.Parallel()
	want := map[catalog.Platform]string{
		catalog.GB:  "Game Boy",
		catalog.GBC: "Game Boy Color",
		catalog.GBA: "Game Boy Advance",
	}
	for p, label := range want {
		if !p.Valid() {
			t.Errorf("%s.Valid() = false, want true", p)
		}
		if got := p.Label(); got != label {
			t.Errorf("%s.Label() = %q, want %q", p, got, label)
		}
	}
}

// The Game Boy files are new, and the platform suffix is the only thing that
// keeps "tetris-gb", "tetris-gbc" and "tetris-gba" apart, so a gba entry must
// carry -gba exactly and not the shorter -gb that happens to be its prefix.
func TestLoadAndValidateAcceptGameBoyAdvance(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"gba.yaml": gbaYAML})
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatalf("Load rejected a gba file: %v", err)
	}
	if len(games) != 1 || games[0].Platform != catalog.GBA {
		t.Fatalf("games = %+v, want one entry on platform gba", games)
	}
	if err := catalog.Validate(games); err != nil {
		t.Errorf("Validate rejected a good gba entry: %v", err)
	}
}

func TestValidateRejectsGBSuffixOnGBAEntry(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"gba.yaml": `platform: gba
games:
  - {id: mother-3-gb, title: "Mother 3", ebay: {query: "Mother 3 GBA"}}
`})
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := catalog.Validate(games); err == nil {
		t.Error("Validate accepted an id ending in -gb on a gba entry")
	}
}
