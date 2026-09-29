---
title: Kubernetes 아키텍처 — 상태 제어와 요청 경로 구분하기
description: Deployment를 제출한 뒤 Pod와 Service가 실제 요청을 받을 때까지, 제어 경로와 트래픽 경로를 한 사례로 따라간다.
categories: [kubernetes]
tags: [kubernetes, k8s, architecture, interview]
date: 2024-02-20
---

`replicas: 3`인 API Deployment를 제출했는데 `kubectl apply`는 성공했고 외부 요청은 실패한다. Kubernetes가 성공했다고 답했는데 왜 서비스는 아직 사용할 수 없을까? **API 객체를 저장하는 일, Pod 세 개를 실행하는 일, 그 Pod로 요청을 전달하는 일은 서로 다른 단계**이기 때문이다.

아래에서는 가상의 `demo` 네임스페이스와 `api` 서비스를 따라 각 단계의 상태를 살펴본다.

## `apply` 뒤에 한 함수가 순서대로 실행되는 것은 아니다

처음에는 Deployment가 `replicas: 3`을 요구하고, 사용 가능한 Pod가 0개라고 가정하자. API 서버는 요청을 인증·인가하고 객체를 검증해 저장한다. 이 시점의 성공은 **원하는 상태를 기록했다**는 뜻이다. 컨테이너가 이미 시작됐다는 응답이 아니다.

Deployment 컨트롤러는 저장된 객체를 관찰하고 새 ReplicaSet을 만든다. ReplicaSet은 부족한 Pod 객체를 만든다. 스케줄러는 아직 노드가 정해지지 않은 Pod를 찾아 자원 요청, 배치 제약 등을 고려해 노드를 선택한다. 선택된 노드의 kubelet은 컨테이너 런타임을 통해 이미지와 컨테이너를 준비하고 Pod 상태를 보고한다. 이것이 한 번의 동기 호출이 아니라, 각 구성 요소가 API 객체의 현재 상태를 보고 자기 책임을 반복해서 맞추는 **제어 루프**다. [컨트롤러](https://kubernetes.io/docs/concepts/architecture/controller/), [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [클러스터 컴포넌트](https://kubernetes.io/docs/concepts/overview/components/)

| 가상 관찰 | 그때까지 확인된 것 | 아직 확인되지 않은 것 |
| --- | --- | --- |
| `deployment.apps/api configured` | API 서버가 Deployment 변경을 수락했다 | ReplicaSet 생성, Pod 실행, 서비스 연결 |
| Deployment `READY 0/3` | 원하는 복제본은 3개, 준비된 복제본은 0개다 | 어느 단계에서 막혔는지 |
| Pod 3개 중 1개가 Ready | 적어도 한 Pod가 준비 상태를 보고했다 | 외부 경로와 나머지 두 Pod의 정상 동작 |
| Deployment `READY 3/3` | 세 복제본이 준비됐다 | DNS, 외부 진입점, 실제 요청 성공 |

이 표에서 `0/3`만 보고 “스케줄러가 고장 났다”고 결론 내리면 안 된다. Pod가 노드에 배치되지 않았을 수도 있고, 배치됐지만 이미지를 받지 못했을 수도 있으며, 컨테이너는 떠도 readiness 검사를 통과하지 못했을 수도 있다. `kubectl -n demo get pods -o wide`로 노드 배치 여부를 보고, 해당 Pod의 `describe` 이벤트와 컨테이너 상태로 다음 경계를 좁힌다. [Pod 수명주기](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

## 준비된 Pod가 있어도 요청 경로는 따로 완성된다

이제 `api` Service가 `app: api` 라벨의 Pod를 선택하고, 외부 진입점의 HTTP 규칙이 그 Service를 가리킨다고 가정하자. 요청 경로는 다음과 같다.

```text
사용자 → DNS/외부 진입점 → Ingress 컨트롤러 → Service → 준비된 백엔드 Pod
```

Ingress 규칙은 요청의 host와 path를 어느 Service로 보낼지 선언한다. Service는 안정적인 접근 지점을 제공하고, 연결할 백엔드 정보는 EndpointSlice로 추적된다. Pod가 Ready가 아니면 일반적인 selector 기반 Service의 정상 백엔드로 취급되지 않는다.

따라서 `kubectl get deployment`가 `1/3`인 동안에도 선택된 백엔드가 하나라면 요청이 갈 수 있지만, 그 하나의 장애를 견딜 여유는 없다. 반대로 `3/3`이라도 외부 DNS가 틀리거나 Ingress 컨트롤러가 규칙을 처리하지 않는다면 외부 요청은 실패한다. Kubernetes API 서버는 이런 일반 애플리케이션 요청을 매번 중계하지 않는다. [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/), [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)

여기서 `kubectl get`이 잘 된다는 사실은 제어 경로의 일부가 살아 있다는 증거다. 앱 접속 성공의 증거로 바꿔 쓰면 안 된다. 반대로 API 서버가 잠시 조회에 응답하지 않는다는 사실만으로, 이미 설정된 Service 경로의 기존 트래픽이 반드시 끊겼다고 단정할 수도 없다. 실제 영향은 클러스터의 네트워크 구현과 당시 백엔드 상태를 확인해야 한다.

## Pod 하나를 지우면 무엇이 회복되고 무엇은 남는가

세 복제본 중 하나를 잃으면 ReplicaSet은 원하는 수와 현재 수의 차이를 보고 대체 Pod를 만든다. 그 Pod는 다시 배치·시작·준비 단계를 거친다. **새 Pod 객체를 만들 수 있다는 능력과 그 사이에도 요청을 처리할 수 있다는 능력은 다르다.** 나머지 Ready Pod가 있으면 일부 요청을 계속 받을 수 있지만, 모두 같은 노드에 배치됐다면 노드 하나의 장애로 한꺼번에 잃을 수 있다. 여러 노드에 흩어져도 공통 DB가 중단되면 API 복제본 수는 그 의존성을 해결하지 못한다.

고가용성을 논할 때는 장애 대상을 먼저 고른다. Pod 프로세스 하나인가, 노드 하나인가, 제어 경로인가, 공통 저장소인가? Pod 복제, 노드 분산, 컨트롤 플레인과 etcd의 장애 대응, DB 복구는 각각 다른 답이다. `replicas: 3`만으로 모두 해결됐다고 말할 수 없다. [노드에 Pod 배치](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/), [클러스터 컴포넌트](https://kubernetes.io/docs/concepts/overview/components/)

운영에서 이 구분을 적용하려면 실패한 요청부터 거꾸로 추적한다. 외부 접속 실패라면 먼저 진입점과 Service의 준비된 백엔드를 확인한다. 원하는 Pod 수가 채워지지 않았다면 그때 Deployment→ReplicaSet→Pod→노드로 내려간다. 각 단계에서 “객체가 존재한다”와 “그 단계의 목적을 달성했다”를 별개의 관찰로 기록하면 원인 범위를 빠르게 줄일 수 있다.

[컨트롤 플레인과 워커 노드의 역할](/posts/master-worker-nodes/)에서는 같은 Pod의 상태가 스케줄링 문제인지 노드 실행 문제인지 이벤트로 구분한다. [Ingress와 로드밸런서](/posts/ingress-vs-loadbalancer/)에서는 요청 경로를 host와 Service 백엔드까지 따라간다.
