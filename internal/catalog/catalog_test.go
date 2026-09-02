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
