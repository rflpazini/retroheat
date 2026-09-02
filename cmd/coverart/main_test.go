package main

import (
	"strings"
	"testing"
)

const sample = `platform: vita
games:
  - id: with-info
    title: "With Info"
    info:
      developer: "Someone"
      year: 2012
    ebay:
      query: "With Info Vita"
  - id: without-info
    title: "Without Info"
    ebay:
      query: "Without Info Vita"
  - id: has-cover
    title: "Has Cover"
    info:
      cover_url: "https://old.example/cover.png"
      year: 2013
    ebay:
      query: "Has Cover Vita"
`

func TestSetCoverAddsToExistingInfoBlock(t *testing.T) {
	t.Parallel()
	lines, ok := setCover(strings.Split(sample, "\n"), "with-info", "https://img.example/a.png")
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	want := "    info:\n      cover_url: \"https://img.example/a.png\"\n      developer: \"Someone\""
	if !strings.Contains(got, want) {
		t.Errorf("cover_url not inserted as first info key:\n%s", got)
	}
}

func TestSetCoverOpensInfoBlockWhenMissing(t *testing.T) {
	t.Parallel()
	lines, ok := setCover(strings.Split(sample, "\n"), "without-info", "https://img.example/b.png")
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	want := "    title: \"Without Info\"\n    info:\n      cover_url: \"https://img.example/b.png\"\n    ebay:"
	if !strings.Contains(got, want) {
		t.Errorf("info block not opened after title:\n%s", got)
	}
}

func TestSetCoverReplacesExisting(t *testing.T) {
	t.Parallel()
	lines, ok := setCover(strings.Split(sample, "\n"), "has-cover", "https://img.example/c.png")
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	if strings.Contains(got, "old.example") {
		t.Errorf("old cover_url still present:\n%s", got)
	}
	if strings.Count(got, "cover_url") != 1 {
		t.Errorf("expected exactly one cover_url, got:\n%s", got)
	}
	// Nothing outside the edited entry may change.
	if !strings.Contains(got, "    ebay:\n      query: \"Has Cover Vita\"") {
		t.Errorf("neighbouring keys disturbed:\n%s", got)
	}
}

func TestSetCoverUnknownID(t *testing.T) {
	t.Parallel()
	if _, ok := setCover(strings.Split(sample, "\n"), "nope", "x"); ok {
		t.Error("unknown id reported as found")
	}
}

func TestSameGame(t *testing.T) {
	t.Parallel()
	cases := []struct {
		game, article string
		want          bool
	}{
		{"Marvel vs. Capcom 2", "Marvel vs. Capcom 2: New Age of Heroes", true},
		{"Persona 4 Golden", "Persona 4", true},
		{"Tearaway", "Tearaway (video game)", true},
		{"Steins;Gate", "Steins;Gate (video game)", true},
		{"1080° Snowboarding", "1080° Snowboarding", true},
		{"Severed", "Severed (film)", true}, // the description check rejects films, not this
		{"Gravity Rush", "Killzone: Mercenary", false},
		{"Muramasa Rebirth", "Muramasa: The Demon Blade", true},
		{"Atelier Ayesha Plus", "Atelier Ayesha: The Alchemist of Dusk", true},
		{"Sly Cooper Collection", "Jak and Daxter Collection", false},
		{"Persona 4 Golden", "Persona 3", false},
	}
	for _, c := range cases {
		if got := sameGame(c.game, c.article); got != c.want {
			t.Errorf("sameGame(%q, %q) = %v, want %v", c.game, c.article, got, c.want)
		}
	}
}

func TestIsVideoGame(t *testing.T) {
	t.Parallel()
	for desc, want := range map[string]bool{
		"2012 video game":                     true,
		"2001 role-playing video game":        true,
		"2010 visual novel":                   true,
		"2013 action role-playing game":       true,
		"List of Danganronpa characters":      false,
		"Video game series":                   false,
		"Japanese video game developer":       false,
		"2016 film":                           false,
		"Topics referred to by the same term": false,
	} {
		if got := isVideoGame(desc); got != want {
			t.Errorf("isVideoGame(%q) = %v, want %v", desc, got, want)
		}
	}
}
