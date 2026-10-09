---
title: "스트리밍 업로드인데 왜 528 MiB 버퍼가 필요할까"
description: "minio-go의 크기 미상 업로드에서 PartSize 기본값을 추적한다. 버퍼 크기와 동시성의 관계, 파일 크기 제한이 데이터를 자를 수 있는 이유를 살펴본다."
categories: [architecture, optimization]
tags: [go, streaming, backpressure, queueing, memory, minio]
date: 2026-09-29
related:
  - slug: flashattention-io-to-fp4-bottlenecks
    reason: 한 비용을 줄인 뒤 남는 메모리·계산 병목을 따라갑니다.
  - slug: cloudflare-dns-cache-memory-optimization
    reason: 작은 엔트리의 구조 변경이 전체 메모리 비용을 바꾸는 사례를 비교합니다.
  - slug: file-upload-concurrency-control
    reason: 여러 업로드가 같은 저장 용량을 갱신할 때의 경쟁을 살펴봅니다.
---

파일을 `io.Reader`로 넘기면 메모리를 조금씩만 쓸까. 호출하는 코드가 파일 전체를 읽지 않더라도, 데이터를 받는 SDK는 전송용 버퍼를 먼저 만들 수 있다. **스트리밍은 데이터를 전달하는 방식이고, 메모리 상한은 각 단계의 할당 방식으로 정해진다.**

Go 1.24.5와 minio-go v7.0.97로 로컬 실험을 해 보자. SDK의 첫 `Read` 호출에서 버퍼 크기를 관찰한 뒤, 그 값으로 동시 실행 수와 part 크기를 어떻게 정할지 계산한다.

## 528 MiB는 어디에서 나왔나

`PutObject`에 길이 `-1`을 넘기면 SDK는 입력이 끝날 때까지 읽어야 한다. 마지막 크기를 모르는 동안에도 part 크기는 먼저 정해야 한다. 여기서 `PartSize: 0`은 버퍼를 없애라는 설정이 아니라 자동 계산을 선택하는 값이다.

v7.0.97의 [`OptimalPartInfo`](https://github.com/minio/minio-go/blob/v7.0.97/api-put-object-common.go)는 미상 크기를 5 TiB로 놓고 계산한다. 이 버전의 기본 단위는 16 MiB, 최대 part 수는 10,000이다. MiB는 2²⁰바이트, TiB는 2⁴⁰바이트다. [상수 정의](https://github.com/minio/minio-go/blob/v7.0.97/constants.go)

```text
가정한 전체 크기       = 5 × 2⁴⁰ = 5,497,558,138,880 bytes
part당 필요한 크기    = floor(5,497,558,138,880 / 10,000)
                      = 549,755,813 bytes
16 MiB 단위로 올림    = ceil(549,755,813 / 16,777,216) × 16,777,216
                      = 33 × 16,777,216
                      = 553,648,128 bytes = 528 MiB
```

작은 part를 쓰면 큰 입력을 다 담기 전에 part 번호가 소진될 수 있다. SDK는 길이를 모르는 입력에서도 자신이 지원하는 최대 크기를 처리하려고 큰 버퍼를 선택한 셈이다. 실제 입력이 작다는 사실은 첫 읽기 전에 알 수 없으므로 이 계산에 반영되지 않는다.

조건을 좁혀야 원인도 정확해진다. 이 글이 확인한 경로는 V4 서명 방식의 일반 S3 호환 엔드포인트에서, 크기 미상 입력을 **순차 multipart**로 보내는 경우다. `ConcurrentStreamParts`와 `NumThreads > 1`을 함께 지정하면 별도 병렬 경로를 탄다. 길이를 아는 작은 입력도 다른 경로다. [PutObject의 분기](https://github.com/minio/minio-go/blob/v7.0.97/api-put-object.go)

<iframe src="/assets/diagrams/2026-09-29/minio-upload-buffer.html" title="크기 미상 업로드의 SDK 버퍼 할당 순서" loading="lazy" width="100%" height="576" style="border:0;display:block;width:100%;" sandbox=""></iframe>

버퍼는 원격 저장소에 도착하기 전에 클라이언트 프로세스에서 만들어진다. 서버의 저장 캐시와 구분해야 할 지점이다. [그림 크게 보기](/assets/diagrams/2026-09-29/minio-upload-buffer.html)

## 파일을 읽기 전에 할당되는지 직접 확인한다

소스의 순차 경로는 multipart 시작 요청 뒤에 part 크기의 슬라이스를 만들고 `reader.Read`를 호출한다. 그렇다면 입력을 한 바이트도 주지 않는 reader에서도 큰 버퍼를 볼 수 있어야 한다. 이 예측을 확인하는 실험을 만들었다.

[실험 코드 내려받기](/assets/examples/2026-09-29/minio-buffer-probe/main.go) · [go.mod](/assets/examples/2026-09-29/minio-buffer-probe/go.mod) · [go.sum](/assets/examples/2026-09-29/minio-buffer-probe/go.sum)

세 파일을 빈 디렉터리에 저장하고 Go 1.24.5에서 `GOTOOLCHAIN=local go run .`을 실행한다. **기본값 실험은 약 528 MiB의 Go heap 할당을 요청한다.** 메모리가 작은 환경에서는 기본값 케이스를 빼고 실행한다. 외부 저장소나 인증 정보는 필요 없다. HTTP transport가 multipart 시작과 중단 응답을 메모리에서 돌려주고, reader는 첫 호출에서 관측 후 의도적인 오류를 반환한다. 따라서 파일 전송 성능을 측정하는 실험은 아니다.

관찰 지점은 다음과 같다. `before`는 `PutObject` 직전에 기록한 누적 할당량이다. 전체 실행 파일에는 예측한 버퍼 크기, reader 호출 여부, 의도한 오류가 반환됐는지를 검사하는 assert 역할의 조건문도 들어 있다.

```go
func (p *probeReader) Read(b []byte) (int, error) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    p.called = true
    // 이 시점에는 아직 입력을 한 바이트도 반환하지 않았다.
    fmt.Printf("Read buffer=%.0f MiB; allocated before Read=%.2f MiB\n",
        float64(len(b))/(1<<20), float64(m.TotalAlloc-p.before)/(1<<20))
    return 0, stop
}
```

이 reader를 SDK에 넘기는 호출은 다음과 같다. `configured`를 `0`과 `8 * 1024 * 1024`로 바꾸어 비교한다. 길이 인자 `-1`은 전체 크기를 모른다는 뜻이다.

```go
_, err := client.PutObject(
    context.Background(), "demo-bucket", "demo", reader, -1,
    minio.PutObjectOptions{PartSize: configured},
)
if !reader.called || !errors.Is(err, stop) {
    panic("probe must stop at its first Read")
}
```

여기서는 첫 읽기에서 의도적으로 실패시켜 할당 시점만 본다. 실제 업로드라면 `PutObject` 오류를 처리하고, 저장 성공을 확인한 뒤에만 완료로 기록해야 한다.

Go 1.24.5, darwin/arm64에서 `PartSize=0`과 `PartSize=8 MiB`를 순서대로 실행한 결과다.

```text
Read buffer=528 MiB; allocated before Read=528.06 MiB
Read buffer=8 MiB; allocated before Read=8.05 MiB
```

`len(b)`는 SDK가 reader에 건넨 슬라이스 길이다. `TotalAlloc`의 차이는 그 사이 발생한 누적 Go heap 할당량이므로 요청 처리와 XML 파싱 등의 작은 할당도 포함한다. 소수점 부분은 환경에 따라 달라진다. 이 결과는 **입력 크기를 알아내기 전에 버퍼를 만든다**는 예측을 지지한다. 완성된 업로드, 최대 동시성, RSS, 컨테이너 OOM까지 검증한 결과는 아니다.

특히 할당량과 RSS를 혼동하면 다음 판단도 틀어진다. Go가 확보한 객체 크기와 OS가 실제 메모리에 올려 둔 페이지는 같은 측정 대상이 아니다. `TotalAlloc`은 해제된 객체까지 누적하며, 현재 살아 있는 버퍼를 알고 싶다면 heap profile과 실제 처리 중인 요청 수를 함께 본다. [Go 1.24.5 MemStats 정의](https://github.com/golang/go/blob/go1.24.5/src/runtime/mstats.go)

## PartSize는 메모리와 요청 수를 함께 바꾼다

8 MiB는 이 실험에서 차이를 보기 위해 고른 값이다. 모든 서비스에 권하는 기본값은 아니다. 순차 전송이고 입력 크기가 F, part 크기가 B라면 대략 `ceil(F/B)`번의 part 업로드가 필요하다. 각 part의 데이터 전송 외 고정 비용을 r, 순수 전송 속도를 v라고 단순화하면 다음 모델을 세울 수 있다.

```text
순차 전송 시간 ≈ F / v + ceil(F / B) × r
```

이는 네트워크 측정식이 아닌 비교용 모델이다. 재전송·연결 재사용·체크섬·서버 처리량을 생략했다. 그래도 왜 B를 무조건 줄일 수 없는지는 설명한다. B를 절반으로 줄이면 버퍼는 작아지지만, 큰 입력에서 고정 비용을 치르는 횟수는 거의 두 배가 된다. 반대로 B를 키우면 실패한 part를 재시도할 때 다시 보내야 하는 범위도 커진다.

크기 상한도 함께 정한다. 이 SDK 버전에서 8 MiB part 10,000개가 담을 수 있는 양은 80,000 MiB, 약 78.125 GiB다. 100 GiB 입력을 허용하려면 이 조합은 부족하다. 따라서 애플리케이션의 최대 입력 S에 대해 `ceil(S/B) ≤ 10,000`을 확인하고 SDK가 허용하는 part 크기 범위도 만족시킨다. 최신 저장소 한도를 오래된 클라이언트에 그대로 적용하지 않고, **사용 중인 SDK와 서버 양쪽의 제약**을 확인한다.

파일의 정확한 길이를 이미 아는 경우에는 그 길이를 전달하는 것이 첫 선택이다. 길이를 알아내려고 전체 파일을 메모리에 복사하면 절약하려던 비용이 다른 곳으로 옮겨간다. 임시파일에 받는 방식은 메모리 대신 디스크 용량·I/O·정리 책임을 요구한다. 입력이 변환되거나 압축된다면 원본 길이가 업로드 바이트 수와 같은지도 확인한다.

## 동시성은 요청 수가 아니라 살아 있는 버퍼 수로 센다

part 크기를 줄여도 업로드가 무제한으로 시작되면 전체 메모리를 제한하지 못한다. 동시에 실행 중인 업로드를 C, 업로드당 살아 있는 part 버퍼 수를 K, part 크기를 B라고 두자.

```text
전송 버퍼의 용량 합 ≈ C × K × B
```

순차 경로에서는 K가 1인 반면, 이 버전의 병렬 스트림 경로는 `NumThreads × PartSize` 크기로 버퍼 영역을 만든다. `NumThreads`만 보고 모든 호출에 같은 K를 대입하면 안 된다. 앞서 확인한 호출 분기가 먼저다. [병렬 스트림 버퍼 할당](https://github.com/minio/minio-go/blob/v7.0.97/api-put-object-streaming.go)

아래는 실제 서비스와 무관한 용량 계획 예다. 프로세스에 허용할 총예산에서 평상시 메모리와 여유분을 뺀 뒤, 업로드에 96 MiB를 배정했다고 가정한다. B=8 MiB, K=2이면 part 버퍼만 따졌을 때 C는 최대 6이다. 하지만 요청당 파싱·메타데이터 비용 R이 더 있으면 식은 바뀐다.

```text
C ≤ floor(업로드 예산 / (K × B + R))
```

R을 재지 않고 C=6을 안전하다고 결론 내릴 수는 없다. 아직 GC가 회수하지 않은 이전 요청의 객체와 런타임 비용도 여유분에 들어가야 한다. `GOMEMLIMIT`을 낮춰도 현재 읽거나 보내는 버퍼는 살아 있는 객체이므로 GC가 없애 주지 못한다. 메모리 제한은 soft limit이며 요청 입장 제어를 대신하지 않는다. [Go GC 가이드의 memory limit 설명](https://go.dev/doc/gc-guide#Memory_limit)

## 대기시키는 위치가 한 줄 달라져도 상한이 깨진다

다음 두 순서는 세마포어의 크기가 같아도 다른 시스템이다.

```text
A: 본문 파싱·버퍼 할당 → 슬롯 대기 → 업로드 → 슬롯 반환
B: 슬롯 확보 → 본문 파싱·버퍼 할당 → 업로드 → 슬롯 반환
```

A에서 슬롯 밖에 기다리는 요청이 W개이고 요청당 이미 P바이트를 보유했다면, 제한식에 `W × P`가 추가된다. W를 제한하지 않았으므로 업로드의 C를 제한해도 이 항은 계속 늘어난다. HTTP 핸들러 안의 업로드 코드만 볼 것이 아니라 앞선 미들웨어가 본문을 읽는지도 확인해야 한다.

B는 큰 할당의 시작을 제한하지만 대기하는 연결·고루틴·프록시 버퍼까지 제거하지는 않는다. 대기열 상한과 대기 시간 제한을 두고, 취소된 요청이 나중에 슬롯을 얻어 불필요한 읽기를 시작하지 않는지 검사한다. 슬롯은 전송 함수의 호출자가 관심을 잃었을 때가 아니라 실제 버퍼 사용이 끝났을 때 반환한다. [취소와 자원 수명을 다룬 글](/posts/parser-cancellation-resource-ownership/)과 같은 문제다.

## 읽기 제한은 초과 검증과 다르다

메모리를 줄이려고 입력을 일정 길이로 제한할 때는 저장 결과도 확인해야 한다. Go의 [`io.LimitReader`](https://pkg.go.dev/io@go1.24.5#LimitReader)는 지정한 길이를 읽고 나면 EOF를 반환한다. 원본에 데이터가 더 있어도 이를 초과 오류로 알리지 않는다.

다음 예제를 실행하면 차이를 볼 수 있다. 실제 업로드 구현을 대신하는 코드는 아니다.

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func main() {
    data, err := io.ReadAll(io.LimitReader(strings.NewReader("abcdef"), 5))
    if string(data) != "abcde" || err != nil {
        panic("unexpected LimitReader behavior")
    }
    fmt.Printf("data=%q err=%v\n", data, err)
}
```

출력은 `data="abcde" err=<nil>`이다. 성공적으로 읽었지만 원본의 마지막 `f`는 없다. **오류가 없다는 사실과 원본 전체를 보존했다는 사실은 다르다.**

일반적으로 최대 N바이트 입력을 검증하려면 N+1바이트까지 관찰해 초과 여부를 판단할 수 있다. 하지만 데이터를 외부 저장소로 보내는 중이라면 검사가 언제 끝나는지도 중요하다. 초과를 알아내기 전에 저장 완료를 확정하면 검증이 늦다. SDK가 입력을 언제 다시 읽고 언제 multipart 완료를 요청하는지, 실패 시 미완료 업로드를 어떻게 정리하는지까지 확인해야 한다.

## 내 업로드 코드에서는 무엇을 재볼까

먼저 사용하는 SDK 버전과 실제 호출 경로를 고정한다. 길이를 알고 있는 입력과 모르는 입력을 나누고, part 크기와 병렬 전송 설정을 기록한다. 파일 크기만 바꾸면 버퍼 정책의 차이를 놓칠 수 있다.

작은 파일 한 건으로 시작해 동시 실행 수를 늘리면서 Go 힙의 할당량과 프로세스가 물리 메모리에 올려 둔 양(RSS)을 따로 측정해 보자. 버퍼를 줄인 뒤에는 메모리뿐 아니라 처리 시간과 저장된 전체 바이트도 비교한다. 실패·취소·크기 초과에서 저장 완료가 잘못 보고되지 않는지도 검사한다.

마지막으로 본문 reader의 호출 횟수를 세는 대역을 넣어 보면 좋다. 처리 자리를 기다리는 동안 읽기 횟수가 늘어난다면, 동시성 제한은 메모리를 쓰기 시작한 뒤에 적용되고 있는 것이다. 그 순서를 확인한 다음 버퍼와 동시 실행 수를 조정해야 한다.
