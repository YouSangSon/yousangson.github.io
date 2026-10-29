"""A deterministic, two-process trace, not a distributed snapshot service.

The transfer and markers are delivered in a prescribed order. Reversing their
order is a negative control that violates the paper's FIFO-channel assumption.
"""

initial_a, initial_b, amount = 100, 50, 10
expected_total = initial_a + initial_b
after_send_a = initial_a - amount
after_receive_b = initial_b + amount

duplicate = initial_a + after_receive_b
missing = after_send_a + initial_b
assert duplicate == 160 and duplicate != expected_total
assert missing == 140 and missing != expected_total
print(f"mixed local snapshots: {duplicate}")
print(f"in-flight transfer omitted: {missing}")

# A sends the transfer before it receives B's marker. B records its state before
# receiving that transfer. A records its state and queues its marker after it.
for delivery_order in [("transfer", "marker"), ("marker", "transfer")]:
    recorded_a, recorded_b = after_send_a, initial_b
    live_b = initial_b
    recorded_channel = []
    for message in delivery_order:
        if message == "marker":
            break
        live_b += amount
        recorded_channel.append(amount)
    total = recorded_a + recorded_b + sum(recorded_channel)
    fifo = delivery_order == ("transfer", "marker")
    assert (total == expected_total) == fifo
    assert live_b == (after_receive_b if fifo else initial_b)
    assert recorded_channel == ([amount] if fifo else [])
    print(f"{'FIFO' if fifo else 'non-FIFO control'}: A={recorded_a}, B={recorded_b}, channel={sum(recorded_channel)}, total={total}")
