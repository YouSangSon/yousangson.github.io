---
title: "Kafka와 Redis로 실시간 답변의 유실을 어디까지 복구할까"
description: Redis Pub/Sub과 Kafka의 전달 의미를 비교하고, 소비 그룹, 처리 완료와 WebSocket 연결 라우팅을 구분한다.
categories: [architecture, messaging]
tags: [kafka, redis, websocket, sse, realtime, pub/sub, streaming, golang]
date: 2024-12-10
mermaid: true
updated: '2026-10-09'
related:
  - slug: distributed-lock-ttl-auto-renewal
    reason: 락의 만료 뒤에도 이전 작업이 계속 실행되는 경우를 살펴봅니다.
  - slug: redis-lock-queue-race-condition-fix
    reason: 큐에서 꺼낸 작업의 책임과 실패 후 복구 조건을 확인합니다.
---

스트리밍 답변을 받던 브라우저가 잠깐 끊겼고 다시 연결하니 뒤쪽 문장만 보인다. 브로커를 고를 때는 발행한 이벤트를 보관하는 기능과 브라우저가 놓친 부분을 다시 보내는 기능을 구분해야 한다. Kafka와 Redis의 차이를 이 두 책임으로 나누면 연결 복구에 어떤 상태와 전달 기능이 필요한지 판단할 수 있다.

가상의 답변 `A`, `B`, `C`를 보내는 서비스를 생각해 보자. **유실된 이벤트를 무엇으로 복구할지**, **어디까지 전달돼야 완료로 볼지**를 정하면 필요한 브로커 기능도 좁힐 수 있다.

## 먼저 이벤트가 사라졌을 때의 답을 정한다

같은 실시간 화면에도 서로 다른 요구가 있다. “문서 처리 상태가 바뀌었다”는 알림을 놓쳤다면 현재 상태를 다시 조회해 회복할 수 있다. 반면 중간 문자 조각만 가진 답변에서는 B를 잃고 C만 받았을 때 전체 내용을 만들 수 없다. 완성된 답변 원본을 따로 저장했다면 다시 조회할 수 있고, 그렇지 않다면 조각을 재생할 기록이 필요하다.

여기서 선택이 갈린다. 이벤트를 현재 상태가 바뀌었다는 힌트로 쓸지, 결과를 재구성하는 유일한 기록으로 쓸지다. 원본 상태가 별도로 있으면 알림의 유실을 감수할 여지가 생긴다. 이벤트만이 원본이라면 기록의 보존과 재생이 요구사항에 들어간다.

Redis Pub/Sub은 현재 구독자에게 보내는 at-most-once 전달 방식이며 끊긴 동안의 메시지를 다시 읽을 위치가 없다. Redis의 키·값 영속화를 켠다고 채널이 재생 가능한 로그로 바뀌지는 않는다. 재전달이 필요한 경우에는 Redis Streams처럼 다른 자료구조도 비교해야 한다. **Redis 전체와 Kafka를 비교하는 것과 Pub/Sub과 로그를 비교하는 것은 다르다.** [Redis Pub/Sub의 delivery semantics](https://redis.io/docs/latest/develop/pubsub/#delivery-semantics)

## 저장됐다는 응답은 브라우저가 읽었다는 응답이 아니다

전송 경로에 완료 지점을 표시하면 선택하기 쉬워진다.

```text
생성기 → 브로커 기록 → 소비자 읽기 → 연결 소유 서버 → 브라우저 적용
          ①             ②              ③                ④
```

①의 성공은 선택한 브로커 설정에서 기록이 받아들여졌다는 뜻이다. ② 뒤 소비자가 죽을 수 있고, ③의 socket 쓰기가 성공했어도 ④에서 화면에 반영되기 전에 연결이 끊길 수 있다. 소비 offset을 어디에서 커밋하느냐는 어떤 중단 구간을 재전달로 복구할지 결정한다.

Kafka 안에서 읽은 레코드를 처리해 다른 Kafka 토픽에 쓰고 offset을 함께 확정하는 트랜잭션과, 브라우저의 UI 상태를 같은 트랜잭션으로 바꾸는 것은 다른 문제다. 외부 DB나 브라우저까지 결과를 보장하려면 대상 시스템의 참여와 중복 처리 정책이 필요하다. [Kafka의 메시지 전달 의미](https://kafka.apache.org/41/design/design/#message-delivery-semantics)

<iframe src="/assets/diagrams/2026-09-29/message-completion-boundary.html" title="메시지 처리와 완료 기록 사이의 장애 구간" loading="lazy" width="100%" height="552" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기](/assets/diagrams/2026-09-29/message-completion-boundary.html)

“정확히 한 번”이라는 말을 쓰려면 대상부터 적는다. 브로커에 한 번 기록됐는지, 업무 상태에 한 번 반영됐는지, 브라우저가 한 번 그렸는지는 서로 다른 주장이다. 연결 재전송을 허용하고 화면 반영을 멱등하게 만드는 방식은 전송이 정확히 한 번인 방식과 같지 않다.

## 연결 소유권은 소비자 그룹이 정하지 않는다

WebSocket 연결이나, 서버가 브라우저로 이벤트를 보내는 SSE(Server-Sent Events) 연결은 특정 서버 프로세스가 소유한다. 반면 Kafka Consumer Group은 파티션을 멤버에게 배정한다. 파티션을 읽은 Pod가 해당 브라우저 연결을 가진 Pod라는 보장은 없다. `connectionID`를 레코드 키로 사용하더라도 파티션 선택에 영향을 줄 뿐 원하는 네트워크 연결로의 라우팅을 완성하지 않는다.

연결 전달을 설계하는 방법은 여러 가지다. 연결 서버마다 관심 있는 이벤트를 받을 수도 있고, 중간 소비자가 현재 연결 소유자를 찾아 전달할 수도 있다. 첫 방식은 구독 수와 fan-out 비용이 늘고, 두 번째는 소유자 조회·재접속·이전 연결의 지연된 전송을 다뤄야 한다. 별도 그룹을 많이 만들면 같은 레코드를 읽는 소비자 수와 작업량도 늘어난다.

재접속 때는 연결 세대를 바꾸고 이전 세대로 향한 늦은 이벤트를 새 연결에 무조건 채택하지 않도록 한다. 다만 이전 연결에서 놓친 **논리 이벤트**는 새 연결에도 필요할 수 있다. 연결의 정체성과 답변 이벤트의 정체성을 나누어야 하는 이유다. 이 설명은 설계 대안이며 특정 라우팅 구현의 성능 검증은 아니다.

## 재접속은 커서·중복·누락을 함께 다룬다

답변 하나의 조각에 1, 2, 3이라는 번호를 붙였다고 하자. 브라우저는 마지막으로 반영한 번호를 1로 기억한다. 재접속 후 3을 받으면 곧바로 이어 붙일 것이 아니라 2가 빠졌음을 알 수 있어야 한다. 서버가 2부터 재생해 3을 다시 보내더라도 두 번 표시해서는 안 된다.

[전체 실행 예제](/assets/examples/2026-09-29/messaging-depth/stream_resume.py)는 메모리의 이벤트 목록으로 이 동작을 검사한다. `python3 stream_resume.py`로 실행한다. 핵심 반영 함수는 다음과 같다.

```python
def apply(state, event):
    sequence, text = event
    if sequence <= state["last"]:
        return "duplicate"
    if sequence != state["last"] + 1:
        return "gap"
    state["text"] += text
    state["last"] = sequence
    return "applied"
```

```text
gap detected, replay applied, duplicate ignored: {'last': 3, 'text': 'ABC'}
cursor predates retention: full snapshot or explicit reset required
```

이 모델에서 번호는 **답변 하나의 연속된 애플리케이션 이벤트 번호**다. 여러 답변이 섞인 Kafka 파티션의 offset을 그대로 넣는 규칙이 아니다. Kafka offset에는 해당 답변과 무관한 레코드와 빈 구간이 있을 수 있다. 같은 숫자 모양이라도 어떤 범위에서 연속성을 보장하는지 먼저 정한다.

번호 발급 순서와 실제 도착 순서도 다르다. 2를 받은 생산자가 잠시 멈춘 사이 3이 먼저 도착할 수 있다. 번호는 누락을 **발견**할 정보이며 재전송·버퍼링 정책까지 자동으로 제공하지 않는다. 완성된 답변 snapshot을 돌려줄지, 빠진 구간을 재생할지, 일정 범위까지만 임시 보관할지 정해야 한다.

SSE의 `id`와 재접속 시 `Last-Event-ID`는 서버에 커서를 전달하는 수단이 될 수 있다. 그러나 표준이 서버의 로그 보관이나 재생 API까지 만들어 주는 것은 아니다. 서버는 요청한 커서가 보존 범위에 있는지 확인하고, 너무 오래된 커서이면 snapshot이나 명시적 reset으로 회복해야 한다. [HTML 표준의 Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

브라우저 메모리가 사라지는 새로고침까지 복구하려면 커서를 어디에 보관할지도 정해야 한다. 화면 상태와 커서를 별도로 저장하면 커서만 앞서거나 뒤처질 수 있으므로, 최종 snapshot으로 복원하는 방식과 비교한다. 모델은 연결 프로토콜이나 브라우저 저장을 구현하지 않고 순서 규칙만 검증한다.

## Kafka가 보존하는 순서와 애플리케이션의 순서

Kafka는 파티션 안의 로그 순서를 제공한다. 그 레코드를 병렬 worker에 넘기면 처리 완료 순서는 바뀐다. 같은 답변의 이벤트를 같은 파티션에 배치하는 전략도 파티션 수 변경·파티셔너·키 정책을 함께 봐야 한다. 로그에서 읽은 순서를 서비스의 최종 적용 순서라고 가정하지 않는다. [Kafka의 소비 위치와 파티션 모델](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)

뒤의 이벤트가 끝났다고 앞의 미완료 이벤트를 넘어 커밋하는 문제는 [파티션 재시도와 완료 prefix 글](/posts/kafka-poison-partition-and-commit-frontier/)에서 실험한다. 순서가 꼭 필요한 범위를 답변·문서·계정 중 무엇으로 잡느냐에 따라 병렬성도 달라진다. 모든 이벤트를 하나의 파티션에 넣으면 단순한 순서를 얻지만 처리 병렬성의 범위를 제한한다.

## 선택을 한 서비스 시나리오로 끝까지 적용한다

문서 처리 상태 알림이 사라져도 서버의 상태 조회로 복구할 수 있고, 재접속 때 항상 현재 상태를 다시 읽는 제품을 생각해 보자. 이 경우 Pub/Sub은 상태 변경을 빨리 알리는 경로가 될 수 있다. 알림 하나가 유실돼도 업무 상태를 잃지 않도록 원본 상태가 먼저 확정돼 있어야 한다.

반대로 문서 처리 요청 자체를 큐에 넣고 worker 장애 뒤에도 이어서 처리해야 한다면 기록·진행 위치·재전달이 필요하다. Kafka나 Redis Streams를 비교할 수 있으며, 외부 결과를 쓴 뒤 ack/offset을 확정하는 사이의 중복은 별도로 해결한다. 같은 Redis라도 Pub/Sub 대신 Streams를 고르면 보존할 상태와 운영 책임이 달라진다. [XACK](https://redis.io/docs/latest/commands/xack/), [XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/)

답변 조각을 하나도 놓칠 수 없는 제품이라면 브로커만 선택해서 끝나지 않는다. 답변별 이벤트 로그나 최종 원본, 클라이언트 커서, 재생 범위, 중복 적용 방지가 한 경로로 이어져야 한다. 토큰마다 기록할지 묶어서 기록할지도 응답 지연과 쓰기 수 사이의 선택이다.

지연 시간을 비교할 때는 이 완성된 경로에서 측정한다. 생성부터 브로커 확인, 소비 대기, 라우팅, 브라우저 적용까지 어디를 포함했는지 정하고 같은 내구성과 재생 요구 아래 비교한다. 서로 다른 보장을 가진 경로의 평균 지연만 비교하면 빠른 도구를 고른 것이 아니라 덜 보장하는 경로를 고른 결과일 수 있다.

브로커 선택 전에 테스트 하나를 먼저 정할 수 있다. B를 보내기 직전에 연결을 끊고 C 이후 다시 연결한다. 그때 화면을 `ABC`로 복구하는 정보가 어디에 남는지 설명해 보자. 그 위치와 완료 경계가 정해지면 필요한 브로커 기능도 구체화된다.
