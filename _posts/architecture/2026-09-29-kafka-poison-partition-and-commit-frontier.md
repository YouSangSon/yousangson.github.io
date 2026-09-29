---
title: "Kafka 재시도가 정상 파티션까지 멈출 때"
description: "재시도로 고칠 수 없는 입력과 일시적 실패를 나누고, 병렬 소비자의 안전한 커밋 위치를 작은 예제로 계산한다."
categories: [architecture, distributed systems]
tags: [kafka, backpressure, retry, head-of-line-blocking, python]
date: 2026-09-29
---

문서 처리 소비자에 필수 값이 빠진 메시지 하나를 넣는다고 하자. 같은 입력으로 다시 실행해도 성공하지 못한다. 그런데 소비자가 모든 실패를 무한 재시도한다면 이 메시지는 계속 실행 자리를 차지한다. 자리를 다른 파티션과 공유하고 있다면 정상 입력도 기다리게 된다.

이런 입력을 흔히 *poison message*라고 부른다. 재시도 간격을 늘리기 전에, **같은 입력으로 다시 실행했을 때 무엇이 달라질 수 있는지**부터 구분해야 한다.

## 입력 오류는 시간이 해결해 주지 않는다

브로커 연결이 잠시 끊겼다면 다음 시도에는 성공할 수 있다. 필수 필드가 없거나 지원하지 않는 형식이라면 시간이 지나도 입력은 같다. 비싼 작업을 시작하기 전 검사할 수 있는 조건은 먼저 확인하는 편이 낫다.

하지만 입력을 거부했다고 처리가 완료된 것은 아니다. 메시지를 보존하고 해당 파티션을 멈출지, 별도의 실패 저장소로 옮길지 정해야 한다. 실패 저장소에 썼다는 응답을 잃는 경우도 있으므로 “실패하면 DLQ” 한 줄만으로 유실과 중복이 모두 해결되지는 않는다.

이 글은 특정 선택을 정답으로 두지 않는다. 파티션을 멈추면 뒤의 정상 메시지도 기다린다. 별도 저장소로 넘기고 진행하면 그 저장의 내구성, 중복 방지, 재처리 경로가 필요하다. 무엇을 포기하고 무엇을 보존하는지 드러내야 한다.

## 뒤의 작업이 끝나도 앞의 작업을 건너뛸 수는 없다

Kafka의 소비 위치와 커밋된 위치는 다르다. 소비 위치는 이미 가져온 레코드 뒤로 움직일 수 있다. 커밋 위치는 장애 후 어디에서 다시 읽을지를 결정한다. 보통 마지막 처리 완료 레코드의 offset에 1을 더한 값을 커밋한다. [KafkaConsumer: Positions and Committed Offsets](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)

한 파티션의 A, B, C를 병렬로 실행해 B와 C가 먼저 끝났다고 하자.

```text
수신 순서: A → B → C
완료 상태: 대기  완료  완료
안전하게 확정할 앞부분: 아직 없음
```

C 뒤를 커밋하면 재시작 후 A를 다시 받지 못할 수 있다. 필요한 것은 가장 큰 완료 offset이 아니라 **실제로 받은 기록 중 앞에서부터 모두 끝난 구간**이다. 로그의 offset에는 빈 값이 있을 수 있으므로 정수가 연속인지 검사하는 것과도 다르다.

다음 Python 예제를 실행해 보자.

```python
def next_offset(delivered, done):
    result = None
    for offset in delivered:
        if offset not in done:
            break
        result = offset + 1
    return result

assert next_offset([10, 12, 15], {12, 15}) is None
assert next_offset([10, 12, 15], {10, 15}) == 11
assert next_offset([10, 12, 15], {10, 12, 15}) == 16
print("only the completed prefix can advance")
```

11은 offset 11의 레코드를 처리했다는 뜻이 아니다. 10까지 완료했다는 복구 위치다. 예제는 계산 규칙만 보여 준다. 실제 소비자는 파티션별로 상태를 나누고, 재할당으로 소유권을 잃은 뒤 오래된 worker가 커밋하지 않게 해야 한다. 사용하는 클라이언트의 자동 커밋 설정도 확인해야 한다.

## 실행 자리와 완료 대기 기록은 다른 자원이다

A가 막혀 있는 동안 B와 C는 실행을 끝냈지만 아직 커밋할 수 없다. 실행 중인 작업만 세면 이런 완료 기록이 계속 쌓일 수 있다. 반대로 모든 기록을 하나의 작은 공용 한도에 넣으면 파티션 하나가 다른 파티션의 진입까지 막을 수 있다.

한도는 이름보다 보호하는 자원을 기준으로 정한다. 동시에 실행할 작업 수, 커밋 대기 기록 수, 기록이 가진 payload 바이트를 따로 본다. 파티션별 제한을 두더라도 전체 파티션 수가 늘면 합계 메모리가 늘 수 있으므로 프로세스 전체 상한도 필요하다.

## 외부 저장 완료와 offset 커밋 사이

벡터 DB에 쓰기를 마친 뒤 offset을 커밋하기 전에 종료되면 같은 입력을 다시 처리할 수 있다. 반대로 쓰기 전에 커밋하면 저장하지 못한 작업을 건너뛸 수 있다. Kafka의 트랜잭션 보장을 별도의 저장소까지 자동으로 확장해서는 안 된다. [Kafka의 전달 의미](https://kafka.apache.org/41/design/design/#message-delivery-semantics)

<iframe src="/assets/diagrams/2026-09-29/message-completion-boundary.html" title="처리와 완료 기록 사이의 장애 구간" loading="lazy" width="100%" height="552" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기](/assets/diagrams/2026-09-29/message-completion-boundary.html)

중복 실행이 허용돼도 결과가 유지되는 쓰기 방법이나 처리 결과를 확인할 식별자가 필요하다. 이것은 소비자의 순서 계산과 별개다. prefix를 정확히 계산해도 외부 부수효과가 자동으로 멱등해지지는 않는다.

검증할 때는 잘못된 입력 하나와 다른 파티션의 정상 입력을 함께 넣는다. 정상 작업이 진행하는지, 미처리 입력의 offset은 보존되는지, 외부 저장 직후 종료해도 결과를 잃지 않는지를 각각 확인한다. 재시도 로그가 줄었다는 사실보다 이 세 결과가 더 많은 것을 알려 준다.
