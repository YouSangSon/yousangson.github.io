package restore

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestPathSwapRootAndMutableBytes(t *testing.T) {
	base := t.TempDir()
	a, b := filepath.Join(base, "a"), filepath.Join(base, "b")
	for _, dir := range []string{a, b} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(a, "payload"), []byte("version1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(b, "payload"), []byte("other-v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "current")
	if err := os.Symlink("a", link); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(link) // Go 1.24: follows this initial link.
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("b", link); err != nil {
		t.Fatal(err)
	}
	byPath, err := os.ReadFile(filepath.Join(link, "payload"))
	if err != nil {
		t.Fatal(err)
	}
	held, err := root.Open("payload")
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	byRoot, err := io.ReadAll(held)
	if err != nil {
		t.Fatal(err)
	}
	if string(byPath) != "other-v1" || string(byRoot) != "version1" {
		t.Fatalf("path=%q root=%q", byPath, byRoot)
	}
	t.Logf("after path swap: path=%q rooted=%q", byPath, byRoot)

	if err := os.WriteFile(filepath.Join(base, "outside"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if ordinary, err := os.ReadFile(filepath.Join(a, "..", "outside")); err != nil || string(ordinary) != "outside" {
		t.Fatalf("ordinary path did not reach existing outside file: %q, %v", ordinary, err)
	}
	if _, err := root.Open("../outside"); err == nil {
		t.Fatal("root accepted traversal outside its directory")
	}

	beforeWrite, err := root.Open("payload")
	if err != nil {
		t.Fatal(err)
	}
	defer beforeWrite.Close()
	writer, err := os.OpenFile(filepath.Join(a, "payload"), os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.WriteAt([]byte("version2"), 0); err != nil {
		writer.Close()
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	changed, err := io.ReadAll(beforeWrite)
	if err != nil {
		t.Fatal(err)
	}
	if string(changed) != "version2" {
		t.Fatalf("held file bytes=%q; want version2", changed)
	}
	t.Logf("after in-place write: held file reads %q", changed)
}
