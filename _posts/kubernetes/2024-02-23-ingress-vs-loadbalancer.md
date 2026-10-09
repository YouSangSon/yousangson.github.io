---
title: Kubernetes Ingress vs 로드밸런서 차이점
description: 하나의 HTTP 요청이 외부 진입점에서 Ingress 규칙과 Service 백엔드를 지나가는 과정을 따라 두 리소스의 역할을 구분한다.
categories: [kubernetes]
tags: [kubernetes, ingress, load balancer, k8s]
date: 2024-02-23
---

Kubernetes에서 `https://api.example.test/v1/items` 요청이 실패하지만 DNS는 주소를 돌려주고 외부 진입점에도 연결되며 `api` Pod는 Ready다. Ingress와 로드밸런서 중 하나를 원인으로 고르기에는 아직 범위가 넓다. 요청이 **어느 경계까지 도착했고 어느 규칙과 백엔드를 선택했는지** 따라가면 다음에 확인할 설정을 좁힐 수 있다.

`example.test`와 `demo` 네임스페이스를 쓰는 가상 환경에서 흔히 쓰는 연결 구성을 따라가 보자.

## 비교 대상부터 고정한다

로드밸런서는 여러 구현을 가리키는 일반 용어다. 이 글에서는 Kubernetes의 **`type: LoadBalancer` Service**와 **Ingress 리소스**를 비교한다. LoadBalancer Service는 클러스터 서비스에 외부 진입점을 요청한다. 실제 주소와 전달 방식은 클라우드 제공자나 클러스터의 구현이 마련한다. Ingress는 HTTP/HTTPS의 host·path에 따른 백엔드 규칙을 선언한다. 규칙을 읽고 적용하는 Ingress 컨트롤러가 없으면 Ingress 객체만 만들어도 요청은 흐르지 않는다. [Service의 LoadBalancer 유형](https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer), [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)

흔한 배치에서는 Ingress 컨트롤러 앞에 LoadBalancer Service가 있다. 이때 두 리소스는 경쟁하는 선택지가 아니라 서로 다른 단계다.

```text
DNS → 외부 로드밸런서 → Ingress 컨트롤러 → api Service → Ready한 api Pod
```

구현에 따라 컨트롤러가 외부 로드밸런서를 직접 구성하거나 다른 진입 방식을 쓸 수도 있다. 그러므로 “Ingress는 응용 계층(L7), 로드밸런서는 전송 계층(L4)”라는 문장은 일반 규칙이 아니다. 외부 로드밸런서에도 HTTP 라우팅 기능이 있을 수 있고, 이 글에서 비교하는 Ingress는 HTTP 규칙을 표현하는 API다.

## `/v1/items` 요청을 한 단계씩 보낸다

가상 설정에서 Ingress는 `api.example.test`의 `Prefix /v1`을 `api` Service의 80번 포트로 보낸다. Service는 `app: api` 라벨의 Pod를 선택하고 `targetPort: 8080`으로 연결한다. Pod가 Ready라면 그 주소가 Service의 EndpointSlice에 준비된 백엔드로 나타난다. 이때 요청은 다음 질문을 차례로 통과해야 한다. [Ingress 경로 유형](https://kubernetes.io/docs/concepts/services-networking/ingress/#path-types), [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)

| 경계 | 이 요청에서 확인할 값 | 값이 틀렸을 때 좁혀지는 범위 |
| --- | --- | --- |
| DNS와 외부 진입점 | `api.example.test`가 의도한 외부 주소로 연결되는가 | 클러스터 밖의 이름 해석·진입 설정 |
| Ingress 컨트롤러 | 해당 Ingress를 처리하는 컨트롤러가 있고 host가 일치하는가 | 규칙 선택 또는 컨트롤러 적용 |
| Ingress 경로 | `Prefix /v1`이 `/v1/items`를 `api:80`으로 보내는가 | host/path·서비스 포트 설정 |
| Service 백엔드 | `app: api`인 준비된 endpoint가 있는가 | selector·readiness·Pod 상태 |
| 애플리케이션 | 선택된 Pod의 8080 포트가 기대한 응답을 내는가 | 앱 포트·핸들러·외부 의존성 |

여기서 `Prefix /v1`은 `/v1`과 `/v1/items`에 맞지만 `/v12`에는 맞지 않는다. Kubernetes의 Prefix는 단순 문자열 접두어가 아니라 `/`로 나눈 경로 요소를 기준으로 한다. 만약 `Exact /v1`을 썼다면 `/v1/items`는 그 규칙에 맞지 않는다. `ImplementationSpecific`의 해석은 컨트롤러에 맡겨지므로, 이 예시처럼 동작을 예측하려면 `pathType`까지 확인해야 한다. [Ingress 경로 매칭](https://kubernetes.io/docs/concepts/services-networking/ingress/#path-types)

## Pod는 Ready인데 백엔드가 없다면

`kubectl -n demo get pods`가 `Running`을 보여 준다는 것만으로 Service가 그 Pod를 선택한다고 결론 내릴 수 없다. Service의 selector가 Pod의 라벨과 다르면 백엔드가 생기지 않는다. Pod가 실행 중이어도 readiness가 실패하면 일반적인 selector 기반 Service에서 준비된 endpoint가 되지 않는다. 반대로 준비된 endpoint가 있고 직접 Service 경로가 동작한다면 외부 진입점이나 Ingress 규칙 쪽으로 범위를 좁힐 수 있다. [Service selector](https://kubernetes.io/docs/concepts/services-networking/service/), [Pod readiness](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes)

```bash
kubectl -n demo describe ingress <ingress-name>
kubectl -n demo get service api -o yaml
kubectl -n demo get pods -l app=api -o wide
kubectl -n demo get endpointslices -l kubernetes.io/service-name=api
```

이 명령은 리소스와 연결 관계를 읽는다. 특정 HTTP 상태 코드만으로 고장 단계를 단정하지 않는다. 일치하지 않는 host, 없는 backend, upstream 연결 실패를 어떤 응답으로 표현하는지는 Ingress 컨트롤러와 설정마다 다르다. 외부 연결이 성공했다는 사실과 애플리케이션의 올바른 응답도 각각 따로 확인한다.

## 어느 API를 쓸지 결정하는 기준

한 TCP/UDP 서비스를 외부로 내보내는 요구라면 LoadBalancer Service가 직접적인 선택일 수 있다. 여러 HTTP 서비스에 대해 host/path 규칙과 TLS 종료를 공통으로 운영하려면 Ingress 컨트롤러와 외부 진입점을 함께 설계할 수 있다. 공유 진입점이 언제나 더 싸거나 안전한 것은 아니다. 컨트롤러 운영, 장애 범위, 인증·TLS 정책, 클라이언트 주소 보존 방식은 해당 구현의 설정까지 비교해야 한다.

새 설계라면 Ingress API가 동결됐고 Kubernetes 문서가 Gateway API를 권장한다는 점도 고려한다. 이것이 기존 Ingress가 사라진다는 뜻은 아니다. 현재 컨트롤러의 지원 범위와 필요한 라우팅 기능을 비교해 결정한다. [Ingress의 유지 상태](https://kubernetes.io/docs/concepts/services-networking/ingress/)

장애를 재현할 때는 “Ingress냐 로드밸런서냐” 대신 실패한 **host와 path, 선택된 Service와 준비된 endpoint**를 한 줄로 적어 보자. 그 한 줄이 없으면 Pod 수를 늘리거나 외부 주소를 바꿔도 어느 단계가 고쳐졌는지 알 수 없다.
