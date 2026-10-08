package catalog_test

import (
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
)

func TestNormalizeGTIN(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
		ok       bool
	}{
		// Silent Hill 2 and its Greatest Hits reprint, as printed and as eBay
		// reports them.
		{"083717200253", "0083717200253", true},
		{"0083717200253", "0083717200253", true},
		{"083717200505", "0083717200505", true},
		// A Japanese (JAN) or European code keeps its 13 digits.
		{"4988601003995", "4988601003995", true},
		{"083717200254", "", false}, // one digit misread
		{"83717200253", "", false},  // a digit short
		{"0 83717 20025 3", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := catalog.NormalizeGTIN(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("NormalizeGTIN(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestLoadReadsBarcodes(t *testing.T) {
	t.Parallel()
	dir := writeCatalog(t, map[string]string{"ps2.yaml": `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    ebay: {query: "Silent Hill 2 PS2"}
    barcodes:
      - {code: "083717200253"}
      - {code: "083717200505", variant: greatest-hits}
`})
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := catalog.Validate(games); err != nil {
		t.Fatalf("Validate rejected good barcodes: %v", err)
	}
	got := games[0].Barcodes
	if len(got) != 2 || got[0].Code != "083717200253" || got[0].Variant != "" || got[1].Variant != catalog.VariantGreatestHits {
		t.Errorf("Barcodes = %+v", got)
	}
}

func TestValidateRejectsBadBarcodes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, yaml, want string
	}{
		{"bad check digit", `platform: ps2
games:
  - {id: silent-hill-2-ps2, title: "Silent Hill 2", ebay: {query: "a"}, barcodes: [{code: "083717200254"}]}
`, "valid check digit"},
		{"unknown variant", `platform: ps2
games:
  - {id: silent-hill-2-ps2, title: "Silent Hill 2", ebay: {query: "a"}, barcodes: [{code: "083717200253", variant: gold}]}
`, "unknown variant"},
		{"listed twice", `platform: ps2
games:
  - {id: silent-hill-2-ps2, title: "Silent Hill 2", ebay: {query: "a"}, barcodes: [{code: "083717200253"}, {code: "0083717200253"}]}
`, "listed twice"},
		// The same box cannot be two games, even written two ways.
		{"two games", `platform: ps2
games:
  - {id: silent-hill-2-ps2, title: "Silent Hill 2", ebay: {query: "a"}, barcodes: [{code: "083717200253"}]}
  - {id: silent-hill-3-ps2, title: "Silent Hill 3", ebay: {query: "b"}, barcodes: [{code: "0083717200253"}]}
`, "already belongs to silent-hill-2-ps2"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			games, err := catalog.Load(writeCatalog(t, map[string]string{"ps2.yaml": c.yaml}))
			if err != nil {
				t.Fatal(err)
			}
			err = catalog.Validate(games)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("Validate = %v; want an error mentioning %q", err, c.want)
			}
		})
	}
}
