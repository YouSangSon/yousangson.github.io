---
title: "통합 검색에서 정규식보다 먼저 정해야 할 것"
description: 여러 자료를 한 번에 찾는 검색에서 입력의 의미, 사용자별 조회 범위, 병렬 요청의 비용을 구분하는 작은 예제.
categories: [architecture, golang]
tags: [search, security, mongodb, regex, golang]
date: 2024-11-25
---

검색창에 `a.b`를 입력했을 때 점은 글자일까, 정규식의 임의 문자일까? 사용자는 보통 제목에 적힌 점을 찾으려 한다. 서버가 이 문자열을 그대로 정규식으로 넘기면 `axb`도 검색된다. 여러 자료를 묶어 찾는 화면에서는 이 작은 의미 차이가 권한과 비용 문제로 이어진다.

여기서는 가상의 개인 메모 검색을 예로 든다. 실제 서비스의 자료 종류, 권한 규칙, 저장 구조, 성능 수치는 사용하지 않는다.

## 입력을 검색 언어로 취급하지 않는다

Go 1.24.5 기준으로, 사용자가 **문자 그대로 포함된 제목**을 찾는다는 계약이라면 `regexp.QuoteMeta`로 정규식 메타 문자를 이스케이프할 수 있다. 다음 예제는 데이터베이스를 대신해 메모 세 개를 메모리에서 검사한다.

```go
package main

import (
    "fmt"
    "regexp"
    "strings"
)

type Note struct{ Owner, Title string }

func search(notes []Note, verifiedUser, input string) ([]string, error) {
    query := strings.TrimSpace(input)
    if query == "" || len(query) > 64 { // 예시 정책: UTF-8 바이트 기준 1~64
        return nil, fmt.Errorf("invalid query length")
    }
    pattern, err := regexp.Compile("(?i)" + regexp.QuoteMeta(query))
    if err != nil {
        return nil, err
    }
    var titles []string
    for _, note := range notes {
        if note.Owner == verifiedUser && pattern.MatchString(note.Title) {
            titles = append(titles, note.Title)
        }
    }
    return titles, nil
}

func main() {
    notes := []Note{{"mina", "a.b 기록"}, {"mina", "axb 기록"}, {"jun", "a.b 비공개"}}
    got, err := search(notes, "mina", "a.b")
    fmt.Println(got, err)
    // [a.b 기록] <nil>
}
```

이 코드에서 중요한 순서는 소유자를 확인한 뒤 제목을 검사하는 부분이다. 입력을 안전한 정규식으로 바꿔도 다른 사람의 자료까지 조회하면 권한 문제는 그대로다. 실제 데이터베이스에서는 사용자 범위를 **서버가 확인한 신원으로 만든 조회 조건**에 넣어야 한다. 클라이언트가 보낸 `owner` 값을 그대로 믿거나, 모든 행을 가져와 화면에서만 거르는 방식으로 바꾸면 안 된다.

길이 상한도 정규식 이스케이프와 역할이 다르다. 이스케이프는 입력의 *의미*를 고정하고, 상한은 한 요청에 허용할 *비용*을 제한한다. 예제의 64바이트는 설명을 위해 고른 값이다. 서비스의 허용 길이와 검색 방식은 실제 사용량과 UX를 보고 정해야 한다.

## 데이터베이스를 쓰면 실행 계획까지 확인한다

위 예제의 `(?i)`는 대소문자 구분 없이 찾기 위한 Go 정규식 옵션이다. MongoDB의 `$regex`로 옮길 때도 `regexp.QuoteMeta` 같은 리터럴 처리와 권한 조건은 각각 필요하다. 하지만 그것만으로 검색이 빠르다는 뜻은 아니다. MongoDB 문서는 **대소문자 구분 정규식의 단순한 접두 검색**에서 인덱스 이점을 설명하는 반면, 대소문자를 구분하지 않는 `$regex`는 대소문자 무시 인덱스를 활용하지 못한다고 명시한다. 부분 문자열 검색과 접두 검색도 같은 비용으로 묶어 설명할 수 없다. [MongoDB `$regex` 문서](https://www.mongodb.com/docs/manual/reference/operator/query/regex/), [Go `regexp.QuoteMeta`](https://pkg.go.dev/regexp#QuoteMeta)

자료 종류가 늘면 각 조회를 병렬로 실행하고 싶어진다. 다만 모든 검색을 한꺼번에 시작하면 사용자 요청 한 건이 저장소 연결과 CPU를 동시에 점유한다. 자료별 결과 수, 전체 시간 제한, 동시 실행 수를 먼저 정하고, 일부 조회 실패를 사용자에게 어떻게 알릴지도 결정해야 한다. 빈 결과와 실패를 같은 빈 배열로 돌려주면 검색 대상이 없었던 것처럼 보인다. Go의 `context`는 취소와 마감 시간을 하위 작업에 전달하지만, 취소 호출 자체가 작업 종료를 기다려 주지는 않는다. [Go `context` 문서](https://pkg.go.dev/context)

검색 캐시도 같은 권한 경계를 따른다. 사용자별 결과를 캐시한다면 키와 무효화 조건이 그 사용자 범위를 보존해야 한다. 안전한 리터럴 검색이라도 남의 결과를 재사용하면 입력 검증은 도움이 되지 않는다.

## 확인할 수 있는 것과 없는 것

위 메모리 예제는 `a.b`가 문자 그대로 매칭되고 다른 소유자의 메모는 반환되지 않는다는 사실만 보여 준다. 데이터베이스의 인덱스 사용, 병렬 조회의 지연, 캐시 무효화, 권한 변경 직후의 결과는 검증하지 않는다.

자기 검색 API를 점검한다면 같은 제목을 두 사용자에게 만들어 보자. `a.b`를 입력했을 때 `axb`가 섞이지 않는지, 다른 사용자의 같은 제목이 나오지 않는지 따로 확인한다. 마지막으로 실제 조회 계획과 권한 변경 뒤 캐시 결과를 보면 입력·권한·비용의 세 경계를 각각 검증할 수 있다.
