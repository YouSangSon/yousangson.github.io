---
title: "취소된 작업의 임시파일은 언제 지워도 되는가"
description: "호출자의 취소와 실제 스레드 종료를 나누고, 임시파일과 처리 슬롯의 수명을 작은 Python 예제로 확인한다."
categories: [architecture, optimization]
tags: [asyncio, cancellation, resource-lifetime, subprocess]
date: 2026-09-29
---

가상의 문서 변환기에서 요청이 취소되자 `finally`에서 임시 디렉터리를 지운다고 하자. 요청은 끝났고 처리 슬롯도 반환됐지만, 별도 스레드에서 실행 중이던 변환 함수는 그제야 입력 파일을 열려고 한다. 이때 파일 읽기가 실패한다면, 원인은 파일 자체보다 **요청의 종료와 파일 사용자의 종료를 같은 사건으로 취급한 것**에 있다.

[앞선 취소 글](/posts/cancellation-does-not-kill-running-threads/)에서는 `task.cancel()` 뒤에도 blocking 스레드가 계속 실행될 수 있음을 보았다. 이어서 임시파일과 동시 처리 슬롯을 누가 맡고 언제 해제해야 하는지 작은 Python 예제로 확인해 보자.

## 취소가 끊는 연결부터 구분한다

요청 하나를 세 부분으로 나눠 보자. `asyncio.Task`는 결과를 기다리고, executor의 스레드는 blocking 함수를 실행하며, 임시 디렉터리와 세마포어 슬롯은 그 함수가 끝날 때까지 필요하다. 요청의 `Task`에 취소를 보내면 다음 `await` 지점에서 `CancelledError`가 발생할 수 있다. 이것은 스레드에 대한 종료 확인이 아니다. Python 문서도 Task 취소를 코루틴의 다음 기회에 예외를 일으키는 방식으로 설명한다. [`asyncio` Task 취소](https://docs.python.org/3.11/library/asyncio-task.html#task-cancellation)

`loop.run_in_executor()`는 함수를 executor에 제출하고 `asyncio.Future`를 돌려준다. 이미 실행 중인 callable에 대해 `concurrent.futures.Future.cancel()`은 취소에 실패한다. 따라서 `await`가 취소됐다는 사실에서 함수의 실행 종료를 추론할 수 없다. [`run_in_executor`](https://docs.python.org/3.11/library/asyncio-eventloop.html#asyncio.loop.run_in_executor), [`Future.cancel()`](https://docs.python.org/3.11/library/concurrent.futures.html#concurrent.futures.Future.cancel)

문제의 순서를 시간 순으로 쓰면 다음과 같다.

```text
T0  요청이 슬롯을 얻고 임시파일을 만든다.
T1  스레드가 시작해 파일 경로를 받지만, 아직 파일을 읽지 않는다.
T2  호출자가 Task를 취소한다.
T3  Task의 finally가 파일을 지우고 슬롯을 돌려준다.
T4  다음 요청이 빈 슬롯을 얻는다. 첫 스레드는 여전히 실행 중이다.
T5  첫 스레드가 파일을 읽으려다 실패한다.
```

`finally`는 제어 흐름을 떠나는 코루틴의 정리를 보장하는 데 유용하다. 하지만 그 코루틴이 다른 실행 단위에 넘긴 자원의 사용 종료까지 증명하지는 않는다. `TemporaryDirectory`는 context를 벗어날 때 내용을 지우고, `async with Semaphore`는 블록을 벗어날 때 슬롯을 반환한다. 두 context manager 모두 자신이 감싼 **코루틴의 수명**에 맞춰 움직인다. [`TemporaryDirectory`](https://docs.python.org/3.11/library/tempfile.html#tempfile.TemporaryDirectory), [`asyncio.Semaphore`](https://docs.python.org/3.11/library/asyncio-sync.html#semaphore)

슬롯 반환도 단순한 숫자 문제가 아니다. 제한이 1인데 취소된 첫 작업이 계속 돌고 있을 때 슬롯을 반환하면 두 번째 작업이 진입할 수 있다. 그 순간 세마포어가 나타내는 점유 수와 실제로 실행 중인 변환 수가 달라진다. `Semaphore.locked()`는 지금 즉시 획득할 수 있는지만 알려 준다. 운영 중인 worker 수를 직접 측정하는 API는 아니다. 아래에서는 첫 worker의 시작과 정지를 별도로 통제하므로 두 상태를 함께 해석할 수 있다. [`Semaphore.locked()`](https://docs.python.org/3.11/library/asyncio-sync.html#asyncio.Semaphore.locked)

같은 요청 안에서도 자원마다 마지막 사용자가 다를 수 있다. worker가 입력을 메모리에 모두 읽었다는 확인을 준다면 입력 파일은 그때 지울 여지가 있다. 그러나 실행 슬롯이 제한하려는 대상이 worker 전체라면 파일을 더 읽지 않더라도 종료까지 슬롯을 보유해야 한다. 반대로 worker가 파일 경로만 받았다는 사실은 읽기가 끝났다는 확인이 아니다. 이 글의 예제는 별도의 '입력 사용 완료' 신호를 만들지 않았으므로, **worker 전체 완료**를 두 자원의 공통 해제 기준으로 삼는다. 더 세밀한 최적화는 실제로 그 신호를 제공할 때만 가능하다.

두 경로의 차이는 자원을 누가 언제까지 보유하는가에 있다.

| 시점 | 호출자와 함께 정리하는 경로 | worker 종료까지 보유하는 경로 |
| --- | --- | --- |
| 스레드가 파일을 읽기 직전에 대기 | 파일과 슬롯을 보유 | 파일과 슬롯을 보유 |
| 호출자에게 취소가 들어옴 | `await`를 빠져나와 파일 삭제·슬롯 반환 | `shield`로 worker의 future를 유지하고 완료 대기 |
| 스레드의 대기를 해제함 | 이미 삭제된 파일을 읽으려 함 | 파일을 읽은 뒤 소유 Task가 정리 |

아래 예제는 이 순서를 이벤트로 고정한다. `owner()` 안에 파일·슬롯·future를 함께 둔 이유는 정리 순서를 코드의 중첩 범위로 확인하기 위해서다.

## 취소 시점을 고정해 두 경로를 비교한다

아래 파일을 `cancellation_demo.py`로 저장하고 `python3 cancellation_demo.py`로 실행할 수 있다. 예제는 표준 라이브러리만 사용한다. `threading.Event`가 worker를 파일 읽기 직전에 붙잡고, `asyncio.Event`가 시작 및 취소 관측 시점을 알려 준다. `sleep()` 길이나 운 좋은 스케줄 순서에 기대지 않는다. 스레드에서 asyncio 이벤트를 깨울 때는 event loop의 thread-safe 호출을 사용한다. [`call_soon_threadsafe`](https://docs.python.org/3.11/library/asyncio-eventloop.html#asyncio.loop.call_soon_threadsafe)

```python
import asyncio
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory


async def run_case(keep_until_worker_done):
    loop = asyncio.get_running_loop()
    slot = asyncio.Semaphore(1)
    started = asyncio.Event()
    cancel_seen = asyncio.Event()
    release = threading.Event()
    observed = queue.Queue()

    def work(path):
        loop.call_soon_threadsafe(started.set)
        release.wait()
        observed.put(path.read_text() if path.exists() else "MISSING")

    async def owner():
        async with slot:
            with TemporaryDirectory() as directory:
                path = Path(directory) / "input.txt"
                path.write_text("ready")
                future = loop.run_in_executor(pool, work, path)
                try:
                    if keep_until_worker_done:
                        await asyncio.shield(future)
                    else:
                        await future
                except asyncio.CancelledError:
                    cancel_seen.set()
                    if keep_until_worker_done:
                        await asyncio.shield(future)
                    raise

    with ThreadPoolExecutor(max_workers=1) as pool:
        task = asyncio.create_task(owner())
        try:
            await started.wait()
            task.cancel()
            await cancel_seen.wait()
            if keep_until_worker_done:
                assert slot.locked() and not task.done()
                print("held: slot=busy, owner=running")
                release.set()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                assert not slot.locked()
            else:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                assert not slot.locked()
                async with slot:
                    print("early: next request admitted before worker exits")
                release.set()
        finally:
            release.set()
    result = observed.get_nowait()
    print(f"worker read: {result}")
    assert result == ("ready" if keep_until_worker_done else "MISSING")


async def main():
    await run_case(False)
    await run_case(True)


asyncio.run(main())
```

실행 결과는 다음과 같다.

```text
early: next request admitted before worker exits
worker read: MISSING
held: slot=busy, owner=running
worker read: ready
```

첫 경우에서 `await future`는 취소되고 `owner()`가 두 context를 빠져나간다. 첫 worker는 `release`가 열리기 전이라 아직 파일을 읽지 않았다. 그 사이 `async with slot`에 들어갈 수 있다는 것은 **다음 요청의 진입 허용**을 보여 준다. 이어 첫 worker가 재개됐을 때는 임시파일이 이미 없다. 재현 코드가 실제 변환 라이브러리의 오류를 만들지는 않는다. 파일이 없는 시점과 슬롯이 열린 시점을 결정적으로 만드는 반례다.

둘째 경우에는 `asyncio.shield(future)`가 내부 future를 첫 취소 전파에서 보호한다. 보호받는 future와 달리 `owner()`의 `await`는 여전히 `CancelledError`를 받는다. 그래서 예제는 취소를 관측한 뒤 **같은 future의 완료를 다시 기다리고**, 그다음 취소를 다시 던진다. `release`가 열리기 전의 `owner()`는 아직 살아 있고 슬롯도 점유 중이다. worker가 파일을 읽고 끝난 다음에야 디렉터리와 슬롯이 정리된다. `shield()` 자체는 worker를 중지하거나 정리를 예약하지 않는다. 소유자가 완료를 기다리는 코드가 있기 때문에 이 순서가 성립한다. [`asyncio.shield`](https://docs.python.org/3.11/library/asyncio-task.html#shielding-from-cancellation)

여기에는 제품 결정도 하나 숨어 있다. 안전한 둘째 경우의 `owner()`는 취소를 즉시 상위 호출자에게 완료로 돌려주지 않는다. 파일의 소유권을 유지하려고 worker 종료를 기다리기 때문이다. 호출자에게 즉시 응답해야 한다면 종료를 추적할 다른 소유자가 필요하다. 예를 들어 별도 supervisor가 future, 임시 디렉터리, 슬롯을 함께 보유하고 요청 Task는 supervisor에 취소 의도만 전달할 수 있다. 그때도 supervisor가 언제 자원을 반환하는지, 종료 실패를 누가 관측하는지 정해야 한다. 호출자가 사라졌다는 이유만으로 소유권이 저절로 이동하지는 않는다.

그 handoff에는 두 가지 확인이 필요하다. 먼저 요청 Task가 끝나기 전에 supervisor가 작업 식별자와 future를 받아 **정리 책임을 인수**해야 한다. 다음으로 supervisor가 worker의 완료 또는 실패를 관측한 뒤 자원을 한 번만 반환해야 한다. 단순히 `create_task()`로 정리 코루틴을 하나 띄우고 참조를 버리면 이 계약을 표현하지 못한다. Python 문서도 background task를 유지하려면 강한 참조를 보관하라고 안내한다. [`asyncio.create_task()`](https://docs.python.org/3.11/library/asyncio-task.html#asyncio.create_task)

따라서 '취소 요청을 받았다'는 상태와 '작업이 끝났다'는 상태는 별도로 기록하는 편이 정확하다. 즉시 응답 정책을 택할 수는 있지만, 그 순간에도 임시파일과 처리 슬롯은 살아 있는 worker 쪽에 남는다. 늦은 결과를 버리는 결정과 자원을 일찍 해제하는 결정은 서로 다른 문제다.

## 두 번째 취소와 worker 오류는 별도 처리가 필요하다

`observed`는 `ThreadPoolExecutor`의 context를 빠져나간 다음 읽으므로 worker가 끝난 뒤의 결과다. 반면 수정 경로에서 최종 파일 부재를 별도 assert로 확인하지는 않는다. 삭제 시점은 `owner()`의 context 흐름과 `TemporaryDirectory`의 계약으로 설명한다. [`Executor.shutdown`](https://docs.python.org/3.11/library/concurrent.futures.html#concurrent.futures.Executor.shutdown), [`TemporaryDirectory`](https://docs.python.org/3.11/library/tempfile.html#tempfile.TemporaryDirectory)

이 검사는 **첫 취소 한 번, worker 정상 종료, 단일 파일과 단일 슬롯**에서의 순서를 확인한다. 스레드가 영원히 막히거나 예외를 던지면 소유 Task도 기다리거나 다른 오류를 받을 수 있다. 두 번째 취소가 기다리는 Task에 들어오면 예제의 재대기마저 끊길 수 있다. 이 코드를 일반적인 취소 처리 함수로 복사해서는 안 된다. 실제 실행기에는 worker의 I/O timeout 또는 협력적 중단, 반복 취소에 대한 소유권 규칙, 오류 수집, shutdown 시점의 정리 정책이 필요하다. `asyncio.wait_for()`만 덧씌워도 중단된 것은 기다림일 수 있으므로, timeout 직후 파일 삭제가 안전하다는 증거가 되지 않는다. [`asyncio.wait_for`](https://docs.python.org/3.11/library/asyncio-task.html#asyncio.wait_for)

특히 예제의 `except CancelledError` 안에서 기다리던 worker가 예외를 내면 그 예외가 원래 취소보다 먼저 밖으로 나올 수 있다. 어느 결과를 호출자에게 보여 줄지, worker 오류를 어디에 남길지는 제품의 결과 계약에 달려 있다. 다만 어떤 결과를 택하든 정리 시점은 여전히 worker의 완료를 따라야 한다. 오류를 취소로 분류하는 일과 파일을 지우는 일은 같은 결정이 아니다.

또 하나의 한계는 worker가 이미 바깥 상태를 바꾼 경우다. 입력 파일의 수명을 맞춰도 원격 쓰기나 출력 파일의 원자적 게시가 자동으로 해결되지는 않는다. 늦은 성공을 결과로 채택할지, 같은 요청을 재시도할지, 부분 산출물을 누가 정리할지는 별도 계약이다. 이 예제는 그런 서비스 상태를 재현하거나 검증하지 않는다.

## 한 작업의 실패가 공용 자원의 해제 시점은 아니다

변환 파일 여러 개가 같은 임시 디렉터리를 쓴다고 하자. `asyncio.gather()`의 기본 동작에서는 한 awaitable의 첫 예외가 호출자에게 즉시 전달되더라도 다른 awaitable들은 자동 취소되지 않고 계속 실행된다. 따라서 첫 오류를 잡은 자리에서 공용 디렉터리를 지우면 다른 변환이 입력을 읽는 중일 수 있다. [`asyncio.gather`](https://docs.python.org/3.11/library/asyncio-task.html#running-tasks-concurrently)

반대로 `gather()` 자체를 취소하면 제출된 미완료 awaitable들에는 취소가 전달된다. 그래도 그 안에서 이미 시작한 blocking callable의 종료까지 보장되는 것은 아니다. '형제 awaitable을 취소했다'와 '형제 worker가 끝났다' 사이에도 앞의 두 실행 단위가 그대로 있다. [`asyncio.gather` 취소 동작](https://docs.python.org/3.11/library/asyncio-task.html#running-tasks-concurrently), [`Future.cancel()`](https://docs.python.org/3.11/library/concurrent.futures.html#concurrent.futures.Future.cancel)

`TaskGroup`은 관련 코루틴의 수명을 묶는 데 도움이 된다. 그러나 코루틴이 내부에서 executor 작업을 시작하고 실제 종료를 기다리지 않았다면, 코루틴들의 종료만으로 blocking worker의 종료를 증명할 수 없다. 여기서도 질문은 같다. **정리하려는 자원을 마지막으로 쓰는 실행 단위가 무엇인가?** 공용 디렉터리라면 모든 사용자, 슬롯이라면 제한하려는 실제 작업이 끝났는지를 각각 확인해야 한다. 두 자원이 항상 같은 시점에 끝난다는 가정도 검토해야 한다.

## 중단 자체가 요구라면 경계를 바꾼다

스레드 작업을 빨리 멈출 수 있는 API가 있고 worker가 이를 확인한다면, 협력적 취소와 짧은 I/O timeout을 먼저 사용할 수 있다. 그런 계약이 없는 외부 변환기를 반드시 끊어야 한다면 별도 프로세스가 다른 선택지다. Python의 `Popen.terminate()`와 `kill()`은 자식 프로세스에 종료 수단을 제공한다. 다만 신호를 보냈다는 사실만으로 자식의 종료를 확인한 것은 아니다. `wait()`로 종료를 확인하고, stdout/stderr를 pipe로 받는다면 pipe가 찰 때의 교착을 피하도록 `communicate()`로 출력과 종료를 함께 처리해야 한다. [`Popen` 종료·대기](https://docs.python.org/3.11/library/subprocess.html#popen-objects)

대표 자식이 또 다른 프로세스를 만든다면 대표 하나만 종료해도 나머지가 파일을 쓰고 있을 수 있다. POSIX에서는 `start_new_session=True`로 새 세션을 시작하고 `os.killpg()`로 그룹에 신호를 보내는 방법이 있다. 이것은 **그룹에 속한** 프로세스에 대한 수단이지, 임의로 생성된 모든 후손의 종료를 증명하는 만능 해법은 아니다. 프로세스가 그룹을 벗어나는지, 플랫폼에서 어떤 종료 수단을 지원하는지, 종료 확인에 실패했을 때 입력과 출력물을 어떻게 격리할지 함께 설계해야 한다. [`start_new_session`](https://docs.python.org/3.11/library/subprocess.html#subprocess.Popen), [`os.killpg`](https://docs.python.org/3.11/library/os.html#os.killpg)

프로세스를 강제로 끝내면 불완전한 출력이 남을 수 있고, 이미 완료된 원격 작업을 되돌리지는 못한다. 반면 스레드를 기다리는 방식은 자원을 안전하게 보유하지만 worker가 멈추면 취소 응답과 슬롯 반환도 지연된다. 어느 쪽이든 요청 취소, 실행 종료, 자원 정리, 외부 결과 확정은 따로 관측해야 한다.

다음에 변환 작업의 취소를 검사할 때는 응답 시간부터 재지 말고 worker를 파일 읽기 직전에 멈춰 보자. 그 상태에서 취소가 도착하면 **파일은 누가 보유하고 있는지, 다음 요청은 슬롯에 들어올 수 있는지**를 먼저 확인한다. 이 두 질문이 정리 시점을 결정한다.
