---
title: Kubernetes 컨트롤 플레인과 워커 노드의 역할
description: 같은 Pending 표시를 스케줄링 실패와 노드의 이미지 준비 실패로 나누어, 어느 구성 요소의 증거를 볼지 판단한다.
categories: [kubernetes]
tags: [kubernetes, master node, worker node, k8s]
date: 2024-02-22
---

두 Pod가 모두 `Pending`으로 보인다. 하나는 실행할 노드를 아직 못 찾았고, 다른 하나는 이미 노드에 배치됐지만 이미지를 가져오지 못했다. 두 상황에 “노드가 부족하다”는 처방을 같이 쓰면 두 번째 Pod에는 아무 효과가 없다. 먼저 **Pod가 어느 단계까지 갔는지**를 봐야 한다.

`api-a`, `api-b`는 설명용 가상 Pod다. 아래 조회 명령의 출력은 예시이며, 세부 문구는 Kubernetes 버전과 이미지 레지스트리 오류에 따라 달라질 수 있다.

## 노드 배치 이전과 이후를 가르는 필드

Pod를 만들면 API 서버가 객체를 저장한다. 스케줄러는 아직 `.spec.nodeName`이 없는 Pod에 맞는 노드를 찾는다. 노드가 정해지면 그 노드의 kubelet이 Pod 사양을 받아 볼륨과 네트워크, 이미지, 컨테이너를 준비한다. kubelet은 실행 상태를 API에 보고하지만 스케줄러가 직접 컨테이너를 시작하지는 않는다. [컴포넌트](https://kubernetes.io/docs/concepts/overview/components/), [Pod 수명주기](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

```text
Pod 객체 저장 → 노드 선택·바인딩 → kubelet의 실행 준비 → 컨테이너 시작 → readiness 확인
                 스케줄러              노드와 런타임                 앱과 probe
```

이 경계는 `kubectl -n demo get pods -o wide`의 `NODE` 열과 `kubectl -n demo describe pod <pod-name>`의 이벤트·컨테이너 상태로 추적할 수 있다. 단, CLI의 `STATUS` 열은 사람이 보기 좋은 이유를 합쳐 보여 줄 수 있으며 Pod의 `phase` 자체와 항상 같은 문자열은 아니다. 공식 문서상 `Pending` phase에는 **스케줄링 대기뿐 아니라 이미지 다운로드 대기**도 포함된다. [Pod phase](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-phase)

이름을 외우기보다 각 구성 요소가 남기는 관찰을 연결하면 책임이 드러난다.

| 구성 요소 | 맡은 일 | 여기서 구분할 실패 |
| --- | --- | --- |
| API 서버와 etcd | API 객체를 받아 저장하고 현재 상태를 조회 가능하게 한다 | 객체 생성 자체가 거부됐는지, 수락 뒤 진행이 멈췄는지 |
| 컨트롤러 매니저 | Deployment·ReplicaSet 등의 원하는 개수를 맞춘다 | 원하는 Pod 객체가 생성됐는지 |
| 스케줄러 | 노드가 없는 Pod에 실행 위치를 정한다 | `NODE`가 비어 있고 배치 이벤트가 있는지 |
| kubelet과 컨테이너 런타임 | 배치된 Pod의 볼륨·이미지·컨테이너를 준비한다 | 노드 지정 뒤 어떤 준비 작업이 실패했는지 |
| 네트워크 구현 | Pod 연결과 Service 트래픽 전달을 구성한다 | Pod가 실행된 뒤 요청 경로가 실제로 이어지는지 |

etcd는 Kubernetes API 상태의 저장소다. 앱이 사용하는 DB를 대신하지 않는다. 컴포넌트가 어느 물리 서버에서 실행되는지는 클러스터 구성에 따라 달라지므로, 이 표는 머신 이름이 아니라 **책임과 증거**를 나눈다. [클러스터 컴포넌트](https://kubernetes.io/docs/concepts/overview/components/)

## `api-a`: 노드가 정해지지 않았다

가상 사례에서 `api-a`의 `NODE`가 `<none>`이고 이벤트에 `FailedScheduling`이 나온다. 예를 들어 필요한 CPU request를 수용할 노드가 없다는 메시지라면, kubelet이나 이미지 레지스트리보다 스케줄러가 평가한 자원 조건을 먼저 봐야 한다. `nodeSelector`, affinity, taint/toleration, CPU·메모리 request, 볼륨의 영역 제약 등도 같은 배치 단계에서 후보 노드를 줄일 수 있다. `NODE <none>` 자체가 CPU 부족을 증명하지는 않으므로 이벤트의 이유를 읽는다. [Pod를 노드에 배치](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/), [스케줄링 프레임워크](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)

```bash
kubectl -n demo get pod api-a -o wide
kubectl -n demo describe pod api-a
kubectl get nodes
```

가령 이벤트가 CPU 부족을 가리킨다면 request와 노드의 할당 가능 자원을 비교하고, 다른 제약도 함께 확인한다. 이미지 태그를 바꿔도 노드 후보가 생기지는 않는다. 반대로 이벤트가 볼륨 바인딩을 가리키면 영구 스토리지 요청인 PVC와 스토리지 종류를 정의하는 StorageClass의 `volumeBindingMode`까지 살펴야 한다. `WaitForFirstConsumer`는 Pod의 배치 제약을 고려하려고 바인딩을 늦출 수 있으므로, PVC `Pending` 한 단어만으로 저장소 장애를 단정할 수도 없다. [StorageClass의 볼륨 바인딩 방식](https://kubernetes.io/docs/concepts/storage/storage-classes/#volume-binding-mode)

## `api-b`: 노드는 정해졌지만 컨테이너가 시작하지 못했다

이번에는 `api-b`의 `NODE`가 `node-b`이고, 컨테이너 상태가 `Waiting`, 이유가 `ImagePullBackOff`라고 가정하자. 스케줄러는 배치 결정을 마쳤다. 이제 kubelet이 런타임과 함께 이미지를 받는 단계의 실패를 봐야 한다. 잘못된 이미지 이름, 존재하지 않는 태그, 레지스트리 연결 문제, 비공개 이미지 인증 등 서로 다른 원인이 같은 대기 이유로 나타날 수 있다. `describe pod`의 이벤트와 실제 이미지 참조를 비교해야 원인을 좁힐 수 있다. [이미지 다운로드 오류](https://kubernetes.io/docs/concepts/containers/images/#imagepullbackoff), [Pod의 컨테이너 상태](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-states)

```bash
kubectl -n demo get pod api-b -o wide
kubectl -n demo describe pod api-b
kubectl -n demo get pod api-b -o jsonpath='{.spec.containers[*].image}'
```

노드가 지정됐다고 kubelet 자체가 고장 났다고 단정하지 않는다. 이미지 이름과 권한이 틀린 경우도 있고, 볼륨 마운트나 Pod 네트워크 설정이 실패한 경우도 있다. 이벤트가 지목한 실제 대기 작업이 먼저다. 노드와 런타임의 로그는 이 단계의 증거가 부족할 때 권한 있는 운영자가 확인한다.

## `Running`인데 요청이 실패하면

컨테이너가 실행 중이라고 앱이 요청을 받을 준비가 된 것은 아니다. readiness probe가 실패하면 일반적인 selector 기반 Service의 EndpointSlice에서 준비된 백엔드로 사용되지 않는다. `kubectl get pod`의 `READY` 열과 Pod condition, EndpointSlice의 해당 endpoint 조건을 함께 확인한다. 준비된 백엔드가 있다면 그다음은 Service port와 targetPort, Ingress 규칙, 외부 진입점의 문제일 수 있다. 이 단계에서 스케줄러 설정을 바꿔도 기존 요청 경로의 잘못된 host 규칙은 고쳐지지 않는다. [readiness probe](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes), [EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)

노드의 kube-proxy 또는 이를 대체하는 구현은 Service 트래픽 전달을 돕고, Pod 네트워크는 별도의 네트워크 구현이 구성한다. kube-proxy가 모든 Pod 간 연결을 직접 만드는 것도, API 서버가 애플리케이션 요청을 매번 중계하는 것도 아니다. 클러스터마다 구현이 다르므로 실제 데이터 경로는 해당 환경의 네트워크 구성으로 확인한다. [클러스터 컴포넌트](https://kubernetes.io/docs/concepts/overview/components/), [서비스 네트워킹](https://kubernetes.io/docs/concepts/services-networking/)

다음 장애에서 먼저 두 질문을 적어 보자. **이 Pod에 노드가 지정됐는가? 지정됐다면 kubelet이 어떤 작업에서 기다리는가?** 그 답에 따라 스케줄링 제약을 조사할지, 노드의 실행 준비를 조사할지 결정할 수 있다. 서비스 요청 자체가 실패한다면 [Ingress와 Service 경로](/posts/ingress-vs-loadbalancer/)로 이어서 확인한다.
