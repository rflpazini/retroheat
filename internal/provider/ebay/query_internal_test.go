package ebay

import (
	"errors"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/provider"
)

func TestExcludedMatchesWholeWordsOnly(t *testing.T) {
	t.Parallel()
	negs := []string{"episode i", "greatest hits", "ps3"}
	cases := map[string]bool{
		"Xenosaga Episode II PS2 Complete":              false, // "episode i" must not match inside "episode ii"
		"Xenosaga Episode III PS2 CIB":                  false,
		"Xenosaga Episode I PS2 Black Label":            true,
		"Silent Hill 2 Greatest Hits PS2":               true,
		"Silent Hill 2 PS2 - Greatest Hits Edition":     true,
		"Siren PS2 NTSC-U Complete, not the PS3 remake": true,
		"Siren PS2 Complete":                            false,
	}
	for title, want := range cases {
		if got := excluded(title, negs); got != want {
			t.Errorf("excluded(%q) = %v, want %v", title, got, want)
		}
	}
}

func TestForeignReadsTheListingAgainstTheEntrysRegion(t *testing.T) {
	t.Parallel()
	us := catalog.Game{Region: catalog.RegionNTSCU}
	pal := catalog.Game{Region: catalog.RegionPAL}
	jp := catalog.Game{Region: catalog.RegionNTSCJ}

	cases := []struct {
		title string
		g     catalog.Game
		want  bool
	}{
		// Abbreviations and other regions count as imports for a US entry.
		{"Marvel vs. Capcom 2 (JP Sega Dreamcast, 2000) CIB", us, true},
		// A region word in the game's own name is not a region.
		{"PGA European Tour Nintendo 64 N64 cart", catalog.Game{Title: "PGA European Tour"}, false},
		{"PGA European Tour N64 PAL UK cart", catalog.Game{Title: "PGA European Tour"}, true},
		{"Mario Party 3 CIB - Nintendo 64 JP (N64)", us, true},
		{"1080 Snowboarding NINTENDO 64 Complete CIB N64 JPN", us, true},
		{"Persona 3 Portable (Sony PSP, 2010) CIB Korea Version TESTED", us, true},
		{"ICO Playstation PS2 Game Taiwan Exclusive Version Edition Complete CIB", us, true},
		{"Super Smash Bros Melee GameCube 2002 Game PAL Germany", us, true},
		{"Uncharted Golden Abyss *RARE Russia Version* PS Vita Sealed", us, true},
		// Where the cartridge was made is not where it was sold.
		{"The Legend of Zelda Ocarina of Time Nintendo 64 N64 Game Cartridge made in Japan", us, false},
		{"Mario Kart: Double Dash Nintendo GameCube 2003 Complete Made in Japan", us, false},
		{"Mario Kart 64 (Nintendo 64, 1997) Authentic Tested", us, false},
		// A PAL entry keeps PAL copies and drops the cheaper Japanese ones.
		{"Shenmue II | Sega Dreamcast | PAL | FACTORY SEALED", pal, false},
		{"Shenmue II Sega Dreamcast Japan NTSC-J 4 Disc Set w Manual Case", pal, true},
		{"God Eater 2 Rage Burst PS Vita Import Japan COMPLETE", pal, true},
		// A Japan-only release is all imports; only PAL copies are foreign.
		{"Capcom vs SNK 2 Sega Dreamcast Japan Import CIB", jp, false},
		{"Capcom vs SNK 2 Dreamcast PAL UK Complete", jp, true},
	}
	for _, c := range cases {
		if got := foreign(c.title, c.g); got != c.want {
			t.Errorf("foreign(%q, %s) = %v, want %v", c.title, c.g.Region, got, c.want)
		}
	}
}

func TestNamesPlatformAcceptsEverySpellingSellersUse(t *testing.T) {
	t.Parallel()
	cases := []struct {
		title string
		p     catalog.Platform
		want  bool
	}{
		{"Silent Hill 2 PS2 Black Label", catalog.PS2, true},
		{"Silent Hill 2 (Sony PlayStation 2, 2001)", catalog.PS2, true},
		{"Silent Hill 2 Playstation2 CIB", catalog.PS2, true},
		{"Silent Hill 2 PS-2 complete", catalog.PS2, true},
		{"Final Fantasy X-2PS2 Game *Disc Only*", catalog.PS2, true},
		// The first PlayStation, with its release year.
		{"Alone in the Dark: The New Nightmare (Sony PlayStation, 2001) - CIB", catalog.PS2, false},
		{"College Hoops 2K8 (Sony PlayStation.  3, 2007)", catalog.PS3, true},
		{"The OG Animal Crossing (Nintendo GameCube2002) with memory card", catalog.GameCube, true},
		{"Wipeout 64 NintendoN64 VIDEO Game Cart only", catalog.N64, true},
		{"Floigan Bros.(Dream Cast) - Tested Working", catalog.Dreamcast, true},
		{"Atelier Rorona Plus PS Vita", catalog.Vita, true},
		{"Atelier Rorona Plus PSVITA new", catalog.Vita, true},
		// The widened search for the Vita game returns the PS3 original.
		{"Atelier Rorona: The Alchemist of Arland (Sony PlayStation 3, 2010)", catalog.Vita, false},
		{"Atelier Rorona Alchemist of Arland Premium Edition complete and Sealed", catalog.Vita, false},
		{"Mario Kart 64 Nintendo 64 cart", catalog.N64, true},
		{"Mario Kart N64 authentic", catalog.N64, true},
		{"Pikmin Nintendo Game Cube complete", catalog.GameCube, true},
		{"Pikmin GCN disc only", catalog.GameCube, true},
		{"Crisis Core Final Fantasy VII UMD", catalog.PSP, true},
		{"Garou Mark of the Wolves Sega Dreamcast", catalog.Dreamcast, true},
		// A Game Boy Color cartridge is often listed as plain Game Boy.
		{"Pokemon Crystal Nintendo Game Boy authentic", catalog.GBC, true},
		{"Metroid Fusion Gameboy Advance", catalog.GBA, true},
		{"Tetris Nintendo Gameboy DMG", catalog.GB, true},
		{"Garou Mark of the Wolves Neo Geo AES", catalog.Dreamcast, false},
	}
	for _, c := range cases {
		if got := namesPlatform(c.title, c.p); got != c.want {
			t.Errorf("namesPlatform(%q, %s) = %v, want %v", c.title, c.p, got, c.want)
		}
	}
}

func TestRequiredWordsKeepASiblingGameOut(t *testing.T) {
	t.Parallel()
	g := catalog.Game{
		ID: "blazblue-chrono-phantasma-extend-vita", Title: "BlazBlue: Chrono Phantasma Extend", Platform: catalog.Vita,
		Ebay: catalog.EbayHints{Require: []string{"extend"}},
	}
	cases := map[string]string{
		"BlazBlue: Chrono Phantasma Extend PS Vita Aksys CIB":    "cib:\\bcib\\b",
		"BlazBlue: Chrono Phantasma (Sony PlayStation Vita) CIB": "skip:not-this-game",
		"Blazblue Chrono Phantasma EXTEND psvita sealed":         "new:\\bsealed\\b",
	}
	for title, want := range cases {
		if got := judge(provider.Listing{Title: title, PriceCents: 3000, Currency: "USD"}, g, mediaOf(g)).label; got != want {
			t.Errorf("judge(%q) = %s, want %s", title, got, want)
		}
	}
}

func TestWideQueryDropsExclusionsAndGroups(t *testing.T) {
	t.Parallel()
	cases := []struct {
		query    string
		negative []string
		want     string
	}{
		{`Ghosthunter (ps2, "playstation 2")`, []string{"xbox"}, "Ghosthunter ps2"},
		{`Lost Kingdoms (ii, 2) (gamecube, "game cube")`, []string{"ps2"}, "Lost Kingdoms ii gamecube"},
		{`Garou Mark of the Wolves Dreamcast`, []string{"neo geo", "ps4"}, "Garou Mark of the Wolves Dreamcast"},
		{`Metroid Fusion (gba, "game boy advance", "gameboy advance")`, nil, "Metroid Fusion gba"},
		// Already the plain search: nothing wider to try.
		{`Wipeout 64 N64`, nil, ""},
	}
	for _, c := range cases {
		g := catalog.Game{Ebay: catalog.EbayHints{Query: c.query, Negative: c.negative}}
		if got := WideQuery(g); got != c.want {
			t.Errorf("WideQuery(%q, %v) = %q, want %q", c.query, c.negative, got, c.want)
		}
	}
}

func TestQuotesFromListingsSaysWhyAGameCannotBePriced(t *testing.T) {
	t.Parallel()
	g := catalog.Game{ID: "cannon-spike-dreamcast", Title: "Cannon Spike", Platform: catalog.Dreamcast}
	ls := []provider.Listing{
		{ItemID: "1", Title: "Cannon Spike Sega Dreamcast Complete CIB", PriceCents: 9000, Currency: "USD"},
		{ItemID: "2", Title: "Cannon Spike Sega Dreamcast Factory Sealed", PriceCents: 20000, Currency: "USD"},
		{ItemID: "3", Title: "Cannon Spike (Sega Dreamcast, 2000)", PriceCents: 8000, Currency: "USD"},
		{ItemID: "4", Title: "Cannon Spike Dreamcast Japan import", PriceCents: 4000, Currency: "USD"},
		{ItemID: "5", Title: "Cannon Spike Dreamcast manual only", PriceCents: 1500, Currency: "USD"},
	}
	_, err := QuotesFromListings(g, ls)
	if !errors.Is(err, provider.ErrNoData) {
		t.Fatalf("err = %v, want ErrNoData", err)
	}
	want := "cannon-spike-dreamcast: no usable listings (5 listings, kept 1 cib, 1 new (a price needs 4 of one condition); skipped 1 unknown, 1 region, 1 rejected)"
	if err.Error() != want {
		t.Errorf("err =\n  %s\nwant\n  %s", err, want)
	}
	if _, err := QuotesFromListings(g, nil); err == nil || !strings.HasSuffix(err.Error(), "(the search found no listings)") {
		t.Errorf("empty search err = %v, want it to say the search found nothing", err)
	}
}

func TestMediaOfTellsCartridgesCardsAndDiscsApart(t *testing.T) {
	t.Parallel()
	cases := map[catalog.Platform]classify.Media{
		catalog.N64:  classify.Boxed,
		catalog.GB:   classify.Boxed,
		catalog.GBC:  classify.Boxed,
		catalog.GBA:  classify.Boxed,
		catalog.Vita: classify.Carded,
		catalog.PS2:  classify.Cased,
		catalog.PS3:  classify.Cased,
	}
	for p, want := range cases {
		if got := mediaOf(catalog.Game{Platform: p}); got != want {
			t.Errorf("mediaOf(%s) = %v, want %v", p, got, want)
		}
	}
}
