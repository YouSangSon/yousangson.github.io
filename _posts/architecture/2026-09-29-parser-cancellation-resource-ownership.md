---
title: "취소된 작업의 임시파일은 언제 지워도 되는가"
description: "비동기 작업 취소 뒤에도 살아 있는 스레드와 자식 프로세스가 임시파일, 처리 슬롯, 완료 판정을 어떻게 붙잡아야 하는지 살펴본다."
categories: [architecture, optimization]
tags: [asyncio, cancellation, resource-lifetime, subprocess]
date: 2026-09-29
---

앞선 [취소와 실제 실행의 경계를 다룬 글](/posts/cancellation-does-not-kill-running-threads/)에서는 `await` 취소가 실행 중인 스레드를 즉시 멈추지 않는다고 설명했다. 다음 문제는 자원 수명이다. 스레드가 원본 파일을 읽는 동안 상위 요청이 취소됐다면, 임시 디렉터리는 언제 지우고 처리 슬롯은 언제 돌려줄까?

핵심은 논리적 완료와 물리적 완료의 차이다. `Task.cancel()`은 실행 중인 작업을 즉시 중단하는 명령이 아니라 코루틴에 취소를 요청한다. [`concurrent.futures.Future.cancel()`도 이미 실행 중인 호출은 취소할 수 없다](https://docs.python.org/3.11/library/concurrent.futures.html#concurrent.futures.Future.cancel). `CancelledError`만으로 스레드의 파일 접근 종료를 추론할 수 없다.

## 파일과 슬롯을 붙잡는 주체

파서의 한 경로에는 문서별 임시 디렉터리와 동시 처리 수를 제한하는 슬롯이 있다. 스레드로 보낸 어댑터가 그 디렉터리의 원본을 읽는다. 취소 직후 `finally`에서 디렉터리를 지우면 작업은 살아 있는데 파일만 사라진다. 슬롯까지 반환하면 다음 문서가 진입해 실제 동시 작업 수가 설정 상한을 넘어선다. 자원 수명은 그 자원을 마지막으로 사용할 물리 작업의 수명에 묶여야 한다.

스레드풀에 제출한 `Future`를 작업 종료의 증거로 붙잡았다. 상위 취소가 오면 이를 기억하되, 같은 `Future`가 끝날 때까지 기다린 뒤 취소를 다시 전파한다. Python의 [`asyncio.shield()` 문서](https://docs.python.org/3.11/library/asyncio-task.html#shielding-from-cancellation)는 이 차이를 명확히 한다. shield는 내부 작업으로 취소가 전달되는 것을 막지만, 취소된 호출자의 `await`에는 여전히 `CancelledError`가 발생한다. shield 한 번만 걸고 호출자가 곧바로 빠져나가면 자원 소유 문제는 남는다. 소유자는 안쪽 작업이 끝났음을 관측할 때까지 자신의 `finally`에 도달하지 않아야 한다.

종료 순서는 다음과 같이 잡았다.

```text
취소 요청 → 실제 worker 종료 확인 → 임시파일 정리 → 처리 슬롯 반환
```

반복 취소에도 최초에 제출한 작업을 끝까지 관측한다. 작업 자체가 실패했다면 어느 오류를 바깥에 알릴지도 명시해야 한다. 예를 들어 원격 writer의 전달 결과가 불명인데 단순 취소로 덮어버리면, 실제 저장 여부를 모른 채 재시도를 허용할 수 있다. 구현은 전달 불명 오류를 취소보다 우선하고, 일반 작업 오류에는 취소를 우선하는 규칙을 둔다. 이는 Python이 자동으로 정해 주는 예외 우선순위가 아니라 데이터 무결성을 위한 애플리케이션의 결정이다.

## 첫 실패 뒤에도 형제 작업은 남는다

형제 작업도 같은 원칙을 따른다. 문서 하나에서 수십 개 자산을 동시에 처리할 때 첫 실패를 즉시 문서 결과로 확정하면 다른 자산의 업로드나 저장 작업이 남을 수 있다. Python의 [`asyncio.gather()` 문서](https://docs.python.org/3.11/library/asyncio-task.html#asyncio.gather)에 따르면 기본 설정에서 첫 예외는 기다리는 쪽에 곧바로 전달되며, 다른 awaitable은 자동으로 취소되지 않고 계속 실행할 수 있다. 각 형제의 결과와 예외를 모아 모두 끝난 뒤 결과를 고른다. 그래야 정리와 writer 종료 판정이 형제 작업을 앞지르지 않는다. 오류 우선순위도 전체 결과를 본 뒤 판단한다.

## 대표 프로세스 뒤에 남은 작업

프로세스 변환에서는 범위가 더 넓다. 대표 자식이 종료돼도 그 자식이 띄운 구성원이 변환용 프로필을 계속 사용할 수 있다. 부모가 자식을 별도 세션으로 시작하고 프로세스 그룹을 관리하면, 종료 요청을 그룹에 보낼 수 있다. Python은 [`Popen(start_new_session=True)`](https://docs.python.org/3.11/library/subprocess.html#subprocess.Popen)와 [`os.killpg()`](https://docs.python.org/3.11/library/os.html#os.killpg)를 제공한다. 그러나 그룹에 신호를 보냈다는 사실은 그룹이 사라졌다는 증거가 아니다. 구현은 원래 자식의 종료 상태와 그룹 부재를 확인한 뒤 변환 프로필을 지운다. 어느 확인이 불명확하면 안전하게 정리했다고 선언하지 않는다.

또 다른 경로에서는 자식 파서가 외부 변환을 직접 소유하지 않고 부모에게 제한된 변환 요청을 보낸다. 부모는 입출력 경로가 작업 디렉터리 안에 있는지 확인하고 변환 결과를 돌려준다. 파일과 자식 프로세스의 소유자는 부모다. 자식의 결과 메시지만으로 프로세스 종료와 자원 해제를 선언하지 않는다. 전역 잠금은 종료 확인 없이 새 프로세스를 시작하지 않기 위한 선택이다. 종료를 증명할 수 없으면 새 변환의 처리량이 떨어질 수 있다는 한계가 있다.

## 종료 시점을 통제하는 작은 검사

아래 코드는 임시 디렉터리와 슬롯의 소유 관계를 일반화한 재현 예제다. Python 3.11 이상에서 실행할 수 있다. `Event`로 스레드의 시작과 종료를 통제하므로 임의의 `sleep()` 시간에 성공 여부를 맡기지 않는다.

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

예제는 취소 직후의 파일·슬롯 유지와 worker 종료 뒤 해제만 검사한다. 실제 코드는 반복 취소, 작업 실패, 형제의 미확정 업로드, 프로세스 그룹의 늦은 종료도 따로 검증해야 한다. 로컬 회귀 테스트는 반복 취소 중 원본·슬롯 유지와 그룹 구성원이 남은 동안의 프로필 유지를 확인했다. 당시 전체 검사에는 실패가 있었고 해당 모듈의 수정 후 검사를 통과한 기록이다. 깨끗한 전체 재실행을 뜻하지 않는다. 실제 부하, 외부 프로그램 종료, 원격 writer의 ACK와 배포 중 종료는 미검증이다. 완료의 기준을 `Task.done()` 하나로 정하지 않고, 파일·슬롯·원격 결과를 사용하던 마지막 작업이 끝났다는 증거로 정하는 것이 이번 설계의 핵심이다.
