---
title: 고루틴과 GOMAXPROCS 이해하기 — Go 1.24.5 기준
categories: [golang, goroutine]
tags: [golang, goroutine, concurrency] # TAG names should alw   ays be lowercase
description: Go 1.24.5의 고루틴과 GOMAXPROCS 기본값, 컨테이너 CPU 제한, 작업 수명과 자원 사용을 구분한다.
---

고루틴을 늘리면 서버의 처리량도 늘어날까. 네트워크를 기다리는 작업과 CPU를 계속 쓰는 작업은 답이 다르다. 고루틴은 누가 실행하고, 무엇을 기다리며, 언제 끝나는지부터 정리해 보자.

> 2026-09-29 보완: 이 글의 런타임 설명은 **Go 1.24.5** 기준이다.

## 고루틴은 런타임이 관리하는 실행 흐름이다

`go f()`는 함수 `f`를 새 고루틴에서 실행한다. Go 런타임은 여러 고루틴을 OS 스레드에 배치한다. 고루틴 하나를 만들 때마다 OS 스레드 하나가 생기는 구조는 아니다.

고루틴의 스택은 작게 시작해 필요에 따라 커진다. 따라서 “고루틴은 항상 2KB, 스레드는 항상 1MB”처럼 고정 비용으로 비교하면 실제 메모리 사용량을 놓친다. 스택 외에도 각 작업이 잡고 있는 버퍼와 객체가 있기 때문이다. [Effective Go](https://go.dev/doc/effective_go#goroutines)

`main`도 고루틴에서 실행된다. `main`이 반환하면 다른 고루틴이 끝날 때까지 자동으로 기다려 주지 않는다. 종료를 기다려야 하는 작업에는 `sync.WaitGroup`처럼 완료를 합류시키는 장치가 필요하다.

## 동시성과 병렬성은 다른 질문이다

| 개념 | 묻는 것 | 예 |
| --- | --- | --- |
| 동시성 | 여러 작업을 어떻게 함께 진행할까? | 한 요청이 네트워크를 기다리는 동안 다른 요청 처리 |
| 병렬성 | 여러 계산이 실제로 동시에 실행되는가? | 여러 CPU에서 서로 다른 계산 실행 |

동시성은 싱글 코어에만 해당하는 개념이 아니다. 병렬 실행이 가능한 서버에서도 작업 간 통신, 대기, 종료를 조직하는 문제가 남는다.

## Go 1.24.5의 GOMAXPROCS

`GOMAXPROCS`는 사용자 Go 코드를 동시에 실행할 수 있는 OS 스레드 수의 상한을 정한다. 고루틴 총수나 프로세스의 전체 OS 스레드 수를 제한하는 값은 아니다. 시스템 호출 때문에 대기하는 스레드 등은 별도로 존재할 수 있다.

Go 1.24.5에서 별도 설정이 없다면 기본값은 `runtime.NumCPU()`다. 이 함수는 프로세스 시작 시 운영체제에서 확인한 **사용 가능한 논리 CPU 수**를 반환한다. 물리 코어 수와 같다고 단정하면 안 된다. 환경 변수 `GOMAXPROCS`나 코드의 설정도 확인해야 한다. [Go 1.24.5 runtime 소스](https://github.com/golang/go/blob/go1.24.5/src/runtime/debug.go), [환경 변수 설명](https://github.com/golang/go/blob/go1.24.5/src/runtime/extern.go)

컨테이너에서는 CPU affinity로 보이는 CPU 수와 cgroup의 CPU quota가 다를 수 있다. **Go 1.24.5의 기본 런타임은 CPU quota를 읽어 GOMAXPROCS를 자동 조정하지 않는다.** Linux 컨테이너 quota를 고려하는 기본 동작은 Go 1.25에서 추가됐다. 별도 라이브러리나 환경 설정이 있다면 그 효과는 런타임 기본값과 구분해야 한다. [Go 1.25 변경 사항](https://go.dev/doc/go1.25#runtime)

그래서 `runtime.GOMAXPROCS(runtime.NumCPU())`를 무조건 추가할 이유는 없다. 오히려 운영 환경에서 정한 값을 덮어쓸 수 있다. 실행 중인 값, Pod의 CPU 제한, CPU throttling과 지연 시간을 함께 확인한 뒤 조정해야 한다.

## 고루틴 수보다 작업이 붙잡는 자원을 본다

고루틴이 가볍다고 작업도 가벼운 것은 아니다. 업로드 하나가 큰 버퍼를 할당한다면 고루틴을 더 만드는 만큼 메모리 사용량도 늘어난다. [MinIO 업로드 버퍼 분석](/posts/upload-memory-admission-before-body/)에서는 동시성 제한과 요청별 할당량을 함께 살펴본다.

종료도 명시적으로 설계해야 한다. `context` 취소는 종료 요청이다. 대상 코드가 이를 확인하고 빠져나와야 작업이 끝난다. [닫힌 채널로 CPU를 소모한 사례](/posts/cpu-100-percent-goroutine-leak-fix/)와 [파서 작업의 종료와 자원 수명](/posts/parser-cancellation-resource-ownership/)가 이 차이를 보여 준다.

새 고루틴을 추가할 때는 세 가지를 확인한다. 시작할 수 있는 작업 수에 상한이 있는지, 기다리는 연산이 취소에 반응하는지, 종료를 누가 기다리는지다. 이 질문에 답할 수 있어야 동시성이 늘어도 자원 사용과 종료를 예측할 수 있다.
