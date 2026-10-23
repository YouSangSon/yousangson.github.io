#!/usr/bin/env python3
"""Reproduce RFC3339Nano ordering with Go and in-memory SQLite; no dependencies."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

GO_SOURCE = r'''package main

import (
    "encoding/json"
    "fmt"
    "os"
    "runtime"
    "time"
)

func main() {
    const layout = "2006-01-02T15:04:05.000000000Z"
    base := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
    rows := make([]map[string]string, 0)
    for i, ns := range []int64{0, 1, 100000000, 100000001, 110000000, 900000000, 900000000} {
        t := base.Add(time.Duration(ns))
        raw, fixed := t.Format(time.RFC3339Nano), t.UTC().Format(layout)
        parsed, err := time.Parse(time.RFC3339Nano, fixed)
        if err != nil || !parsed.Equal(t) { panic("normalization changed instant") }
        if t.In(time.FixedZone("UTC+9", 9*3600)).UTC().Format(layout) != fixed {
            panic("normalization changed with timezone")
        }
        rows = append(rows, map[string]string{
            "id": fmt.Sprintf("%c", 'a'+i), "raw": raw, "fixed": fixed,
        })
    }
    if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
        "go": runtime.Version(), "rows": rows,
    }); err != nil { panic(err) }
}
'''


def main():
    # Resolve the selected Go before entering the temporary build directory.
    env = dict(os.environ, GOTOOLCHAIN="local", GOWORK="off")
    goroot = subprocess.check_output(["go", "env", "GOROOT"], env=env, text=True).strip()
    with tempfile.TemporaryDirectory(prefix="timestamp-order-") as tmp:
        source = Path(tmp) / "main.go"
        source.write_text(GO_SOURCE)
        payload = json.loads(subprocess.check_output(
            [str(Path(goroot) / "bin/go"), "run", str(source)],
            cwd=tmp, env=env, text=True,
        ))
    assert not Path(tmp).exists()
    rows = payload["rows"]
    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE events (id TEXT PRIMARY KEY, raw TEXT, fixed TEXT)")
        db.executemany("INSERT INTO events VALUES (:id, :raw, :fixed)", rows)
        db.execute("CREATE INDEX events_order ON events(fixed, id)")

        def ids(sql, args=()):
            return "".join(row[0] for row in db.execute(sql, args))

        expected = "gfedcba"
        raw = ids("SELECT id FROM events ORDER BY raw DESC, id DESC")
        fixed = ids("SELECT id FROM events ORDER BY fixed DESC, id DESC")
        assert raw != expected
        assert fixed == expected
        print(f"Go {payload['go']}; Python {sys.version.split()[0]}; SQLite {sqlite3.sqlite_version}")
        for row in rows:
            print(f"{row['id']}: {row['raw']} -> {row['fixed']}")
        print(f"raw DESC: {raw}")
        print(f"fixed DESC: {fixed}")

        cutoff = rows[2]
        raw_cutoff = ids("SELECT id FROM events WHERE raw <= ? ORDER BY fixed, id", (cutoff["raw"],))
        fixed_cutoff = ids("SELECT id FROM events WHERE fixed <= ? ORDER BY fixed, id", (cutoff["fixed"],))
        assert raw_cutoff != "abc" and fixed_cutoff == "abc"
        print(f"cutoff at c: raw={raw_cutoff}; fixed={fixed_cutoff}")

        for page_size in (1, 2):
            pages, cursor = [], None
            while True:
                query = "SELECT id, fixed FROM events"
                args = ()
                if cursor is not None:
                    query += " WHERE (fixed, id) < (?, ?)"
                    args = cursor
                page = db.execute(query + f" ORDER BY fixed DESC, id DESC LIMIT {page_size}", args).fetchall()
                if not page:
                    break
                pages.append("".join(row[0] for row in page))
                cursor = (page[-1][1], page[-1][0])
                assert len("".join(pages)) <= len(rows), "cursor did not advance"
            assert "".join(pages) == expected
            if page_size == 2:
                print("cursor pages: " + " / ".join(pages))

        # shortcut: this checks SQLite date functions on two fixtures, not all DB timestamp types.
        rounded = [db.execute("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?)", (rows[i]["raw"],)).fetchone()[0] for i in (2, 3)]
        assert rounded[0] == rounded[1]
        print(f"strftime c == d: {rounded[0]}")
        print("PASS: ordering, cutoff, tied cursor, nanoseconds, UTC conversion, cleanup")
    finally:
        db.close()


if __name__ == "__main__":
    main()
