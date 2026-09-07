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

func TestBoxedMediaNeedsTheBoxToBeComplete(t *testing.T) {
	t.Parallel()
	// On a cartridge platform the cardboard box is the valuable part, so a
	// cartridge "with manual" is neither loose nor complete and must not
	// drag the complete-in-box median down.
	unknown := []string{
		"Mario Kart 64 Racing Nintendo 64 N64 Original Authentic Game Tested With Manual",
		"Nintendo Mario Kart 64 for N64, Manual Included, NTSC-U/C, 1996 100% Authentic",
		"Mario Kart 64 (N64, 1997) VGC w/ Manual + Case Protector Cleaned & Tested",
		"Mario Kart 64 N64 w manual",
	}
	for _, title := range unknown {
		got := classify.ClassifyMedia(title, classify.Boxed)
		if got.Rejected || got.Condition != classify.Unknown {
			t.Errorf("ClassifyMedia(%q, Boxed) = %+v, want unknown", title, got)
		}
		if got.Reason != "manual-no-box" {
			t.Errorf("ClassifyMedia(%q, Boxed).Reason = %q, want manual-no-box", title, got.Reason)
		}
	}

	cib := []string{
		"Mario Kart 64 N64 With Manual and Box Tested",
		"Banjo-Kazooie N64 Authentic Box, Manual, and Cart",
		"Conker's Bad Fur Day (Nintendo 64 N64) w/ Box & Manual Action-Adventure M 2001",
		"Goemon's Great Adventure (Nintendo 64 N64) Box+Cart+Manual Good/Tested",
		"Mario Kart 64 Nintendo 64 N64 Complete Game Cartridge Manuals in Original Box",
		"Mario Kart 64 (Nintendo 64 N64) Complete In Box with manual",
		"Mario Kart 64 N64 Nintendo 64 CIB Complete Great Condition",
		"Mario Kart 64 N64 Boxed w/ Manual",
	}
	for _, title := range cib {
		got := classify.ClassifyMedia(title, classify.Boxed)
		if got.Rejected || got.Condition != classify.CIB {
			t.Errorf("ClassifyMedia(%q, Boxed) = %+v, want %q", title, got, classify.CIB)
		}
	}

	// Cased media keeps the old reading: the disc is in its case, so the
	// manual is the only part that could be missing.
	for _, title := range []string{
		"Silent Hill 2 PlayStation 2 Tested With Manual",
		"Bully PS2 Black Label w Manual 2006",
	} {
		if got := classify.ClassifyMedia(title, classify.Cased); got.Condition != classify.CIB {
			t.Errorf("ClassifyMedia(%q, Cased) = %+v, want %q", title, got, classify.CIB)
		}
	}
}

func TestClassifyDefaultsToCasedMedia(t *testing.T) {
	t.Parallel()
	title := "Silent Hill 2 PS2 with manual"
	if got, want := classify.Classify(title), classify.ClassifyMedia(title, classify.Cased); got != want {
		t.Errorf("Classify(%q) = %+v, ClassifyMedia(Cased) = %+v", title, got, want)
	}
}

func TestClassifyRejectsReproductionCardsAndReplacementBoxes(t *testing.T) {
	t.Parallel()
	titles := []string{
		"Mario Kart N64, Nintenton 64 Games Cartridge Card for Nintendo N64 - NEW IN BOX",
		"N64 Game Card SUPER MARIO DONKEY KONG POKEMON KART 64 for Nintendo 64",
		"Mario Kart 64 Cart Games For Nintendo N64 US Version Fast Shipping",
		"Mario Kart 64 Nintendo 64 N64 Tested Authentic w/ Manual + Replacement Box/Case",
		"Conker's Bad Fur Day N64 cart with custom box",
	}
	for _, title := range titles {
		if got := classify.ClassifyMedia(title, classify.Boxed); !got.Rejected {
			t.Errorf("ClassifyMedia(%q) = %+v, want rejected", title, got)
		}
	}
}

func TestMentionsIgnoresThePlatformsOwnNumber(t *testing.T) {
	t.Parallel()
	// "PlayStation 2" carries a 2, and for a title that ends in 2 it used to
	// satisfy the sequel-number check: nearly every "Dark Cloud 2" listing
	// counted was the first game. The platform name is not a sequel number.
	notThisGame := map[string]string{
		"Dark Cloud (Sony PlayStation 2, 2001) PS2 CIB Complete TESTED":     "Dark Cloud 2",
		"Silent Hill Origins PlayStation 2 PS2 Complete In Box":             "Silent Hill 2",
		"Way of the Samurai PS2 PlayStation 2 Disc Only":                    "Way of the Samurai 2",
		"Shin Megami Tensei: Digital Devil Saga (Sony PlayStation 2) CIB":   "Digital Devil Saga 2",
		"Capcom Vs Snk Mark Of Millennium 2001 Used PS2 Playstation 2 Game": "Capcom vs. SNK 2",
		"Xenosaga Episode I Der Wille zur Macht Sony PlayStation 2 PS2 CIB": "Xenosaga Episode II",
	}
	for listing, game := range notThisGame {
		if classify.Mentions(listing, game) {
			t.Errorf("Mentions(%q, %q) = true, want false", listing, game)
		}
	}
	stillThisGame := map[string]string{
		"Dark Cloud 2 Sony ( PlayStation 2 , 2003) PS2 Game CIB Complete":  "Dark Cloud 2",
		"Silent Hill 2 (Sony PlayStation 2, 2001) Black Label Complete":    "Silent Hill 2",
		"Xenosaga: Episode II 2 PS2 PlayStation 2 Complete CIB Mint Discs": "Xenosaga Episode II",
		"Mario Kart 64 Nintendo 64 N64 Cartridge Only":                     "Mario Kart 64",
	}
	for listing, game := range stillThisGame {
		if !classify.Mentions(listing, game) {
			t.Errorf("Mentions(%q, %q) = false, want true", listing, game)
		}
	}
}

func TestClassifyRejectsSlabsDemosMerchandiseAndPartialSets(t *testing.T) {
	t.Parallel()
	rejected := []string{
		"The Legend of Zelda Majora's Mask N64 Sealed 2000 PSA 9.2 A+",
		"Ikaruga (Nintendo GameCube, 2003) CGC 9.4 A Sealed First Print",
		"Star Fox StarFox Nintendo 64 N64 W/ Rumble Pak Sealed 1st Print New VGA 85+",
		"Sonic Adventure 2: The Trial Sega Dreamcast Disc Only Tested",
		"Phantasy Star Online Sega Dreamcast 2001 CIB W/ Sonic Adventure 2 Demo",
		"Konami Preview Disc Silent Hill Suikoden Demo PlayStation 2 PS2 NEW SEALED",
		"BRAND NEW SEALED Front Mission 4 Demo Sampler Disc Volume Two PS2",
		"Pokemon XD: Gale of Darkness GameCube Skin *New* Sealed",
		"Super Mario 64 5ft Flag N64 1996 Banner Poster Nintendo",
		"nintendo 64 box protector banjo tooie n64 Brand New reprint",
		"1 N64 Nintendo 64 Star Fox Video Game Clear Case Cases Sleeve Box Protector CIB",
		"SNES N64 Video Game Acrylic Display Case CIB Sealed Pokemon Stadium",
		"Shenmue (Sega Dreamcast, 2000) CIB Missing Disk 1 Complete Tested, Working",
		"Baten Kaitos Origins Nintendo GameCube, 2006 W/ Manual, Disc 2 Only",
		"Resident Evil Zero (Gamecube - DISC ONE REPLACEMENT DISC ONLY)",
		"UMD Dual Pack: Patapon + LocoRoco (Sony, PSP, PlayStation Portable) Brand New",
		"YS SEVEN PREMIUM EDITION SONY PSP MUSICAL SELECTIONS CD ONLY SEALED BRAND NEW.",
		"Suikoden V Art Book + Limited Edition Music CD Soundtrack PS2 Promo New Sealed",
	}
	for _, title := range rejected {
		if got := classify.Classify(title); !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}

	// Games shipped with posters and soundtracks; a copy that mentions them
	// is still a copy of the game.
	cib := []string{
		"Pokemon XD Gale of Darkness GameCube Complete CIB with Original Poster Tested",
		"Pokemon XD: Gale of Darkness CIB (GameCube, 2005) No Poster - Free Shipping",
		"Turok 2: Seeds of Evil (Nintendo 64, N64) CIB Complete with Poster",
		"Silent Hill 3 PS2 PlayStation 2 Complete CIB + Soundtrack CD Tested Black Label",
		"Grandia II Sega Dreamcast Complete w/ Manual and Soundtrack CD",
		"Mario Kart 64 N64 CIB w/ Protector",
	}
	for _, title := range cib {
		if got := classify.Classify(title); got.Rejected || got.Condition != classify.CIB {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.CIB)
		}
	}
}

func TestClassifyDoubtsASealedCopyThatWasTestedOrIsAUSVersion(t *testing.T) {
	t.Parallel()
	// Nobody tests a factory-sealed game, and "Brand New Factory Sealed US
	// Version" at a third of the complete price is the bootleg template.
	doubtful := []string{
		"Star Fox 64 - Nintendo 64 (N64) Best price Tested and working Factory sealed",
		"Super Mario 64 - N64 | AUTHENTIC | CLEANED. TESTED.  SEALED.",
		"Killer7 (Nintendo GameCube, 2005) Tested Complete/w Manual New Sealed In Plastic",
		"Shin Megami Tensei: Nocturne PS2 (Brand New Factory Sealed US Version)",
		"Katamari Damacy PS2 Brand New Factory Sealed US Version",
	}
	for _, title := range doubtful {
		got := classify.Classify(title)
		if !got.Rejected || got.Condition == classify.New {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}
	sealed := []string{
		"Shin Megami Tensei Nocturne (PS2 Playstation 2) NEW SEALED Y-FOLD, NEAR-MINT!",
		"Ikaruga Nintendo GameCube New Sealed",
		"Factory Sealed ATLUS Shin Megami Tensei: Digital Devil Saga PS2 NTSC-U/C",
	}
	for _, title := range sealed {
		if got := classify.Classify(title); got.Rejected || got.Condition != classify.New {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.New)
		}
	}
}

func TestMentionsNeedsBothWordsOfATwoWordTitleAndAWholeNumber(t *testing.T) {
	t.Parallel()
	notThisGame := map[string]string{
		"La Pucelle Tactics US PS2 Playstation 2 New Sealed":          "Suikoden Tactics",
		"Sony Playstation 2 PS2 Dark Cloud 2001 Black Label Complete": "Dark Cloud 2",
	}
	for listing, game := range notThisGame {
		if classify.Mentions(listing, game) {
			t.Errorf("Mentions(%q, %q) = true, want false", listing, game)
		}
	}
	stillThisGame := map[string]string{
		"Rhapsodia (Suikoden Tactics) CIB Sony PS2": "Suikoden Tactics",
		"Killer 7 Nintendo GameCube Complete":       "killer7",
		"Dark Cloud 2 (Sony PlayStation 2, 2003)":   "Dark Cloud 2",
	}
	for listing, game := range stillThisGame {
		if !classify.Mentions(listing, game) {
			t.Errorf("Mentions(%q, %q) = false, want true", listing, game)
		}
	}
}

func TestClassifyRejectsPartOfAMultiDiscSet(t *testing.T) {
	t.Parallel()
	partial := []string{
		"Shenmue Sega Dreamcast with Manual Disc 1 won't load, other discs work",
		"Resident Evil CODE: Veronica Disk 2 (Sega Dreamcast, 2000) Loose Disc Capcom",
		"Metal Gear Solid: The Twin Snakes Disc 2 GameCube disc only - Tested/Working",
		"Baten Kaitos: Eternal Wings Nintendo GameCube 2004 Disc 2 W Manual See Pics Read",
		"Skies of Arcadia Dreamcast Disc 1 Only + Manual Untested",
	}
	for _, title := range partial {
		if got := classify.Classify(title); !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected as a partial set", title, got)
		}
	}
	// Naming every disc is the opposite: a whole set.
	whole := map[string]classify.Condition{
		"Resident Evil Zero (Nintendo GameCube) Disc 1 & Disc 2 + Manual No Case": classify.Loose,
		"Skies of Arcadia Sega Dreamcast CIB 2 Discs, Manual, & Case":             classify.CIB,
		"Shenmue II Sega Dreamcast 4 Disc Set w Manual Case":                      classify.CIB,
		"Xenosaga Episode II Jenseits von Gut und Bose (PS2, 2005) CIB 2-Discs":   classify.CIB,
	}
	for title, want := range whole {
		if got := classify.Classify(title); got.Rejected || got.Condition != want {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, want)
		}
	}
}

func TestSealedSanityReadsWholeWords(t *testing.T) {
	t.Parallel()
	// "Untested" is how an honest seller describes a sealed copy, and
	// "previous version" contains "us version"; neither is a bootleg tell.
	sealed := []string{
		"Space Channel 5 Sega Dreamcast Factory Sealed, Untested",
		"Ikaruga Nintendo GameCube New Sealed - Not Tested, Never Opened",
		"Okami PS2 Brand New Sealed, previous version print run",
	}
	for _, title := range sealed {
		if got := classify.Classify(title); got.Rejected || got.Condition != classify.New {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.New)
		}
	}
	doubtful := []string{
		"Star Fox 64 - Nintendo 64 (N64) Best price Tested and working Factory sealed",
		"Katamari Damacy PS2 (Brand New Factory Sealed U.S. Version)",
	}
	for _, title := range doubtful {
		if got := classify.Classify(title); !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}
}

func TestABoxThatIsAbsentOrAnAccessoryIsNotABox(t *testing.T) {
	t.Parallel()
	// The word "box" in "no box" or "box protector" must not satisfy the
	// Boxed-media check, or a cartridge with its manual and nothing else
	// would be priced as complete.
	unknown := []string{
		"Mario Kart 64 N64 with Manual, No Box",
		"Mario Kart 64 (N64, 1997) w/ Manual + Box Protector Cleaned & Tested",
		"Donkey Kong 64 Nintendo N64 Game Cartridge Instruction Manual Booklet No Box",
		"Pokemon Puzzle League N64 No Box, Manual Included",
	}
	for _, title := range unknown {
		got := classify.ClassifyMedia(title, classify.Boxed)
		if got.Rejected || got.Condition != classify.Unknown {
			t.Errorf("ClassifyMedia(%q, Boxed) = %+v, want unknown", title, got)
		}
	}
	cib := []string{
		"Mario Kart 64 N64 w/ Box & Manual + Box Protector",
		"Wave Race 64 (Nintendo 64 N64 1996) Tested Box Manual Box Protector",
	}
	for _, title := range cib {
		if got := classify.ClassifyMedia(title, classify.Boxed); got.Rejected || got.Condition != classify.CIB {
			t.Errorf("ClassifyMedia(%q, Boxed) = %+v, want %q", title, got, classify.CIB)
		}
	}
	// For a disc the box is the case; a disc with its manual and no box is
	// a loose copy, as "no case" already is.
	if got := classify.ClassifyMedia("Geist - Nintendo GameCube w/ Manual, No Box, Excellent Disc", classify.Cased); got.Condition != classify.Loose {
		t.Errorf("ClassifyMedia(Geist no box, Cased) = %+v, want %q", got, classify.Loose)
	}
}

func TestVGAIsASlabOnlyWithAGrade(t *testing.T) {
	t.Parallel()
	rejected := []string{
		"Zelda Twilight Princess VGA 85 Factory Sealed Nintendo GameCube",
		"VGA GOLD 85+ - Cannon Spike Sega Dreamcast 2000 FACTORY SEALED! - RARE!",
		"Factory Sealed Sonic Adventure VGA graded 90 Gold Sega Dreamcast",
	}
	for _, title := range rejected {
		if got := classify.Classify(title); !got.Rejected {
			t.Errorf("Classify(%q) = %+v, want rejected", title, got)
		}
	}
	kept := map[string]classify.Condition{
		"Ikaruga Sega Dreamcast VGA Compatible CIB Complete":          classify.CIB,
		"Suikoden V PS2 Complete CIB with Bonus Music CD":             classify.CIB,
		"Grandia II Sega Dreamcast Disc Only, works with the VGA box": classify.Loose,
	}
	for title, want := range kept {
		if got := classify.Classify(title); got.Rejected || got.Condition != want {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, want)
		}
	}
}

func TestMentionsKeepsScanningPastALongerNumber(t *testing.T) {
	t.Parallel()
	// The first "darkcloud2" sits inside "darkcloud2001" and must be
	// skipped; the second is the real thing.
	if !classify.Mentions("dark cloud 2001 and dark cloud 2 ps2", "Dark Cloud 2") {
		t.Error("Mentions stopped at the first, rejected occurrence")
	}
}
