---
title: Kafka vs Redis - 실시간 메시징 아키텍처 선택
description: Redis Pub/Sub과 Kafka의 전달 의미를 비교하고, 소비 그룹, 처리 완료와 WebSocket 연결 라우팅을 구분한다.
categories: [architecture, messaging]
tags: [kafka, redis, websocket, sse, realtime, pub/sub, streaming, golang]
date: 2024-12-10
mermaid: true
---

LLM의 스트리밍 응답을 여러 Pod에서 WebSocket이나 SSE로 전달할 때, 메시지 브로커를 바꾸면 순서와 유실 문제가 함께 해결될 것 같았다. 하지만 브로커의 저장 보장, 소비자의 처리 완료, 실제 연결을 가진 Pod로의 전달은 서로 다른 문제였다.

> 2026-09-29 보완: 기존 글의 “Consumer Group이면 한 번만 처리된다”는 설명을 바로잡았다. 근거 조건이 없는 지연 시간 비교도 제거했다.

## 먼저 유실을 허용할 수 있는지 정한다

| 요구사항 | Redis Pub/Sub | Kafka |
| --- | --- | --- |
| 현재 구독자에게 전달 | 채널 구독자에게 발행 | 토픽을 소비하는 클라이언트가 읽음 |
| 연결이 끊긴 동안의 메시지 재생 | 제공하지 않음 | 보관 중인 로그와 소비 위치를 바탕으로 가능 |
| 처리 진행 위치 | Pub/Sub 자체에는 없음 | 파티션별 소비 위치 관리 |
| 애플리케이션 처리 완료 | 별도 설계 필요 | 별도 설계 필요 |

Redis Pub/Sub은 at-most-once 전달 방식이다. 구독자가 연결을 잃거나 메시지를 처리하지 못해도 Pub/Sub이 재전달하지 않는다. Redis의 RDB/AOF 설정을 켠다고 Pub/Sub 채널이 재생 가능한 로그가 되는 것도 아니다. [Redis Pub/Sub 전달 의미](https://redis.io/docs/latest/develop/pubsub/)

유실돼도 다음 상태 조회로 복구할 수 있는 알림과, 반드시 재처리해야 하는 문서 작업은 같은 기준으로 선택하기 어렵다.

## Kafka의 순서와 Consumer Group을 구분한다

Kafka 로그의 순서는 **파티션 안에서** 정해진다. 같은 키를 같은 파티션에 배치하는 설정을 쓰더라도 파티셔너나 파티션 수를 바꾸면 매핑이 달라질 수 있다. 읽은 레코드를 병렬 작업으로 넘겼다면 로그 순서와 처리 완료 순서도 달라진다.

Consumer Group은 파티션의 소비를 멤버에게 나눠 맡긴다. 이것이 메시지의 업무 처리를 한 번만 실행한다는 뜻은 아니다. 외부 DB에 쓴 뒤 오프셋을 커밋하기 전에 종료되면 같은 레코드를 다시 처리할 수 있다. 반대로 처리 전에 커밋하면 중단된 작업을 건너뛸 수 있다. [Kafka의 전달 의미와 트랜잭션](https://kafka.apache.org/41/design/design/#message-delivery-semantics)

<iframe src="/assets/diagrams/2026-09-29/message-completion-boundary.html" title="메시지 처리와 완료 기록 사이의 장애 구간" loading="lazy" width="100%" height="552" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기: 메시지 처리와 완료 기록](/assets/diagrams/2026-09-29/message-completion-boundary.html)

외부 저장소에 쓰는 작업은 중복 실행을 받아도 결과가 유지되는 멱등성 키나 원자적인 결과·완료 기록이 필요하다. Kafka 내부 트랜잭션의 보장을 외부 DB와 WebSocket 전송까지 자동으로 확장해서는 안 된다.

[잘못된 메시지 하나가 파티션을 막았던 사례](/posts/kafka-poison-partition-and-commit-frontier/)에서는 이 문제를 더 구체적으로 다룬다. 완료한 뒤쪽 메시지가 있다고 앞에서 실패한 메시지를 넘어 커밋할 수는 없다.

## 메시지를 받은 Pod가 연결을 가진 Pod인가

공유 Consumer Group이 선택한 소비자가 특정 WebSocket 연결을 소유한 Pod라는 보장은 없다. `connectionID`를 Kafka 키로 쓰는 것만으로 그 Pod에 배달되는 것도 아니다.

연결 소유자를 찾는 정보와 전달 경로를 별도로 설계해야 한다. 연결이 다른 Pod로 이동하거나 재접속하는 순간, 이전 연결로 가던 메시지를 어떻게 처리할지도 정해야 한다. 로컬 전송과 브로커 전달을 섞는다면 두 경로 사이의 순서와 중복도 확인해야 한다.

이는 브로커 선택에서 얻은 설계 교훈이다. 이 글이 특정 라우팅 방식의 운영 검증까지 제시하는 것은 아니다.

## INCR은 번호를 만들지만 도착 순서를 맞추지는 않는다

Redis `INCR`로 동일 키의 번호를 원자적으로 증가시킬 수 있다. 그러나 먼저 번호를 받은 작업이 늦게 전송될 수 있으므로 수신 순서까지 보장하지는 않는다. 번호를 이용하려면 수신 측의 중복 제거, 누락 감지와 재정렬 정책도 필요하다. [INCR 명령](https://redis.io/docs/latest/commands/incr/)

Redis 장애 시 각 Pod의 로컬 카운터로 돌아가는 방식은 전역 번호의 유일성을 유지하지 못한다. 번호가 정확성에 필요한 값이라면 오류를 반환하거나 다른 식별 체계를 사용해야 한다.

## 지연 시간은 경로 전체에서 측정한다

“Redis는 1ms 미만, Kafka는 10–100ms”처럼 고정값으로 비교하지 않는다. 배치 대기, 복제 확인, 네트워크, 소비 지연, WebSocket 쓰기까지 측정 범위에 따라 결과가 달라진다.

새 시스템을 선택할 때는 “소비자가 처리 직후 죽으면 무엇이 다시 실행되는가?”를 먼저 확인해 보자. 그 답이 정해진 뒤에 필요한 내구성과 지연 시간을 비교해야 한다.
