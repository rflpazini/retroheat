package classify_test

import (
	"testing"

	"github.com/rflpazini/retroheat/internal/classify"
)

func TestClassifyRejectsJunk(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Silent Hill 2 PS2 Reproduction Case Only No Game",
		"Silent Hill 2 (PlayStation 2) CASE ONLY - No Game or Manual",
		"Rule of Rose PS2 Repro Case + Artwork",
		"Silent Hill 2 PS2 Manual Only Very Good",
		"Obscure PS2 Box Only",
		"God Hand PS2 Cover Art Insert Only",
		"Silent Hill 2 PS2 Empty Case Replacement",
		"Silent Hill 2 PS2 Custom Case No Disc",
		"Lot of 10 PS2 Games Silent Hill Resident Evil Onimusha",
		"PS2 Slim Console Bundle with Silent Hill 2 and Controller",
		"Silent Hill 2 PS2 For Parts Not Working Disc Cracked",
		"Silent Hill 2 Official Strategy Guide Book Prima",
		"Silent Hill 2 WATA 9.6 A+ Graded Sealed PS2",
		"Rule of Rose PS2 VGA 85 Graded",
		"Kuon PS2 CGC Graded 9.0",
		"Silent Hill 2 Promo Poster 18x24",
		"Silent Hill 2 PS2 Demo Disc Not For Resale",
		"Silent Hill 2 PS2 Digital Download Code",
		"Persona 4 Golden Vita Artwork Only No Game",
	}
	for _, title := range titles {
		got := classify.Classify(title)
		if !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}
}

func TestClassifyNew(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Silent Hill 2 PS2 Brand New Factory Sealed",
		"Silent Hill 2 (Sony PlayStation 2, 2001) NEW SEALED",
		"Obscure PS2 Sealed Y-Fold Black Label",
		"God Hand PS2 New In Box Unopened",
		"Kuon PlayStation 2 Still Sealed Mint",
		"Rule of Rose PS2 factory sealed NIB",
		"Skies of Arcadia Legends GameCube Shrink Wrap Sealed",
	}
	for _, title := range titles {
		got := classify.Classify(title)
		if got.Rejected || got.Condition != classify.New {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.New)
		}
	}
}

func TestClassifyCIB(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Silent Hill 2 PS2 CIB Complete In Box",
		"Silent Hill 2 PlayStation 2 Complete with Manual Tested",
		"Silent Hill 2 PS2 Complete W/ Manual Registration Card",
		"Obscure (PS2) Complete In Box CIB Black Label",
		"God Hand PS2 Game Case Manual Included Complete",
		"Conker's Bad Fur Day N64 Complete In Box with Manual",
		"Fire Emblem Path of Radiance GameCube CIB",
		"Persona 4 Golden Vita complete in box",
	}
	for _, title := range titles {
		got := classify.Classify(title)
		if got.Rejected || got.Condition != classify.CIB {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.CIB)
		}
	}
}

func TestClassifyLoose(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Silent Hill 2 PS2 Disc Only Tested Working",
		"Silent Hill 2 PlayStation 2 Loose Disc",
		"Silent Hill 2 PS2 Game Only No Manual",
		"Conker's Bad Fur Day N64 Cartridge Only Authentic",
		"Harvest Moon 64 Cart Only Tested",
		"Crisis Core Final Fantasy VII PSP UMD Only",
		"Obscure PS2 disc and case no manual",
		"God Hand PS2 Unboxed Disc",
		"Skies of Arcadia Dreamcast disk only",
	}
	for _, title := range titles {
		got := classify.Classify(title)
		if got.Rejected || got.Condition != classify.Loose {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.Loose)
		}
	}
}

// Sellers abbreviate "brand new in box" and routinely leave the marketplace
// condition field on Used, so the title has to carry the classification on its
// own.
func TestClassifyRecognisesSellerAbbreviations(t *testing.T) {
	t.Parallel()
	for _, title := range []string{
		"Gotcha Force GameCube BNIB",
		"Gotcha Force GameCube bnib sealed copy",
	} {
		if got := classify.Classify(title); got.Condition != classify.New {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.New)
		}
	}
}

func TestClassifyPrefersSealedOverComplete(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Rule of Rose PS2 Factory Sealed Complete In Box")
	if got.Condition != classify.New {
		t.Errorf("Classify() = %+v, want %q (sealed outranks complete)", got, classify.New)
	}
}

func TestClassifyRejectsJunkBeforeCondition(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Silent Hill 2 PS2 Repro Sealed Complete In Box")
	if !got.Rejected {
		t.Errorf("Classify() = %+v, want rejected (junk outranks every condition)", got)
	}
}

func TestClassifyTitleWordsAreNotConditions(t *testing.T) {
	t.Parallel()
	cases := []string{
		"Kingdom Hearts Complete Edition PS2",
		"Metal Gear Solid 3 Subsistence Complete Collection PS2",
		"Silent Hill 2 PS2 Resealed",
	}
	for _, title := range cases {
		got := classify.Classify(title)
		if got.Rejected {
			continue
		}
		if got.Condition != classify.Unknown {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.Unknown)
		}
	}
}

func TestClassifyIgnoresTheMarketplaceCondition(t *testing.T) {
	t.Parallel()
	// Reproduction carts and merchandise are listed as "New" on eBay. Only a
	// title that says sealed counts, so a bare title is unknown, not new.
	if got := classify.Classify("Super Smash Bros 64 Games For Nintendo N64 US Version USA Fast Shipping"); got.Condition != classify.Unknown {
		t.Errorf("Classify() = %+v, want unknown", got)
	}
}

func TestClassifyRejectsStorefrontAndMultiCartListings(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Nintendo 64 N64 Games Pick Your Game Cartridge Only Tested Working #1",
		"7-in-1 Super Smash Bros 7 NES Games - Nintendo 64 (N64) Fast shipping",
		"Mario Kart 64 Cart Games Mario Party For Nintendo N64 US Version (15 Options)",
		"Genuine Authentic Nintendo 64 N64 Games Japan Japanese Imports Loose *CHOOSE FROM LIST",
		"Sealed New Nintendo 64 Super Smash Bros Pokemon Stadium Mario Kart N64 Rare Lot",
		"Silent Hill 2 PS2 Multicart 5 games",
	}
	for _, title := range titles {
		if got := classify.Classify(title); !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}
}

func TestClassifyIsCaseInsensitive(t *testing.T) {
	t.Parallel()
	upper := classify.Classify("SILENT HILL 2 PS2 DISC ONLY")
	lower := classify.Classify("silent hill 2 ps2 disc only")
	if upper != lower {
		t.Errorf("case sensitivity: upper=%+v lower=%+v", upper, lower)
	}
	if upper.Condition != classify.Loose {
		t.Errorf("Classify() = %+v, want %q", upper, classify.Loose)
	}
}

func TestClassifyReasonIsPopulated(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Silent Hill 2 PS2 Case Only")
	if got.Reason == "" {
		t.Error("rejected result must carry a Reason for -audit output")
	}
}

func TestExplicitlyMissingPartsBeatComplete(t *testing.T) {
	t.Parallel()
	cases := map[string]classify.Condition{
		"Bully Greatest Hits PS2 Tested Complete Case Disc Only - No Manual / No Map": classify.Loose,
		"Silent Hill 2 PS2 CIB no manual":                                             classify.Loose,
		"Bully Sony PlayStation 2 PS2 Game W/ Manual - No Map":                        classify.CIB,
		"Bully PS2 PlayStation 2 Rockstar Games Black Label w Manual 2006":            classify.CIB,
	}
	for title, want := range cases {
		got := classify.Classify(title)
		if got.Rejected || got.Condition != want {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, want)
		}
	}

	// "w manual" must not fire inside "new manual".
	if got := classify.Classify("Silent Hill 2 PS2 disc and a like new manual"); got.Condition == classify.CIB {
		t.Errorf("Classify matched %q as CIB via %q", "like new manual", got.Reason)
	}
}

func TestMentions(t *testing.T) {
	t.Parallel()
	cases := []struct {
		listing, game string
		want          bool
	}{
		{"Bully PS2 PlayStation 2 Disc Only Tested", "Bully", true},
		{"The Ant Bully PS2 Complete", "Bully", true}, // caught by the catalog's negative terms, not here
		{"PS2 Games NEW CIB LOOSE Professionally Cleaned Tested Authentic", "Bully", false},
		{"A - C Cheap Games (Playstation 2) PS2 Disc Only TESTED", "Bully", false},
		{"Sony PlayStation 2 PS2 Games: Disc Only A to L Buy 4 Get 1 FREE", "Bully", false},
		{"Zelda Ocarina of Time N64 Cart Only", "The Legend of Zelda: Ocarina of Time", true},
		{"Shenmue 2 Sega Dreamcast Complete", "Shenmue II", true},
		{"Suikoden 3 PS2 CIB", "Suikoden III", true},
		{"Killer 7 PS2 Complete Black Label", "killer7", true},
		{"MDK 2 Dreamcast Disc Only", "MDK2", true},
		{"Pokemon Snap N64 Cart", "Pokémon Snap", true},
		{"Persona 3 FES PS2 CIB", "Persona 4", false},
		{"Fatal Frame 2 Crimson Butterfly PS2", "Fatal Frame II: Crimson Butterfly", true},
		{"Resident Evil 4 GameCube Complete", "Resident Evil Zero", false},
		{"Resident Evil 0 GameCube Complete", "Resident Evil Zero", true},
		{"Street Fighter 3rd Strike Dreamcast Disc Only", "Street Fighter III: 3rd Strike", true},
		{"Silent Hill 3 PS2 2003 Complete", "Silent Hill 2", false},
		{"Silent Hill II PS2 Black Label", "Silent Hill 2", true},
	}
	for _, c := range cases {
		if got := classify.Mentions(c.listing, c.game); got != c.want {
			t.Errorf("Mentions(%q, %q) = %v, want %v", c.listing, c.game, got, c.want)
		}
	}
}
