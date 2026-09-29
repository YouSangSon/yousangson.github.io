---
title: "함수를 옮겼는데 삭제 판단은 어디에 남았을까"
description: 정리 함수의 위치와 실행 책임을 구분하고, 메모리 예제로 동작 검사와 의존 방향 검사를 나눠 본다.
categories: [architecture, refactoring]
tags: [go, modularity, refactoring, testing, cleanup]
date: 2026-09-10
---

오래된 초안을 지우는 함수를 `draft` 패키지로 옮겼다고 하자. 호출자는 여전히 예전 함수를 부르고, 그 함수가 '이 초안을 지워도 되는가'를 판단한다면 정리 책임은 옮겨지지 않았다. 다음 호출자가 새 패키지를 직접 사용하면 서로 다른 삭제 기준이 생길 수도 있다.

아래 초안 저장소는 이 차이를 설명하려고 만든 **메모리 예제**다. 파일 저장소나 특정 서비스의 정리 흐름을 재구성한 코드가 아니다.

## 판단과 실행을 같은 경계에 둔다

초안 `d1`은 보관 중이고 `d2`는 게시 중이라고 가정하자. 둘 다 목록에 보이지만 게시 중인 항목은 정리 대상이 아니다. 예제에서는 새 소유 모듈의 `Remove`가 후보 확인과 삭제를 모두 맡는다.

```go
package main

import "fmt"

type DraftStore struct {
    drafts map[string]bool
    live   map[string]bool
}

func (s *DraftStore) Remove(id string) bool {
    if s.live[id] || !s.drafts[id] {
        return false
    }
    delete(s.drafts, id)
    return true
}

// 예전 진입점은 호출 형태만 보존한다.
func legacyRemove(s *DraftStore, id string) bool { return s.Remove(id) }

func main() {
    s := &DraftStore{
        drafts: map[string]bool{"d1": true, "d2": true},
        live:   map[string]bool{"d2": true},
    }
    fmt.Println(legacyRemove(s, "d1"), legacyRemove(s, "d2"), s.drafts["d2"])
    // true false true
}
```

한 파일에 적었지만 실제 패키지에서는 `legacy`가 `draft`를 호출하고, `draft`는 `legacy`를 import하지 않는 방향을 생각하면 된다. 예전 진입점이 후보를 조회하거나 `live` 조건을 다시 구현하기 시작하면 결정이 둘로 갈라진다. 호환 함수는 짧아도 그 경계는 중요하다.

## 결과가 같아도 위치는 다를 수 있다

예제에서 `d1`이 삭제되고 `d2`가 남는지 확인하는 검사는 **동작**을 묻는다. 같은 결과를 예전 패키지에서 직접 계산해도 동작 검사는 통과할 수 있다. 새 패키지가 예전 패키지를 역으로 import하지 않는지, 예전 진입점에 다시 삭제 판단이 생기지 않았는지는 별도의 **구조** 질문이다. Go에서는 패키지의 import 관계를 확인할 수 있지만, 함수 내부의 모든 의미를 자동으로 증명하지는 못한다. [Go `go list` 문서](https://pkg.go.dev/cmd/go#hdr-List_packages_or_modules), [Go `testing` 문서](https://pkg.go.dev/testing)

삭제 기능에서는 반환된 개수만 확인해서도 부족하다. 두 항목 중 하나를 잘못 지우고 하나를 잘못 남겨도 '한 건 삭제'라는 숫자는 같다. 살아 있는 `d2`가 남는지처럼 **정확한 대상**을 검사해야 한다.

## 메모리 예제 밖의 경계

이 예제의 map 접근은 단일 흐름을 가정한다. 실제 저장소에서 검사와 삭제 사이에 다른 writer가 같은 항목의 상태를 바꾸면 사전 검사만으로 안전을 보장할 수 없다. 원자적 조건부 변경, 버전 검사, writer 정지처럼 그 저장소에 맞는 실행 경계가 별도로 필요하다. 코드를 새 패키지로 옮겼다는 사실은 이 경쟁을 해결하지 않는다.

자신의 리팩터링을 점검할 때는 예전 공개 함수 하나에서 시작해 후보 선정, 보호 조건 확인, 실제 변경 호출을 따라가 보자. 새 소유 모듈이 세 결정을 맡는지 확인하고, 동작 검사에서는 삭제한 ID와 남긴 ID를 모두 비교한다. 이 두 검사는 '같이 움직이는가'와 '누가 결정하는가'에 각각 답한다.
