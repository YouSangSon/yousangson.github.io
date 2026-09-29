---
title: Kubernetes Deployment vs StatefulSet 차이점
description: Deployment와 StatefulSet의 주요 차이점과 사용 사례 비교
categories: [kubernetes]
tags: [kubernetes, deployment, statefulset, k8s]
date: 2024-02-21
---

Deployment와 StatefulSet을 고를 때는 “DB인가, 웹 서버인가”보다 먼저 물어볼 것이 있다. **Pod가 교체돼도 아무 복제본이나 같은 일을 할 수 있는가, 아니면 복제본별 식별자를 유지해야 하는가?**

## 핵심 차이

| 기준 | Deployment | StatefulSet |
| --- | --- | --- |
| 복제본의 정체성 | 서로 교체 가능한 Pod를 관리 | `web-0`, `web-1`처럼 안정적인 식별자 유지 |
| 저장소 | PVC를 사용할 수 있음 | `volumeClaimTemplates`로 복제본별 PVC 구성 가능 |
| 네트워크 | 보통 Service로 복제본 집합에 접근 | Headless Service와 함께 복제본별 안정적인 이름 사용 |
| 생성·축소 순서 | 복제본별 순서를 보장하는 모델이 아님 | 기본 `OrderedReady` 정책에서 순서 관리 |
| 업데이트 | RollingUpdate 또는 Recreate | RollingUpdate 또는 OnDelete |

Deployment도 영구 볼륨을 사용할 수 있다. “Deployment는 임시 저장소, StatefulSet은 영구 저장소”로 나누면 선택 기준을 잘못 잡게 된다. StatefulSet의 특징은 각 복제본의 식별자와 저장소 연결을 유지하는 데 있다. [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

## StatefulSet이 보장하지 않는 것

Pod가 다시 만들어져도 이름은 유지할 수 있지만 Pod UID와 IP까지 같다는 뜻은 아니다. 안정적인 네트워크 이름과 현재 실행 인스턴스를 구분해야 한다.

또한 StatefulSet을 사용한다고 데이터 복제, 리더 선출, 백업이 자동으로 구현되지는 않는다. 데이터베이스나 메시지 브로커가 필요로 하는 복제 프로토콜과 복구 절차는 그 시스템의 책임이다.

기본 순서 정책도 절대적인 제약은 아니다. `podManagementPolicy: Parallel`을 선택하면 생성·축소 때 다른 Pod가 Ready가 되기를 기다리는 동작이 달라진다. 업데이트 전략과 Pod 관리 정책은 구분해서 읽어야 한다.

## 선택을 확인하는 질문

API 서버의 모든 복제본이 외부 DB에 연결하고 어느 Pod가 요청을 받아도 된다면 Deployment가 자연스럽다. 반면 복제본별 디스크와 이름을 다른 멤버가 식별해야 한다면 StatefulSet을 검토한다.

마지막으로 Pod 하나를 지우고 다시 만들었을 때를 생각해 보자. 유지해야 하는 것이 서비스 전체의 접근 주소인지, 특정 멤버의 이름과 저장소인지 설명할 수 있으면 선택 근거도 분명해진다.
