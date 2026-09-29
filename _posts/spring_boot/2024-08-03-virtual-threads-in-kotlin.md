---
title: Spring Boot에서 가상 스레드와 코루틴 함께 사용하기
description: Java 21 가상 스레드와 Kotlin 코루틴을 Spring Boot에서 통합하는 방법
categories: [spring boot, kotlin]
tags: [spring boot, virtual thread, coroutine, kotlin, java21]
date: 2024-08-03
---

가상 스레드와 코루틴은 함께 사용할 수 있다. 다만 설정을 모두 켠다고 애플리케이션 전체가 자동으로 같은 실행 환경을 사용하는 것은 아니다. **Spring의 작업 실행기와 코루틴의 dispatcher를 나눠서 이해해야 한다.**

## Java 21과 Spring Boot 3.2 기준 설정

이 글은 Java 21, Spring Boot 3.2의 동작을 기준으로 한다. Spring Boot가 제공하는 가상 스레드 지원은 다음 속성으로 켤 수 있다.

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

기존 글처럼 Tomcat executor와 비동기 executor를 무조건 다시 만들 필요는 없다. 우선 자동 설정이 적용되는지 확인한다. 직접 선언한 executor가 있으면 자동 설정과 사용 경로가 달라질 수 있다. [Spring Boot 3.2 가상 스레드](https://docs.spring.io/spring-boot/docs/3.2.0/reference/html/features.html#features.spring-application.virtual-threads), [작업 실행과 스케줄링](https://docs.spring.io/spring-boot/docs/3.2.0/reference/html/features.html#features.task-execution-and-scheduling)

## suspend가 스레드를 선택하지는 않는다

`suspend`는 함수가 일시 중단될 수 있음을 나타낸다. 그 함수가 자동으로 Spring의 기본 스레드 풀이나 가상 스레드에서 실행된다는 뜻은 아니다.

코루틴은 호출 측 컨텍스트와 dispatcher의 영향을 받는다. 실행 위치를 바꾸려면 `withContext` 등으로 해당 dispatcher를 선택한다. 가상 스레드 executor를 dispatcher로 감쌌다면, 그것을 생성한 쪽이 종료 시 닫아야 한다. `ExecutorCoroutineDispatcher.close()`는 연결된 executor의 종료도 처리한다. [코루틴 컨텍스트와 dispatcher](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html), [ExecutorService 변환 API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/as-coroutine-dispatcher.html)

## 수명 관리가 없는 전역 scope를 만들지 않는다

애플리케이션 전체에 `SupervisorJob`을 가진 scope를 만들면 작업의 수명이 요청보다 길어질 수 있다. 그런 작업이 필요한지 먼저 확인하고, 필요하다면 애플리케이션 종료 때 취소하고 완료를 기다리는 주체를 정해야 한다.

이전 글의 전역 scope와 수동 executor 예시는 종료 경로를 설명하지 못해 제거했다. 최소 속성 설정에서 시작하고, 특정 블로킹 호출을 분리해야 할 때만 소유권이 분명한 executor와 dispatcher를 추가하는 편이 이해하기 쉽다.

## CPU 작업이 빨라지는 기능은 아니다

가상 스레드는 대기가 많은 작업을 다수 유지할 때 도움이 될 수 있다. CPU 계산 자체를 빠르게 만들거나 DB 연결 풀의 용량을 늘려 주지는 않는다. 외부 시스템에 보내는 동시 요청 수도 따로 제한해야 한다. [Java 21 가상 스레드](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)

설정 후에는 처리량만 보지 말고 실제 실행 스레드, 요청 지연, DB 연결 대기와 종료 시 남는 작업을 함께 확인한다. [취소와 자원 소유권 사례](/posts/parser-cancellation-resource-ownership/)처럼, 대기를 멈추는 것과 작업이 끝나는 것은 별도로 검증해야 한다.
