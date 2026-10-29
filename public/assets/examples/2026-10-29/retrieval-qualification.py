"""Recalculate published ranks and demonstrate two different acceptance rules.

No model, network, database, or retrieval benchmark runs in this example.
"""

from math import isclose


def scores(ranks):
    return (
        sum(0 < rank <= 5 for rank in ranks) / len(ranks),
        sum(1 / rank if 0 < rank <= 5 else 0 for rank in ranks) / len(ranks),
    )


# The published summary has 17 first-place answers and one second-place answer.
# The failing Chinese-to-English pair consists of that answer and a first place.
ranks = [1] * 16 + [2, 1]
recall, mrr = scores(ranks)
pair_recall, pair_mrr = scores(ranks[-2:])
hard_negative_ordering = 17 / 18
assert recall == pair_recall == 1
assert isclose(mrr, 35 / 36)
assert pair_mrr == 0.75
assert hard_negative_ordering < 1
print(f"18 queries: recall@5={recall:.6f}, MRR@5={mrr:.6f}")
print(f"zh->en pair: recall@5={pair_recall:.6f}, MRR@5={pair_mrr:.6f}")
print(f"hard-negative ordering={hard_negative_ordering:.6f}, qualification=RED")

# Synthetic distribution: the same answers occur at rank 1 or rank 5.
for rank, expected_mrr in [(1, 1), (5, 0.2), (6, 0), (0, 0)]:
    hit, reciprocal = scores([rank])
    assert hit == int(0 < rank <= 5)
    assert reciprocal == expected_mrr
first, fifth = scores([1]), scores([5])
assert first[0] == fifth[0] and first[1] > fifth[1]
print(f"synthetic rank 1 vs 5: recall@5={first[0]:.1f}/{fifth[0]:.1f}, MRR@5={first[1]:.1f}/{fifth[1]:.1f}")
