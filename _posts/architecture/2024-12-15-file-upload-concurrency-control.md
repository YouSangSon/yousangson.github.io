---
title: "동시 파일 업로드에서 용량 제한이 어긋나는 이유"
description: 서로 다른 파일이 같은 저장 용량을 갱신할 때 생기는 초과 승인과 값 유실을 재현하고, 용량 예약·외부 업로드·완료 기록의 실패 경계를 나눈다.
categories: [architecture, golang]
tags: [concurrency, distributed lock, redis, mongodb, transaction, file upload, golang]
date: 2024-12-15
mermaid: true
updated: '2026-10-09'
related:
  - slug: upload-memory-admission-before-body
    reason: 저장 용량과 별도로 업로드 버퍼의 메모리 상한을 계산합니다.
  - slug: membership-projection-atomic-commit
    reason: 원본과 조회용 합계를 함께 갱신하는 완료 조건을 비교합니다.
---

사진 A와 B는 파일 이름도 객체 키도 다른데 같은 보관함의 사용량을 읽고 쓰는 두 업로드 요청이 충돌한다. 파일 이름별로 잠가도 두 요청이 공유하는 용량 기록은 보호되지 않는다. 어떤 값을 함께 읽고 갱신하는지 따라가면 용량 제한을 지킬 잠금 범위를 찾을 수 있다. 아래 숫자는 설명을 위한 가상 값이다. 용량 상한이 10MiB, 이미 확정된 사용량이 4MiB이고 각 사진이 4MiB라고 하자.

| 순서 | 요청 A | 요청 B | 기록된 사용량 |
| --- | --- | --- | --- |
| 1 | 4를 읽고 `4+4≤10` 확인 | | 4 |
| 2 | | 4를 읽고 `4+4≤10` 확인 | 4 |
| 3 | 객체 A 저장 후 8 기록 | | 8 |
| 4 | | 객체 B 저장 후 자신도 8 기록 | 8 |

두 요청은 성공했지만 실제 보관량은 `4+4+4=12`MiB다. 마지막 값 8은 앞선 갱신을 덮었고, 용량 검사도 같은 옛 값을 두 번 사용했다. 사용량에 `+4`를 원자적으로 더하기만 하면 기록은 12가 되어 값 유실은 사라져도 **상한 초과 승인**은 남는다. 검사와 예약을 하나의 조건부 변경으로 묶어야 한다.

## 먼저 무엇을 세는지 정한다

이 예제의 계약은 `확정 사용량 + 진행 중 예약량 ≤ 10MiB`다. 성공 응답을 보내려면 객체가 저장됐고 해당 요청의 예약이 확정 사용량으로 전환되어야 한다. 요청이 실패해도 예약을 곧바로 지워도 되는 것은 아니다. 업로드가 아직 진행 중이거나 저장 결과를 모른다면, 그 예약을 해제하는 순간 다른 요청을 승인해 실제 객체의 합계가 상한을 넘을 수 있다.

MongoDB에서는 한 문서에 든 값을 **현재 값 조건과 함께 갱신**하는 작업이 단일 문서에서 원자적이다. 여러 문서에 걸친 예약 기록까지 함께 바꿔야 한다면 트랜잭션 경계를 검토해야 한다. [MongoDB 원자성과 조건부 갱신](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [트랜잭션](https://www.mongodb.com/docs/manual/core/transactions/)

다음 Python 3 표준 라이브러리 예제는 같은 실패 순서를 만들고, SQLite의 조건부 `UPDATE`로 예약을 한 건만 승인한다. 실제 업로드나 분산 DB를 흉내 내지는 않는다.

```python
import sqlite3

read_by_a = read_by_b = 4
naive_used = read_by_a + 4
naive_used = read_by_b + 4
assert naive_used == 8 and 4 + 4 + 4 == 12
print("separate read/write: recorded=8, actual=12")

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE quota (capacity INTEGER, used INTEGER, held INTEGER)")
db.execute("CREATE TABLE requests (id TEXT PRIMARY KEY, size INTEGER, state TEXT)")
db.execute("INSERT INTO quota VALUES (10, 4, 0)")
db.commit()

def reserve(request_id, size):
    try:
        with db:
            changed = db.execute(
                "UPDATE quota SET held=held+? "
                "WHERE used+held+?<=capacity", (size, size)
            ).rowcount
            if changed:
                db.execute("INSERT INTO requests VALUES (?, ?, 'held')",
                           (request_id, size))
            return changed == 1
    except sqlite3.IntegrityError:  # 같은 요청 ID의 두 번째 예약
        return False

assert reserve("A", 4)
assert not reserve("B", 4)
assert db.execute("SELECT used, held FROM quota").fetchone() == (4, 4)

```

A의 예약이 먼저 확정되면 `held`는 4가 된다. 같은 조건으로 들어온 B는 `used + held + size <= capacity`를 만족하지 못해 거절된다. 여기까지는 저장할 자리를 확보했을 뿐 실제 저장을 완료한 상태는 아니다.

### 예약을 확정 사용량으로 옮긴다

객체 저장 성공을 확인한 뒤에는 같은 요청 ID를 기준으로 예약 상태를 완료 상태로 바꾼다. 위 코드와 아래 코드를 순서대로 한 파일에 두고 실행한다.

```python
def finish(request_id):  # 객체 저장 성공을 확인한 뒤에만 호출
    with db:
        row = db.execute(
            "SELECT size FROM requests WHERE id=? AND state='held'",
            (request_id,)
        ).fetchone()
        if row is None:
            return False
        size = row[0]
        changed = db.execute(
            "UPDATE requests SET state='done' WHERE id=? AND state='held'",
            (request_id,)
        ).rowcount
        if changed != 1:
            raise RuntimeError("reservation changed")
        changed = db.execute(
            "UPDATE quota SET used=used+?, held=held-? WHERE held>=?",
            (size, size, size)
        ).rowcount
        if changed != 1:
            raise RuntimeError("quota changed")
        return True

assert finish("A")
assert not finish("A")  # 재시도가 사용량을 또 늘리지 않는다.
assert not reserve("A", 1)  # 용량은 남아도 같은 ID의 재사용은 거부
assert db.execute("SELECT used, held FROM quota").fetchone() == (8, 0)
db.close()
print("conditional reserve: A accepted, B and reused A ID rejected; used=8")
```

```text
separate read/write: recorded=8, actual=12
conditional reserve: A accepted, B and reused A ID rejected; used=8
```

`reserve("B", 4)`가 실패한 이유는 B가 늦어서가 아니라, A의 예약 이후 `4+4+4>10`이 되었기 때문이다. `finish("A")`의 두 번째 호출은 완료 상태를 보고 아무 값도 바꾸지 않는다. A를 확정한 뒤에는 2MiB가 남지만, 이미 쓴 A ID로 1MiB를 다시 예약하면 유일성 제약이 전체 변경을 롤백한다. 예제의 확정은 A의 저장 성공이 확인됐다는 가정 아래 실행한다. 파일 크기를 알고 있고, 예약 크기와 실제 저장 크기가 같다는 조건에서만 산술을 증명한다. [Python `sqlite3` 트랜잭션 컨텍스트](https://docs.python.org/3.11/library/sqlite3.html#how-to-use-the-connection-context-manager)

## 외부 업로드는 DB 재시도 안에 넣지 않는다

용량 예약 뒤에는 객체 저장소가 등장한다. DB 트랜잭션은 객체 저장을 함께 롤백하지 않는다. MongoDB 드라이버의 트랜잭션 콜백 방식은 일시적 트랜잭션 오류에서 콜백을 다시 실행할 수 있다. 콜백 안에 객체 업로드를 넣으면 DB 작업 재시도가 외부 업로드까지 반복할 수 있다. [MongoDB 드라이버 트랜잭션 처리](https://www.mongodb.com/docs/manual/core/transactions-in-applications/)

한 가지 실행 순서는 다음과 같다. 이 순서는 저장 용량 계약을 위한 선택이며, 외부 객체의 생명주기까지 DB 트랜잭션으로 만들었다는 뜻은 아니다.

1. 요청 ID로 예약을 원자적으로 기록한다. 크기를 아직 모르면 상한을 정해 스트림을 제한하거나, 읽은 바이트만큼 예약을 안전하게 늘릴 방법이 필요하다.
2. 요청 ID와 연결된 **새 객체 키**에 업로드한다. 같은 키를 재사용하면 늦은 정리 작업이 새로운 파일을 지울 수 있다.
3. 저장 성공을 확인한 뒤 짧은 DB 트랜잭션에서 예약을 확정 사용량으로 옮기고 파일 메타데이터를 기록한다. 이 트랜잭션만 다시 실행할 수 있게 만든다.
4. 업로드 실패가 확정됐다면 예약을 해제한다. 저장 결과가 불명확하면 예약과 요청 상태를 남겨 조회·정리 후 결정한다.

3단계 직전에 프로세스가 죽으면 **객체는 있는데 예약만 남는** 상태가 된다. 예약에는 요청 ID, 객체 키, 크기, 처리 상태가 있어야 재시작 후 객체 존재와 결과를 대조할 수 있다. 정리하기로 했다면 그 객체 키만 삭제하고, 삭제가 확인되기 전에는 해당 예약을 무조건 성공이나 해제로 바꾸지 않는다. 3단계 커밋은 성공했는데 응답만 잃은 경우에는 같은 요청 ID의 완료 기록을 읽어 반환한다. 다시 파일을 올리는 것은 복구가 아니다.

분산 락은 같은 락 사용자들의 진입을 늦출 수 있지만 모든 쓰기 경로가 락을 지키는지, 소유권 만료 후 옛 작업이 쓰지 않는지까지 별도로 확인해야 한다. 위의 조건부 예약이 DB 불변식을 지킨다면 락은 긴 객체 업로드를 직렬화하는 대신 자원 보호나 대기량 조절에만 쓸 수 있다. 큰 파일과 작은 파일의 대기열을 나눠도 최종 용량 행이 같으면 이 충돌은 사라지지 않는다.

또 하나의 한도는 서버 메모리다. 업로드 본문을 읽거나 SDK가 버퍼를 잡기 **전**에 진입량을 제한해야 한다. DB 예약이 메모리 사용량까지 제한하지는 않는다. [스트리밍 업로드의 버퍼 크기](/posts/upload-memory-admission-before-body/)와 [문서 버전별 객체 정리](/posts/immutable-versions-through-rag-pipeline/)는 각각 그 별도 경계를 다룬다.

실제 경로를 검증할 때는 두 요청을 위 순서로 멈춰 보자. 둘 다 승인되는지뿐 아니라, **객체 저장 직후 종료**와 **DB 확정 직후 응답 유실**에서 예약·객체·완료 기록이 어떤 조합으로 남는지를 확인한다. 예제는 조건부 용량 산술만 검증하며, 저장소 지연이나 업로드 중단 감지는 검증하지 않는다.
