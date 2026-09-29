"""Scalar online-softmax arithmetic, not a GPU implementation or benchmark."""
from math import exp, isclose, log


def dense(scores, values):
    maximum = max(scores)
    weights = [exp(s - maximum) for s in scores]
    return sum(w * v for w, v in zip(weights, values)) / sum(weights)


def online(scores, values, block_size, rescale=True):
    if not scores or len(scores) != len(values) or block_size < 1:
        raise ValueError("nonempty matching inputs and positive block size required")
    maximum, denominator, numerator = float("-inf"), 0.0, 0.0
    for start in range(0, len(scores), block_size):
        block = scores[start:start + block_size]
        next_maximum = max(maximum, max(block))
        factor = exp(maximum - next_maximum) if rescale else 1.0
        weights = [exp(s - next_maximum) for s in block]
        denominator = factor * denominator + sum(weights)
        numerator = factor * numerator + sum(
            w * v for w, v in zip(weights, values[start:start + block_size])
        )
        maximum = next_maximum
    return numerator / denominator


def demo():
    scores, values = [0.0, log(2), log(4)], [10.0, 20.0, 40.0]
    assert isclose(dense(scores, values), 30.0)
    for block_size in [1, 2, 3]:
        result = online(scores, values, block_size)
        assert isclose(result, 30.0)
        print(f"block={block_size}: {result:.6f}")
    wrong = online(scores, values, 2, rescale=False)
    assert isclose(wrong, 26.0) and not isclose(wrong, 30.0)
    print(f"without rescaling: {wrong:.6f}")
    for row in [[1000.0, 1001.0, -1000.0], [-1000.0, -999.0, -998.0], [1.0, 1.0, 1.0]]:
        for block_size in [1, 2, 3]:
            assert isclose(online(row, values, block_size), dense(row, values), rel_tol=1e-12)
    print("stable for large scores and different block boundaries")


if __name__ == "__main__":
    demo()
