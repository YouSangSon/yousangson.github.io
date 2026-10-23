---
title: "S3 목록에서 3개를 반환하려고 두 번 조회하는 이유"
description: "minio-go v7.0.97과 Go 1.24.5로 SDK 자동 페이지 넘김을 재현한다. N+1 조회가 HTTP 요청을 줄이는 조건과 다음 페이지 커서·취소·1,000개 상한을 함께 살펴본다."
categories: [architecture, optimization]
tags: [go, s3, minio, pagination, cancellation]
date: 2026-10-23
related:
  - slug: upload-memory-admission-before-body
    reason: 애플리케이션의 스트리밍 코드와 SDK 내부의 버퍼 할당을 구분하는 사례를 비교합니다.
  - slug: parser-cancellation-resource-ownership
    reason: 취소 신호를 보낸 시점과 실제 작업자가 종료한 시점을 나누어 봅니다.
---

객체 목록에서 3개를 반환하고 다음 페이지가 있는지도 알려 주려고 한다. 서버 조회 크기를 3으로 맞췄는데 SDK가 HTTP 요청을 한 번 더 보낼 수 있다. 응답에 담을 3개와 다음 항목의 존재를 확인하는 1개가 필요하므로 조회 크기는 조건에 따라 4가 더 알맞다.

이 차이를 Go 1.24.5와 minio-go v7.0.97로 확인해 보자. 공개 SDK와 로컬 모의 HTTP 서버로 새로 만든 교육용 예제다. 실제 S3 계정이나 MinIO 서버, 인증 정보는 사용하지 않는다.

## 화면의 페이지와 서버의 페이지는 다르다

가상의 버킷에 `object-0001`부터 `object-0004`까지 객체가 네 개 있다고 하자. 애플리케이션이 반환할 페이지 크기 N은 3이다. 첫 페이지의 기대 결과는 다음과 같다.

```text
objects = [object-0001, object-0002, object-0003]
hasMore = true
marker  = object-0003
```

`hasMore`는 반환하지 않은 다음 항목이 있다는 뜻이다. `marker`는 이 예제에서 다음 애플리케이션 요청의 시작 위치로 쓸 마지막 반환 키다. 뒤에서 사용할 S3의 continuation token과는 다른 값이다.

세 개만 읽어서는 뒤에 네 번째가 있는지 알 수 없다. 세 개를 반환하되 하나를 더 읽어 다음 항목의 존재만 확인한다. 이처럼 미리 한 항목을 읽는 방식을 lookahead라고 부른다. 네 번째는 결과에 넣지 않고 `hasMore`만 `true`로 바꾼다.

이제 SDK에 `MaxKeys: 3`을 주면 어떤 일이 일어날까. minio-go의 `ListObjects`는 한 서버 응답만 돌려주는 함수가 아니다. 응답이 잘렸으면 서버가 준 `NextContinuationToken`으로 다음 응답을 읽어 같은 채널에 계속 객체를 보낸다. 애플리케이션은 연속된 네 항목을 읽지만 그 아래에서는 두 번 조회할 수 있다. [minio-go v7.0.97 목록 구현](https://github.com/minio/minio-go/blob/v7.0.97/api-list.go#L120-L198)

모의 서버가 요청 상한까지 객체를 채워 주는 이 예제에서는 두 설정의 진행이 다음처럼 나뉜다.

| 서버 요청의 MaxKeys | 첫 서버 응답 | 다음 항목 확인 | 애플리케이션 반환 |
| --- | --- | --- | --- |
| 3 | 객체 1·2·3, 뒤에 더 있음 | 두 번째 요청에서 객체 4를 읽음 | 객체 1·2·3, hasMore=true |
| 4 | 객체 1·2·3·4, 여기서 끝 | 첫 응답의 객체 4를 읽음 | 객체 1·2·3, hasMore=true |

두 번째 행은 클라이언트의 페이지 크기를 4로 바꾸지 않는다. **서버에서 읽을 양과 클라이언트에 반환할 양을 따로 정한다.** 다만 `MaxKeys`는 상한이다. 실제 서버가 더 적게 반환하면 N+1을 지정해도 추가 요청이 필요할 수 있다. [AWS ListObjectsV2 계약](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html#API_ListObjectsV2_RequestSyntax)

## 한 항목을 더 읽어도 커서는 세 번째에 둔다

예제의 조회 크기 선택은 다음 정도면 충분하다. 여기서 `n`은 1부터 1,000까지 검증한 애플리케이션 페이지 크기다.

```go
maxKeys := n
if n < 1000 {
    maxKeys = n + 1
}
```

반환 루프에서는 더 읽은 객체를 결과에 넣기 전에 멈춘다. 다음은 오류 처리와 채널 정리 부분을 제외한 핵심 구간이다. 실행 파일에는 두 처리가 모두 들어 있다.

```go
if len(result.Items) == n {
    result.HasMore = true
    break
}
result.Items = append(result.Items, item{
    Key: object.Key, Size: object.Size, ETag: object.ETag,
})
result.Marker = object.Key
```

네 번째 객체가 왔을 때는 `Items`의 길이가 이미 3이다. 그러므로 네 번째 키가 `Marker`에 들어가지 않는다. 다음 요청에 `StartAfter: "object-0003"`을 사용하면 `object-0004`부터 다시 읽는다. 미리 봤던 항목이 다음 페이지의 첫 항목으로 돌아온다.

반대로 marker를 네 번째 키로 갱신하면 그 뒤부터 시작해 객체 하나를 건너뛴다. 조회 크기를 바꿀 때 요청 수만 검사하면 이 오류를 놓칠 수 있다. 이 예제는 두 설정의 객체 키·크기·ETag, `hasMore`, marker를 비교하고 그 marker로 실제 다음 페이지도 읽는다.

여기에는 두 종류의 이어 읽기가 있다. SDK 내부에서는 서버의 불투명한 `NextContinuationToken`을 다음 HTTP 요청의 `continuation-token`으로 보낸다. 애플리케이션 페이지 사이에서는 마지막 반환 키를 `StartAfter`로 보낸다. AWS는 continuation token이 실제 객체 키가 아니라고 명시한다. 둘을 서로 변환하거나 같은 커서로 취급하면 안 된다. [AWS 이어 읽기 매개변수](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html#API_ListObjectsV2_RequestParameters)

이 예제는 키 순서가 고정된 재귀 목록에 마지막 키 커서를 사용하는 계약을 새로 정했다. 기존 API가 다른 커서를 사용한다면 그대로 적용할 수 없다. 여러 요청에 걸친 삽입·삭제까지 하나의 스냅샷으로 고정하는 기능도 포함하지 않는다.

## 실제 SDK가 보낸 HTTP 요청 세기

[테스트 소스](/assets/examples/2026-10-23/s3-lookahead/lookahead_test.go), [go.mod](/assets/examples/2026-10-23/s3-lookahead/go.mod), [go.sum](/assets/examples/2026-10-23/s3-lookahead/go.sum)을 같은 빈 디렉터리에 저장한 뒤 실행한다. 처음 실행할 때 모듈 캐시가 비어 있으면 공개 Go 모듈을 다운로드하므로 인터넷 연결이 필요하다.

```sh
go version
go test -v ./...
```

모의 서버는 `ListObjectsV2` XML을 만들고 요청의 `max-keys`, `start-after`, `continuation-token`을 기록한다. 네트워크 요청과 응답 파싱, 자동 페이지 넘김에는 실제 minio-go를 사용한다. 서버의 전체 객체 수를 바꾸며 얻은 출력 중 결과 부분은 다음과 같다.

```text
go version go1.24.5 darwin/arm64
total=4 N=3 HTTP=2->1 returned=3 hasMore=true marker="object-0003"
next page: returned=object-0004 hasMore=false trace=[max=4 token="" after="object-0003"]
total=3 N=3 HTTP=1->1 returned=3 hasMore=false marker="object-0003"
total=2 N=3 HTTP=1->1 returned=2 hasMore=false marker="object-0002"
total=0 N=3 HTTP=1->1 returned=0 hasMore=false marker=""
total=1000 N=999 HTTP=2->1 returned=999 hasMore=true marker="object-0999"
total=1001 N=1000 HTTP=2->2 returned=1000 hasMore=true marker="object-1000"
```

`HTTP=2->1`은 `MaxKeys=N`과 위의 N+1 설정을 각각 실행했을 때 모의 서버가 받은 요청 수다. 전체 객체가 네 개인 경우에만 다음 페이지 검사를 추가로 실행했고 그 요청은 앞의 첫 페이지 횟수에 포함하지 않았다.

객체가 정확히 세 개이면 `hasMore=false`다. 첫 응답에서 목록이 끝나므로 더 받을 객체가 없다는 사실을 SDK 채널의 종료로 알 수 있다. 이때 조회 크기를 하나 늘려도 요청 수는 이미 한 번이라 줄지 않는다. 빈 목록과 N보다 짧은 마지막 페이지도 같다.

N이 999이고 객체가 1,000개인 행에서는 마지막 확인용 객체까지 한 응답에 들어간다. N이 1,000이면 사정이 다르다. S3의 응답 상한이 1,000개이므로 1,001개를 한 번에 받는 최적화를 할 수 없다. 이 예제는 그 경계에서 `MaxKeys=1000`을 유지하며 확인용 1개를 읽기 위해 두 번째 요청을 사용한다. [AWS 응답 크기와 종료 표시](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html#API_ListObjectsV2_ResponseElements)

## 취소를 빨리 보내면 항상 한 번으로 끝날까

위의 2회 대 1회 비교에는 의도적으로 **전체 객체가 N+1개이고 마지막 서버 응답이 끝을 알리는 조건**을 사용했다. 객체가 훨씬 많을 때도 항상 한 번만 요청한다고 보장하려는 실험이 아니다.

v7.0.97의 `ListObjects`는 별도 goroutine에서 객체를 읽으며 용량이 1인 채널로 보낸다. 애플리케이션이 N+1번째 객체를 받은 직후에도 생산자가 다음 서버 페이지 요청을 먼저 시작할 수 있다. 소비자가 `break`와 `cancel`을 호출하는 순서만으로 이미 시작한 요청을 없앨 수는 없다. [minio-go 채널 생산자](https://github.com/minio/minio-go/blob/v7.0.97/api-list.go#L748-L796)

이 변경은 확인용 객체가 다음 서버 페이지에 걸리지 않게 만드는 효과가 있다. 임의의 버킷에서 요청 수를 항상 2에서 1로 줄이는 보장은 아니다. 엄격하게 서버 요청을 한 페이지씩 제어해야 한다면 자동 페이지 넘김 인터페이스 자체가 그 계약에 맞는지 먼저 확인해야 한다.

채널을 중간에 그만 읽을 때는 종료 처리도 남는다. 이 SDK 버전의 안내에 맞춰 예제는 자식 context를 취소한 다음 채널이 닫힐 때까지 비운다.

```go
cancel()
for range objects {}
if err := ctx.Err(); err != nil {
    return page{}, err
}
```

`ctx`는 호출자가 준 context이고 `cancel`은 이 목록 읽기에 만든 자식 context를 취소한다. N+1번째 객체를 찾은 뒤의 자체 종료와 호출자의 취소를 구분하기 위해 부모의 `ctx.Err()`를 확인한다. 서버 응답을 기다리는 동안 호출자가 취소한 테스트에서는 빈 결과와 `context.Canceled`를 반환했다. 성공한 일부 페이지로 포장하지 않았다. 목록 읽기 오류도 별도로 보존한다.

## 폴더 표시나 필터가 있으면 무엇을 세는가

지금까지는 `Recursive: true`로 delimiter 없이 읽은 객체 수를 셌다. delimiter를 쓰는 목록에서는 폴더처럼 보이는 `CommonPrefixes` 한 묶음도 `MaxKeys`의 한 항목을 차지한다. 객체 세 개를 원하면서 서버 응답의 세 항목을 모두 객체로 계산하면 맞지 않는다. [AWS CommonPrefixes 설명](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html#API_ListObjectsV2_ResponseElements)

조회 후 필터도 같은 문제를 만든다. N=3인데 처음 네 객체 중 두 개가 필터에서 제외되면 N+1개를 읽어도 반환 가능한 객체는 두 개뿐이다. 다음 페이지 존재 여부를 판단하려면 필터를 통과하는 네 번째 객체까지 찾아야 한다. 조회 크기를 늘리는 변경이 권한 검사나 제외 조건을 줄여도 된다는 뜻은 아니다.

순서 역시 전제다. AWS 일반 목적 버킷은 키의 사전식 순서로 목록을 반환하지만 directory bucket은 그 순서를 보장하지 않으며 `StartAfter`도 지원하지 않는다. 이 글의 마지막 키 커서를 그 경로에 적용하면 안 된다. [AWS 목록 순서와 버킷별 차이](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)

이 실험이 직접 측정한 값은 로컬 모의 서버의 HTTP 요청 수다. 운영 CPU·메모리·지연시간이나 전체 비용의 개선율을 측정하지 않았다. 실제 목록 경로에 적용할 때는 먼저 SDK가 서버 페이지를 자동으로 넘기는지 보고 같은 입력으로 반환 객체·다음 커서·마지막 페이지를 대조하면 된다. 그 계약을 보존한 상태에서 실제 요청 수를 세어야 조회 크기 한 줄의 효과를 판단할 수 있다.
