---
title: "벡터 문서를 삭제했는데 청크가 다시 나타나는 이유"
description: 삭제 접수, 검색 차단, 늦은 writer의 재삽입, 벡터 정리와 공간 회수를 다른 완료 조건으로 나누고 재시작 가능한 정리 순서를 만든다.
categories: [architecture, golang]
tags: [vector db, milvus, data consistency, retry, distributed systems, golang]
date: 2025-01-12
mermaid: true
---

벡터 검색에서 가상의 문서 `manual` 버전 1을 지웠는데 잠시 뒤 청크가 다시 나타났다. 삭제 전에 시작한 임베딩 작업이 늦게 저장하면 삭제 호출이 성공해도 이런 일이 생긴다. 문서 삭제를 설계할 때는 검색에서 숨기는 시점과 실행 중인 writer가 더는 쓰지 못하는 시점을 나눠야 한다. 모든 이름과 상태는 이 설명을 위한 가상 값이다.

| 순서 | 메타데이터·writer | 벡터 저장소 |
| --- | --- | --- |
| 1 | 버전 1의 임베딩 작업 W가 시작됨 | 청크 A 존재 |
| 2 | 삭제 작업이 버전 1을 지움 | 청크 없음 |
| 3 | W가 이미 준비한 청크 B를 늦게 저장 | 청크 B 재등장 |

2번에서 한 번 비어 있었다는 관측은 3번을 막지 못한다. **삭제가 안정적으로 완료됐는가**를 묻기 전에, 그 버전을 다시 쓸 수 있는 경로가 남았는지 확인해야 한다.

## 네 가지 완료 시각

이 예제는 문서 ID와 **불변 원본 버전**을 함께 삭제 대상으로 삼는다. 파일 이름이나 최신 버전 포인터만으로 삭제하면 새 버전의 청크까지 지울 수 있다. 한 문서를 여러 보관함이 참조할 수 있다면 참조 삭제와 원본 삭제의 소유권도 먼저 분리해야 한다. [원본과 색인 버전의 연결](/posts/immutable-versions-through-rag-pipeline/)

| 상태 | 무엇을 확인했는가 | 아직 주장할 수 없는 것 |
| --- | --- | --- |
| 접수됨 | 권한을 확인하고 버전 1의 삭제 의도를 내구성 있게 기록 | 검색에서 사라짐 |
| 검색 차단됨 | 새 검색이 해당 버전을 결과로 내지 않음 | 벡터 저장소에 행이 없음 |
| 벡터 정리됨 | 더 쓸 수 있는 옛 writer가 없고, 해당 버전의 벡터 부재를 선택한 읽기 조건으로 확인 | 저장 공간이 이미 반환됨 |
| 공간 회수됨 | 저장소의 compaction·GC 결과까지 확인 | 앞 단계의 대체 증거가 아님 |

Milvus의 삭제는 기본 키나 필터로 대상을 지정한다. 검색·쿼리의 가시성은 선택한 일관성 수준에 영향을 받으며, 삭제 후 저장 공간은 compaction과 GC로 나중에 회수될 수 있다. 따라서 `delete_count`, 검색에서 안 보인 한 번의 top-k 결과, 디스크 사용량을 같은 완료 신호로 쓰지 않는다. [Milvus 삭제](https://milvus.io/docs/delete-entities.md), [일관성 수준](https://milvus.io/docs/consistency.md), [삭제 후 공간 회수](https://milvus.io/docs/product_faq.md)

검색 차단은 애플리케이션의 읽기 경계로 둘 수 있다. 삭제 tombstone을 원본 메타데이터에 기록하고 **모든 검색 결과를 반환하기 전** 해당 문서·버전의 현재 공개 상태를 확인하는 방식이다. 이 경계를 우회하는 검색 API나 오래된 캐시가 있으면 즉시 차단을 주장할 수 없다. 보안상 즉시 숨겨야 한다면 그 읽기 경로까지 포함해 검증해야 한다.

## tombstone만으로 옛 쓰기가 멈추지 않는다

삭제 의도와 검색 차단 상태는 같은 내구성 있는 DB 변경에서 기록한다. MongoDB 트랜잭션은 참여한 MongoDB 변경을 묶지만 외부 벡터 저장소의 삭제·삽입까지 롤백하지 않는다. [MongoDB 트랜잭션 범위](https://www.mongodb.com/docs/manual/core/transactions/)

이후 새 writer가 버전 1의 작업을 시작하지 못하게 막고, 이미 시작된 W의 외부 쓰기가 끝났는지 확인한 다음 벡터를 지운다. 단순히 W가 시작할 때 tombstone을 한 번 읽게 하면 충분하지 않다. W는 그 검사와 벡터 저장 사이에서 멈췄다가 삭제 뒤 다시 움직일 수 있다. 짧은 lease가 만료된 사실도 W의 네트워크 요청이나 실행이 끝났다는 증거가 아니다.

다음 예제는 **모든 벡터 쓰기가 하나의 관리 경로를 지나고**, `inflight`에서 작업을 제거할 때 그 외부 쓰기가 실제로 끝났다는 조건을 둔다. 이 조건 아래에서만 정리 작업이 writer 종료 뒤 삭제할 수 있다. 파이썬 집합은 실제 DB나 Milvus의 동시성·가시성을 모델링하지 않는다.

```python
version = ("manual", 1)
vectors = {(version, "A")}
inflight = {"W"}
tombstones = set()
jobs = set()

def visible():
    return {chunk for (v, chunk) in vectors if v not in tombstones}

# 잘못된 순서: 먼저 지운 뒤 옛 writer의 저장이 끝난다.
vectors.clear()
vectors.add((version, "B"))
assert visible() == {"B"}
print("delete before writer finishes:", sorted(visible()))

```

삭제 직후에도 옛 writer가 B를 추가하면 검색 결과가 되살아난다. 삭제 요청을 반복하는 것만으로는 다음 쓰기를 막을 수 없다.

같은 파일에서 이어서 두 번째 순서를 실행한다. 검색에서 숨기는 tombstone과 재시작 후에도 찾아야 할 작업 기록을 먼저 만들고, writer가 끝날 때까지 물리 삭제를 미룬다.

```python
# 새 실행: 새 요청을 차단하는 tombstone과 복구할 작업 기록.
vectors = {(version, "A")}
tombstones.add(version)
jobs.add(version)
assert visible() == set()  # 검색 차단; 벡터 A는 아직 존재한다.

def reconcile(v):
    if inflight:  # 외부 쓰기가 끝나기 전에는 최종 삭제하지 않는다.
        return "waiting for writer"
    vectors.difference_update({item for item in vectors if item[0] == v})
    return "vector rows absent"

assert reconcile(version) == "waiting for writer"
vectors.add((version, "B"))  # tombstone 전에 시작한 W의 마지막 외부 쓰기.
assert visible() == set() and (version, "B") in vectors
inflight.remove("W")  # W의 외부 쓰기 완료를 확인한 뒤.
assert reconcile(version) == "vector rows absent"
# 여기서 프로세스가 종료되어 완료 기록을 못 남겨도 jobs는 유지된다.
assert version in jobs and reconcile(version) == "vector rows absent"
jobs.remove(version)
assert not vectors and not jobs
print("restart/retry: same-version rows absent; job completed")
```

```text
delete before writer finishes: ['B']
restart/retry: same-version rows absent; job completed
```

첫 출력의 B는 **옛 writer가 살아 있는 동안 먼저 삭제한 결과**다. 두 번째 경로는 tombstone으로 검색을 막은 채 W의 종료를 기다리고 삭제를 반복한다. 삭제 호출 뒤 완료 기록 전에 죽어도 작업 기록이 남아 있으므로 재시작 후 같은 버전을 다시 확인할 수 있다. 반복 삭제가 안전하려면 그 버전의 벡터 식별자가 새 버전과 겹치지 않아야 한다.

이 모델의 가장 강한 가정은 `inflight`가 진짜 외부 쓰기의 종료를 뜻한다는 것이다. 실제 시스템에서 단순 메모리 집합이나 만료된 lease만으로 이를 구현하면, 죽은 줄 알았던 W가 삭제 뒤 다시 저장할 수 있다. writer와 삭제가 같은 버전의 외부 쓰기를 직렬화하는 경로, 저장소가 검사하는 세대별 쓰기 권한, 또는 늦은 쓰기를 계속 탐지·재삭제하는 조정 절차 중 무엇으로 이 틈을 닫을지 설계해야 한다. 그런 보장이 없다면 '최종 벡터 정리 완료'를 선언하지 않는다.

## 실패 뒤 어느 단계로 돌아갈까

삭제 요청을 받은 직후 DB에 tombstone만 기록하고 작업 기록을 나중에 쓰면 그 사이의 종료에서 정리 근거가 사라진다. 둘을 한 DB 트랜잭션에 저장하거나 동등한 내구성 있는 의도 기록을 먼저 남긴다. 이 저장이 실패하면 삭제 접수를 성공으로 응답할 수 없다.

벡터 삭제 요청이 실패하면 tombstone은 유지하고 작업은 재시도 가능 상태로 남긴다. 요청은 성공했지만 응답을 잃은 경우에는 같은 버전의 벡터 상태를 다시 확인한 뒤 반복 삭제한다. 영구적인 입력 오류나 버전 식별 불능은 같은 호출을 무한히 반복할 이유가 아니다. 정리 책임을 가진 서비스와 결과를 확인하는 서비스가 다르다면 각자의 완료 기록도 연결해야 한다. [삭제 실행 책임의 경계](/posts/moving-cleanup-execution-ownership/)

검증할 때는 ① tombstone 직후 새 검색, ② 옛 writer를 멈췄다가 재개, ③ 외부 삭제 직후 종료·재시작을 따로 끼워 넣는다. 이 예제는 상태 순서만 확인한다. 실제 Milvus에서는 선택한 일관성 수준으로 **대상 버전의 식별자 전체**를 조회하는 검증이 필요하며, top-k 검색에서 우연히 안 나왔다는 사실은 부재 증명이 아니다. 저장 공간 회수는 그 뒤의 별도 운영 관측이다.
