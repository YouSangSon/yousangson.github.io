---
title: "Deployment와 StatefulSet: Pod를 교체할 때 무엇을 보존할까"
description: Pod 교체 후에도 유지해야 할 식별자가 무엇인지 두 워크로드의 장애 상황으로 판단한다.
categories: [kubernetes]
tags: [kubernetes, deployment, statefulset, k8s]
date: 2024-02-21
updated: '2026-09-29'
related:
  - slug: kubernetes-architecture
    reason: 상태를 제어하는 경로와 실제 요청이 흐르는 경로를 나눠 봅니다.
  - slug: master-worker-nodes
    reason: 컨트롤 플레인과 노드 중 어느 구성 요소의 증거를 볼지 확인합니다.
  - slug: ingress-vs-loadbalancer
    reason: 외부 요청이 Ingress와 Service를 지나는 경로를 따라갑니다.
---

Pod 하나를 지우고 같은 수로 다시 만들었다. API 서버라면 새 Pod가 준비된 뒤 요청을 받아도 된다. 그런데 데이터를 가진 클러스터의 두 번째 멤버라면 새 Pod가 **이전 두 번째 멤버의 디스크와 이름**을 찾아야 할 수 있다. 둘 다 복제본 세 개로 실행하지만, “교체”가 뜻하는 바가 다르다.

Deployment와 StatefulSet의 선택 기준은 DB라는 이름이나 영구 스토리지 요청(PVC)을 사용하는지 여부가 아니다. **복제본을 서로 바꿔도 되는가, 아니면 각 복제본의 정체성이 다음 실행까지 이어져야 하는가?** 다음 두 워크로드는 선택 과정을 설명하기 위한 가상 예시다.

## 어느 Pod나 받을 수 있는 요청

`api` 서버 세 개가 외부 DB에 같은 방식으로 접속하고, 어느 복제본이든 같은 요청을 처리한다고 가정하자. 클라이언트는 특정 Pod 이름이 아니라 `api` Service를 호출한다. Pod 하나가 사라지면 Deployment가 관리하는 ReplicaSet은 부족한 복제본을 새 Pod로 채운다. 새 Pod의 이름·UID·IP가 달라도, 준비를 마치고 Service의 백엔드가 되면 클라이언트의 선택 기준은 바뀌지 않는다. [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [Service](https://kubernetes.io/docs/concepts/services-networking/service/)

Deployment에도 PVC를 붙일 수 있다. 그렇다고 복제본마다 안정적인 이름과 볼륨의 연결을 Deployment가 만들어 주는 것은 아니다. 예를 들어 모든 복제본에 한 PVC를 지정했다면 실제 동시 마운트가 가능한지는 그 볼륨의 access mode와 스토리지 구현에 달린다. Pod마다 별도 데이터가 필요하다면 “PVC가 가능하다”는 사실보다 **교체된 Pod가 어느 데이터의 후계자인지**를 먼저 정해야 한다. [PersistentVolume](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

## 두 번째 멤버는 누구의 데이터를 이어받는가

이번에는 `store-0`, `store-1`, `store-2`가 서로를 이름으로 알고 있고 각자 별도 디스크를 쓰는 서비스를 생각해 보자. StatefulSet은 ordinal을 가진 Pod 이름을 유지하고, `volumeClaimTemplates`를 쓰면 각 ordinal에 대응하는 PVC를 만든다. `store-1` Pod를 교체해도 새 Pod는 같은 이름과 해당 claim을 사용할 수 있다. 다만 새 Pod의 UID와 IP가 그대로라는 뜻은 아니다. peer가 현재 IP를 영구 식별자로 저장하면, 안정적인 이름의 이점을 스스로 없애게 된다. [StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

```text
교체 전: store-1 (Pod UID A, IP A) ── claim data-store-1
교체 후: store-1 (Pod UID B, IP B) ── claim data-store-1
```

이 그림은 StatefulSet의 **식별자와 저장소 연결**을 설명한다. 특정 클러스터에서 볼륨이 즉시 다시 붙는다는 보장은 아니다. 스토리지 클래스, 볼륨의 접근 모드, 노드·영역 제약, 기존 마운트 정리가 재시작 시간을 좌우한다. Headless Service는 멤버별 네트워크 이름을 제공하는 구성 요소이며, DNS 이름이 일정하다는 것과 해당 멤버가 지금 Ready라는 것도 구별해야 한다. [StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/), [StorageClass](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## 안정적인 이름은 데이터 일관성을 만들지 않는다

`store-1`이 같은 디스크를 다시 붙여도 `store-0`과 데이터가 같아졌다는 뜻은 아니다. 어느 멤버가 리더인지, 로그를 어디까지 복제했는지, 중단 중 들어온 쓰기를 어떻게 따라잡는지는 애플리케이션의 복제 프로토콜이 결정한다. 두 멤버가 동시에 자신을 리더라고 믿는 상황을 막는 것도 StatefulSet의 ordinal만으로 해결되지 않는다. 백업과 복구 테스트 역시 별도 책임이다.

이 차이를 놓치면 “StatefulSet으로 바꿨으니 DB가 고가용성”이라는 잘못된 결론에 이른다. StatefulSet이 제공하는 것은 멤버를 식별하고 같은 저장소로 다시 연결할 **기반**이다. 데이터의 정확성과 장애 전환은 그 위에서 검증해야 한다.

## 순서 정책을 선택할 때 생기는 대가

기본 `OrderedReady` 정책에서는 StatefulSet이 ordinal 순서에 따라 Pod 생성·축소를 관리하고, 선행 Pod의 준비를 기다린다. 멤버가 순서대로 합류해야 하는 서비스에는 유용하지만, 앞선 Pod가 Ready가 되지 못하면 다음 생성도 기다릴 수 있다. `podManagementPolicy: Parallel`은 생성·축소를 기다리지 않도록 바꾸지만, 애플리케이션이 순서에 의존한다면 함부로 바꿀 수 없다. 이 정책은 업데이트 전략인 `RollingUpdate`/`OnDelete`와도 다른 설정이다. [StatefulSet의 Pod 관리 정책](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#pod-management-policies)

PVC 보존도 삭제 명령 하나로 추측하면 안 된다. 기본적으로 StatefulSet을 지우거나 축소해도 관련 볼륨을 안전을 위해 보존하지만, `persistentVolumeClaimRetentionPolicy` 설정과 Kubernetes 버전에 따라 PVC 처리 정책을 바꿀 수 있다. 그 뒤 PV의 reclaim policy까지 확인해야 실제 저장소의 수명을 판단할 수 있다. 따라서 “Pod를 지웠다가 다시 만들면 데이터가 남는다”는 운영 지침은 먼저 해당 PVC와 PV 설정을 조회한 뒤에만 성립한다. [StatefulSet PVC 보존](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention), [PV 반환 정책](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#reclaiming)

선택할 때는 교체 실험을 머릿속으로 먼저 한다. Pod 하나가 사라졌을 때 클라이언트가 **아무 준비된 복제본**에 붙으면 되는가? 그러면 Deployment가 단순하다. 다른 멤버가 **같은 이름과 같은 데이터의 후계자**를 기다리는가? 그러면 StatefulSet을 검토한다. 어느 쪽이든 준비 상태, 볼륨 연결, 데이터 복제는 별도 관찰로 확인해야 한다.
