package rawarchive_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/rawarchive"
)

func sample() *rawarchive.Run {
	r := &rawarchive.Run{Schema: rawarchive.Schema, GeneratedAt: "2026-09-07T09:23:41Z", Source: "ebay-browse", SeriesVersion: 1}
	r.Record("bully-ps2", "Bully PS2", []provider.Listing{
		{ItemID: "v1|1|0", Title: "Bully PS2 Complete CIB", PriceCents: 2599, Currency: "USD"},
		{ItemID: "v1|2|0", Title: "Bully (PlayStation 2) Disc Only", PriceCents: 1200, Currency: "USD"},
	}, nil)
	r.Record("okami-ps2", "", nil, errors.New("ebay search: unexpected status 500"))
	return r
}

func TestWriteThenReadRoundTrips(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "raw-20260907T092341Z.json.gz")
	if err := rawarchive.Write(path, sample()); err != nil {
		t.Fatal(err)
	}
	got, err := rawarchive.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Games) != 2 {
		t.Fatalf("games = %d, want 2", len(got.Games))
	}
	if got.Games[0].Query != "Bully PS2" || len(got.Games[0].Listings) != 2 || got.Games[0].Listings[0].PriceCents != 2599 {
		t.Errorf("first game lost data: %+v", got.Games[0])
	}
	if got.Games[1].Err == "" || len(got.Games[1].Listings) != 0 {
		t.Errorf("failed game = %+v, want an error and no listings", got.Games[1])
	}
	day, err := got.Day()
	if err != nil || day != "2026-09-07" {
		t.Errorf("Day = %q, %v; want 2026-09-07", day, err)
	}
}

func TestWriteIsByteStable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a.json.gz"), filepath.Join(dir, "b.json.gz")
	if err := rawarchive.Write(a, sample()); err != nil {
		t.Fatal(err)
	}
	if err := rawarchive.Write(b, sample()); err != nil {
		t.Fatal(err)
	}
	ba, _ := os.ReadFile(a)
	bb, _ := os.ReadFile(b)
	if string(ba) != string(bb) {
		t.Error("the same run produced different bytes; the upload would replace an identical asset every time")
	}
}

func TestReadRejectsAnotherSchema(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "raw.json.gz")
	r := sample()
	r.Schema = rawarchive.Schema + 1
	if err := rawarchive.Write(path, r); err != nil {
		t.Fatal(err)
	}
	if _, err := rawarchive.Read(path); err == nil {
		t.Error("Read accepted a schema this build does not understand")
	}
}

func TestFileNameSortsChronologicallyInUTC(t *testing.T) {
	t.Parallel()
	local := time.FixedZone("BRT", -3*3600)
	early := rawarchive.FileName(time.Date(2026, 9, 7, 6, 23, 41, 0, local))
	late := rawarchive.FileName(time.Date(2026, 9, 7, 18, 23, 41, 0, local))
	if early != "raw-20260907T092341Z.json.gz" {
		t.Errorf("FileName = %q, want the UTC time", early)
	}
	if early >= late {
		t.Errorf("names do not sort by time: %q vs %q", early, late)
	}
}

func TestRecordIsNilSafe(t *testing.T) {
	t.Parallel()
	var r *rawarchive.Run
	r.Record("bully-ps2", "q", nil, nil) // must not panic
}

func TestRecordNeverWritesANullListingsArray(t *testing.T) {
	t.Parallel()
	r := &rawarchive.Run{Schema: rawarchive.Schema, GeneratedAt: "2026-09-07T09:23:41Z"}
	r.Record("bully-ps2", "q", nil, nil)
	if r.Games[0].Listings == nil {
		t.Error("listings is nil, which serializes as null instead of []")
	}
}
