---
title: 닫힌 Go 채널이 CPU를 계속 쓰게 만든 이유
description: Go 1.24.5에서 닫힌 채널과 select의 동작을 재현하고, 고루틴 종료 신호와 실제 종료를 구분한다.
categories: [debugging, golang]
tags: [cpu, goroutine, channel, debugging, performance, streaming, golang]
date: 2024-12-25
mermaid: true
---

스트리밍 루프가 채널이 닫힌 뒤에도 끝나지 않는다고 하자. 새 데이터는 없는데 수신 case가 계속 선택되고, `default`는 한 번도 실행되지 않는다. 이 상황을 '채널이 비었으니 수신은 기다릴 것'이라고 예상하면 원인을 놓친다. **닫히고 비워진 채널의 수신은 즉시 완료되기 때문이다.**

아래 **Go 1.24.5 예제**로 채널의 동작을 확인해 보자. 실제 CPU 사용량이나 고루틴이 끝나지 않는 원인까지 알아내려면 프로파일과 실행 상태를 따로 살펴야 한다.

## 닫힌 채널은 비활성 채널이 아니다

채널을 닫아도 버퍼에 남은 값은 먼저 수신된다. 그 값까지 읽고 나면 수신은 즉시 원소 타입의 zero value를 돌려준다. `value, ok := <-ch`에서 `ok`는 `false`다. 문자열 채널이라면 그 값은 `""`이므로, 빈 문자열도 유효한 데이터일 수 있는 프로토콜에서는 `value`만으로 종료를 판별할 수 없다. [Go 언어 명세: Receive operator](https://go.dev/ref/spec#Receive_operator)

`select`의 `default`는 통신 case 중 즉시 진행 가능한 것이 없을 때 선택된다. 닫히고 비워진 채널의 수신은 **항상 준비된 case**이므로 `default`는 탈출구가 아니다. 루프에서 `ok`를 무시하면 매 반복마다 zero value를 받고 다시 수신한다. 반복 사이에 대기하는 연산이 없다면 계속 CPU 실행 기회를 소비할 수 있다. [Go 언어 명세: Select statements](https://go.dev/ref/spec#Select_statements)

```text
닫힌 채널 수신 → value="", ok=false → 즉시 다음 반복
                    ↑                    |
                    └────────────────────┘
```

이 그림은 수신 경로의 제어 흐름이지 실제 CPU 사용률 그래프가 아니다. 다른 case에 대기가 있더라도 닫힌 채널 case가 계속 준비되어 있다면 루프가 쉴 필요가 없다. 정확한 CPU 비용은 작업 본문과 실행 환경에 따라 달라진다.

## 무한 루프 대신 세 번만 실행해 본다

다음 파일은 문제가 되는 수신을 세 번만 반복한다. 그 뒤에는 버퍼에 마지막 값이 남은 채널을 읽고, 종료를 확인하면 channel case를 `nil`로 비활성화한 다음 stop case로 빠져나간다. `nil` 채널의 수신은 진행할 수 없으므로, 다른 case를 선택할 수 있다. [Go 언어 명세: nil 및 닫힌 채널 수신](https://go.dev/ref/spec#Receive_operator)

```go
package main

import "fmt"

func main() {
	closed := make(chan string)
	close(closed)
	for i := 0; i < 3; i++ {
		select {
		case value, ok := <-closed:
			fmt.Printf("bad receive: value=%q ok=%t\n", value, ok)
		default:
			panic("closed receive should be ready")
		}
	}

	lines := make(chan string, 1)
	lines <- "last"
	close(lines)
	stop := make(chan struct{})
	for {
		select {
		case value, ok := <-lines:
			if !ok {
				lines = nil
				close(stop)
				continue
			}
			fmt.Println("line:", value)
		case <-stop:
			fmt.Println("stopped")
			return
		}
	}
}
```

코드를 `main.go`에 저장한 뒤 Go 1.24.5로 실행한다.

```sh
GOTOOLCHAIN=go1.24.5 go run main.go
```

출력은 다음과 같다.

```text
bad receive: value="" ok=false
bad receive: value="" ok=false
bad receive: value="" ok=false
line: last
stopped
```

첫 세 줄은 `default`에 빠지지 않고 **같은 닫힌 채널에서 즉시 세 번 수신**했다는 증거다. 세 번이라는 상한을 없애고 `ok`도 무시하면 종료 조건 없이 반복할 수 있다. 마지막 두 줄은 닫힌 buffered 채널에서도 기존 값 `"last"`를 먼저 받는다는 점과, `ok=false`를 처리해 선택지를 바꾼 뒤 종료한다는 점을 보여 준다. 이 예제는 실제 CPU 사용률을 측정하지 않는다.

`lines = nil`만 쓰고 다른 준비된 case나 종료 조건이 없다면 `select`는 오히려 영원히 대기할 수 있다. 여기서는 교육용으로 `stop`을 닫아 다음 반복의 종료 case가 반드시 준비되게 했다. 제품 코드에서는 채널을 닫는 쪽과 종료 신호를 보내는 쪽의 책임을 정해야 한다. 수신자가 임의로 생산자의 채널을 닫으면 보내는 쪽의 panic을 만들 수 있다. [Go 언어 명세: Send statements](https://go.dev/ref/spec#Send_statements)

## 한 채널이면 range, 여러 사건이면 select

생산자가 마지막 값을 보내고 반드시 닫는 계약이라면 `for value := range ch`가 가장 단순하다. 버퍼를 비운 뒤 자연스럽게 루프가 끝난다. 그러나 생산자가 닫지 않을 수 있다면 `range`는 계속 기다린다. 닫힘을 기다려야 하는지, 별도 취소 신호로도 나와야 하는지가 먼저 정해져야 한다. [Go 언어 명세: for range와 채널](https://go.dev/ref/spec#For_statements)

여러 입력이나 취소 신호를 함께 기다릴 때는 `select`가 필요하다. 데이터 채널의 `ok=false`를 확인하고 그 case를 제거하거나 함수에서 반환한다. 종료 신호 전용 `<-done`처럼 값은 버리고 닫힘 자체만 의미가 있다면 매번 `ok` 변수를 만들 이유는 없다. 중요한 것은 **닫힘을 데이터로 취급하는지, 제어 신호로 취급하는지**를 구분하는 일이다.

`select`의 case 순서는 우선순위가 아니다. 둘 이상의 통신이 즉시 진행 가능하면 명세상 준비된 case 하나가 균등한 의사 난수 선택으로 결정된다. 따라서 `stop` case를 맨 위에 놓아도 이미 준비된 데이터 case보다 반드시 먼저 실행되지는 않는다. 취소를 받은 뒤 새 작업을 시작하지 않아야 한다면 작업 시작 직전에 취소 상태를 다시 확인하고, 작업 자체에도 취소를 전달해야 한다. 재확인 직후 취소가 도착할 수 있으므로, 이미 시작한 작업의 종료는 별도로 기다려야 한다. [Go 언어 명세: Select statements](https://go.dev/ref/spec#Select_statements), [Go context 문서](https://pkg.go.dev/context#Context)

## CPU 회전과 고루틴 누수는 같은 관측이 아니다

이 글의 닫힌 채널 루프는 **진행 가능한 수신을 반복**하는 경우다. 반대로 열려 있지만 아무도 보내지 않는 채널에서 수신을 기다리는 고루틴은 CPU를 거의 쓰지 않아도 끝나지 않을 수 있다. 둘 다 '종료하지 않은 고루틴'이지만 문제의 자원과 진단 증거가 다르다. 고루틴 수가 늘었다는 사실만으로 CPU 회전을 증명할 수 없고, CPU 사용률이 높다는 사실만으로 고루틴 수의 증가를 증명할 수도 없다.

실제 애플리케이션에서는 CPU 프로파일로 실행 시간을 쓰는 함수와 줄을 찾고, 같은 시점의 고루틴 스택으로 반복 실행인지 차단 대기인지 확인해야 한다. 반복 요청 뒤 고루틴 수가 누적되는지도 별도로 본다. [Go diagnostics](https://go.dev/doc/diagnostics), [runtime/pprof](https://pkg.go.dev/runtime/pprof)

마지막으로 종료 신호를 보냈다는 사실과 실제 종료를 합치지 말자. `stop`이 닫혀도 고루틴이 긴 `doWork()` 안에 있으면 `select`로 돌아올 때까지 그 신호를 처리하지 못한다. 호출자가 자원을 정리해야 한다면 종료 신호뿐 아니라 고루틴의 완료를 기다릴 경로가 필요하다. [파서의 취소와 자원 소유권](/posts/parser-cancellation-resource-ownership/)도 같은 수명 경계를 다룬다. 다음에 닫힌 채널을 만난다면 `value`보다 먼저 `ok`와 **다음 반복에서 어떤 case가 준비되는지**를 살펴보자.
