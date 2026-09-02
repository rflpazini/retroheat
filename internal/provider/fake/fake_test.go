package fake_test

import (
	"context"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/provider/fake"
)

var game = catalog.Game{
	ID:       "god-hand-ps2",
	Title:    "God Hand",
	Platform: catalog.PS2,
	Ebay:     catalog.EbayHints{Query: "God Hand PS2"},
}

// The scheduled job runs twice a day. If sample prices depended on the time of
// day rather than the calendar day, the second run would disagree with the
// first by a cent and the pipeline would commit that as a diff.
func TestQuotesDependOnlyOnTheCalendarDay(t *testing.T) {
	t.Parallel()
	morning := fake.New(time.Date(2026, 9, 1, 6, 12, 3, 0, time.UTC))
	evening := fake.New(time.Date(2026, 9, 1, 21, 47, 59, 0, time.UTC))

	a, err := morning.Quotes(context.Background(), game)
	if err != nil {
		t.Fatal(err)
	}
	b, err := evening.Quotes(context.Background(), game)
	if err != nil {
		t.Fatal(err)
	}

	if len(a) != len(b) {
		t.Fatalf("quote count differs across the same day: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Errorf("quote %d differs across the same day: %+v vs %+v", i, a[i], b[i])
		}
	}
}

func TestBackfillDependsOnlyOnTheCalendarDay(t *testing.T) {
	t.Parallel()
	morning := fake.New(time.Time{})
	first := morning.Backfill(game, 30, time.Date(2026, 9, 1, 6, 0, 0, 0, time.UTC))
	second := morning.Backfill(game, 30, time.Date(2026, 9, 1, 23, 30, 0, 0, time.UTC))

	if len(first) != len(second) {
		t.Fatalf("backfill length differs: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].Date != second[i].Date {
			t.Fatalf("backfill date differs at %d: %s vs %s", i, first[i].Date, second[i].Date)
		}
		if *first[i].Loose != *second[i].Loose || *first[i].CIB != *second[i].CIB {
			t.Errorf("backfill price differs at %s across the same day", first[i].Date)
		}
	}
}

func TestQuotesAreStableForAGivenDay(t *testing.T) {
	t.Parallel()
	p := fake.New(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	a, _ := p.Quotes(context.Background(), game)
	b, _ := p.Quotes(context.Background(), game)
	for i := range a {
		if a[i] != b[i] {
			t.Errorf("repeated call disagreed: %+v vs %+v", a[i], b[i])
		}
	}
}

func TestDifferentGamesGetDifferentPrices(t *testing.T) {
	t.Parallel()
	p := fake.New(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	other := game
	other.ID = "kuon-ps2"

	a, _ := p.Quotes(context.Background(), game)
	b, _ := p.Quotes(context.Background(), other)
	if a[0].MedianCents == b[0].MedianCents {
		t.Error("two games priced identically; sample data should vary by id")
	}
}
