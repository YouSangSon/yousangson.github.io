"""Deterministic scheduler model; no Kafka broker semantics are simulated."""
from collections import Counter


def admit(records, per_partition_limit=None):
    running = []
    counts = Counter()
    for partition, offset in records:
        if len(running) == 2:
            break
        if per_partition_limit is not None and counts[partition] >= per_partition_limit:
            continue
        running.append((partition, offset))
        counts[partition] += 1
    return running


records = [(0, 10), (0, 11), (1, 20)]
shared = admit(records)
isolated = admit(records, per_partition_limit=1)
assert shared == [(0, 10), (0, 11)]
assert isolated == [(0, 10), (1, 20)]
print("shared slots:", shared)
print("per-partition admission:", isolated)


def frontier(delivered, done, committed):
    result = committed
    for offset in delivered:
        if offset not in done:
            break
        result = offset + 1
    return result


delivered = [10, 12, 15]
done = {12, 15}
assert max(done) + 1 == 16  # Unsafe: it would skip unfinished offset 10.
assert frontier(delivered, done, 10) == 10
assert frontier(delivered, done | {10}, 10) == 16
assert frontier(delivered, {10, 15}, 10) == 11
print("frontier before/after offset 10:", 10, 16)

# Assignment generation 7 completed after the partition moved to generation 8.
generation = 8
old_generation = 7
before = set(done)
if old_generation == generation:
    done.add(10)
assert done == before
print("old assignment result: ignored")
