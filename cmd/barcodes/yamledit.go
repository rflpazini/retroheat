package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// writeBarcodes replaces each listed entry's barcodes block in its platform
// file. The edited catalog is loaded and validated from a scratch copy first,
// so a bad edit never touches the real one, and each file is then swapped in
// with a rename, so an interrupted run leaves every file whole.
func writeBarcodes(catalogDir string, games []catalog.Game, codes map[string][]catalog.Barcode) error {
	platformOf := map[string]catalog.Platform{}
	for _, g := range games {
		platformOf[g.ID] = g.Platform
	}
	byFile := map[string]map[string][]catalog.Barcode{}
	for id, bcs := range codes {
		p, ok := platformOf[id]
		if !ok {
			return fmt.Errorf("no such catalog entry: %s", id)
		}
		name := string(p) + ".yaml"
		if byFile[name] == nil {
			byFile[name] = map[string][]catalog.Barcode{}
		}
		byFile[name][id] = bcs
	}

	edited := map[string][]byte{}
	for name, entries := range byFile {
		raw, err := os.ReadFile(filepath.Join(catalogDir, name))
		if err != nil {
			return err
		}
		lines := strings.Split(string(raw), "\n")
		ids := make([]string, 0, len(entries))
		for id := range entries {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			var ok bool
			if lines, ok = setBarcodes(lines, id, entries[id]); !ok {
				return fmt.Errorf("entry %q not found as a block entry in %s", id, name)
			}
		}
		edited[name] = []byte(strings.Join(lines, "\n"))
	}

	if err := validateEdited(catalogDir, edited); err != nil {
		return fmt.Errorf("the edited catalog would not validate, so nothing was written: %w", err)
	}
	names := make([]string, 0, len(edited))
	for name := range edited {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		path := filepath.Join(catalogDir, name)
		if err := os.WriteFile(path+".tmp", edited[name], 0o644); err != nil {
			return err
		}
		if err := os.Rename(path+".tmp", path); err != nil {
			_ = os.Remove(path + ".tmp")
			return err
		}
	}
	return nil
}

// validateEdited loads the catalog as it would be after the edits, from a
// scratch copy of its YAML files.
func validateEdited(catalogDir string, edited map[string][]byte) error {
	scratch, err := os.MkdirTemp("", "barcodes-catalog-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(scratch)
	entries, err := os.ReadDir(catalogDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		ext := filepath.Ext(e.Name())
		if e.IsDir() || (ext != ".yaml" && ext != ".yml") {
			continue
		}
		raw, ok := edited[e.Name()]
		if !ok {
			if raw, err = os.ReadFile(filepath.Join(catalogDir, e.Name())); err != nil {
				return err
			}
		}
		if err := os.WriteFile(filepath.Join(scratch, e.Name()), raw, 0o600); err != nil {
			return err
		}
	}
	games, err := catalog.Load(scratch)
	if err != nil {
		return err
	}
	return catalog.Validate(games)
}

// setBarcodes swaps the entry's barcodes block for one listing codes, placed
// as the entry's last key; with no codes the block goes. The entry ends at the next "  - id:" or at the
// first line that is not part of it (a comment or blank line between
// entries stays where it is).
func setBarcodes(lines []string, id string, codes []catalog.Barcode) ([]string, bool) {
	start := -1
	for i, l := range lines {
		if strings.TrimRight(l, " ") == "  - id: "+id {
			start = i
			break
		}
	}
	if start < 0 {
		return lines, false
	}
	end := start + 1
	for end < len(lines) && strings.HasPrefix(lines[end], "    ") {
		end++
	}

	// Drop the old block: its key line and every line indented under it.
	for i := start + 1; i < end; i++ {
		if strings.TrimRight(lines[i], " ") != "    barcodes:" && !strings.HasPrefix(lines[i], "    barcodes: ") {
			continue
		}
		j := i + 1
		for j < end && strings.HasPrefix(lines[j], "      ") {
			j++
		}
		lines = append(lines[:i:i], lines[j:]...)
		end -= j - i
		break
	}

	if len(codes) == 0 {
		return lines, true
	}
	block := []string{"    barcodes:"}
	for _, b := range codes {
		line := "      - {code: " + strconv.Quote(b.Code)
		if b.Variant != "" {
			line += ", variant: " + string(b.Variant)
		}
		block = append(block, line+"}")
	}
	out := make([]string, 0, len(lines)+len(block))
	out = append(out, lines[:end]...)
	out = append(out, block...)
	return append(out, lines[end:]...), true
}
