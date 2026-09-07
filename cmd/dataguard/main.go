// Command dataguard refuses to let collected price data disappear. It compares
// the data directory at two git revisions, or a revision against a working
// directory, and exits non-zero when the newer side lost history files, points,
// boards or tracked games. A `Data-Reset: <reason>` trailer on a commit in the
// range is the one deliberate way past it, and only when both sides are
// revisions: the scrape job, which checks its own output before committing,
// never resets on purpose.
package main

import (
	"archive/tar"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/rflpazini/retroheat/internal/dataguard"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("dataguard", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var (
		before   = fs.String("before", "", "git revision whose data must survive (required)")
		after    = fs.String("after", "", "git revision to check; alternative to -after-dir")
		afterDir = fs.String("after-dir", "", "directory holding the new data; alternative to -after")
		repo     = fs.String("repo", ".", "repository root")
		dataPath = fs.String("data", "data", "data directory, relative to the repository root")
	)
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *before == "" || (*after == "") == (*afterDir == "") {
		fmt.Fprintln(stderr, "usage: dataguard -before <rev> (-after <rev> | -after-dir <dir>)")
		return 2
	}
	if isZeroSHA(*before) {
		fmt.Fprintln(stdout, "dataguard: nothing before this push; nothing to compare")
		return 0
	}

	if *after != "" {
		changed, err := dataChanged(*repo, *before, *after, *dataPath)
		if err != nil {
			fmt.Fprintln(stderr, "dataguard:", err)
			return 2
		}
		if !changed {
			fmt.Fprintf(stdout, "dataguard: %s unchanged between %s and %s\n", *dataPath, short(*before), short(*after))
			return 0
		}
	}

	beforeDir, ok, cleanup, err := materialize(*repo, *before, *dataPath)
	defer cleanup()
	if err != nil {
		fmt.Fprintln(stderr, "dataguard:", err)
		return 2
	}
	if !ok {
		fmt.Fprintf(stdout, "dataguard: no %s at %s; nothing to compare\n", *dataPath, short(*before))
		return 0
	}

	newDir := *afterDir
	if *after != "" {
		dir, ok, cleanupAfter, err := materialize(*repo, *after, *dataPath)
		defer cleanupAfter()
		if err != nil {
			fmt.Fprintln(stderr, "dataguard:", err)
			return 2
		}
		if !ok {
			// The whole directory is gone; Compare reports every file.
			dir = filepath.Join(os.TempDir(), "dataguard-empty")
		}
		newDir = dir
	}

	rep, err := dataguard.Compare(beforeDir, newDir)
	if err != nil {
		fmt.Fprintln(stderr, "dataguard:", err)
		return 2
	}
	fmt.Fprintf(stdout, "dataguard: compared %s against %s: %d points replaced, %d added, %d violations\n",
		short(*before), describeAfter(*after, *afterDir), rep.Replaced, rep.Added, len(rep.Violations))
	if rep.OK() {
		return 0
	}

	bypass := false
	if *after != "" {
		msgs, err := commitMessages(*repo, *before, *after)
		if err != nil {
			fmt.Fprintln(stderr, "dataguard:", err)
			return 2
		}
		bypass = dataguard.HasResetTrailer(msgs)
	}
	for _, v := range rep.Violations {
		if os.Getenv("GITHUB_ACTIONS") != "" && !bypass {
			fmt.Fprintf(stdout, "::error file=%s/%s::%s\n", *dataPath, v.Path, v.Detail)
		} else {
			fmt.Fprintf(stdout, "  %s\n", v)
		}
	}
	if bypass {
		fmt.Fprintln(stdout, "dataguard: loss allowed by a Data-Reset trailer in the commit range")
		return 0
	}
	fmt.Fprintln(stderr, "dataguard: collected data would be lost. Restore it, or if this is deliberate add a `Data-Reset: <reason>` trailer to the commit.")
	return 1
}

// isZeroSHA recognises the placeholder GitHub sends as the previous commit of
// a branch's first push.
func isZeroSHA(s string) bool {
	return len(s) >= 7 && strings.Trim(s, "0") == ""
}

func short(rev string) string {
	if len(rev) > 12 {
		return rev[:12]
	}
	return rev
}

func describeAfter(rev, dir string) string {
	if rev != "" {
		return short(rev)
	}
	return dir
}

func dataChanged(repo, before, after, dataPath string) (bool, error) {
	cmd := exec.Command("git", "-C", repo, "diff", "--quiet", before, after, "--", dataPath)
	var errb bytes.Buffer
	cmd.Stderr = &errb
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return false, nil
	case errors.As(err, &exit) && exit.ExitCode() == 1:
		return true, nil
	default:
		return false, fmt.Errorf("git diff %s %s: %w: %s", short(before), short(after), err, strings.TrimSpace(errb.String()))
	}
}

func commitMessages(repo, before, after string) (string, error) {
	cmd := exec.Command("git", "-C", repo, "log", "--format=%B", before+".."+after)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git log %s..%s: %w", short(before), short(after), err)
	}
	return string(out), nil
}

// materialize extracts dataPath as of rev into a temporary directory and
// returns the path to the extracted data. ok is false when the revision has
// no such path, which is what the first collection looks like.
func materialize(repo, rev, dataPath string) (dir string, ok bool, cleanup func(), err error) {
	cleanup = func() {}
	tmp, err := os.MkdirTemp("", "dataguard-")
	if err != nil {
		return "", false, cleanup, err
	}
	cleanup = func() { os.RemoveAll(tmp) }

	cmd := exec.Command("git", "-C", repo, "archive", "--format=tar", rev, "--", dataPath)
	var errb bytes.Buffer
	cmd.Stderr = &errb
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", false, cleanup, err
	}
	if err := cmd.Start(); err != nil {
		return "", false, cleanup, fmt.Errorf("git archive: %w", err)
	}
	untarErr := untar(stdout, tmp)
	if err := cmd.Wait(); err != nil {
		msg := errb.String()
		if strings.Contains(msg, "did not match any files") {
			return "", false, cleanup, nil
		}
		return "", false, cleanup, fmt.Errorf("git archive %s: %w: %s", short(rev), err, strings.TrimSpace(msg))
	}
	if untarErr != nil {
		return "", false, cleanup, untarErr
	}
	return filepath.Join(tmp, dataPath), true, cleanup, nil
}

func untar(r io.Reader, dest string) error {
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read archive: %w", err)
		}
		target := filepath.Join(dest, filepath.FromSlash(hdr.Name))
		if rel, err := filepath.Rel(dest, target); err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("archive entry %q escapes the destination", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			if err := f.Close(); err != nil {
				return err
			}
		}
	}
}
