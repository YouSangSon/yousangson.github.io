---
title: API 응답에서 Null 배열 문제 해결하기
description: MongoDB에서 조회한 배열 필드가 null로 반환되어 프론트엔드에서 런타임 에러가 발생하는 문제를 해결하고, API 응답 일관성을 보장하는 패턴
categories: [architecture, golang]
tags: [api, mongodb, null, array, frontend, consistency, golang]
date: 2025-01-08
mermaid: true
---

API 응답의 배열이 어떤 요청에서는 `[]`, 다른 요청에서는 `null`로 돌아왔다. 프론트엔드에서 `user.roles.map(...)`을 호출하면 두 번째 경우에 오류가 났다. 먼저 정할 것은 **이 API에서 값이 없다는 뜻을 어떻게 표현할 것인가**였다.

## null과 빈 배열의 의미를 먼저 정한다

항상 목록을 반환하는 필드라면 항목이 없어도 `[]`를 반환하는 계약이 편하다. 반대로 `null`이 “아직 계산하지 않음”이나 “값을 알 수 없음”을 뜻한다면 무조건 빈 배열로 바꿔서는 안 된다.

| 응답 | 계약에서 정할 의미 |
| --- | --- |
| `[]` | 목록은 유효하지만 항목이 없음 |
| `null` | 필드 계약에 따라 미설정·알 수 없음 등 |
| 필드 생략 | 해당 응답에 필드가 없는 상태 |

이 글의 사례는 역할과 파일 목록을 빈 배열로 반환하기로 한 API다. 권한 조회 실패를 빈 역할 목록으로 숨기는 처리는 포함하지 않는다.

## Go 1.24.5에서 직렬화 확인하기

Go의 `encoding/json`은 nil 슬라이스를 `null`로 인코딩한다. 길이가 0인 non-nil 슬라이스는 `[]`가 된다. 다음 예제는 **Go 1.24.5**에서 두 결과를 확인한다. [Go 1.24.5 JSON 인코더](https://github.com/golang/go/blob/go1.24.5/src/encoding/json/encode.go)

```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    type Response struct {
        Roles []string `json:"roles"`
    }
    for _, tc := range []struct {
        roles []string
        want  string
    }{
        {nil, `{"roles":null}`},
        {[]string{}, `{"roles":[]}`},
    } {
        got, err := json.Marshal(Response{Roles: tc.roles})
        if err != nil || string(got) != tc.want {
            panic("unexpected JSON result")
        }
        fmt.Println(string(got))
    }
}
```

`omitempty`를 붙이면 빈 슬라이스가 필드 생략으로 바뀔 수 있으므로 응답 계약과 함께 확인해야 한다. MongoDB의 `bson` 태그만으로 JSON 필드명이나 생략 규칙이 정해지는 것도 아니다.

## 응답을 만드는 경계에서 정규화한다

DB 조회가 성공한 뒤 응답 DTO를 만들 때 nil 목록을 빈 슬라이스로 초기화할 수 있다. 단일 항목 조회와 목록 조회가 같은 변환을 사용하면 경로별 차이를 줄일 수 있다.

목록 안의 각 객체뿐 아니라 **바깥 목록 자체**도 확인한다. 결과가 0건일 때 `var items []Item`을 그대로 반환하면 `null`이 될 수 있다. 중첩 객체는 nil 여부를 먼저 확인하고 그 안의 배열을 처리한다.

응답 형식을 맞추려는 목적이라면 기존 DB 문서를 모두 바꾸는 마이그레이션까지 바로 필요하지는 않다. 저장 데이터의 의미를 바꿔야 하는 작업과 응답 표현을 통일하는 작업은 구분한다.

## 프론트엔드에서 사라지는 검사와 남는 검사

배열을 보장하면 정상 응답마다 반복하던 null fallback은 줄일 수 있다. HTTP 실패, 잘못된 응답 스키마, 아직 로딩 중인 상태까지 검사가 불필요해지는 것은 아니다.

또한 올바른 형태의 응답이라도 이미 떠난 화면의 결과일 수 있다. [비동기 응답의 범위와 세대 번호](/posts/frontend-async-result-scope-and-generation/)에서는 늦게 도착한 응답을 현재 화면에 적용해도 되는지 검사한다. 응답 형태와 응답을 사용할 시점은 별개의 계약이다.

## 빈 결과를 테스트에 넣는다

단일 조회의 nil 필드, 0건인 목록, 중첩 객체가 없는 경우를 실제 JSON으로 직렬화해 확인한다. 내부 슬라이스 값만 검사하면 태그에 따라 필드가 생략되는 문제를 놓칠 수 있다. 최종 응답에서 약속한 `[]`가 나오는지가 확인 지점이다.
