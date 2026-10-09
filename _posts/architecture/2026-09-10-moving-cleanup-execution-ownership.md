---
title: "함수를 옮겼는데 삭제 판단은 어디에 남았을까"
description: 두 Go 패키지로 정리 책임을 옮긴 예제에서 정확한 잔여 ID와 호환 진입점의 호출 방향을 각각 검증한다.
categories: [architecture, refactoring]
tags: [go, modularity, refactoring, testing, cleanup]
date: 2026-09-10
---

정리 함수를 다른 패키지로 옮긴 뒤 테스트는 초안 한 건이 삭제됐다고 보고했다. 예전 패키지가 여전히 삭제 여부를 판단해도 같은 테스트는 통과한다. 함수 이동을 검증하려면 파일의 위치뿐 아니라 **보호 조건을 판단하고 변경을 실행하는 위치**까지 따라가야 한다.

Go 1.24.5로 실행한 가상 메모리 저장소는 두 패키지로 나뉜다. `oldapi`는 호출자를 위한 옛 진입점을, `draft`는 보호 조건과 실제 변경을 맡는다. 재현하려면 [go.mod](/assets/examples/2026-09-29/engineering-depth/cleanup/go.mod), [`draft/store.go`](/assets/examples/2026-09-29/engineering-depth/cleanup/draft/store.go), [`oldapi/cleanup.go`](/assets/examples/2026-09-29/engineering-depth/cleanup/oldapi/cleanup.go), [`oldapi/cleanup_test.go`](/assets/examples/2026-09-29/engineering-depth/cleanup/oldapi/cleanup_test.go)를 같은 상대 경로에 놓고 `go.mod`가 있는 디렉터리에서 `GOTOOLCHAIN=go1.24.5 go test -v ./...`를 실행한다.

```text
호출자 → oldapi.Remove(store, id) → draft.Store.Remove(id)
                 호환 호출만         보호 조건 확인 + 삭제
```

`draft.Store.Remove`는 초안이 없거나 활성 상태면 `false`를 돌려준다. 그 외에는 map에서 해당 ID를 지운다. `oldapi.Remove`의 본문은 `return store.Remove(id)` 한 줄이다. `draft`가 `oldapi`를 다시 import하면 Go 패키지 순환 의존이 되어 컴파일되지 않는다. 이 예제에서 코드가 놓인 파일보다 중요한 것은 후보 판단과 변경을 `draft`가 함께 소유한다는 점이다.

핵심 구현은 두 함수다. `drafts`는 존재하는 초안, `active`는 현재 사용 중인 초안을 나타내는 map이다.

```go
// draft/store.go
func (s *Store) Remove(id string) bool {
    if !s.drafts[id] || s.active[id] {
        return false
    }
    delete(s.drafts, id)
    return true
}

// oldapi/cleanup.go
func Remove(store *draft.Store, id string) bool {
    return store.Remove(id)
}
```

직접 호출과 호환 호출이 같은 함수에 도착하므로, 보호 조건을 고칠 곳도 하나다. 다음에는 이 구조가 실제로 같은 초안을 보존하는지 확인한다.

## '한 건 삭제'만으로는 부족하다

입력은 `old`, `live`, `keep` 세 ID다. `live`만 활성 상태로 표시하고 `old`를 삭제한 뒤 `live` 삭제를 시도한다.

| 호출 | 기대 결과 | 남아야 할 정확한 ID |
| --- | --- | --- |
| `Remove("old")` | 삭제 성공 | `keep`, `live` |
| `Remove("live")` | 삭제 거절 | `keep`, `live` |

두 번째 호출 뒤에도 삭제 횟수는 한 건이다. `live`를 잘못 지우고 `old`를 남겨도 같은 숫자가 나온다. 그래서 [두 경로의 테스트](/assets/examples/2026-09-29/engineering-depth/cleanup/oldapi/cleanup_test.go)는 반환값과 정렬한 **잔여 ID 전체**를 비교한다. 예전 진입점 `oldapi.Remove`를 부르는 경우와 새 `draft.Store.Remove`를 직접 부르는 경우를 각각 실행한다. 로컬 `go test ./...`에서 둘 다 통과했다.

## 같은 결과를 내는 잘못된 소유권

보호 조건을 예전 함수에만 남기고 새 패키지의 삭제를 단순화하면 어떻게 될까. 실제 예제 파일을 바꾸지 않고 임시 복사본에서 다음처럼 바꿔 시험했다.

```go
// oldapi.Remove: 이 경로만 활성 초안을 보호
if store.IsActive(id) { return false }
return store.Remove(id)

// draft.Store.Remove: 직접 호출하면 활성 상태를 확인하지 않고 삭제
delete(s.drafts, id)
```

예전 경로의 테스트는 여전히 통과했다. `oldapi`가 `live`를 가로막기 때문이다. 새 경로의 테스트는 `live` 삭제를 허용해 실패했다. 같은 저장소를 다루는 두 진입점이 서로 다른 보호 계약을 갖게 된 것이다. 보호 판단을 실제 변경을 소유한 `draft.Store.Remove`에 두면 어느 경로로 들어와도 같은 결정을 내린다.

이 예제에서는 두 호출 경로의 같은 입력을 비교하는 테스트가 소유권의 실질적인 결과를 잡는다. 패키지 방향은 컴파일과 `go list`로 확인할 수 있다. `oldapi`가 `draft`를 import하는데 `draft`가 다시 `oldapi`를 import하면 Go는 순환 의존을 거부한다. 하지만 import 방향만 맞아도 보호 판단이 옛 패키지에 남을 수 있으므로 두 경로의 동작 검사가 필요하다. [Go `go list`](https://pkg.go.dev/cmd/go#hdr-List_packages_or_modules)

## 실제 저장소로 옮길 때 달라지는 것

메모리 map은 테스트 한 흐름에서만 접근했다. 파일이나 데이터베이스의 삭제라면 '활성인지 확인'과 '삭제' 사이에 다른 writer가 상태를 바꿀 수 있다. 이때는 저장소의 원자적 조건부 변경, 버전 조건, 또는 writer와 합의한 잠금 같은 별도 경계가 필요하다. 단일 패키지로 모았다는 사실은 그 경쟁을 막지 않는다.

다음 코드 이동에서 옛 진입점과 새 직접 진입점을 같은 데이터로 실행해 보자. 동작 검사에는 **삭제된 ID와 보존된 ID**를 모두 넣고, 패키지 의존 방향도 확인한다. 옛 경로만 통과한다면 새 소유 모듈이 아직 보호 판단을 갖지 못했을 수 있다.
