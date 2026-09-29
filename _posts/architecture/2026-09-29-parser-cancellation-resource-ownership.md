---
title: "취소된 작업의 임시파일은 언제 지워도 되는가"
description: "호출자의 취소와 실제 스레드 종료를 나누고, 임시파일과 처리 슬롯의 수명을 작은 Python 예제로 확인한다."
categories: [architecture, optimization]
tags: [asyncio, cancellation, resource-lifetime, subprocess]
date: 2026-09-29
---

문서 변환 함수에 임시파일 경로를 넘기고 결과를 기다린다. 사용자가 취소하면 `finally`에서 디렉터리를 정리한다. 깔끔해 보이는 코드지만 변환 함수가 별도 스레드에서 계속 파일을 읽고 있다면 어떨까? 작업은 살아 있는데 입력만 사라진다.

[앞선 취소 글](/posts/cancellation-does-not-kill-running-threads/)은 호출자의 대기와 실제 실행의 차이를 설명했다. 이번에는 그 차이가 **파일과 동시 처리 슬롯의 수명**에 어떤 영향을 주는지 살펴본다. 예제는 문서 처리기를 가정한 작은 실험이다.

## finally는 자신이 끝날 때 실행된다

`finally`는 그 블록의 제어 흐름을 정리한다. 다른 스레드가 같은 자원을 다 썼다는 뜻은 아니다. Python의 `Future.cancel()`도 이미 실행 중인 호출을 취소할 수는 없다. [concurrent.futures.Future.cancel](https://docs.python.org/3.11/library/concurrent.futures.html#concurrent.futures.Future.cancel)

파일만 문제가 되는 것도 아니다. 실제 작업은 계속되는데 세마포어를 먼저 반환하면 다음 요청이 진입한다. 세마포어 값은 여유가 있다고 말하지만 실제로 돌아가는 작업 수는 제한을 넘을 수 있다.

자원을 해제할 기준은 그 자원을 마지막으로 쓰는 작업의 종료다. 임시파일과 슬롯을 상위 요청이 소유한다면, 상위 요청은 실제 작업이 끝났음을 확인할 때까지 그 책임을 유지해야 한다. 별도 worker가 자원을 소유하도록 설계하는 방법도 있지만, 그 경우에는 worker의 종료와 정리를 추적하는 주체가 필요하다.

## 취소 직후의 상태를 멈춰 놓고 본다

아래 코드는 Python 3.11 이상에서 실행할 수 있다. 시간 지연을 추측하는 대신 `Event`로 작업의 시작과 끝을 통제한다. 한 번의 취소가 도착해도 작업이 끝나기 전에는 임시 디렉터리와 슬롯을 돌려주지 않는지 확인한다.

```python
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

async def main():
    loop = asyncio.get_running_loop()
    slot = asyncio.Semaphore(1)
    started = asyncio.Event()
    cancel_seen = asyncio.Event()
    release = threading.Event()
    paths = []

    def work(path):
        loop.call_soon_threadsafe(started.set)
        release.wait()
        assert path.exists()

    with ThreadPoolExecutor(max_workers=1) as pool:
        async def owner():
            async with slot:
                with TemporaryDirectory() as directory:
                    path = Path(directory)
                    paths.append(path)
                    future = loop.run_in_executor(pool, work, path)
                    try:
                        await asyncio.shield(future)
                    except asyncio.CancelledError:
                        cancel_seen.set()
                        await asyncio.shield(future)
                        raise

        task = asyncio.create_task(owner())
        try:
            await started.wait()
            task.cancel()
            await cancel_seen.wait()
            assert paths[0].exists() and slot.locked() and not task.done()
        finally:
            release.set()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert not paths[0].exists() and not slot.locked()

asyncio.run(main())
```

`release.set()` 전에는 스레드가 살아 있다. 이때 첫 assert는 디렉터리가 남아 있고 슬롯도 점유 중인지 확인한다. 스레드가 끝난 뒤에는 두 자원이 해제되고 취소가 호출자에게 다시 전달된다.

`shield()`는 내부 작업으로 취소가 전파되는 것을 막지만, 호출자의 `await`에는 여전히 `CancelledError`가 발생한다. 그래서 예제는 취소를 받은 뒤 같은 future를 다시 기다린다. [asyncio.shield](https://docs.python.org/3.11/library/asyncio-task.html#shielding-from-cancellation)

**이 예제는 한 번의 취소만 다룬다.** 두 번째 대기도 다시 취소될 수 있다. 반복 취소, worker 예외, 프로그램 종료가 가능한 실제 실행기라면 그때도 누가 자원을 보유하고 종료를 관측할지 정해야 한다. 위 코드를 그대로 범용 취소 처리기로 쓰면 안 된다.

## 한 작업의 실패가 형제의 종료는 아니다

여러 변환을 `asyncio.gather()`로 기다릴 때도 주의가 필요하다. 기본 설정에서는 첫 예외가 호출자에게 전달돼도 나머지 awaitable이 자동으로 취소되지 않는다. 하나의 오류를 받은 시점에 공용 임시 디렉터리를 지우면 남은 작업의 입력을 없앨 수 있다. [asyncio.gather](https://docs.python.org/3.11/library/asyncio-task.html#running-tasks-concurrently)

TaskGroup처럼 관련 코루틴의 수명을 묶는 도구도 검토할 수 있다. 다만 코루틴이 종료됐다는 사실과 그 안에서 시작한 blocking 스레드의 종료는 여전히 구분해야 한다. 런타임 도구가 추적하는 실행 단위가 무엇인지 확인하는 것이 먼저다.

## 프로세스로 나누어도 종료 확인은 남는다

외부 변환기를 자식 프로세스로 실행하면 강제 종료 수단을 사용할 수 있다. 그러나 대표 자식이 또 다른 프로세스를 만들었다면 대표 하나의 종료만으로 모두 끝났다고 볼 수 없다. POSIX 환경에서는 별도 세션으로 시작하고 프로세스 그룹에 신호를 보내는 방법이 있다. [Popen의 start_new_session](https://docs.python.org/3.11/library/subprocess.html#subprocess.Popen), [os.killpg](https://docs.python.org/3.11/library/os.html#os.killpg)

신호를 보냈다는 사실과 모든 사용자가 종료됐다는 증거도 다르다. 자식이 그룹을 벗어날 수 있는지, 플랫폼이 무엇을 지원하는지, 종료를 확인할 수 없을 때 자원을 어떻게 격리할지까지 실행 환경에 맞춰 정해야 한다. 로컬 프로세스를 종료해도 이미 보낸 원격 쓰기가 되돌아가는 것은 아니다.

다음 취소 테스트에서는 응답이 얼마나 빨리 돌아오는지만 보지 말자. 작업을 일부러 붙잡아 둔 채 취소하고, 파일이 남아 있는지와 다음 작업의 진입 여부를 확인한다. 종료 신호의 성공보다 자원을 사용하는 마지막 작업의 종료가 정리 시점을 더 정확히 알려 준다.
