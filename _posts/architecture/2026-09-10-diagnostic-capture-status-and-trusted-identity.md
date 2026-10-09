---
title: "오류 로그의 빈칸에도 출처가 필요하다"
description: 요청 본문을 읽지 않은 경우와 빈 JSON을 읽은 경우를 재현하고, 경로의 ID가 언제 검증된 대상이 되는지 추적한다.
categories: [architecture, observability]
tags: [logging, observability, security, api]
date: 2026-09-10
updated: '2026-10-09'
related:
  - slug: restore-preflight-and-toctou-boundary
    reason: 사전검증 이후 경로와 내용이 바뀔 수 있는 경우를 확인합니다.
  - slug: moving-cleanup-execution-ownership
    reason: 실제 정리 실행과 삭제 판단을 어느 쪽이 소유하는지 비교합니다.
  - slug: gitlab-ci-kubernetes-networkpolicy-rbac-debugging
    reason: 빌드 이후 배포가 막힐 때 연결·권한·스토리지 경계를 구분합니다.
---

HTTP 진단 로그를 비교하려고 같은 `POST /notes/n42`에 `{}`를 보냈다. 첫 요청은 인증 전에 401로 끝나 본문을 읽지 않았고 둘째는 정상 처리됐다. 두 로그에 모두 `body: {}`라고 적으면 읽지 않은 상태와 빈 본문을 구분할 수 없으므로 기록한 값뿐 아니라 수집 여부와 출처도 남겨야 한다.

이를 확인하려고 Go 1.24.5의 `httptest`로 작은 **가상 메모 API 관측 모델**을 만들었다. 인증과 저장소는 실제 구현이 아니라 테스트 인자로 고정했다. 본문을 둘러싼 reader가 업무 코드가 읽은 바이트 수만 세고, 진단 기록에는 원문을 넣지 않는다. [실행 가능한 전체 예제](/assets/examples/2026-09-29/engineering-depth/diagnostic/diagnostic_test.go)를 내려받은 디렉터리에서 `GOTOOLCHAIN=go1.24.5 go test -v diagnostic_test.go`로 재현할 수 있다.

| 테스트 요청 | 결과 | 본문에서 읽은 바이트 | 진단상 본문 | 경로 ID / 확인된 대상 |
| --- | ---: | ---: | --- | --- |
| 인증 전 거절, `{}` 전송 | 401 | 0 | 읽지 않음 | `n42` / 없음 |
| 인증 후 `{}` 파싱 | 200 | 2 | 빈 JSON을 파싱함 | `n42` / `n42` |
| 인증 후 잘못된 `{` 파싱 | 400 | 1 | 파싱 실패 | `n42` / 없음 |
| 다른 사람의 `n43` 요청 | 403 | 2 | 빈 JSON을 파싱함 | `n43` / 없음 |
| `secret` 필드를 포함한 요청 | 200 | 24 | 파싱함, 값은 기록하지 않음 | `n42` / `n42` |

이 숫자는 네트워크에서 받은 바이트 수가 아니라 **이 모델의 handler가 읽은 수**다. `Content-Length: 2`를 봤더라도 인증 전에 끝난 요청이 본문을 읽었다고 말할 수 없다. Go의 `http.Request.Body`는 읽을 수 있는 스트림이다. 관측 코드가 업무 코드보다 먼저 스트림을 소비하면 실패 응답의 시점과 handler가 보는 입력까지 바뀔 수 있다. [Go `http.Request` 문서](https://pkg.go.dev/net/http#Request)

읽은 바이트 수를 세는 부분은 다음과 같다. `Read`를 미리 호출하지 않고, handler가 요청할 때 원래 reader로 전달한다. 반환된 `n`만 더하므로 일부 바이트와 오류가 함께 돌아와도 읽은 양을 잃지 않는다.

```go
type countedBody struct {
    io.ReadCloser
    read int
}

func (b *countedBody) Read(p []byte) (int, error) {
    n, err := b.ReadCloser.Read(p)
    b.read += n
    return n, err
}
```

이 reader는 요청마다 따로 만들며, 예제에서는 handler 하나가 순차적으로 읽는다. 원문을 복사해 보관하는 버퍼는 없다.

## 본문은 어느 단계까지 갔는가

위 표의 첫 세 행은 서로 다른 사건이다. 인증 전 거절에서는 본문이 **미관측**이다. `{}`를 파싱한 요청에서는 서버가 실제 빈 객체를 확인했다. 잘못된 `{`에서는 1바이트를 읽었지만 완성된 JSON 값은 없다. 오류가 난 decoder의 부분 상태를 정상 입력처럼 기록하면 안 된다. Go의 `json.Decoder.Decode`가 반환한 오류를 값의 성공적인 해석과 구분해야 한다. [Go `encoding/json` 문서](https://pkg.go.dev/encoding/json#Decoder)

본문을 무조건 먼저 읽는 대안은 조사에 편해 보인다. 하지만 인증에서 거절할 요청도 느린 클라이언트의 업로드를 기다리게 되고, 파일·토큰·개인정보를 진단 저장소로 끌어들인다. 실제 서비스에서는 인증 뒤 허용된 메서드와 content type에만 본문 파서를 연결하고, `http.MaxBytesReader` 같은 크기 상한을 업무 읽기와 관측 읽기에 함께 적용해야 한다. `Content-Length`가 없거나 거짓일 수 있으므로 선언된 길이만 검사해서는 상한이 되지 않는다. 느린 입력에는 서버의 읽기 시간 제한도 필요하다. 상한을 넘긴 요청은 '일부만 파싱 성공'이 아니라 크기 초과라는 상태로 남긴다. [Go `MaxBytesReader`](https://pkg.go.dev/net/http#MaxBytesReader), [Go 서버 제한](https://pkg.go.dev/net/http#Server)

오류를 만났을 때 원문 본문으로 되돌아가 로그에 붙이는 fallback도 위험하다. 잘못된 JSON에는 `secret` 같은 필드의 경계조차 확정되지 않는다. 그러므로 진단에는 읽음 여부, 파싱 상태, 크기 구간, 허용된 식별자 같은 **미리 정한 필드만** 남기고 원문은 버린다. 이 예제는 작은 문자열만 사용해 관측 위치를 보여 준다. 크기·시간 제한을 구현해 검증한 샘플은 아니다.

## 경로의 `n43`은 왜 확인된 대상이 아닌가

`/notes/n43`에서 얻은 값은 클라이언트가 지정한 **후보 ID**다. 모델은 메모를 조회한 뒤 소유자를 비교한다. 다른 사람의 항목이면 403을 반환하고 `resolved`를 비워 둔다. 같은 ID가 URL에 적혀 있었다는 사실만으로 그 항목을 처리했다고 기록하지 않는다.

인증과 JSON 파싱을 통과한 뒤의 핵심 분기는 아래와 같다. `out.supplied`에는 URL에서 얻은 후보가 있지만, `out.resolved`의 초기값은 빈 문자열이다.

```go
owner, exists := map[string]string{
    "n42": "reader", "n43": "other",
}[out.supplied]
if !exists {
    out.status = 404
    return
}
if owner != verifiedPrincipal {
    out.status = 403
    return
}
out.resolved, out.status = out.supplied, 200
```

따라서 다른 사람의 메모를 요청한 경우에는 다음 기록이 남는다.

```text
요청 파싱: supplied=n43
조회·인가: 소유자 불일치
진단 기록: supplied=n43, resolved=없음, status=403
```

이 예제는 차이를 드러내려고 403을 썼다. 실제 API는 존재 여부 노출을 피하려고 404로 응답할 수도 있다. 응답 코드가 어느 쪽이든 **검증된 객체 ID를 채우는 시점**은 조회와 인가가 끝난 뒤여야 한다. 한 추적 번호에 두 종류의 ID를 함께 적더라도 신뢰 수준은 같지 않다.

## 값은 어디서 버리는가

마지막 테스트는 본문에 설명용 `secret` 값을 넣는다. decoder는 값을 처리하지만 관측 결과 구조체에는 파싱 여부와 읽은 양만 담는다. 테스트는 진단 문자열에 그 값이 없는지 검사했다. 이것은 **허용한 정보만 남기는 방식**의 작은 증거이지, 모든 로그 경로가 안전하다는 증거는 아니다. 다른 middleware, 오류 출력, 오래된 저장 기록을 관리자 화면에서 읽는 경계는 별도로 봐야 한다.

OWASP는 접근 토큰·비밀번호·민감한 개인정보를 로그에 직접 남기지 말라고 안내한다. 로그 입력의 줄바꿈 등도 정제 대상이다. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude)

이 모델을 실제 서버에 적용할 때는 인증·서비스 간 추적 전파·로그 저장 경로에서도 같은 구분이 유지되는지 확인해야 한다. 동일한 `{}`를 인증 전후에 보내 보자. 진단 화면이 둘을 같은 빈 값으로 표시한다면, 값보다 **어느 단계에서 관측했는지**가 빠져 있다.
