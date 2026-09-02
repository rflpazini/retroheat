package catalog_test

import (
	"path/filepath"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// The repository's own catalog is the contribution surface. These checks are
// what a pull request adding a game has to pass.

const repoCatalog = "../../catalog"

func TestRepoCatalogIsValid(t *testing.T) {
	t.Parallel()
	games, err := catalog.Load(repoCatalog)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if err := catalog.Validate(games); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if len(games) < 150 {
		t.Errorf("catalog has %d games, expected at least 150", len(games))
	}
}

func TestRepoCatalogCoversEveryPlatform(t *testing.T) {
	t.Parallel()
	games, err := catalog.Load(repoCatalog)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[catalog.Platform]int{}
	for _, g := range games {
		counts[g.Platform]++
	}
	for _, p := range catalog.Platforms {
		if counts[p] == 0 {
			t.Errorf("no games tracked for %s", p)
		}
	}
}

func TestRepoAnnotationsAreValid(t *testing.T) {
	t.Parallel()
	games, err := catalog.Load(repoCatalog)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.LoadAnnotations(filepath.Join(repoCatalog, catalog.AnnotationsFile), games); err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
}

// A catalog entry whose query does not mention its platform pulls in every
// other release of the same game.
func TestEveryQueryIsPlatformScoped(t *testing.T) {
	t.Parallel()
	games, err := catalog.Load(repoCatalog)
	if err != nil {
		t.Fatal(err)
	}
	hints := map[catalog.Platform][]string{
		catalog.PS2:       {"ps2", "playstation 2"},
		catalog.GameCube:  {"gamecube", "game cube", "gcn"},
		catalog.PSP:       {"psp"},
		catalog.Vita:      {"vita"},
		catalog.N64:       {"n64", "nintendo 64"},
		catalog.Dreamcast: {"dreamcast"},
	}
	for _, g := range games {
		if !containsAny(g.Ebay.Query, hints[g.Platform]) {
			t.Errorf("%s: query %q does not name the platform", g.ID, g.Ebay.Query)
		}
	}
}

func containsAny(s string, subs []string) bool {
	lower := lowerASCII(s)
	for _, sub := range subs {
		if len(sub) > 0 && contains(lower, sub) {
			return true
		}
	}
	return false
}

func lowerASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// The editorial layer is what answers "why is this expensive", so its facts
// have to be checked the same way the rest of the catalog is.
func TestRepoGameInfoIsWellFormed(t *testing.T) {
	t.Parallel()
	games, err := catalog.Load(repoCatalog)
	if err != nil {
		t.Fatal(err)
	}

	withInfo := 0
	for _, g := range games {
		if g.Info == nil {
			continue
		}
		withInfo++
		if g.Info.Year != 0 && (g.Info.Year < 1994 || g.Info.Year > 2020) {
			t.Errorf("%s: release year %d is outside the era this project tracks", g.ID, g.Info.Year)
		}
		if g.Info.Why != "" && len(g.Info.Why) < 40 {
			t.Errorf("%s: the collectibility note is too short to explain anything", g.ID)
		}
		if g.Info.Trivia != "" && len(g.Info.Trivia) < 40 {
			t.Errorf("%s: the trivia note is too short to be interesting", g.ID)
		}
	}
	if withInfo < 40 {
		t.Errorf("only %d games carry editorial info; the feature looks empty below ~40", withInfo)
	}
}
