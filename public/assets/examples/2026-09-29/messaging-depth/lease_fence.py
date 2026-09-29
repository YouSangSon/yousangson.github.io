"""An execution-order model, not a Redis or failover test. Python 3 stdlib."""
import sqlite3

lease = {"owner": None, "until": 0, "generation": 0}


def acquire(owner, now, ttl):
    if lease["owner"] is not None and now < lease["until"]:
        return None
    lease.update(owner=owner, until=now + ttl, generation=lease["generation"] + 1)
    return lease["generation"]


def release(owner):
    if lease["owner"] != owner:
        return False
    lease["owner"] = None
    return True


db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE resource (id INTEGER PRIMARY KEY, fence INTEGER, value TEXT)")
db.execute("INSERT INTO resource VALUES (1, 0, 'initial')")
db.commit()


def write(fence, value):
    with db:
        changed = db.execute(
            "UPDATE resource SET fence=?, value=? WHERE id=1 AND fence<=?",
            (fence, value, fence),
        ).rowcount
    return changed == 1


a = acquire("A", now=0, ttl=10)
b = acquire("B", now=11, ttl=10)
assert (a, b) == (1, 2)
assert release("A") is False and lease["owner"] == "B"

unprotected = "B result"
unprotected = "late A result"  # Safe lease release did not protect this write.
assert unprotected == "late A result"
assert write(b, "B result")
assert not write(a, "late A result")
assert db.execute("SELECT fence, value FROM resource").fetchone() == (2, "B result")
print("owner comparison: B lease survives")
print("unprotected resource:", unprotected)
print("fenced resource:", db.execute("SELECT value FROM resource").fetchone()[0])
db.close()
