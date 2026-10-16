"""Independent Git worktree experiment; creates and removes only a temporary repo."""

from pathlib import Path
import subprocess
import tempfile


def git(cwd, *args):
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


with tempfile.TemporaryDirectory(prefix="worktree-inputs-") as directory:
    root = Path(directory)
    source, target = root / "source", root / "target"
    source.mkdir()
    git(source, "init", "-b", "main")
    (source / "config.txt").write_text("committed\n")
    (source / ".tool-versions").write_text("python 3.14.5\n")
    git(source, "add", "config.txt", ".tool-versions")
    (source / ".gitignore").write_text(".env.local\n.tool-versions\n")
    git(source, "add", ".gitignore")
    git(source, "-c", "user.name=Example", "-c", "user.email=example@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "-m", "initial")

    (source / "config.txt").write_text("local change\n")
    (source / ".env.local").write_text("EXAMPLE_MODE=local\n")
    (source / "notes.txt").write_text("untracked\n")
    git(source, "worktree", "add", "-b", "study", str(target), "HEAD")

    assert (target / "config.txt").read_text() == "committed\n"
    assert (source / "config.txt").read_text() == "local change\n"
    assert not (target / ".env.local").exists()
    assert not (target / "notes.txt").exists()
    assert (target / ".tool-versions").exists()
    assert git(target, "ls-files", "--", ".tool-versions") == ".tool-versions"
    assert git(source, "check-ignore", "--", ".env.local") == ".env.local"
    assert (target / ".git").is_file()
    print(subprocess.run(["git", "--version"], check=True, capture_output=True, text=True).stdout.strip())
    print("tracked edit: source=local change; target=committed")
    print("ignored input: target missing")
    print("untracked note: target missing")
    print("tracked file matching ignore pattern: target present")
    print("linked worktree .git: file")
