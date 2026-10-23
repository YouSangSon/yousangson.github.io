---
title: "Mimir 개발기: 데이터 소스를 연결한 뒤에 남는 일"
description: "Mimir의 소스 선택부터 JSONL 저장까지 따라가며 커넥터 지원과 이용 승인을 구분한다. 수정되는 거시 지표, 재생성되는 분석 결과, FRED 연동 제거가 보여 주는 데이터 수명 관리의 경계를 살펴본다."
date: 2026-10-24
categories: [projects, data-engineering]
tags: [mimir, python, data-pipeline, jsonl, provenance, idempotency]
related:
  - slug: timeout-unknown-outcome-and-idempotency
    reason: 같은 입력을 다시 처리할 때 무엇을 같은 작업으로 볼지 더 살펴봅니다.
  - slug: moving-cleanup-execution-ownership
    reason: 수집 중단과 기존 데이터 삭제의 실행 책임을 나누는 문제로 이어집니다.
---

데이터 API가 정상 응답했고 수집 코드도 동작한다. 이제 응답을 저장소에 계속 쌓고 분석 보고서에 써도 될까. 개인 프로젝트 Mimir를 만들며 다루게 된 문제는 커넥터의 동작 여부만으로 이 질문에 답할 수 없다는 점이다.

[Mimir](https://github.com/YouSangSon/Mimir)는 공시·가격·거시 지표·뉴스를 모아 JSONL 파일에 저장하고 분석과 보고서로 연결하는 파이프라인이다. 이 글은 [공개 커밋 `1449836`](https://github.com/YouSangSon/Mimir/tree/14498368599056d68dc0e87ed24d98f86142df3c)의 구현을 기준으로 한다. 소스를 읽어 수집·저장 경계를 설명하며 외부 API 호출이나 투자 성과를 검증한 글은 아니다.

## 소스 목록에 있다는 것의 의미

Mimir에는 서로 다른 두 판단이 있다. 실행 코드가 판단하는 것은 필요한 키와 패키지가 있는지, 이번 수집 주기에 해당하는지, 운영자가 꺼 놓았는지다. 해당 데이터의 출처와 이용 조건, 보관과 파생물 공개 범위를 검토하는 일은 그보다 넓다.

예를 들어 `Registry.due()`는 수집 주기가 맞는 소스 중 `disabled_ids`에 없는 것을 고른다. `gray_enabled`가 꺼져 있으면 `GRAY`로 표시된 소스도 제외한다. 이 함수는 약관을 읽거나 개별 데이터의 권리를 확인하지 않는다. `OFFICIAL` 표시 역시 소스의 메타데이터다. 프로젝트 README도 공식 API라는 표시를 이용 승인으로 취급하지 않으며 ECOS의 계열별 출처와 권리 검토를 미완료 항목으로 남겨 둔다. [소스 선택 구현](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/core/registry.py) · [프로젝트의 이용 경계](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/README.md#-legality--safety)

이 구분이 없으면 API 키를 발급받았다는 사실이 영구 보관과 재배포까지 승인됐다는 뜻으로 커질 수 있다. Mimir의 설정은 실행을 제어하는 수단이다. 별도의 승인 기록을 갖춘 정책 엔진으로 읽어서는 안 된다.

## 거시 지표 한 건이 파일에 도착하기까지

일별 수집 진입점은 `mimir.collect`다. 설정과 관심 종목을 검증한 뒤 `build_sources()`가 소스 객체를 만든다. ECOS는 키가 없으면 생성 대상에서 빠진다. 키가 있더라도 Registry의 주기·비활성화 설정을 통과해야 이번 실행에 포함된다. 아래 흐름은 **운영자가 해당 계열의 이용 범위를 검토했다는 전제**에서 설명하는 코드 경로다. 구현 자체가 그 검토를 강제하지는 않는다. [수집 진입점](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/collect.py) · [소스 생성](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/core/builder.py)

가상의 ECOS 응답에서 통계 코드가 `STAT`, 항목 코드가 `ITEM`, 관측 시점이 `202608`, 값이 `2.50`이라고 하자. 실제 통계의 코드나 수치를 옮긴 예제가 아니다. 어댑터는 이 응답을 다음 의미로 바꾼다.

| 단계 | 이 예제에서 만들어지는 값 | 그 값이 맡는 역할 |
| --- | --- | --- |
| ECOS 어댑터 | `ecos:STAT:ITEM:202608` | 같은 계열·관측 시점의 중복 판별 키 |
| 시각 변환 | `ts = 2026-08-01 00:00 UTC` | 월 단위 관측값을 넣을 날짜 파티션 결정 |
| 정규화 | `source=ecos`, `dataset=macro`, `value=2.50`, `captured_at=수집 시각` | 출처·종류·값·수집 시각을 공통 Record로 묶음 |
| 저장 정책 | `macro`이므로 덮어쓰기 허용 | 같은 키의 값이 수정되면 교체 |
| JSONL 저장 | `data/macro/2026/08/01.jsonl` | 관측 날짜에 따른 파일 저장 |
| 실행 기록 | 수집·저장·무효 건수와 성공 여부 | 데이터 파일과 별도로 이번 실행 결과를 남김 |

`ts`는 통계가 가리키는 시점이고 `captured_at`은 Mimir가 가져온 시각이다. 10월에 8월 지표를 다시 받아도 저장 위치는 8월 파티션이다. 정규화 과정에서는 데이터 종류에 맞는 payload, 즉 실제 값 묶음의 구조를 검증한다. 필수 필드가 맞지 않으면 정상 데이터로 저장하지 않고 무효 건수를 늘린다. [ECOS 변환](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/sources/ecos.py) · [정규화와 검증](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/core/normalize.py)

Orchestrator는 소스마다 가져오기·정규화·저장을 묶어 수행하고 결과를 Manifest라는 실행 기록에 쓴다. 한 소스의 예외는 실패 결과로 남겨 다른 소스 수집을 이어 간다. 따라서 전체 명령의 실패 표시만 보면 어느 소스까지 저장됐는지 알 수 없다. 소스별 결과를 함께 읽어야 한다. 일부 레코드가 검증에서 탈락해도 해당 소스는 `ok=true`일 수 있으므로 `invalid`도 확인해야 한다. [수집 조정과 실패 처리](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/core/orchestrator.py)

## 같은 키를 다시 받으면 무엇을 보존할까

위 지표가 나중에 `2.75`로 수정되었다고 하자. 모든 데이터에 중복 무시를 적용하면 값은 계속 `2.50`에 머문다. 반대로 모든 파일을 새 결과로 교체하면 재수집 범위에 없던 과거 데이터까지 잃을 수 있다. Mimir는 수집 원본과 다시 만드는 결과의 저장 방식을 나눈다.

| 입력 상황 | 적용되는 방식 | 남는 결과 |
| --- | --- | --- |
| 가격·공시·뉴스에서 같은 날짜 파티션의 같은 키 재수집 | 먼저 저장한 값 유지 | 중복 행을 추가하지 않음 |
| 거시 지표의 같은 키가 `2.50 → 2.75`로 수정 | 나중 값으로 교체 | 현재 JSONL에는 `2.75`가 남음 |
| 거시 지표의 값과 나머지 내용은 같고 수집 시각만 변경 | 변경 없는 재수집으로 처리 | 기존 행과 수집 시각 유지 |
| 일별 분석을 다시 돌렸는데 결과가 3건에서 1건으로 감소 | 해당 날짜 결과 전체 교체 | 새 1건만 남고 오래된 2건은 사라짐 |
| 일별 분석을 다시 돌렸는데 결과가 0건 | 해당 날짜 결과 제거 | 이전 결과가 오늘도 유효한 것처럼 남지 않음 |

이는 구현에서 도출한 예시이며 실행 측정표는 아니다. 수집 경로의 `append_overwrite_enabled()`는 거시 지표에만 덮어쓰기를 켠다. 분석 엔진은 `replace_partition()`으로 그날의 결과 전체를 바꾼다. 데이터가 줄어든 재실행에서는 새 행만 덮어쓰는 것으로 부족하기 때문이다. [저장 정책](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/storage/policy.py) · [JSONL 저장소](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/storage/jsonl_store.py) · [분석 결과 교체](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/mimir/analysis/engine.py)

이 선택에는 비용도 있다. 현재 거시 지표 파일은 수정된 최신 값을 담는다. 과거 특정 날짜에 알려져 있던 값을 그대로 복원하는 시점별 이력 저장소는 아니다. Git에 커밋한 변경을 추적할 수 있어도 모든 수집 시점의 버전을 질의하는 분석 모델이 저절로 생기지는 않는다. 과거 정보만으로 전략을 평가하려면 당시 이용 가능했던 값과 공개 시점을 따로 모델링해야 한다.

## FRED를 제거할 때 수집 버튼만 끄지 않은 이유

공개된 2026년 8월 31일 설계에는 FRED 연동을 제거한 결정이 남아 있다. 당시 프로젝트는 검토한 서비스·API 조건과 Mimir의 지속 저장 및 소프트웨어·ML 연결 사용 방식이 충돌한다고 판단했다. 여기서 다루는 것은 **그 시점의 프로젝트 결정과 구현 범위**다. 모든 FRED 이용에 대한 현재의 법적 결론으로 일반화하지 않는다. [FRED 제거 설계](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/docs/superpowers/specs/2026-08-31-fred-terms-safety-boundary-design.md)

제거 범위가 넓었던 이유는 새 수집을 막아도 데이터가 들어오는 다른 길과 이미 저장된 데이터가 남기 때문이다. 기본 소스 등록에서 FRED를 빼고 키 연결을 제거했으며 예전 `sources.fred` 설정은 알 수 없는 설정으로 거부하도록 했다. 과거 구간을 가져오는 backfill에서도 FRED를 대상으로 실행할 수 없게 했다.

읽기 경계도 바뀌었다. 현재 `macro` payload는 ECOS 구조를 받는다. 예전 FRED 형식의 JSONL을 읽으면 구조 검증에서 거부되어 분석으로 그대로 흘러가지 않는다. 공개 테스트에는 이전 키를 넣어도 FRED 요청과 데이터 저장이 생기지 않는지, backfill이 네트워크·저장 전에 실패하는지, 이전 형식이 읽기 단계에서 거부되는지를 확인하는 사례가 있다. 이 글에서는 해당 테스트를 다시 실행하지 않았다. [이전 데이터 거부 테스트](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/tests/storage/test_record_envelope.py) · [backfill 경계 테스트](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/tests/test_backfill.py)

다만 읽기 거부가 삭제를 대신하지는 않는다. 설계는 기존 데이터의 위치와 파생물을 식별하고 삭제나 재생성은 운영자의 명시적 승인 아래 수행하도록 구분한다. 임시 격리는 최종 정리와 다르다. 이미 만든 보고서나 다른 복제본까지 코드 변경 하나로 사라지는 것도 아니다.

## 작은 저장소가 맡을 수 있는 범위

텍스트 JSONL을 Git으로 관리하면 파일을 열어 보고 수정 diff를 확인하기 쉽다. 대신 현재 저장 구현은 파티션 파일을 직접 다시 쓰며 DB 트랜잭션이나 여러 writer 사이의 잠금을 제공하지 않는다. 재실행의 중복 방지 규칙이 동시 쓰기나 중간 실패의 안전성까지 보장하지는 않는다.

또한 Record에는 출처와 관측·수집 시각이 있지만 승인 근거 문서와 허용 용도, 보존 만료일을 필수로 묶는 구조는 없다. 새 소스를 연결할 때 확인할 일은 그래서 두 갈래다. 어떤 입력을 받아 어떤 파일을 만드는지 따라가고 그 파일과 파생 결과를 언제까지 어떤 용도로 보관할 수 있는지 별도로 확인해야 한다. 전자가 구현되어 있어도 후자는 미완료일 수 있다.

다른 수집기에 이 방식을 적용한다면 같은 키를 두 번 넣는 경우에서 시작할 수 있다. 값이 그대로일 때, 값이 수정됐을 때, 재분석 결과가 없어졌을 때 각각 무엇이 남아야 하는지 정한다. 이어 소스 사용을 중단했을 때 새 요청·과거 데이터 읽기·기존 보고서가 어디에서 멈추는지 따라가면 커넥터 추가만으로 끝나지 않는 작업 범위가 보인다.

## 프로젝트

- [Mimir 공개 저장소와 제작자 YouSangSon](https://github.com/YouSangSon/Mimir)
- [검토한 판본의 README](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/README.md)
- [MIT 라이선스](https://github.com/YouSangSon/Mimir/blob/14498368599056d68dc0e87ed24d98f86142df3c/LICENSE): 프로젝트 코드의 라이선스이며 수집 대상 데이터의 이용 조건을 대신하지 않는다.
