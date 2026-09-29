"""Application cursor model; not a Kafka, Redis, or SSE implementation."""
events = [(1, "A"), (2, "B"), (3, "C")]


def apply(state, event):
    sequence, text = event
    if sequence <= state["last"]:
        return "duplicate"
    if sequence != state["last"] + 1:
        return "gap"
    state["text"] += text
    state["last"] = sequence
    return "applied"


client = {"last": 0, "text": ""}
assert apply(client, events[0]) == "applied"
# Connection disappears before event 2; event 3 arrives after reconnect.
assert apply(client, events[2]) == "gap"
assert client == {"last": 1, "text": "A"}
for event in events[client["last"]:]:
    assert apply(client, event) == "applied"
assert apply(client, events[2]) == "duplicate"
assert client == {"last": 3, "text": "ABC"}
print("gap detected, replay applied, duplicate ignored:", client)

# If the cursor is older than retained history, do not silently return a suffix.
oldest_retained = 3
requested_next = 2
assert requested_next < oldest_retained
print("cursor predates retention: full snapshot or explicit reset required")
