package ebay

import "testing"

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
