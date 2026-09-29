---
title: 고루틴과 GOMAXPROCS 이해하기 — Go 1.24.5 기준
categories: [golang, goroutine]
tags: [golang, goroutine, concurrency] # TAG names should alw   ays be lowercase
description: Go 1.24.5의 고루틴과 GOMAXPROCS 기본값, 컨테이너 CPU 제한, 작업 수명과 자원 사용을 구분한다.
---

`GOMAXPROCS=1`이면 고루틴도 하나만 만들 수 있을까? 아니다. 두 고루틴을 만들어 채널 앞까지 진행시키고, 둘 다 나중에 완료할 수 있다. 이 값은 **동시에 Go 코드를 실행하는 능력**을 제한한다. 대기 중인 작업 수, OS 스레드 총수, 요청 수의 상한이 아니다.

이 글은 Go **1.24.5**를 기준으로 한다. 이후 버전의 컨테이너 기본값 변경을 과거 버전에 소급하지 않는다. 아래 예제는 동작을 확인하는 실험이지 성능이나 컨테이너 CPU 사용량의 측정값이 아니다.

## `go f()` 뒤에는 무엇이 생기는가

`go f()`는 함수 `f`를 새 고루틴에서 실행한다. 고루틴은 같은 주소 공간에서 다른 고루틴과 동시에 진행할 수 있고, 런타임이 OS 스레드 위에 배치한다. 고루틴 하나마다 스레드 하나가 고정되는 구조는 아니다. 스택은 작게 시작해 필요에 따라 커지거나 줄지만, 그 설명만으로 작업의 메모리 비용을 계산할 수는 없다. 고루틴이 붙잡은 버퍼, 응답 객체, 파일, 연결까지 함께 봐야 한다. [Effective Go: goroutines](https://go.dev/doc/effective_go#goroutines), [Go 런타임 내부 설명](https://go.dev/src/runtime/HACKING)

Go 런타임의 용어를 최소한으로 풀면 `G`는 고루틴, `M`은 OS 스레드, `P`는 사용자 Go 코드를 실행하는 데 필요한 권한과 상태다. 실행하려는 `G`를 `M`에 올리려면 `P`가 필요하다. `GOMAXPROCS`는 `P`의 수를 정한다. `M`이 시스템 호출에서 막히면 `P`를 다른 `M`이 사용할 수 있다. 그래서 `P`의 수와 전체 `M`의 수를 같은 숫자로 읽으면 안 된다. 이것은 런타임 구현을 이해하는 모델이며 모든 작업이 어떤 순서로 실행될지 예측하는 공식은 아니다. [Go 런타임의 G/M/P 설명](https://go.dev/src/runtime/HACKING)

예를 들어 두 네트워크 요청이 응답을 기다리는 동안 다른 고루틴이 진행할 수 있다. CPU 계산 두 개가 실제 같은 순간에 돌아갈 수 있는지는 사용할 수 있는 `P`와 CPU 자원에 달렸다. **동시성**은 여러 작업의 진행을 조직하는 방법이고, **병렬성**은 실제 같은 시간에 계산을 수행하는 상태다. 어느 쪽이든 `main`이 먼저 반환하면 다른 고루틴의 종료를 자동으로 기다려 주지 않는다. 기다려야 할 작업이라면 결과 채널이나 `sync.WaitGroup`으로 합류해야 한다. [Effective Go: concurrency](https://go.dev/doc/effective_go#concurrency)

## 한 개의 P에 두 작업을 세워 본다

다음 코드는 `runtime.GOMAXPROCS(1)`을 명시적으로 설정하고 고루틴 둘을 `release` 채널 앞까지 진행시킨다. 두 `started` 신호를 받은 뒤에만 출력하므로 스케줄링 속도에 기대지 않는다. `release`를 닫아 두 작업을 진행시키고 둘의 종료 신호를 기다린다.

```go
package main

import (
	"fmt"
	"runtime"
)

func main() {
	previous := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(previous)

	started := make(chan struct{}, 2)
	release := make(chan struct{})
	done := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() {
			started <- struct{}{}
			<-release
			done <- struct{}{}
		}()
	}
	<-started
	<-started
	fmt.Println("P limit:", runtime.GOMAXPROCS(0))
	fmt.Println("workers started: 2")
	close(release)
	<-done
	<-done
	fmt.Println("workers completed: 2")
}
```

```text
P limit: 1
workers started: 2
workers completed: 2
```

`P limit: 1`인데 시작 신호를 보낸 고루틴은 둘이다. 이것으로 `GOMAXPROCS`가 고루틴 개수 제한이 아니라는 점을 확인할 수 있다. 두 작업이 **동시에 CPU에서 실행됐다**는 결과는 아니다. 시작 신호를 보낸 순간에 각 고루틴이 이미 `release`에서 대기 중인지도 출력만으로는 알 수 없다. 다만 둘 다 `release`가 닫히기 전에는 완료 신호를 보낼 수 없고, 프로그램은 완료 신호 두 개를 받아 수명을 명시적으로 합류한다. 닫힌 채널 수신은 즉시 진행할 수 있다. [Go 언어 명세: 수신](https://go.dev/ref/spec#Receive_operator)

실제 서버에서 `GOMAXPROCS`를 1로 설정하면 CPU 작업의 병렬 실행 능력은 제한할 수 있지만, 그 자체로 대기 중인 작업 수를 제한하지 않는다. 요청마다 고루틴을 계속 만들 수 있고 각 요청이 버퍼를 보유할 수도 있다. 메모리 사용량이나 외부 서비스 동시 호출 수를 제한하려면 별도의 admission, semaphore 또는 worker 수 제한이 필요하다. [업로드의 메모리 admission](/posts/upload-memory-admission-before-body/)은 이 차이를 요청당 버퍼로 설명한다.

## Go 1.24.5의 기본값과 컨테이너 CPU 제한

Go 1.24.5에서 별도 설정이 없을 때 `GOMAXPROCS` 기본값은 시작 시점의 `runtime.NumCPU()`다. 이는 프로세스에 사용할 수 있는 논리 CPU 수이며, 컨테이너의 cgroup CPU bandwidth quota와 같은 수치라고 가정하면 안 된다. Go 1.25 릴리스 노트는 그 전 버전의 기본값을 이처럼 설명하고, **1.25부터** Linux cgroup CPU bandwidth 제한을 기본값 계산에 반영한다고 명시한다. [Go 1.25 릴리스 노트: Container-aware GOMAXPROCS](https://go.dev/doc/go1.25#runtime)

예를 들어 CPU affinity로 보이는 논리 CPU가 8개인데 cgroup quota가 2 CPU에 해당하는 환경을 생각해 보자. 별도 설정이 없는 **Go 1.24.5 기본 동작**이라면 `GOMAXPROCS`는 보이는 CPU 수를 기준으로 8이 될 수 있다. 이는 설명용 가정이며 이 글이 특정 컨테이너에서 8 또는 2를 측정했다는 뜻이 아니다. CPU quota를 초과해 실행하려는 Go 작업은 운영체제의 throttling을 만날 수 있으나, 실제 지연 영향은 작업과 제한 조건을 측정해야 한다. Go 1.25의 새 기본 동작을 적용한 시스템이라면 런타임 버전, 수동 설정 여부, 실제 quota를 다시 확인해야 한다. [Go 1.25 릴리스 노트](https://go.dev/doc/go1.25#runtime)

`GOMAXPROCS` 환경 변수나 `runtime.GOMAXPROCS()` 호출은 운영자가 정한 값을 바꾼다. 시작 코드에 `runtime.GOMAXPROCS(runtime.NumCPU())`를 습관적으로 넣으면 운영 환경에서 설정한 한도를 덮어쓸 수 있다. Go 1.25의 동적 기본값 갱신도 수동 설정 시 비활성화된다. 버전에 맞춰 **실행 중인 값, 실제 CPU affinity와 quota, throttling, 지연 시간**을 따로 확인하고 조정해야 한다. [`runtime.GOMAXPROCS` API](https://pkg.go.dev/runtime#GOMAXPROCS), [Go 1.25 릴리스 노트](https://go.dev/doc/go1.25#runtime)

## 스케줄러가 대신 끝내 주지는 않는다

고루틴이 채널 수신이나 I/O에서 기다리면 런타임은 다른 작업을 진행시킬 수 있다. 하지만 기다리는 조건이 영원히 충족되지 않으면 그 고루틴은 종료되지 않는다. `context`의 취소 함수 역시 작업을 죽이는 명령이 아니라 취소 신호를 전파한다. 대상 코드가 `Done()`을 확인하고 빠져나와야 한다. [Go context 문서](https://pkg.go.dev/context#Context)

[닫힌 채널을 반복 수신한 예제](/posts/cpu-100-percent-goroutine-leak-fix/)는 반대 극단이다. 기다리지 않으므로 쉬지 않고 돌 수 있다. 대기 고루틴과 CPU를 태우는 고루틴 모두 '개수'만으로 원인을 알 수 없다. 실행 상태와 스택을 확인하고 CPU 프로파일에서 시간을 쓰는 함수를 찾아야 한다. [Go 진단 문서](https://go.dev/doc/diagnostics)

새 고루틴을 추가할 때는 먼저 세 경계를 정하자. **진입 상한**은 무엇인가, **멈출 조건**은 무엇인가, **종료를 누가 기다리는가**. `GOMAXPROCS`는 첫 질문의 답이 아니며, `context`를 전달한 사실만으로 둘째와 셋째 질문이 해결되지 않는다. 세 경계가 있으면 고루틴 수가 늘어날 때 무엇이 늘어나는지도 설명할 수 있다.
