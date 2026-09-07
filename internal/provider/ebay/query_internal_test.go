package ebay

import (
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
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
