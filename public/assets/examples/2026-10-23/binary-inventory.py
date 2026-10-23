#!/usr/bin/env python3
"""Offline Go module-metadata and artifact-identity demonstration, not an SBOM generator."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    go = shutil.which("go")
    if go is None:
        raise SystemExit("Go must already be installed; this script installs nothing")
    # Resolve version-manager shims before moving into the temporary module.
    goroot = subprocess.check_output(
        [go, "env", "GOROOT"], text=True,
        env=os.environ | {"GOTOOLCHAIN": "local"},
    ).strip()
    go = str(Path(goroot) / "bin" / "go")
    with tempfile.TemporaryDirectory(prefix="binary-inventory-") as directory:
        root = Path(directory)
        env = os.environ | {
            "GOENV": "off", "GOWORK": "off", "GOFLAGS": "",
            "GOTOOLCHAIN": "local", "GOPROXY": "off", "GOSUMDB": "off",
            "GO111MODULE": "on", "CGO_ENABLED": "0",
            "GOCACHE": str(root / "cache"), "GOMODCACHE": str(root / "modcache"),
        }

        def run(*args):
            return subprocess.run(
                [go, *args], cwd=root, env=env, check=True,
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            ).stdout.strip()

        files = {
            "go.mod": "module example.test/inventory\n\ngo 1.24.5\n\nrequire example.test/helper v0.0.0\nreplace example.test/helper => ./helper\n",
            "helper/go.mod": "module example.test/helper\n\ngo 1.24.5\n",
            "helper/helper.go": 'package helper\nfunc Message() string { return "helper" }\n',
            "cmd/a/main.go": 'package main\nimport ("fmt"; "example.test/helper")\nfunc main() { fmt.Println(helper.Message()) }\n',
            "cmd/b/main.go": 'package main\nimport "fmt"\nfunc main() { fmt.Println("stdlib") }\n',
        }
        for name, content in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        manifest_hash = sha256(root / "go.mod")
        version = run("version")
        if version.split()[2] != "go1.24.5":
            raise SystemExit(f"Use installed Go 1.24.5 for this demonstration; got {version}")
        print(version)
        print("source modules:")
        print(run("list", "-m", "all"))
        records = {}
        for command in ("a", "b"):
            name = f"command-{command}"
            run("build", "-trimpath", "-buildvcs=false", "-o", name, f"./cmd/{command}")
            metadata = run("version", "-m", name)
            dependencies = [line.split()[1] for line in metadata.splitlines()
                            if line.startswith("\tdep\t")]
            assert dependencies == (["example.test/helper"] if command == "a" else [])
            records[name] = {"sha256": sha256(root / name), "modules": dependencies}
            print(f"{name} dependency modules: {','.join(dependencies) or '(none)'}")
        assert sha256(root / "go.mod") == manifest_hash
        assert records["command-a"]["sha256"] != records["command-b"]["sha256"]

        def matches(name, path):
            return path.name == name and sha256(path) == records[name]["sha256"]

        assert all(matches(name, root / name) for name in records)
        print("original name+sha256 mapping: PASS")
        shutil.copyfile(root / "command-b", root / "command-a")
        assert not matches("command-a", root / "command-a")
        print("command-b bytes under command-a name: REJECT")
        print("go.mod unchanged: PASS")
    assert not root.exists()
    print("temporary resources removed: PASS")


if __name__ == "__main__":
    main()
