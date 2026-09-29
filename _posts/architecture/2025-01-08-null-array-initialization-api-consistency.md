---
title: API 응답에서 Null 배열 문제 해결하기
description: "Go의 nil 슬라이스가 JSON null이 되는 경계부터 GET 응답과 PATCH 입력의 생략·null·빈 배열을 서로 다른 계약으로 다룬다."
categories: [architecture, golang]
tags: [api, mongodb, null, array, frontend, consistency, golang]
date: 2025-01-08
mermaid: true
---

화면이 `user.roles.map(...)`을 호출했는데 어떤 응답에는 `"roles": []`, 다른 응답에는 `"roles": null`이 있다면 두 번째에서 오류가 난다. 화면마다 `roles ?? []`를 넣기 전에 정할 질문은 **목록이 비어 있는 것과 목록을 모르는 것이 같은 상태인가**다. 이 글은 항목이 없을 때도 유효한 빈 목록을 반환하기로 한 **가상 API**를 사용한다. 실제 권한 조회가 실패했는데 이를 빈 역할 목록으로 바꾸는 처리는 이 계약에 포함하지 않는다.

## 응답의 세 모양은 서로 다른 약속이다

`[]`는 목록을 알고 있고 항목이 없다는 뜻으로 쓸 수 있다. `null`은 미확인·미설정 같은 별도 상태에 쓸 수 있다. 필드 생략은 그 응답에서 속성을 제공하지 않는다는 뜻일 수 있다. 의미는 API가 정해야 하지만, 세 표현을 우연히 섞으면 클라이언트는 매번 추측해야 한다. [JSON Schema의 속성과 required 설명](https://json-schema.org/understanding-json-schema/reference/object#required-properties)

| JSON 응답 | `roles: string[]` 계약과의 관계 | 클라이언트가 알아야 할 것 |
| --- | --- | --- |
| `{"roles":[]}` | 유효한 빈 목록 | `map` 사용 가능 |
| `{"roles":null}` | 계약 위반 또는 명시적 미확인 상태 | 스키마에 null 의미가 있어야 함 |
| `{}` | 계약 위반 또는 선택 필드 | 필드 생략 조건이 있어야 함 |

이 글에서는 GET 응답의 `roles`를 **필수·null 불가 배열**로 정한다. `roles`를 가져오는 데 실패했다면 성공 응답의 빈 배열로 숨기지 않고 요청 실패를 처리한다. 그러면 `[]`는 “조회에 성공했고 역할이 없음”을 뜻한다. 권한 판단은 여전히 서버가 수행하며, 응답 배열 형식이 권한의 증거가 되는 것은 아니다.

## Go의 값과 JSON 바이트는 다르다

Go 1.24.5의 `encoding/json`은 nil 슬라이스를 `null`로, 길이 0인 non-nil 슬라이스를 `[]`로 인코딩한다. `omitempty`를 붙이면 둘 다 필드가 생략된다. Go 내부에서 둘 다 `len == 0`이어도 API의 바이트 계약은 세 갈래로 갈린다. [Go 1.24.5 `encoding/json` 소스](https://github.com/golang/go/blob/go1.24.5/src/encoding/json/encode.go)

```go
type Response struct {
    Roles []string `json:"roles"`
}
// Response{Roles: nil}        -> {"roles":null}
// Response{Roles: []string{}} -> {"roles":[]}
// `json:"roles,omitempty"`를 쓰면 빈 슬라이스에서 roles가 생략된다.
```

DB에서 필드가 없거나 nil로 읽혔다는 사실은 그대로 두고, **클라이언트에 보낼 응답 구조체(DTO)를 만드는 경계**에서 목록 계약을 적용할 수 있다. 단일 사용자 응답뿐 아니라 `items`가 0건인 바깥 목록, 각 항목의 중첩 목록도 그 경계에서 확인한다. 한 경로만 초기화하고 다른 목록 API를 방치하면 같은 스키마가 다시 갈라진다. 응답 모양을 고치기 위해 기존 저장 문서를 모두 마이그레이션해야 하는 것은 아니다. 저장값의 의미 자체를 바꾸는 요구가 있을 때만 별도 작업으로 검토한다.

권한과 무관한 `labels` 목록으로 같은 변환을 구현하면 아래처럼 된다. 조회 실패는 이 함수에 도달하기 전에 오류로 처리하고, 성공한 빈 결과만 정규화한다.

```go
type response struct {
    Labels []string `json:"labels"`
}

func labelsResponse(stored []string) response {
    if stored == nil {
        stored = []string{}
    }
    return response{Labels: stored}
}
```

이 함수는 저장소 값을 쓰지 않고 응답에 사용할 슬라이스만 선택한다. `omitempty`를 붙이지 않았으므로 빈 배열도 응답에 남는다.

[전체 Go 실행 예제](/assets/examples/2026-09-29/web-depth/json/main.go)를 저장해 `go run main.go`로 실행하면 실제 직렬화 결과와 아래의 PATCH 구분을 함께 확인할 수 있다.

```text
GET nil stored list: {"labels":[]}
GET empty outer list: {"items":[]}
pointer DTO distinguishes absent/null: false
direct []string decode [x,null]: ["x",""]
PATCH {}: {"labels":["old"]}
PATCH []: {"labels":[]}
PATCH null: rejected
PATCH [null] and [x,null]: rejected
PATCH [new]: {"labels":["new"]}
```

처음 두 줄이 확인하는 것은 DTO의 출력 바이트다. 내부 슬라이스만 검사하면 `omitempty` 때문에 필드 자체가 사라지는 문제를 놓칠 수 있다.

## PATCH에서는 생략과 빈 배열이 정반대다

GET에서 `[]`로 정규화했다고 PATCH 입력의 생략도 빈 배열로 읽어서는 안 된다. 여기서는 **생략 = 그대로 유지**, **`[]` = 목록 지우기**, **`null` = 잘못된 입력**이라는 사용자 정의 PATCH 문서를 선택한다.

| PATCH 본문 | 현재 `["old"]`에 적용한 결과 |
| --- | --- |
| `{}` | `["old"]` 유지 |
| `{"labels":[]}` | `[]`로 교체 |
| `{"labels":null}` | 거부 |
| `{"labels":[null]}` | 배열 원소가 문자열이 아니므로 거부 |
| `{"labels":["new"]}` | `["new"]`로 교체 |

단순한 `*[]string` 필드로 역직렬화하면 `{}`와 `{"labels":null}`가 모두 nil 포인터가 되어 둘을 구별하지 못한다. 한편 Go 1.24.5에서 `[null]`을 곧바로 `[]string`으로 읽으면 오류 대신 빈 문자열 원소가 된다. `["x",null]`도 두 번째 원소가 `""`가 된다. 이는 `labels?: string[]`의 원소 타입을 조용히 바꾸므로, 예제는 `map[string]json.RawMessage`에서 키의 **존재 여부**를 확인한 다음 `[]*string`으로 각 원소의 null을 구별한다. [Go 1.24.5 JSON 디코더](https://github.com/golang/go/blob/go1.24.5/src/encoding/json/decode.go)

```go
raw, present := fields["labels"]
if !present {
    return current, nil // 생략: 유지
}
if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
    return nil, fmt.Errorf("labels cannot be null")
}
var items []*string
if err := json.Unmarshal(raw, &items); err != nil {
    return nil, err
}
next := make([]string, len(items))
for i, item := range items {
    if item == nil {
        return nil, fmt.Errorf("labels[%d] cannot be null", i)
    }
    next[i] = *item
}
return next, nil // []면 명시적으로 지움
```

이 규칙은 **예제 API의 선택**이다. HTTP PATCH 자체가 null의 의미를 정하지 않는다. `application/merge-patch+json`을 채택했다면 RFC 7396에서 객체 속성의 `null`은 그 속성을 제거하라는 뜻이고, 배열은 부분 수정이 아니라 값 전체 교체다. 같은 `PATCH`라는 메서드라도 문서 형식의 의미를 혼동하면 삭제 요청을 거부하거나, 반대로 원치 않는 삭제를 수행할 수 있다. [HTTP PATCH RFC 5789](https://www.rfc-editor.org/info/rfc5789/), [JSON Merge Patch RFC 7396](https://www.rfc-editor.org/info/rfc7396/)

## 클라이언트 타입까지 같은 계약이어야 한다

GET 응답 스키마는 `roles`를 필수 배열로, 이 예제의 PATCH 스키마는 `labels`를 선택 배열로 적는다. 두 스키마 모두 `null`은 허용하지 않는다. JSON Schema에서 `required`는 **속성의 존재**를, `type: array`는 **존재하는 값의 타입**을 검사한다. `required`가 없다는 이유로 `null`까지 허용되는 것은 아니다. [JSON Schema object](https://json-schema.org/understanding-json-schema/reference/object), [JSON Schema type](https://json-schema.org/understanding-json-schema/reference/type)

클라이언트 타입으로는 GET의 `roles: string[]`와 PATCH의 `labels?: string[]`처럼 표현할 수 있다. 그러나 타입 표기만으로 네트워크 바이트가 검증되지는 않는다. 서버 직렬화 검사에는 **nil 필드, 빈 바깥 목록, 중첩 목록**을 넣고, 입력 검사에는 **생략, 최상위 null, 빈 배열, null 원소, 잘못된 타입**을 넣어야 한다. 올바른 형태의 응답이라도 이미 떠난 화면의 것일 수 있으므로, [비동기 결과의 소속과 세대](/posts/frontend-async-result-scope-and-generation/)는 별도로 확인한다.

다른 API에서 null이 “아직 계산하지 않음”이라는 실제 상태라면 `[]`로 바꾸지 말고 스키마에 그 상태를 표현해야 한다. **값의 의미가 DTO, JSON, PATCH, 클라이언트에서도 같은지** 확인하자. null이 실제 상태를 나타낸다면 그 의미도 그대로 전달돼야 한다.
