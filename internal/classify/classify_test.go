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
		got := classify.Classify(title, "Used")
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
		got := classify.Classify(title, "New")
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
		got := classify.Classify(title, "Used")
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
		got := classify.Classify(title, "Used")
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
		if got := classify.Classify(title, "Used"); got.Condition != classify.New {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.New)
		}
	}
}

func TestClassifyPrefersSealedOverComplete(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Rule of Rose PS2 Factory Sealed Complete In Box", "New")
	if got.Condition != classify.New {
		t.Errorf("Classify() = %+v, want %q (sealed outranks complete)", got, classify.New)
	}
}

func TestClassifyRejectsJunkBeforeCondition(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Silent Hill 2 PS2 Repro Sealed Complete In Box", "New")
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
		got := classify.Classify(title, "Used")
		if got.Rejected {
			continue
		}
		if got.Condition != classify.Unknown {
			t.Errorf("Classify(%q) = %+v, want %q", title, got, classify.Unknown)
		}
	}
}

func TestClassifyFallsBackToEbayCondition(t *testing.T) {
	t.Parallel()
	if got := classify.Classify("Silent Hill 2 Sony PlayStation 2", "New"); got.Condition != classify.New {
		t.Errorf("Classify() = %+v, want %q from eBay condition", got, classify.New)
	}
	if got := classify.Classify("Silent Hill 2 Sony PlayStation 2", "Used"); got.Condition != classify.Unknown {
		t.Errorf("Classify() = %+v, want %q (used tells us nothing)", got, classify.Unknown)
	}
}

func TestClassifyIsCaseInsensitive(t *testing.T) {
	t.Parallel()
	upper := classify.Classify("SILENT HILL 2 PS2 DISC ONLY", "Used")
	lower := classify.Classify("silent hill 2 ps2 disc only", "Used")
	if upper != lower {
		t.Errorf("case sensitivity: upper=%+v lower=%+v", upper, lower)
	}
	if upper.Condition != classify.Loose {
		t.Errorf("Classify() = %+v, want %q", upper, classify.Loose)
	}
}

func TestClassifyReasonIsPopulated(t *testing.T) {
	t.Parallel()
	got := classify.Classify("Silent Hill 2 PS2 Case Only", "Used")
	if got.Reason == "" {
		t.Error("rejected result must carry a Reason for -audit output")
	}
}
