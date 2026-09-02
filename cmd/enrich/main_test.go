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

func TestSetInfoFieldsAddsToExistingBlockInOrder(t *testing.T) {
	t.Parallel()
	lines, ok := setInfoFields(strings.Split(sample, "\n"), "with-info", map[string]string{
		"cover_url": "https://img.example/a.png",
		"publisher": "Pub",
		"genre":     "RPG",
	})
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	want := "    info:\n      publisher: \"Pub\"\n      genre: \"RPG\"\n      cover_url: \"https://img.example/a.png\"\n      developer: \"Someone\""
	if !strings.Contains(got, want) {
		t.Errorf("fields not inserted in order after info:\n%s", got)
	}
}

func TestSetInfoFieldsOpensBlockWhenMissing(t *testing.T) {
	t.Parallel()
	lines, ok := setInfoFields(strings.Split(sample, "\n"), "without-info", map[string]string{
		"year":      "2014",
		"about":     "A game. It is good.",
		"about_url": "https://en.wikipedia.org/wiki/A_game",
	})
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	want := "    title: \"Without Info\"\n    info:\n      year: 2014\n      about: \"A game. It is good.\"\n      about_url: \"https://en.wikipedia.org/wiki/A_game\"\n    ebay:"
	if !strings.Contains(got, want) {
		t.Errorf("info block not opened after title:\n%s", got)
	}
}

func TestSetInfoFieldsReplacesExisting(t *testing.T) {
	t.Parallel()
	lines, ok := setInfoFields(strings.Split(sample, "\n"), "has-cover", map[string]string{"cover_url": "https://img.example/c.png"})
	if !ok {
		t.Fatal("entry not found")
	}
	got := strings.Join(lines, "\n")
	if strings.Contains(got, "old.example") || strings.Count(got, "cover_url") != 1 {
		t.Errorf("old cover_url not replaced exactly once:\n%s", got)
	}
	if !strings.Contains(got, "    ebay:\n      query: \"Has Cover Vita\"") {
		t.Errorf("neighbouring keys disturbed:\n%s", got)
	}
}

func TestSetInfoFieldsUnknownID(t *testing.T) {
	t.Parallel()
	if _, ok := setInfoFields(strings.Split(sample, "\n"), "nope", map[string]string{"year": "1"}); ok {
		t.Error("unknown id reported as found")
	}
}

func TestFirstSentences(t *testing.T) {
	t.Parallel()
	lead := "Bully is a 2006 action-adventure video game developed by Rockstar Vancouver and published by Rockstar Games. Set in the fictional New England town of Bullworth, the game follows Jimmy Hopkins. Over the course of a school year, Jimmy attempts to rise through the ranks."
	got := firstSentences(lead, 2, 400)
	want := "Bully is a 2006 action-adventure video game developed by Rockstar Vancouver and published by Rockstar Games. Set in the fictional New England town of Bullworth, the game follows Jimmy Hopkins."
	if got != want {
		t.Errorf("firstSentences = %q", got)
	}
	// Backs off to one sentence when two exceed the cap.
	if got := firstSentences(lead, 2, 120); got != "Bully is a 2006 action-adventure video game developed by Rockstar Vancouver and published by Rockstar Games." {
		t.Errorf("did not back off to one sentence: %q", got)
	}
	// "vs." is not a sentence end.
	if got := firstSentences("Marvel vs. Capcom 2 is a fighting game. It was released in 2000.", 1, 400); got != "Marvel vs. Capcom 2 is a fighting game." {
		t.Errorf("split on an abbreviation: %q", got)
	}
	if got := firstSentences("", 2, 400); got != "" {
		t.Errorf("empty input gave %q", got)
	}
}

func TestGenreLabel(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"action-adventure game":   "Action-adventure",
		"role-playing video game": "Role-playing",
		"fighting game":           "Fighting",
		"":                        "",
	} {
		if got := genreLabel(in); got != want {
			t.Errorf("genreLabel(%q) = %q, want %q", in, got, want)
		}
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
		{"Gravity Rush", "Killzone: Mercenary", false},
		{"Muramasa Rebirth", "Muramasa: The Demon Blade", true},
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
		"2010 visual novel":                   true,
		"2013 action role-playing game":       true,
		"Video game series":                   false,
		"Japanese video game developer":       false,
		"List of Danganronpa characters":      false,
		"Topics referred to by the same term": false,
	} {
		if got := isVideoGame(desc); got != want {
			t.Errorf("isVideoGame(%q) = %v, want %v", desc, got, want)
		}
	}
}
