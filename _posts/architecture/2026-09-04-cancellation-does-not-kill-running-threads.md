---
title: "취소는 스레드를 죽이지 않는다: Python, Rust, Kotlin의 실행 중단 경계"
description: asyncio.to_thread, Tokio spawn_blocking, Kotlin coroutine과 MCP 요청을 취소할 때 실제로 멈추는 것과 계속 실행되는 것을 구분한다.
categories: [architecture, concurrency]
tags: [cancellation, asyncio, rust, tokio, kotlin, coroutine, mcp, concurrency]
date: 2026-09-04
mermaid: true
---

`task.cancel()`은 성공했다. 호출자는 곧바로 `CancelledError`를 받았다. 그런데 별도 스레드에서 시작한 작업은 잠시 뒤 정상적으로 끝났다.

```python
import asyncio
import threading
import time

finished = threading.Event()


def blocking_work():
    time.sleep(0.25)
    finished.set()


async def main():
    task = asyncio.create_task(asyncio.to_thread(blocking_work))
    await asyncio.sleep(0.05)

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("awaiting_task=cancelled")

    print(f"thread_finished_immediately={finished.is_set()}")
    await asyncio.sleep(0.30)
    print(f"thread_finished_later={finished.is_set()}")


asyncio.run(main())
```

실행 결과는 다음과 같았다.

```text
awaiting_task=cancelled
thread_finished_immediately=False
thread_finished_later=True
```

취소된 것은 무엇이고, 계속 실행된 것은 무엇일까? 이 차이를 놓치면 에이전트나 스케줄러에서 사용자가 실행을 취소했는데도 외부 API 호출이 계속되고, 정상 취소가 도구 장애로 기록되거나, 자동 재시도로 같은 작업이 다시 수행될 수 있다.

## 취소는 실행 단위마다 의미가 다르다

취소를 하나의 동작으로 보면 혼란스럽다. 실제로는 다음 세 가지가 따로 움직인다.

```mermaid
flowchart LR
    A[호출자] -->|취소 요청| B[Task 또는 Future]
    B -->|결과 대기 중단| A
    B -.취소 전달.-> C[실행 중인 작업]
    C -->|지원하는 경우만 중단| D[하위 I/O 또는 원격 서버]
```

1. 호출자가 결과를 기다리는 일을 중단한다.
2. 런타임이 실행 중인 작업에 취소 신호를 전달한다.
3. 실제 작업과 하위 시스템이 신호를 이해하고 안전한 지점에서 멈춘다.

첫 번째 단계가 끝났다고 세 번째 단계까지 끝났다고 볼 수 없다. 이 원칙은 Python만의 제약이 아니다. Rust와 Kotlin도 async 작업과 blocking 작업의 경계에서 같은 차이를 가진다.

## Python: `to_thread()`는 스레드 종료 API가 아니다

Python의 [`asyncio.to_thread()`](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)는 blocking 함수를 별도 스레드에서 실행하고 그 결과를 기다릴 수 있게 한다. 개념적으로 핵심은 다음 한 줄이다.

```python
return await loop.run_in_executor(None, func_call)
```

호출자가 취소되면 `await`는 중단된다. 그러나 executor에 제출된 함수가 이미 실행 중이라면 상황이 다르다. [`concurrent.futures.Future.cancel()`](https://docs.python.org/3/library/concurrent.futures.html#concurrent.futures.Future.cancel)은 작업이 실행 중이거나 완료됐다면 `False`를 반환한다.

```text
대기열에 있음 → 시작을 취소할 수 있음
이미 RUNNING  → 스레드는 계속 실행됨
```

Python이 임의의 스레드에 예외를 주입해 죽이지 않는 데는 이유가 있다. 스레드가 lock을 획득한 직후이거나, 파일을 쓰는 중이거나, 트랜잭션의 절반을 처리한 시점일 수 있다. 그 위치에서 갑자기 사라지면 공유 상태와 자원 정리를 보장할 수 없다.

따라서 다음과 같은 blocking 요청은 바깥 task만 취소해서는 멈추지 않는다.

```python
def upload_file():
    return requests.post(url, files=files, timeout=300)


await asyncio.to_thread(upload_file)
```

호출자는 취소됐지만 `requests.post()`는 응답을 받거나 300초 timeout이 발생할 때까지 실행될 수 있다. 이미 서버가 업로드를 commit했다면 그 결과도 취소로 되돌아가지 않는다.

## Rust: async task는 중단할 수 있지만 `spawn_blocking`은 다르다

Rust 표준 라이브러리의 [`std::thread::JoinHandle`](https://doc.rust-lang.org/std/thread/struct.JoinHandle.html)은 thread를 기다리는 `join()`을 제공한다. 반대로 thread를 강제로 죽이는 안전한 표준 API는 없다. `JoinHandle`을 drop하면 thread가 종료되는 것이 아니라 detach되어 계속 실행된다.

Tokio의 async task는 조금 다르다. [`JoinHandle::abort()`](https://docs.rs/tokio/latest/tokio/task/struct.JoinHandle.html#method.abort)를 호출하면 task가 다음 `.await`에서 runtime에 제어권을 돌려줄 때 취소된다. task 내부의 값은 destructor를 거쳐 정리된다.

```rust
let handle = tokio::spawn(async {
    long_async_operation().await;
});

handle.abort();
let result = handle.await;
assert!(result.unwrap_err().is_cancelled());
```

하지만 async 코드가 제어권을 돌려주지 않는 긴 계산을 수행하면 취소도 그동안 처리되지 않는다.

Python의 `to_thread()`와 대응되는 Tokio API는 [`spawn_blocking()`](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)이다. 공식 문서도 이미 시작된 blocking task에는 `abort()`가 효과가 없다고 명시한다.

```rust
let handle = tokio::task::spawn_blocking(|| {
    blocking_http_call()
});

handle.abort(); // 이미 실행 중이면 작업은 계속된다.
```

Rust로 다시 작성하면 메모리 안전성과 타입 모델의 이점은 얻을 수 있다. 그러나 blocking 작업을 외부에서 즉시 죽이는 문제 자체가 사라지지는 않는다.

## Kotlin: coroutine 취소와 thread interrupt는 별개다

Kotlin coroutine의 `Job.cancel()`도 협력적 취소다. suspending 함수가 취소를 확인하거나 코드가 `isActive`, `ensureActive()`, `yield()` 같은 지점에서 상태를 확인해야 한다.

다음 코드는 timeout이 발생해도 `Thread.sleep()`이 끝날 때까지 thread를 계속 막을 수 있다.

```kotlin
withTimeout(500) {
    Thread.sleep(10_000)
}
```

Kotlin 공식 [`withTimeout`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html) 문서도 cancellation은 cooperative하며, blocking JVM 코드는 자동으로 모두 멈추지 않는다고 설명한다.

Kotlin/JVM에는 한 단계 더 나아간 [`runInterruptible()`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-interruptible.html)이 있다.

```kotlin
withTimeout(500) {
    runInterruptible(Dispatchers.IO) {
        blockingQueue.take()
    }
}
```

coroutine이 취소되면 실행 중인 Java thread에 `Thread.interrupt()`를 전달한다. `BlockingQueue.take()`처럼 interrupt를 지원하는 API는 `InterruptedException`을 내고 멈출 수 있다.

하지만 `runInterruptible()`도 강제 thread kill은 아니다. 호출한 라이브러리가 interrupt를 무시하거나 interrupt로 깨울 수 없는 native I/O에 들어가 있으면 즉시 종료되지 않는다. Kotlin/Native에는 JVM과 같은 thread interrupt도 없다.

## 언어를 바꾸면 해결되는가

주요 런타임은 대부분 임의의 in-process thread를 강제로 죽이는 기능을 제공하지 않거나 위험하다고 본다.

| 환경 | 일반적인 취소 방식 | 이미 실행 중인 blocking 작업 |
| --- | --- | --- |
| Python `asyncio` | `Task.cancel()` | `to_thread()` 작업은 계속될 수 있음 |
| Rust Tokio | `JoinHandle::abort()` | `spawn_blocking()`은 시작 후 abort 불가 |
| Kotlin coroutine | `Job.cancel()` | 협력적 확인 필요 |
| Kotlin/JVM | `runInterruptible()` | 대상 API가 interrupt를 지원할 때만 중단 |
| Java | `Thread.interrupt()` | interrupt를 확인하거나 지원해야 함 |
| Go | `context.Context` | goroutine이 `Done()`을 확인해야 함 |
| 현대 .NET | `CancellationToken` | 작업이 token을 확인해야 함 |
| Node.js Worker | `worker.terminate()` | 실행 중간에 종료 가능, 일관성 주의 |
| 별도 process/container | 종료 신호 | 강제 종료 가능, 외부 side effect는 유지 |

Java의 `Thread.stop()`은 공유 객체가 불완전한 상태로 노출될 수 있어 제거 방향이고, 현대 .NET의 `Thread.Abort()`도 지원되지 않는다. Go의 `CancelFunc` 역시 작업을 중단하라는 신호일 뿐 작업 종료를 기다리거나 goroutine을 강제 종료하지 않는다.

Node.js Worker처럼 runtime이 별도로 관리하는 worker는 terminate할 수 있다. 그러나 실행이 어느 지점에서 멈출지 알 수 없다는 문제와 외부 시스템에 이미 반영된 결과는 그대로 남는다.

결국 선택 기준은 언어가 아니라 격리 수준이다.

```text
cooperative cancellation이 충분하다
    → coroutine/task + cancellation token

blocking 작업이 취소 신호를 지원한다
    → token/event/interrupt + 짧은 I/O timeout

신뢰할 수 없는 작업을 반드시 강제 종료해야 한다
    → 별도 process 또는 container
```

## MCP 취소도 “중단 요청”이지 rollback이 아니다

에이전트가 원격 MCP 도구를 실행하고 있다면 한 단계가 더 생긴다. 로컬 task 취소가 원격 MCP 서버의 작업 종료까지 자동으로 보장하지 않는다.

MCP의 [`notifications/cancelled`](https://modelcontextprotocol.io/specification/2024-11-05/basic/utilities/cancellation)는 진행 중인 request ID와 선택적인 이유를 전송한다. 수신자는 가능하면 처리를 멈추고 자원을 해제해야 하지만, 이미 완료됐거나 취소할 수 없는 요청은 알림을 무시할 수 있다. 취소 뒤 늦게 도착한 응답은 송신자가 무시해야 한다.

장기 작업을 위한 MCP Tasks의 [`tasks/cancel`](https://modelcontextprotocol.io/extensions/tasks/overview)도 cooperative하고 eventually consistent하다. 서버는 취소 의도를 확인하지만 실제 작업이 반드시 멈추거나 반드시 `cancelled` 상태가 된다고 보장하지 않는다.

따라서 에이전트 실행 취소는 다음 의미로 정의하는 편이 안전하다.

> 취소 이후에는 새 작업을 시작하지 않고, 늦게 도착한 결과를 채택하지 않으며, 취소된 실행을 자동 재시도하지 않는다.

이 정의에는 이미 commit된 외부 작업의 rollback이 포함되지 않는다.

## 취소를 실패로 기록하지 않는다

구현에서 자주 생기는 버그는 cancellation 예외를 일반 예외로 바꾸는 것이다.

```python
try:
    await connect_to_tool_server()
except asyncio.CancelledError:
    raise RuntimeError("tool server timeout")  # 잘못된 분류
```

이렇게 하면 사용자가 취소한 실행이 도구 장애로 기록된다. 상위 스케줄러는 실패 정책에 따라 알림을 보내거나 실행을 재시도할 수 있다.

취소는 실행 경계를 통과하는 동안 취소로 유지해야 한다.

```python
try:
    await connect_to_tool_server()
except asyncio.CancelledError:
    raise
```

최상위 실행 경계에서만 취소를 terminal outcome으로 변환한다. 취소 의도가 먼저 확정됐다면 그 뒤에 도착한 도구 오류나 늦은 성공보다 취소가 우선한다.

```text
cancel intent 저장
    → task와 원격 요청에 취소 전달
    → 새 tool call 차단
    → 늦은 결과 폐기
    → 실행 상태를 cancelled로 종료
    → 실행이 소유한 자원 정리
```

연결 cleanup은 취소에 같이 휩쓸리지 않도록 제한된 시간 동안 보호해야 한다. 반대로 cleanup이 실패했다고 취소된 실행을 `failed`로 뒤집어서는 안 된다. cleanup 실패는 별도의 warning과 metric으로 남기는 것이 낫다.

## 외부 side effect는 취소가 아니라 별도 설계로 다룬다

이메일 전송, 결제, 파일 업로드, 배포 요청처럼 외부 상태를 바꾸는 도구가 있다고 하자.

```text
클라이언트: 취소 요청 전송
서버: 이미 이메일 발송 완료
클라이언트: 응답을 받기 전에 task 취소
```

이 상황에서 로컬 상태는 `cancelled`일 수 있지만 이메일은 이미 발송됐다. 이를 `failed`로 기록하는 것도, rollback됐다고 표시하는 것도 사실과 다르다.

외부 side effect에는 취소와 별도로 다음 장치가 필요하다.

- 동일 실행의 중복 요청을 막는 idempotency key
- commit 전후를 구분하는 원격 operation ID
- 실제 지원되는 경우에만 제공하는 cancel API
- 취소가 불가능한 작업의 compensation 절차
- “일부 외부 작업이 완료됐을 수 있음”을 표시하는 UI

모든 도구를 처음부터 별도 process로 감싸는 것은 과하다. 먼저 cancellation-aware async API, bounded timeout, 늦은 결과 폐기, 재시도 차단을 적용한다. 실제로 중단 비용이 큰 blocking 도구만 process나 container 경계로 옮기면 된다.

## 최소 검증 체크리스트

취소 기능은 정상 실행 테스트만으로 검증할 수 없다. 최소한 다음 시점을 각각 만들어야 한다.

1. 대기열에 있을 때 취소하면 작업이 시작되지 않는가?
2. async I/O 중 취소하면 하위 cancellation이 전파되는가?
3. blocking thread 중 취소하면 호출자는 종료되고 늦은 결과는 폐기되는가?
4. 취소와 성공이 동시에 도착하면 정한 우선순위가 유지되는가?
5. 취소가 실패 알림이나 자동 재시도를 만들지 않는가?
6. MCP 연결과 session cleanup이 한 번만 수행되는가?
7. 이미 완료된 외부 side effect를 rollback 완료로 잘못 표시하지 않는가?

마지막으로 다음 상황을 예측해 보면 취소 모델이 제대로 잡혔는지 알 수 있다.

> blocking HTTP 업로드가 이미 시작된 뒤 coroutine을 취소하면 무엇이 멈추는가?

호출자의 대기와 이후 에이전트 진행은 멈출 수 있다. 하지만 업로드 thread와 원격 서버 작업은 계속될 수 있다. 즉시 중단이 제품 요구라면 async cancellation을 지원하는 client와 server 계약을 사용하거나, 해당 작업을 강제 종료 가능한 process/container 경계에 격리해야 한다.

## 참고

- [Python asyncio.to_thread](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)
- [Python concurrent.futures.Future.cancel](https://docs.python.org/3/library/concurrent.futures.html#concurrent.futures.Future.cancel)
- [Rust std::thread::JoinHandle](https://doc.rust-lang.org/std/thread/struct.JoinHandle.html)
- [Tokio task cancellation](https://docs.rs/tokio/latest/tokio/task/#cancellation)
- [Tokio spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
- [Kotlin cancellation and timeout](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html)
- [Kotlin runInterruptible](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-interruptible.html)
- [Java Thread](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
- [.NET Thread.Abort obsoletion](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/5.0/thread-abort-obsolete)
- [Go context](https://pkg.go.dev/context)
- [Node.js Worker threads](https://nodejs.org/api/worker_threads.html)
- [MCP cancellation](https://modelcontextprotocol.io/specification/2024-11-05/basic/utilities/cancellation)
- [MCP Tasks](https://modelcontextprotocol.io/extensions/tasks/overview)
