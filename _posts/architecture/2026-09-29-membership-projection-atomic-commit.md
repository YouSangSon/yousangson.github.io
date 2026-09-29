---
title: "원본은 바뀌었는데 조회 화면은 그대로일 때"
description: "원본과 조회용 합계를 함께 커밋하는 방법, 비동기 작업을 잃지 않는 방법, 늦은 계산이 새 결과를 덮지 못하게 하는 조건을 한 상태 순서로 확인한다."
categories: [architecture, consistency]
tags: [transaction, materialized-view, concurrency, sqlite, mongodb]
date: 2026-09-29
---

주문 수량이 1에서 2로 바뀌었는데 요약 화면에는 합계 1이 남았다. 원본 행과 빠른 조회용으로 저장한 합계가 서로 다른 시각을 가리키는 것이다. 아래 주문·합계·revision은 실제 업무가 아닌 가상 예제다. 이 예제에서는 합계가 수량과 같고, revision은 원본이 바뀔 때 증가한다고 가정한다.

먼저 성공 응답의 의미를 정해야 한다. **즉시 일치**를 약속한다면 원본과 파생 값을 같은 완료 경계에서 바꾸어야 한다. 잠시 늦어도 된다면 조회 응답은 어느 revision까지 반영했는지 드러내야 한다. 두 정책 모두 가능하지만, 같은 API가 둘을 조용히 섞으면 "성공했는데 화면이 옛값"이라는 상태를 설명할 수 없다.

## 둘째 저장을 실패시키면 원자성의 범위가 보인다

원본과 합계가 같은 DB의 트랜잭션에 참여한다면 둘 중 하나만 남는 실패를 피할 수 있다. MongoDB도 여러 문서·컬렉션의 변경을 트랜잭션으로 묶을 수 있다. 단, 각 연산이 해당 세션에 속해야 하며 별도 캐시나 외부 API까지 자동으로 포함되지는 않는다. [MongoDB 트랜잭션](https://www.mongodb.com/docs/manual/core/transactions/), [세션 전달과 재시도](https://www.mongodb.com/docs/manual/core/transactions-in-applications/)

다음 Python 3 표준 라이브러리 예제는 SQLite로 두 가지 다른 실패를 만든다. 먼저 합계의 제약을 일부러 위반해 **함께 롤백**되는지 본다. 그다음 원본과 갱신 의도를 함께 저장하는 비동기 경로에서, 늦은 revision 1 작업이 revision 2 결과를 덮는 경우를 재현한다.

```python
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE source (quantity INTEGER, revision INTEGER)")
db.execute("CREATE TABLE view_total (total INTEGER CHECK(total >= 0), revision INTEGER)")
db.execute("CREATE TABLE outbox (revision INTEGER PRIMARY KEY, total INTEGER)")
db.execute("INSERT INTO source VALUES (1, 1)")
db.execute("INSERT INTO view_total VALUES (1, 1)")
db.commit()

try:
    with db:
        db.execute("UPDATE source SET quantity=2, revision=2")
        db.execute("UPDATE view_total SET total=-1, revision=2")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("second write should fail")
assert db.execute("SELECT * FROM source").fetchone() == (1, 1)
assert db.execute("SELECT * FROM view_total").fetchone() == (1, 1)
print("failed second write: source=1/view=1")

```

둘째 쓰기가 실패하자 원본도 `(1, 1)`로 돌아간다. 한 트랜잭션의 원자성이 막은 것은 부분 저장이다. 이제 조회용 합계를 나중에 갱신하는 경로로 바꿔 보자. 세 코드 블록은 위에서부터 같은 파일에 이어 붙여 실행한다.

### 갱신 의도를 저장해도 실행 순서까지 정해지지는 않는다

```python
# 비동기 경로: 원본과 '합계를 2로 만들라'는 의도를 함께 커밋.
with db:
    db.execute("UPDATE source SET quantity=2, revision=2")
    db.execute("INSERT INTO outbox VALUES (2, 2)")
assert db.execute("SELECT * FROM view_total").fetchone() == (1, 1)
assert db.execute("SELECT * FROM outbox").fetchone() == (2, 2)

# 잘못된 소비자: 새 작업 B 뒤에 오래된 작업 A가 조건 없이 저장.
db.execute("UPDATE view_total SET total=2, revision=2")
db.execute("UPDATE view_total SET total=1, revision=1")
db.commit()
assert db.execute("SELECT * FROM view_total").fetchone() == (1, 1)
print("unconditional late write: source=2/view=1")

```

원본과 outbox를 함께 저장했어도 소비자가 순서를 뒤집어 적용하면 합계는 다시 1이 된다. outbox는 할 일을 잃지 않게 하지만, 오래된 계산 결과를 자동으로 거절하지는 않는다.

### 저장할 때 revision을 비교한다

```python
# 같은 초기 상태에서, 더 새로운 revision만 반영.
def apply(revision, total):
    with db:
        return db.execute(
            "UPDATE view_total SET total=?, revision=? WHERE revision<?",
            (total, revision, revision)
        ).rowcount

assert apply(2, 2) == 1
assert apply(1, 1) == 0
assert db.execute("SELECT * FROM view_total").fetchone() == (2, 2)
db.close()
print("guarded late write: source=2/view=2")
```

```text
failed second write: source=1/view=1
unconditional late write: source=2/view=1
guarded late write: source=2/view=2
```

첫 출력은 **원자성**만 확인한다. 두 번째는 원본 변경이 내구성 있게 저장돼도 조회용 합계는 지연될 수 있고, 무조건 덮어쓰면 더 오래된 값으로 돌아갈 수 있음을 보인다. 세 번째의 `WHERE revision<?`는 파생 값에 이미 반영된 revision보다 오래된 작업을 거른다. 조건이 맞지 않으면 `UPDATE`가 0행에 적용된다. [Python `sqlite3` 연결 컨텍스트](https://docs.python.org/3.11/library/sqlite3.html#how-to-use-the-connection-context-manager), [SQLite `UPDATE` 조건](https://www.sqlite.org/lang_update.html)

## 두 writer의 계산 시각을 같이 본다

위 코드의 늦은 작업 A는 다음처럼 만들어질 수 있다.

| 시각 | 작업 A | 작업 B | 저장된 상태 |
| --- | --- | --- | --- |
| 1 | 원본 revision 1을 읽고 합계 1 계산 | | 원본 1 / 파생 1 |
| 2 | 계산 후 멈춤 | 원본을 2로 바꾸고 revision 2 커밋 | 원본 2 / 파생 1 또는 2 |
| 3 | | revision 2 파생 값 저장 | 원본 2 / 파생 2 |
| 4 | 옛 합계 1을 뒤늦게 저장 | | 조건이 없으면 원본 2 / 파생 1 |

A가 뒤늦게 잠금을 얻는 것만으로는 해결되지 않는다. 잠금 **안에서 원본을 다시 읽고 계산**하거나, 저장할 때 "여전히 내가 읽은 revision인가"를 조건으로 확인해야 한다. 새 revision이 발견되면 계산을 버리고 다시 시작한다. MongoDB도 병렬 갱신의 충돌을 막을 때 예상 현재 값을 조건에 넣도록 안내한다. [MongoDB 조건부 갱신](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)

코드의 단조 증가 조건은 **revision 2의 합계 2가 올바른 값으로 만들어졌다는 가정**에서만 효과가 있다. 잘못 계산한 합계 99도 revision 2를 붙이면 저장할 수 있다. 또한 같은 revision에 서로 다른 값이 오면 0행을 조용히 성공으로 취급해서는 안 된다. 원본 변경과 작업 payload를 같은 트랜잭션에서 기록하거나, 작업자가 특정 revision의 원본을 읽어 계산하고 적용 조건을 검증해야 한다. 거부된 쓰기가 오래된 중복인지 데이터 불일치인지도 구분한다.

## 즉시 일치와 비동기 갱신의 비용

원본과 파생 값이 **같은 DB**에 있고 성공 응답 직후 둘이 같아야 한다면, 하나의 트랜잭션에서 변경하고 계산 입력의 revision까지 검사하는 쪽이 자연스럽다. 트랜잭션이 둘째 저장 실패를 막아도, 잘못된 계산을 함께 저장하는 것까지 막지는 않는다. DB의 격리 수준과 충돌 처리도 실제 제품에서 검증해야 한다.

비동기 갱신을 허용한다면 원본 변경과 outbox 의도를 함께 커밋한다. 원본만 커밋한 뒤 메모리 큐에 작업을 넣는 방식은 그 사이의 프로세스 종료에서 의도를 잃는다. outbox 소비자는 중복 실행될 수 있으므로 revision과 작업 ID로 같은 결과를 유지하고, 늦은 작업이 최신 파생 값을 덮지 못하게 한다. 조회 응답에는 `source_revision=2, view_revision=1`처럼 지연을 관측할 방법이 있어야 한다. 최신 값이 반드시 필요한 읽기만 원본에서 다시 계산하는 정책도 가능하다.

외부 캐시까지 즉시 갱신해야 한다면 같은 DB 트랜잭션만으로는 부족하다. 캐시가 옛 revision을 얼마나 보여 줘도 되는지, 갱신 실패를 어떻게 다시 시도할지를 별도 계약으로 정한다. 위 실험은 DB의 롤백과 조건부 갱신만 증명한다. 실제 다중 writer·외부 캐시·MongoDB의 격리 특성까지 증명하지 않는다. 다른 읽기용 사본을 설계할 때도 **원본 revision, 파생 값의 revision, 성공 응답의 시점**을 먼저 함께 기록해 보자.
