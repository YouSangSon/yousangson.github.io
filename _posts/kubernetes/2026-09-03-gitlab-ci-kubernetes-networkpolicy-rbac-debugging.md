---
title: "Kubernetes 배포가 막혔을 때 어느 경계부터 볼까"
description: CI의 API 연결 실패, NetworkPolicy 생성 거부, PVC 대기를 하나의 가상 배포 흐름에서 구별한다.
categories: [kubernetes, devops]
tags: [kubernetes, gitlab ci, rbac, serviceaccount, networkpolicy, pvc]
date: 2026-09-03
---

CI 배포 job이 실패했다. 첫 실행은 Kubernetes API 연결 시간 초과, 연결을 고친 다음 실행은 `NetworkPolicy` 생성 `Forbidden`, 권한을 바로잡은 다음에는 영구 스토리지 요청인 PVC가 `Pending`이다. job 이름은 하나여도 세 실패는 같은 원인으로 이어지지 않는다. **각 시도의 마지막으로 확인된 경계**를 기록해야 다음 수정을 고를 수 있다.

아래는 `demo` 네임스페이스와 `deployer` ServiceAccount를 사용하는 가상 사례다. 오류 문구는 설명용이며, 명령은 상태를 조회하는 진단 예시다.

## 첫 실행: API에 닿았다는 증거가 없다

가상 로그의 첫 줄은 `dial tcp <api-address>:443: i/o timeout`이다. 이 메시지는 클라이언트가 제때 연결을 완료하지 못했다는 관찰이다. Kubernetes가 `NetworkPolicy`를 거절했거나 ServiceAccount 권한이 부족하다는 증거는 아니다. runner에서 사용한 API 주소, 이름 해석, 라우팅, 방화벽, TLS 연결까지 **어느 지점의 응답을 받았는지** 좁혀야 한다.

실제 runner가 클러스터 밖에 있다면 Pod를 대상으로 하는 Kubernetes `NetworkPolicy`가 runner의 API 연결을 직접 통제한다고 가정해서도 안 된다. NetworkPolicy는 Pod 트래픽을 대상으로 하고 지원하는 네트워크 플러그인이 적용한다. [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

가상 사례에서는 runner의 kubeconfig가 이미 폐기된 API 주소를 가리켰다고 하자. 주소를 현재 진입점으로 고친 뒤 Kubernetes 형식의 응답을 받았다면, 이번 변경으로 **연결 경계는 넘었다**고 검증할 수 있다. 일반적으로는 `timeout` 한 줄만으로 주소 오류나 DNS 문제를 단정하지 않는다. CI의 kubeconfig가 가리키는 클러스터와 주소를 비밀값을 노출하지 않는 방식으로 확인하고, runner 환경에서 DNS·TCP·TLS의 결과를 각각 기록한다. 주소가 해석돼도 다음 네트워크 구간에서 막힐 수 있다.

## 두 번째 실행: `Forbidden`의 주체와 동사가 바뀐 단서다

연결 문제를 해결한 다음, 설명용 오류가 다음과 같다고 하자.

```text
Error from server (Forbidden): networkpolicies.networking.k8s.io is forbidden:
User "system:serviceaccount:demo:deployer" cannot create resource "networkpolicies"
in API group "networking.k8s.io" in the namespace "demo"
```

이번에는 Kubernetes API가 계정, 리소스, 동사와 namespace를 담아 인가 거부를 돌려줬다. 최소한 이 요청은 API의 인가 판단까지 도달했다. CI 설정에서 *사용하려고 했던* 계정이 아니라 오류에 적힌 `system:serviceaccount:demo:deployer`를 조사해야 한다. Role은 리소스와 동사의 허용 범위를 정의하고, RoleBinding은 그 권한을 주체에게 연결한다. 이름이 비슷한 다른 ServiceAccount나 다른 namespace의 RoleBinding을 고쳐도 이 요청의 인가는 바뀌지 않는다. [ServiceAccount](https://kubernetes.io/docs/concepts/security/service-accounts/), [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)

```bash
kubectl -n demo get rolebindings
kubectl -n demo describe rolebinding <binding-name>
kubectl -n demo describe role <role-name>
kubectl auth can-i create networkpolicies.networking.k8s.io -n demo \
  --as=system:serviceaccount:demo:deployer
```

마지막 명령은 조사자가 해당 계정을 **impersonate할 권한이 있을 때만** 사용한다. 없다면 실제 배포 계정의 컨텍스트에서 `can-i`를 실행하거나 권한 있는 운영자에게 확인을 요청한다. `can-i create`의 `yes`는 지금 묻는 인가 질문 하나에 대한 답이다. 배포 도구가 기존 객체를 수정할 때는 다른 동사가 필요할 수 있으므로 실제 실패 요청의 동사도 확인한다. `yes`가 manifest의 유효성, NetworkPolicy의 트래픽 효과, Pod의 실행을 증명하지는 않는다. [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/), [사용자 impersonation](https://kubernetes.io/docs/reference/access-authn-authz/user-impersonation/)

`NetworkPolicy`라는 이름 때문에 Pod 간 통신 허용 규칙부터 고치고 싶을 수 있다. 하지만 **NetworkPolicy 객체를 만들 수 있는가**는 API 인가 문제이고, **만든 정책이 어떤 Pod 트래픽을 허용하는가**는 selector·규칙·네트워크 플러그인 적용 문제다. 전자는 이 `Forbidden`이 직접 가리키지만 후자는 아직 시험하지 않았다. 권한을 추가해야 한다면 배포에 필요한 리소스·동사·namespace와 Binding을 공유하는 다른 주체를 먼저 확인한다. 한 오류를 없애려고 `cluster-admin`을 주면 원래 필요하지 않은 범위까지 열게 된다. [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/), [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)

## 세 번째 실행: PVC `Pending`은 저장소와 배치의 질문이다

인가 문제를 바로잡아 manifest가 수락된 뒤에도 앱 Pod가 Ready가 되지 않았다고 하자. PVC가 `Pending`이라는 상태만 보인다. 이는 저장소 요청이 아직 바인딩되지 않았다는 뜻이지, 방금 고친 RBAC 권한이 다시 부족하다는 뜻은 아니다. 정적 PV가 요청 용량·access mode·StorageClass 등과 맞지 않을 수도 있고, 동적 프로비저너가 실패했을 수도 있다. [PersistentVolume](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

```bash
kubectl -n demo get pvc
kubectl -n demo describe pvc <claim-name>
kubectl get storageclass
kubectl -n demo get pods -o wide
kubectl -n demo describe pod <pod-name>
```

이 사례의 PVC가 `storageClassName: fast`를 요청하는데 `kubectl get storageclass`에는 `standard`만 있다고 가정하자. 요청한 클래스를 제공할 구성이 없으므로, 먼저 배포 manifest가 의도한 저장소 등급과 클러스터의 제공 목록이 왜 다른지 확인해야 한다. 권한을 더 주거나 Pod를 재시작해도 `fast` 클래스는 생기지 않는다. 클래스 이름을 바꿀지, 운영자가 해당 클래스를 제공할지는 요구한 저장소 성능·위치·보존 정책을 확인한 뒤 결정한다. PVC 이벤트도 이 가설과 일치하는지 확인해야 한다.

다른 클러스터에서 같은 `Pending`을 보면 결론은 달라질 수 있다. StorageClass의 `Immediate`는 PVC 생성 시 바인딩·프로비저닝을 시도한다. `WaitForFirstConsumer`는 해당 PVC를 쓰는 Pod의 배치 제약을 고려하려고 바인딩을 늦춘다. 후자의 PVC가 잠시 `Pending`인 것만으로 저장소 고장이라고 볼 수 없다. 사용하는 Pod가 없거나 Pod가 스케줄링되지 않는다면, 왜 소비자가 아직 배치되지 않았는지도 봐야 한다. [StorageClass의 바인딩 방식](https://kubernetes.io/docs/concepts/storage/storage-classes/#volume-binding-mode)

반대로 이벤트가 사용 가능한 PV가 없거나 프로비저닝 실패를 구체적으로 가리킨다면 그 조건과 스토리지 구현을 조사한다. PVC를 지우고 다시 만드는 시도는 기존 바인딩과 데이터 보존에 영향을 줄 수 있다. 원인을 모를 때의 읽기 전용 진단 명령으로 취급할 수 없다.

## 세 번의 수정은 세 번의 검증이 필요하다

| 실패를 구분한 관찰 | 그 관찰로 할 수 있는 결론 | 다음 검증 |
| --- | --- | --- |
| 연결 시간 초과, Kubernetes 응답 없음 | API 인가까지 도달했는지 모름 | runner의 실제 연결 경로와 응답 지점 |
| Kubernetes `Forbidden`에 계정·동사·리소스가 적힘 | 해당 요청이 인가 단계에서 거부됨 | 실제 계정의 Binding과 필요한 동사 |
| manifest 수락 뒤 PVC `Pending` | 저장소 요청이 아직 바인딩되지 않음 | PVC 이벤트, StorageClass 방식, Pod 배치 |

연결이 복구됐다는 사실은 RBAC가 맞다는 뜻이 아니고, `can-i`가 `yes`라는 사실은 PVC가 붙었다는 뜻이 아니다. PVC가 `Bound`여도 Pod의 이미지·readiness와 실제 서비스 요청은 이어서 확인해야 한다. 배포 job 하나에 “성공”을 붙이기 전에, API 수락→Pod 준비→서비스 경로의 어느 단계까지 관찰했는지 기록하자. [Pod 수명주기](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/), [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
