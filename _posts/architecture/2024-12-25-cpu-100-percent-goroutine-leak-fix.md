---
title: 닫힌 Go 채널이 CPU를 계속 쓰게 만든 이유
description: Go 1.24.5에서 닫힌 채널과 select의 동작을 재현하고, 고루틴 종료 신호와 실제 종료를 구분한다.
categories: [debugging, golang]
tags: [cpu, goroutine, channel, debugging, performance, streaming, golang]
date: 2024-12-25
mermaid: true
---

채팅 스트리밍이 끝난 뒤에도 CPU 사용률이 높게 유지됐다. 조사한 코드에는 닫힌 채널을 반복해서 읽는 루프가 있었다. 채널의 종료 신호를 빈 문자열 데이터처럼 처리하면서 루프가 쉬지 않고 돌았다.

CPU 사용률만으로 고루틴 누수를 단정할 수는 없다. CPU 프로파일로 바쁜 경로를 찾고, 고루틴 수와 스택을 함께 확인해야 한다. 이 사례에서 중요한 원인은 **닫힌 채널을 읽은 뒤 종료하지 않는 제어 흐름**이었다.

> 2026-09-29 보완: Go **1.24.5** 기준으로 채널과 `select` 설명을 정리했다. 기존의 “다음 ticker 주기까지 종료를 기다린다”는 설명은 잘못되어 바로잡았다.

## 닫힌 채널에서는 default가 탈출구가 되지 않는다

채널을 닫아도 버퍼에 남은 값은 먼저 읽을 수 있다. 버퍼까지 비면 수신은 대기하지 않고 원소 타입의 zero value와 `ok=false`를 반환한다.

`select`의 `default`는 다른 통신 case가 즉시 진행할 수 없을 때만 선택된다. 닫히고 비워진 채널의 수신은 항상 진행 가능하므로 `default`로 빠지지 않는다. [Go 언어 명세: 수신 연산](https://go.dev/ref/spec#Receive_operator), [select](https://go.dev/ref/spec#Select_statements)

다음 예제는 무한 루프를 만들지 않고 그 동작을 확인한다.

```go
package main

import "fmt"

func main() {
    closed := make(chan string)
    close(closed)

    select {
    case value, ok := <-closed:
        if value != "" || ok {
            panic("unexpected closed-channel result")
        }
        fmt.Println("closed receive selected")
    default:
        panic("default must not be selected")
    }

    lines := make(chan string, 2)
    lines <- "first"
    lines <- "second"
    close(lines)

    count := 0
    for range lines {
        count++
    }
    if count != 2 {
        panic("buffered messages were lost")
    }
    fmt.Println("drained:", count)
}
```

출력은 다음과 같다.

```text
closed receive selected
drained: 2
```

## 종료 방식을 채널의 계약에 맞춘다

생산자가 마지막 값을 보낸 뒤 채널을 닫는 계약이라면 `for range ch`로 남은 값을 읽고 종료할 수 있다. 취소나 여러 채널을 함께 다뤄야 한다면 `select`에서 `value, ok := <-ch`를 사용해 종료를 처리한다.

기존의 non-blocking drain을 단순한 수신 루프로 바꾸면, 채널이 아직 열려 있을 때 기다리게 된다. 따라서 `ok` 검사만 추가하는 문제와 “생산자가 닫을 때까지 기다릴 것인가”는 구분해야 한다. 생산자 종료 보장 없이 바꾸면 CPU 회전 대신 대기 누수가 생길 수 있다.

종료 신호만 받는 `<-done`에는 값과 `ok`가 필요하지 않을 수 있다. “모든 수신에는 항상 ok”가 아니라 데이터와 종료를 구분해야 하는 곳에서 적절한 패턴을 선택한다.

## select의 작성 순서는 우선순위가 아니다

여러 case가 준비되어 있으면 `select`는 그중 하나를 선택한다. 종료 case를 맨 위에 쓴다고 우선 실행하지 않는다.

`stopChan`이 닫혀 있고 고루틴이 `select`에서 대기 중이라면 다음 ticker 시각까지 기다릴 이유가 없다. 이미 진행할 수 있는 종료 case가 있기 때문이다. 다만 `doWork()` 안에서 오래 실행 중이라면 함수가 반환하거나 스스로 취소를 처리할 때까지 루프로 돌아오지 못한다.

작업 직전에 종료 신호를 다시 검사하면 불필요한 시작을 줄일 수 있다. 그러나 검사 직후 취소될 수 있으므로 즉시 종료를 보장하는 방법은 아니다. 실행 중 작업에도 컨텍스트를 전달하고, 호출자가 실제 종료를 기다릴 수 있어야 한다.

## 다시 확인할 경계

[파서의 취소와 자원 소유권](/posts/parser-cancellation-resource-ownership/)에서는 취소 신호를 보낸 뒤에도 실제 작업이 자원을 사용했다. 언어가 달라도 확인할 질문은 같다. **종료를 요청했는가, 실제로 끝났는가, 누가 그것을 확인하는가?**

수정 검증에서는 채널 종료 후 CPU 프로파일에서 해당 루프가 사라지는지 확인하고, 반복 요청 뒤 고루틴 수가 안정되는지 별도로 본다. 이 예제의 출력은 채널 의미를 확인하는 증거이며 운영 환경의 성능 측정값은 아니다.
