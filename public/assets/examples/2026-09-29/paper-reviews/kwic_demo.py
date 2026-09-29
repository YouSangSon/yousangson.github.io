"""Independent educational KWIC example; Python 3 stdlib, no paper code copied."""


class MaterializedShifts:
    def __init__(self, lines):
        self._rows = []
        for line in lines:
            words = line.split()
            for start in range(len(words)):
                self._rows.append(" ".join(words[start:] + words[:start]))

    def count(self):
        return len(self._rows)

    def text(self, shift_id):
        return self._rows[shift_id]


class IndexedShifts:
    def __init__(self, lines):
        self._lines = [line.split() for line in lines]
        # Deliberately reverse enumeration: the public contract promises no order.
        self._locations = [
            (line_id, start)
            for line_id, words in enumerate(self._lines)
            for start in range(len(words))
        ][::-1]

    def count(self):
        return len(self._locations)

    def text(self, shift_id):
        line_id, start = self._locations[shift_id]
        words = self._lines[line_id]
        return " ".join(words[start:] + words[:start])


def alphabetized(index):
    return sorted(index.text(i) for i in range(index.count()))


def demo():
    lines = ["red blue green"]
    eager = MaterializedShifts(lines)
    indexed = IndexedShifts(lines)
    assert eager.text(0) != indexed.text(0)  # callers must not rely on enumeration
    expected = ["blue green red", "green red blue", "red blue green"]
    assert alphabetized(eager) == alphabetized(indexed) == expected
    for source in [[], [""], ["one"], ["a a", "a a"], ["가 나", "나 가"]]:
        assert alphabetized(MaterializedShifts(source)) == alphabetized(IndexedShifts(source))
    print("same sorted output; different internal enumeration")
    print("\n".join(expected))


if __name__ == "__main__":
    demo()
