package main

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestIsZeroSHA(t *testing.T) {
	t.Parallel()
	if !isZeroSHA("0000000000000000000000000000000000000000") {
		t.Error("the 40-zero placeholder was not recognised")
	}
	for _, s := range []string{"", "0", "e5b5523", "00e5b55230000"} {
		if isZeroSHA(s) {
			t.Errorf("isZeroSHA(%q) = true, want false", s)
		}
	}
}

func TestUntarRefusesToEscapeTheDestination(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	body := []byte("{}")
	if err := tw.WriteHeader(&tar.Header{Name: "../escape.json", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}

	dest := t.TempDir()
	if err := untar(&buf, dest); err == nil {
		t.Fatal("untar accepted an entry that escapes the destination")
	}
	if _, err := os.Stat(filepath.Join(dest, "..", "escape.json")); err == nil {
		t.Error("the escaping file was written")
	}
}

func TestUntarWritesRegularFilesUnderTheDestination(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	body := []byte(`{"id":"x"}`)
	if err := tw.WriteHeader(&tar.Header{Name: "data/history/", Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "data/history/x-ps2.json", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}

	dest := t.TempDir()
	if err := untar(&buf, dest); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "data", "history", "x-ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(body) {
		t.Errorf("file body = %q, want %q", got, body)
	}
}
