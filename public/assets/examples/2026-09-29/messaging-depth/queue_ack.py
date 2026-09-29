"""Queue state model + real SQLite transaction; no Redis/network/crash benchmark."""
from collections import deque
import sqlite3

ready = deque(["X"])
ready.pop()  # A worker disappears before processing.
assert not ready
print("pop then worker loss: no recoverable queue entry")

ready = deque(["X"])
pending = set()


def take():
    # Model one indivisible ready -> pending operation.
    job = ready.pop()
    pending.add(job)
    return job


db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE receipt (job TEXT PRIMARY KEY);
CREATE TABLE total (value INTEGER NOT NULL);
INSERT INTO total VALUES (0);
""")


def apply_once(job):
    with db:
        inserted = db.execute("INSERT OR IGNORE INTO receipt VALUES (?)", (job,)).rowcount
        if inserted:
            db.execute("UPDATE total SET value=value+10")
    return bool(inserted)


job = take()
assert apply_once(job)
assert job in pending  # Result committed; worker disappears before acknowledgement.
pending.remove(job)
ready.appendleft(job)  # Recovery re-delivers the unfinished queue entry.
retried = take()
assert retried == job and not apply_once(retried)
pending.remove(retried)
assert not ready and not pending
assert db.execute("SELECT value FROM total").fetchone()[0] == 10
print("commit then acknowledgement loss: delivered twice, total=10")
db.close()
