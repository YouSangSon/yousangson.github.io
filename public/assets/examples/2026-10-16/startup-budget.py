"""Deterministic teaching model, not a MongoDB or Kubernetes benchmark."""


def startup(build_seconds, check_seconds, budget_seconds, prepared):
    required = check_seconds if prepared else build_seconds + check_seconds
    return required, required < budget_seconds


for prepared, build, expected in [(False, 360, False), (True, 360, True), (False, 20, True)]:
    seconds, ready = startup(build, 2, 60, prepared)
    assert ready == expected
    print(f"prepared={prepared} build={build}s startup={seconds}s budget=60s ready={ready}")
