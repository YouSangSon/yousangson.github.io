"""Synthetic evaluation failures, not an LLM benchmark; Python 3 stdlib."""
from pathlib import Path
from tempfile import TemporaryDirectory


def claim_only(root):
    return "saved"


def correct(root):
    (root / "answer.txt").write_text("42\n")
    return "saved"


def side_effect(root):
    correct(root)
    (root / "protected.txt").write_text("changed")
    return "saved"


def evaluate(action):
    with TemporaryDirectory() as directory:
        root = Path(directory)
        protected = root / "protected.txt"
        protected.write_text("keep")
        reply = action(root)
        answer = root / "answer.txt"
        correct_output = answer.is_file() and answer.read_text() == "42\n"
        unchanged = protected.read_text() == "keep"
        return reply == "saved", correct_output and unchanged


def demo():
    expected = [(True, False), (True, True), (True, False)]
    for action, result in zip([claim_only, correct, side_effect], expected):
        actual = evaluate(action)
        assert actual == result, (action.__name__, actual)
        print(f"{action.__name__:12} reply={actual[0]} outcome={actual[1]}")
    # With equal, independent success probability p, these answer different questions.
    p, k = 0.7, 3
    at_least_one = 1 - (1 - p) ** k
    all_success = p ** k
    assert abs(at_least_one - 0.973) < 1e-12
    assert abs(all_success - 0.343) < 1e-12
    print(f"synthetic p={p}, k={k}: any={at_least_one:.3f}, all={all_success:.3f}")


if __name__ == "__main__":
    demo()
