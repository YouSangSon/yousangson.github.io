---
title: Spring Boot에서 가상 스레드와 코루틴 함께 사용하기
description: Java 21과 Spring Boot 3.2에서 요청 스레드와 코루틴 dispatcher가 별도로 선택되는 이유를 실행 위치와 자원 수명으로 살펴본다.
categories: [spring boot, kotlin]
tags: [spring boot, virtual thread, coroutine, kotlin, java21]
date: 2024-08-03
---

`spring.threads.virtual.enabled=true`를 설정하고 Kotlin `suspend` 함수를 호출했다. 그러면 그 함수의 모든 코드가 가상 스레드에서 실행될까? **설정이 바꾸는 Spring 실행 경로와 코루틴이 선택하는 dispatcher는 서로 다른 경계**다. 실제 호출이 어느 경계를 지나는지 확인하지 않으면 설정만으로 실행 스레드를 예측할 수 없다.

기준은 **Java 21과 Spring Boot 3.2**다. 아래 Kotlin 예제에서는 로컬 JVM의 executor와 dispatcher 연결을 확인한다. Spring Boot 애플리케이션의 요청 처리 성능을 측정하는 예제는 아니다.

## 가상 스레드는 어떤 대기를 가볍게 하는가

Java의 가상 스레드도 `Thread`다. 플랫폼 스레드와 달리 하나의 OS 스레드에 평생 묶이지 않는다. 지원되는 blocking I/O를 기다릴 때 JVM이 가상 스레드를 일시 중단하면, 그 OS 스레드는 다른 가상 스레드를 실행할 수 있다. 그래서 요청마다 독립적인 실행 흐름을 두는 서버가 대기 작업을 많이 처리할 때 도움이 된다. 개별 계산을 더 빠르게 하거나 DB 연결 풀의 한도를 늘리는 기능은 아니다. [Java 21 가상 스레드 가이드](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)

이를 '스레드가 무한해진다'고 읽으면 곤란하다. 작업마다 메모리와 열린 자원이 들고, 외부 서비스와 DB도 각자의 동시 처리 한도가 있다. 가상 스레드 자체를 작은 풀에 가둬 동시성을 제한하기보다, 제한해야 할 외부 호출 앞에서 semaphore 같은 admission을 두는 편이 목적이 분명하다. Oracle의 가이드는 가상 스레드를 작업당 하나로 사용하고, 외부 서비스 동시 요청 한도는 별도로 제한하는 예를 든다. [Java 21 가상 스레드 채택 가이드](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)

Java 21에는 실행 중인 가상 스레드가 carrier OS 스레드에서 내려오지 못하는 **pinning** 경계도 있다. 특히 오래 걸리는 blocking 작업을 `synchronized` 영역이나 native 호출 안에서 수행하면 확장성이 떨어질 수 있다. 짧은 동기화 블록을 모두 고칠 이유는 없다. 빈번하고 오래 지속되는 pinning이 관측될 때 해당 경로를 조사해야 한다. 이 설명은 Java 21 기준이며 다른 JDK의 구현까지 단정하지 않는다. [Java 21 가상 스레드와 pinning](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)

## Boot 속성이 바꾸는 실행기와 바꾸지 않는 경로

Spring Boot 3.2에서는 Java 21 이상에서 다음 속성을 켤 수 있다.

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

Boot 문서는 사용자 정의 `Executor` bean이 없는 경우 자동 구성되는 `AsyncTaskExecutor`가 가상 스레드를 사용하는 `SimpleAsyncTaskExecutor`가 된다고 설명한다. 이 실행기는 `@EnableAsync` 작업, Spring MVC의 비동기 요청 처리, Spring WebFlux의 blocking execution 지원 등 문서에 지정된 경로에서 사용된다. 스케줄러도 가상 스레드 기반 구현으로 바뀔 수 있다. 직접 만든 `Executor`가 있으면 자동 구성과 선택 규칙이 달라지고, MVC/WebFlux 지원에는 `applicationTaskExecutor`라는 이름의 `AsyncTaskExecutor` 조건도 있다. 따라서 설정의 효과는 **실제로 어떤 executor가 선택됐는지**를 확인해야 알 수 있다. [Spring Boot 3.2 작업 실행과 스케줄링](https://docs.spring.io/spring-boot/docs/3.2.0/reference/html/features.html#features.task-execution-and-scheduling)

Spring Boot 3.2 릴리스 노트는 이 속성을 켠 내장 Tomcat과 Jetty가 요청 처리를 가상 스레드에서 수행한다고도 설명한다. 동기식 MVC controller의 진입 스레드와 `@Async` 작업의 executor는 둘 다 가상 스레드가 될 수 있지만 **서로 다른 진입 경로**다. 코루틴이 중단됐다가 재개되는 경로까지 한 번의 controller 진입 스레드로 설명할 수는 없다. [Spring Boot 3.2 릴리스 노트: Servlet Web Servers](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.2-Release-Notes)

여기까지는 Spring이 관리하는 실행기 이야기다. Kotlin의 `suspend`는 함수가 중단과 재개를 지원한다는 뜻이지, 특정 스레드 종류를 선언하는 키워드가 아니다. 코루틴의 현재 context와 dispatcher가 재개 위치를 결정한다. `withContext(otherDispatcher)`는 지정한 dispatcher에서 블록을 실행하고 이후 원래 context로 돌아올 수 있다. 따라서 Boot 속성을 켰다는 이유만으로 직접 생성한 `CoroutineScope`나 `Dispatchers.Default`의 작업까지 가상 스레드로 바뀌는 것은 아니다. [Kotlin coroutine context와 dispatcher](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)

요청 처리, 코루틴 재개, blocking 구간, 취소를 나누어 보면 각 설정이 어디에 적용되는지 읽기 쉽다.

| 경계 | 실행 위치를 정하는 것 | 확인할 질문 |
| --- | --- | --- |
| Tomcat/Jetty 요청 진입 | 내장 서버의 요청 실행 설정 | 동기 controller는 어느 스레드에서 시작하는가? |
| Spring 비동기 작업 | 선택된 `AsyncTaskExecutor` | 자동 구성인가, 사용자 정의 executor인가? |
| 코루틴의 재개 | 현재 `CoroutineDispatcher` | 어디서 시작했고 `withContext`를 썼는가? |
| 외부 I/O | 클라이언트·DB 풀과 호출 계약 | 실제로 대기하는가, 동시 요청 상한은 무엇인가? |

이 표는 '가상 스레드와 코루틴 중 하나만 선택해야 한다'는 뜻이 아니다. 두 도구를 함께 쓸 수 있지만, 둘 사이의 연결은 호출 경로에 명시해야 한다는 뜻이다.

## dispatcher를 명시하면 무엇이 바뀌는가

다음 예제는 Java 21의 `newVirtualThreadPerTaskExecutor()`를 Kotlin coroutine dispatcher로 감싼다. `runBlocking`은 독립 실행 예제의 시작점일 뿐, Spring 요청 처리 코드에 넣으라는 뜻이 아니다. `withContext` 안팎에서 `Thread.currentThread().isVirtual`을 읽는다.

```kotlin
import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

fun main() = runBlocking {
    println("caller virtual=${Thread.currentThread().isVirtual}")
    Executors.newVirtualThreadPerTaskExecutor().asCoroutineDispatcher().use { dispatcher ->
        withContext(dispatcher) {
            println("inside virtual=${Thread.currentThread().isVirtual}")
        }
    }
    println("resumed virtual=${Thread.currentThread().isVirtual}")
}
```

```text
caller virtual=false
inside virtual=true
resumed virtual=false
```

이 출력은 **예제 안에서만** 진입 전, 지정한 dispatcher 안, 원래 context로 복귀한 뒤의 스레드 종류를 보여 준다. `suspend` 자체가 가상 스레드를 선택하지 않았고, `withContext(dispatcher)`가 명시적인 전환 지점이었다. Kotlin의 `asCoroutineDispatcher()`는 `ExecutorService`를 dispatcher로 바꾸며, 반환된 dispatcher의 `close()`는 연결된 executor를 종료한다. 그래서 예제는 `use`로 수명을 닫는다. [Kotlin `asCoroutineDispatcher`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/as-coroutine-dispatcher.html), [`ExecutorCoroutineDispatcher.close`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-executor-coroutine-dispatcher/close.html)

실제 Boot 애플리케이션에서 executor나 dispatcher를 직접 소유한다면, 애플리케이션 종료 시 새 작업 진입을 막고 진행 중인 작업의 취소·완료를 처리한 다음 닫는 주체가 필요하다. 요청보다 오래 사는 전역 scope를 단순히 만들어 두면 요청 취소와 그 안의 작업 종료가 갈라진다. 반대로 Boot가 이미 해당 실행 경로를 자동 구성한다면 같은 목적의 executor를 하나 더 만들 필요가 없다. 먼저 선택된 bean과 작업 진입점을 확인한 뒤, 명시적인 dispatcher가 필요한 blocking 경로에만 둔다.

## 적용 전에 확인할 실패 경계

Boot 3.2 문서는 가상 스레드가 daemon thread라는 점도 명시한다. 스케줄러의 가상 스레드만 JVM을 유지할 것이라고 기대하면 애플리케이션이 종료될 수 있다. 문서는 그런 경우 `spring.main.keep-alive=true`를 권장한다. 이 속성은 모든 애플리케이션에 무조건 추가할 값이 아니라, 실제 생명주기 조건에 따라 확인할 항목이다. [Spring Boot 3.2 가상 스레드](https://docs.spring.io/spring-boot/docs/3.2.0/reference/html/features.html#features.spring-application.virtual-threads)

가상 스레드 채택 여부는 숫자 하나로 판단하기 어렵다. 먼저 요청과 `@Async` 작업이 어느 executor에 들어가는지, `suspend` 경계의 dispatcher가 무엇인지, DB 연결 대기와 외부 호출 한도가 병목인지 확인한다. 그다음 같은 부하에서 처리량·지연·pinning과 종료 시 남는 작업을 비교한다. 이 글의 세 줄 출력은 dispatcher 연결의 증거일 뿐, Spring의 자동 구성이나 운영 성능의 증거가 아니다. [취소와 자원 소유권](/posts/parser-cancellation-resource-ownership/)에서처럼 호출자의 대기가 끝난 시점과 실제 작업이 자원을 놓은 시점도 따로 관측해야 한다.
