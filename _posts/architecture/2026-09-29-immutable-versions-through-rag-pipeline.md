---
title: "파일을 바꾸었는데 답변은 왜 옛 문서를 인용할까"
description: "RAG에서 원본 버전과 검색에 공개한 색인 버전을 분리하고, 부분 색인과 전환 중 읽기가 만드는 오류를 실행 가능한 예제로 확인한다."
categories: [architecture, distributed systems]
tags: [rag, vector-search, embeddings, consistency, provenance]
date: 2026-09-29
---

사용 설명서를 새로 올렸는데 챗봇은 예전 절차를 안내한다. 새 파일이 존재한다는 사실만으로 새 내용이 검색된다고 볼 수 있을까? 파싱, 청크 분할, 임베딩, 벡터 저장, 검색이 따로 진행된다면 **최신 원본**과 **지금 검색에 공개한 색인**은 서로 다른 시각을 가리킬 수 있다.

아래의 `manual`은 설명을 위한 가상 문서다. 실제 장애나 특정 서비스의 구현을 재현한 사례는 아니다. 이 예제에서 지킬 계약은 하나다. **한 번의 검색과 인용은 하나의 완성된 색인 세대와 그 세대를 만든 원본 버전을 사용한다.** 최신 원본을 즉시 검색해야 한다는 뜻은 아니다. 새 세대가 준비될 때까지 이전 버전을 제공할지, 검색을 잠시 중단할지는 별도 정책이다.

## 같은 파일명 아래 서로 다른 세 개의 시각

`manual.pdf`는 위치를 나타내지만, 그 이름만으로 읽은 바이트를 특정할 수 없다. 처리 작업이 시작할 때 경로를 기록하고 나중에 그 경로를 열면 그사이 교체된 파일을 읽을 수도 있다. 처리 입력은 불변 원본 버전에 묶고, 인용을 열 때도 그 버전을 다시 요청해야 한다. 예를 들어 S3 버전 관리에서는 일반 GET이 현재 버전을 읽고, 특정 버전을 읽으려면 version ID를 지정한다. 저장소의 version ID와 독자에게 보여 주는 문서 버전은 별개로 관리할 수도 있다. [S3 객체 버전 조회](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RetrievingObjectVersions.html)

이 설계에는 적어도 세 가지 정체성이 있다.

| 정체성 | 답하는 질문 | 예시 |
| --- | --- | --- |
| 원본 버전 | 어떤 바이트를 읽었나 | `manual`의 버전 2 |
| 색인 세대 | 어떤 원본과 처리 설정으로 검색 자료를 만들었나 | 버전 2 + 청크 규칙 B + 임베딩 모델 M |
| 공개 포인터 | 새 검색 요청이 어느 완성된 세대를 읽나 | 현재 세대 1, 준비 중인 세대 2 |

재시도 횟수는 원본 버전과 다르다. 같은 바이트의 임베딩을 다시 만들었다고 원본이 새 버전이 되지는 않는다. 반대로 원본이 같아도 청크 규칙이나 임베딩 모델을 바꾸면 파생 색인은 새 세대다. 모델을 바꾼 뒤에는 질의 벡터도 그 색인에 맞는 모델과 설정으로 만들어야 한다. 서로 다른 모델이 만든 벡터의 코사인 점수를 같은 공간의 점수처럼 섞는다고 의미가 보장되지는 않는다. Qdrant 문서도 모델 변경 시 새 벡터를 다시 만들고, 별도 컬렉션을 사용하는 경우 색인을 구축한 뒤 별칭을 전환하는 방법을 설명한다. [Qdrant 컬렉션과 별칭](https://qdrant.tech/documentation/manage-data/collections/)

<iframe src="/assets/diagrams/2026-09-29/rag-version-identity.html" title="원본 버전과 검색·인용의 연결" loading="lazy" width="100%" height="584" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기](/assets/diagrams/2026-09-29/rag-version-identity.html)

그림의 화살표는 자료의 흐름을 나타낸다. 원본에서 검색 자료를 만드는 연결과, 검색한 결과에서 정확한 원본 인용으로 돌아가는 연결이 모두 필요하다. 버전 태그는 그 연결을 표현하는 재료이지, 그 자체가 공개 시점을 정해 주지는 않는다.

## 태그만 붙이면 남는 두 번의 틈

가상의 `manual` 버전 2가 청크 A와 B를 만든다고 하자. 다음 순서에는 모든 청크에 올바른 버전 태그가 있어도 오류가 난다.

| 순서 | 원본·색인 상태 | 태그만 보고 검색하면 |
| --- | --- | --- |
| 1 | 버전 1의 A·B가 검색 가능 | 버전 1을 읽음 |
| 2 | 버전 2 원본 저장, 새 색인의 A만 보임 | 버전 1과 2가 섞이거나, 버전 2로 필터링해도 B가 빠짐 |
| 3 | 버전 2의 A·B가 모두 보임 | 새 세대를 공개할 후보가 됨 |
| 4 | 검색자가 공개 세대 1을 읽은 직후 포인터가 2로 바뀜 | 인용 단계에서 포인터를 다시 읽으면 버전 1 검색 결과에 버전 2 파일을 붙임 |

2번의 문제는 검색 결과의 `version=2`가 거짓이어서 생기지 않는다. 결과가 **부분 집합**이라는 사실을 태그가 말해 주지 않기 때문이다. 4번도 각 단계의 버전 값은 맞다. 검색과 인용이 서로 다른 순간의 공개 포인터를 읽은 것이 문제다. 읽기 시작할 때 공개 세대를 한 번 정하고, 검색·인용에 그 값을 계속 전달해야 한다.

## 완성한 뒤 공개하고, 읽는 동안 고정한다

한 가지 구현 방식은 새 색인을 기존 세대와 분리해서 만드는 것이다. 원본 버전과 파서·청크·임베딩 설정을 고정하고, 예상 청크 집합과 실제 저장·조회 가능한 집합을 대조한다. 준비가 확인된 뒤에만 새 요청이 읽을 공개 포인터를 바꾼다. 이미 시작한 요청은 앞서 읽은 포인터로 끝까지 진행한다.

아래 Python 3 예제는 그 순서를 일부러 한 단계씩 실행한다. 딕셔너리는 저장소와 검색 가시성을 흉내 낼 뿐이다. 벡터 검색 품질, 실제 DB의 원자성, 권한 검사는 모델링하지 않는다.

```python
source = {1: "old manual", 2: "new manual"}
chunks = {1: {"a": "old A", "b": "old B"}, 2: {}}
visible = {1: {"a", "b"}, 2: set()}
expected = {"a", "b"}
published = [1]

def read():
    version = published[0]  # 요청 전체에서 한 번만 읽는다.
    hits = tuple(chunks[version][key] for key in sorted(visible[version]))
    return version, hits

def publish(version):
    assert set(chunks[version]) == visible[version] == expected
    published[0] = version

chunks[2]["a"] = "new A"
visible[2].add("a")
try:
    publish(2)
except AssertionError:
    pass  # 청크 B가 보이기 전에는 공개하지 않는다.
else:
    raise AssertionError("partial index was published")
assert read() == (1, ("old A", "old B"))
print("partial index -> published source:", source[read()[0]])

chunks[2]["b"] = "new B"
visible[2].add("b")
pinned_version, pinned_hits = read()    # 검색자는 세대 1을 잡았다.
publish(2)                              # 그 사이 공개 포인터가 바뀐다.
unsafe_citation = source[published[0]]  # 포인터를 다시 읽는 잘못된 인용
safe_citation = source[pinned_version]  # 저장한 세대로 전환 후 인용 조회
old_hit = pinned_hits[0]
assert (old_hit, unsafe_citation) == ("old A", "new manual")
assert (pinned_version, pinned_hits, safe_citation) == (
    1, ("old A", "old B"), "old manual"
)
next_version, next_hits = read()
assert (next_version, next_hits, source[next_version]) == (
    2, ("new A", "new B"), "new manual"
)
print("unpinned citation:", old_hit, "/", unsafe_citation)
print("pinned read:", pinned_version, pinned_hits, "/", safe_citation)
print("next read:", next_version, next_hits, "/", source[next_version])
```

첫 출력에서는 새 청크 하나가 보이지만 공개된 검색은 여전히 옛 원본을 사용한다. 두 번째 출력은 실제로 만들면 안 되는 `old A / new manual` 조합이다. 세대 1을 잡은 요청은 포인터가 바뀐 **뒤에** 저장한 세대로 원본을 조회해 `old manual`을 얻고, 다음 요청부터 세대 2를 읽는다. 이 예제의 `assert`는 부분 색인과 읽기 중 전환만 고정된 순서로 재현한다. 다중 작업자의 경쟁과 조건부 원자 갱신은 검증하지 않는다. 실제 서비스에서는 포인터 확인과 갱신을 조건부 원자 연산으로 구현하고, 검색자가 붙잡은 옛 세대를 요청이 끝나기 전에 지우지 않아야 한다.

예를 들어 공개 포인터를 관계형 DB 행에 둔다면, 읽은 세대가 여전히 예상 값이고 새 세대가 준비됐다는 조건을 확인하며 갱신해야 한다. 늦게 끝난 옛 작업이 더 최신 세대를 다시 덮지 못하도록 목표 원본 버전도 그 조건에 포함한다. PostgreSQL 트랜잭션은 한 트랜잭션의 중간 쓰기를 다른 트랜잭션에 노출하지 않지만, 기본 Read Committed에서는 같은 트랜잭션 안의 연속된 두 SELECT도 서로 다른 커밋을 볼 수 있다. 그러므로 검색과 인용이 포인터를 두 번 조회하는 코드는 트랜잭션을 쓴다는 이유만으로 안전해지지 않는다. [PostgreSQL 트랜잭션](https://www.postgresql.org/docs/current/tutorial-transactions.html), [트랜잭션 격리](https://www.postgresql.org/docs/current/transaction-iso.html)

## 색인 쓰기 성공과 검색 준비는 다르다

예제의 `visible`은 실제 저장소에서 별도로 확인해야 할 경계다. 쓰기 API가 성공했어도 검색 노드에서 그 쓰기가 언제 보이는지는 제품과 읽기 설정에 달려 있다. Milvus는 Strong, Bounded, Session, Eventually 수준을 구분하고, 검색 요청에도 일관성 수준을 지정할 수 있다. 어떤 수준을 쓸지와 준비 판정 시점을 함께 정해야 한다. [Milvus consistency level](https://milvus.io/docs/consistency.md)

예상 청크 수만 맞아도 충분하지 않다. 중복 청크가 하나를 대신했는지, 각 청크가 같은 원본 버전과 처리 설정에서 왔는지, 검색 가능한 결과가 예상 ID와 일치하는지 확인해야 한다. 모델의 `set(chunks) == visible == expected`는 이 조건의 작은 축약이다. 실제 검색 색인의 가시성 검사는 해당 저장소의 API와 일관성 설정에 맞춰야 하며, 벡터 검색의 top-k 결과만으로 전체 청크 존재를 증명할 수는 없다.

실패 지점도 분리해 다룬다. 색인 구축 중 실패하면 공개 포인터는 옛 세대를 유지하고 미완성 세대는 검색 대상에서 격리한다. 색인이 준비됐지만 포인터 갱신에 실패했다면 재시도 전에 현재 공개 값과 목표 버전을 다시 읽는다. 포인터 갱신이 성공하고 응답만 유실됐다면 무조건 다시 전환하지 말고 현재 값을 확인한다. 공개 뒤에도 옛 세대를 읽는 진행 중 요청과 과거 인용이 있으므로, 정리 시점은 새 세대 공개 시점과 같지 않다.

Qdrant의 컬렉션 별칭 전환은 한 벡터 저장소 안에서 별칭 변경을 원자적으로 수행하는 구체적인 수단이다. 이 보장은 별도 원본 저장소나 인용 메타데이터까지 하나의 트랜잭션으로 묶어 주지는 않는다. 그런 경계가 여러 저장소에 걸치면 애플리케이션의 공개 포인터와 읽기 고정 계약을 따로 설계해야 한다. [Qdrant 컬렉션 별칭](https://qdrant.tech/documentation/manage-data/collections/)

## 여러 문서와 인용으로 계약을 넓히기

문서 A의 버전 2와 문서 B의 버전 7만 검색하기로 했다면, 문서 ID가 `{A, B}`에 있고 버전이 `{2, 7}`에 있는지만 따로 검사해서는 안 된다. `(A, 7)`도 그 조건을 통과한다. 검색 필터는 `(A AND 2) OR (B AND 7)`처럼 문서와 버전의 쌍을 보존해야 한다. 독립 문서의 최신 공개 버전을 각각 읽는 정책이라면 한 요청에서 어느 쌍들을 선택했는지 고정한다. 문서 전체가 같은 발행 시점을 공유해야 하는 제품이라면 문서별 쌍만으로는 부족하고, 묶음 전체의 공개 세대가 추가로 필요하다.

인용도 검색 결과의 원본 버전으로 연결한다. 나중에 링크를 열 때 파일명만 다시 조회하면 최신 파일이 열려 당시의 근거와 달라질 수 있다. 다만 과거 버전을 가리키는 링크가 현재 읽기 권한까지 주는 것은 아니다. 열람 시점의 권한을 다시 확인해야 하고, 보존 기간이 끝나 버전을 더 이상 제공하지 않는다면 다른 버전으로 조용히 대체하지 말아야 한다.

| 공개 정책 | 독자가 얻는 것 | 운영 비용과 한계 |
| --- | --- | --- |
| 새 세대 준비까지 이전 버전 제공 | 검색 연속성 | 화면·답변에 사용 버전을 표시하고 옛 원본을 보존해야 함 |
| 새 원본 도착 시 검색 중단 | 최신 파일과 다른 근거를 피함 | 색인 지연 동안 결과가 비어 있음 |

어느 선택이든 “새 파일이 올라왔다”와 “새 파일이 검색·인용에 공개됐다”를 별도로 관측해야 한다. 다음에 비슷한 문제를 조사한다면 답변 문장의 품질을 평가하기 전에, **검색 요청이 잡은 공개 세대, 결과의 원본 버전, 인용이 실제로 연 버전** 세 값을 먼저 대조해 보자.
