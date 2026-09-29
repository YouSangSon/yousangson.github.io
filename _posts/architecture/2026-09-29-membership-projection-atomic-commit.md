---
title: "원본은 바뀌었는데 조회 화면은 그대로일 때"
description: "원본 데이터와 미리 계산한 조회 값을 함께 관리하는 비용을 트랜잭션, 오래된 쓰기, 비동기 갱신으로 나누어 살펴본다."
categories: [architecture, consistency]
tags: [transaction, materialized-view, concurrency, sqlite, mongodb]
date: 2026-09-29
---

주문의 수량은 바뀌었는데 요약 화면의 합계는 그대로다. 원본 행과 빠른 조회를 위해 저장해 둔 합계가 서로 다른 시점의 값을 보여 주는 것이다. 요청이 성공했다고 응답해도 화면마다 다른 결과가 나올 수 있다.

조회할 때마다 계산하는 대신 결과를 저장해 두는 *materialized view*는 읽기를 줄여 준다. 대신 원본이 바뀔 때 파생 값도 관리해야 한다. 먼저 정할 질문은 하나다. **성공 응답 직후 두 값이 같아야 하는가, 잠시 달라도 되는가?**

이 글은 주문과 합계를 사용하는 가상 예제다. 특정 서비스의 저장 구조나 업무 규칙을 전제로 하지 않는다.

## 둘째 저장을 실패시키면 경계가 보인다

원본과 합계를 같은 DB에서 바꿀 수 있고 즉시 일치해야 한다면, 두 변경을 하나의 트랜잭션에 넣는 방법을 검토할 수 있다. MongoDB도 여러 문서·컬렉션의 변경을 트랜잭션으로 묶을 수 있다. 각 연산이 해당 세션을 사용해야 하며, 외부 캐시나 API 호출까지 자동으로 포함되지는 않는다. [MongoDB Transactions](https://www.mongodb.com/docs/manual/core/transactions/)

아래는 별도 서버 없이 실행할 수 있도록 SQLite를 사용했다. 의도적으로 두 번째 저장을 실패시켜 첫 번째 변경도 남지 않는지 확인한다.

```python
import sqlite3

with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE orders (quantity INTEGER NOT NULL)")
    db.execute("CREATE TABLE summary (total INTEGER CHECK (total >= 0))")
    db.execute("INSERT INTO orders VALUES (1)")
    db.execute("INSERT INTO summary VALUES (1)")

try:
    with db:
        db.execute("UPDATE orders SET quantity = 2")
        db.execute("UPDATE summary SET total = -1")  # 의도한 제약 위반
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("the second write should fail")

assert db.execute("SELECT quantity FROM orders").fetchone()[0] == 1
assert db.execute("SELECT total FROM summary").fetchone()[0] == 1
db.close()
print("both values stayed unchanged")
```

Python 3.11의 `sqlite3.Connection` 컨텍스트 관리자는 블록의 성공·실패에 따라 열린 트랜잭션을 커밋하거나 롤백한다. 연결 자체를 닫지는 않으므로 마지막에 `close()`를 호출했다. [Python sqlite3: Connection context manager](https://docs.python.org/3.11/library/sqlite3.html#how-to-use-the-connection-context-manager)

이 예제가 확인하는 것은 두 저장의 원자성이다. 합계를 제대로 계산했는지, 다른 연결과의 경쟁을 어떻게 처리하는지까지 증명하지는 않는다. 트랜잭션 안에서도 잘못 계산한 값을 둘 다 정상 저장하면 함께 커밋될 수 있다.

## 함께 커밋해도 오래된 계산은 남을 수 있다

다음 순서를 보자.

```text
작업 A: 원본 1을 읽고 합계 계산 시작
작업 B: 원본 2와 새 합계를 함께 커밋
작업 A: 뒤늦게 원본 1의 합계를 저장
```

B의 트랜잭션은 성공했지만 A가 낡은 값을 덮어썼다. 원자성은 B의 두 저장을 묶어 주었을 뿐, 다른 작업의 입력을 최신으로 바꾸지는 않았다.

참여하는 writer가 같은 잠금을 사용한다면 잠금을 얻은 뒤 원본을 다시 읽는 방법이 있다. 파생 값에 원본 revision을 남기고, 저장 시 여전히 그 revision인지 조건부로 확인하는 방법도 있다. 어떤 방법이든 읽은 값과 저장할 때의 조건을 연결해야 한다. 이미 계산한 옛 값을 들고 잠금만 기다리는 것으로는 충분하지 않다.

## 비동기 갱신을 택하면 지연도 상태가 된다

합계가 잠시 늦어도 괜찮다면 변경을 비동기로 전달할 수 있다. 다만 원본 저장 뒤 메모리에만 작업을 등록하면 프로세스 종료 시 갱신을 잃을 수 있다. 원본 커밋과 갱신 의도를 내구성 있게 연결하고, 중복 전달과 순서 역전을 처리할 방법이 필요하다.

읽는 쪽도 지연을 표현해야 한다. 마지막 반영 revision이나 갱신 중 상태를 보여 줄 수도 있고, 반드시 최신 값이 필요한 요청만 원본에서 계산할 수도 있다. 읽기 성능을 얻는 대신 어떤 시점의 값을 허용할지 계약을 추가하는 선택이다.

| 확인할 실패 | 질문 |
| --- | --- |
| 둘째 저장 실패 | 첫째 저장만 남아도 되는가? |
| 원본 커밋 직후 종료 | 파생 값을 다시 만들 근거가 남는가? |
| 늦은 작업의 저장 | 새 결과를 옛 결과로 덮을 수 있는가? |
| 캐시 갱신 실패 | 사용자에게 어느 시점의 값이 보이는가? |

트랜잭션, 잠금, 캐시는 서로 다른 질문에 답한다. 하나를 도입했다는 사실보다 실패를 끼워 넣은 뒤 원본과 화면이 어떤 상태로 남는지 확인해야 한다. 주문 합계뿐 아니라 검색 색인과 통계 요약처럼 읽기용 사본을 만드는 곳에서도 같은 질문을 적용할 수 있다.
