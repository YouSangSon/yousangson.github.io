---
title: "Kubernetes 배포가 막혔을 때 어느 경계부터 볼까"
description: GitLab CI 배포에서 네트워크 연결, ServiceAccount 인가, NetworkPolicy 적용, PVC 바인딩을 서로 다른 실패로 진단하는 방법.
categories: [kubernetes, devops]
tags: [kubernetes, gitlab ci, rbac, serviceaccount, networkpolicy, pvc]
date: 2026-09-03
---

배포 job이 멈췄다. `NetworkPolicy`를 적용할 때는 `Forbidden`이 나왔고, 다음 시도에서는 PVC가 `Pending`에 머물렀다고 하자. 둘 다 'Kubernetes 배포 실패'지만 같은 권한을 더 준다고 해결되지 않는다. 실패가 난 경계를 먼저 가려야 한다.

아래의 `demo` namespace와 `deployer` 계정은 설명용 가상 환경이다. 실제 고객, 클러스터 구성, 정책 YAML, 배포 기록을 옮긴 사례가 아니다. 명령도 읽기 전용 진단 예시이며 여기서 클러스터에 실행한 결과는 없다.

## API에 닿았는지부터 구분한다

연결 시간 초과나 DNS 오류라면 아직 Kubernetes API의 인가 판단까지 도달했는지 알 수 없다. CI runner에서 API 주소를 해석하고 연결하는 경로, runner가 속한 네트워크, API 서버의 응답을 먼저 확인한다. 반대로 Kubernetes가 사용자와 리소스를 적은 `Forbidden`을 돌려줬다면 요청은 API 인가 단계에 도착했다.

`NetworkPolicy`는 Pod에 들어오거나 나가는 트래픽을 통제하는 리소스다. `NetworkPolicy` **객체를 생성할 권한**은 RBAC가 결정한다. Pod 트래픽이 허용되는지는 선택된 정책과 네트워크 플러그인의 적용 상태를 따로 봐야 한다. 두 기능은 이름에 'network'가 같이 들어가도 검사할 대상이 다르다. [Kubernetes NetworkPolicy 문서](https://kubernetes.io/docs/concepts/services-networking/network-policies/), [RBAC 문서](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)

## `Forbidden`은 실제 계정과 동사를 따라간다

가령 오류가 `system:serviceaccount:demo:deployer`에게 `networking.k8s.io` 그룹의 `networkpolicies`를 `create`할 권한이 없다고 말한다면, CI가 사용할 것으로 *예상한* 계정 대신 오류에 나온 계정부터 확인한다. ServiceAccount는 namespace 안의 신원이고, RoleBinding은 그 신원에 Role 또는 ClusterRole을 연결한다. [Kubernetes ServiceAccount 문서](https://kubernetes.io/docs/concepts/security/service-accounts/), [RBAC 문서](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)

권한을 가진 조사자가 해당 namespace에서 다음을 확인할 수 있다.

```bash
kubectl -n demo get rolebindings
kubectl -n demo describe rolebinding <binding-name>
kubectl -n demo describe role <role-name>
kubectl -n demo auth can-i create networkpolicies.networking.k8s.io \
  --as=system:serviceaccount:demo:deployer
```

마지막 줄의 `--as`는 조사자에게 **impersonate 권한이 있을 때만** 쓸 수 있다. 그 권한이 없다면 실제 배포 계정의 컨텍스트에서 `kubectl auth can-i`를 실행하거나 권한 있는 운영자에게 확인을 요청한다. `can-i`는 지정한 동사의 허용 여부를 묻는다. 실제 적용 명령이 조회·생성·변경 중 무엇을 수행하는지도 따로 확인해야 한다. [`kubectl auth can-i` 문서](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/)

하나의 권한이 빠졌다고 `cluster-admin`을 주면 검사 범위가 namespace 밖으로 넓어진다. 실제 배포 경로에 필요한 리소스와 동사만 Role에 담고, 그 Role을 누가 공유하는지 확인한 뒤 바꾼다. `can-i`의 `yes`는 인가 질문에 대한 답이다. manifest가 유효하거나 Pod가 정상 실행됐다는 뜻은 아니다.

## PVC `Pending`은 다른 질문이다

PVC는 저장 공간을 요청한다. 제어 평면은 조건에 맞는 PV와 바인딩하거나 StorageClass를 이용해 동적으로 준비한다. 맞는 저장소가 없으면 PVC는 바인딩되지 않는다. 이때 앞서 본 `NetworkPolicy` 권한을 늘려도 PVC의 조건은 바뀌지 않는다. [Kubernetes PersistentVolume 문서](https://kubernetes.io/docs/concepts/storage/persistent-volumes/), [StorageClass 문서](https://kubernetes.io/docs/concepts/storage/storage-classes/)

```bash
kubectl -n demo get pvc
kubectl -n demo describe pvc <claim-name>
kubectl get storageclass
```

`describe pvc`의 이벤트와 요청 용량, access mode, StorageClass를 함께 본다. 정적 PV를 쓰는 환경이라면 PV의 조건과 예약 상태도 권한 있는 운영자가 확인해야 한다. `Pending`이라는 한 단어만으로 PV 부재, 잘못된 StorageClass, 용량 불일치 중 하나를 단정할 수 없다. PVC를 지웠다 다시 만드는 행동은 바인딩과 보존 데이터에 영향을 줄 수 있으므로 진단 명령으로 취급하지 않는다.

## CI 입력도 별도 경계다

배포 전에 테스트부터 달라졌다면 GitLab의 `dotenv` artifact를 확인할 만하다. GitLab 문서에 따르면 이 artifact의 변수는 뒤따르는 job에 전달된다. 여러 선행 job에서 같은 이름의 값을 내보낸다면 테스트 job이 실제로 어떤 값을 받는지 확인해야 한다. 이 검사는 Kubernetes 인가와 별개다. [GitLab `dotenv` artifact 문서](https://docs.gitlab.com/ci/yaml/artifacts_reports/#artifactsreportsdotenv)

같은 배포 실패라도 질문을 순서대로 바꾸면 조사 범위가 좁아진다. API 응답이 있었는가? `Forbidden`의 주체와 동사는 무엇인가? RoleBinding이 어느 Role을 가리키는가? PVC 이벤트는 어떤 바인딩 조건을 말하는가? 자신의 CI에서 이 네 답을 먼저 기록해 두면 토큰 재발급이나 광범위한 권한 부여를 검증 없이 시도할 이유가 줄어든다.
