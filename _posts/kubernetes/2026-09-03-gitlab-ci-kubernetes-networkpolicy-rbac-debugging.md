---
title: "DRM API를 고객사별로 배포하며 만난 GitLab CI, RBAC, PVC 문제"
description: 하나의 DRM API를 고객사별 런타임으로 분리해 Kubernetes에 배포하면서 만난 통합 테스트 환경변수 충돌, PV 권한, NetworkPolicy RBAC, PVC Pending 문제와 해결 과정을 정리한다.
categories: [kubernetes, debugging]
tags: [kubernetes, gitlab ci, rbac, serviceaccount, rolebinding, networkpolicy, persistentvolume, spring boot]
date: 2026-09-03
---

하나의 DRM API를 두 고객사 환경으로 분리해 Kubernetes에 배포하는 작업을 진행했다. 소스 코드는 같지만 고객사마다 라이선스와 네이티브 런타임, 이미지, Secret, PVC가 달랐다. 개발과 운영 클러스터도 분리돼 있었다.

최종 구조는 다음과 같았다.

```text
같은 Spring Boot 애플리케이션
  ├─ 고객사 A dev/prod 이미지와 PVC
  └─ 고객사 B dev/prod 이미지와 PVC

GitLab CI
  ├─ 고객사별 벤더 런타임 추출
  ├─ 테스트와 애플리케이션 이미지 빌드
  └─ 환경별 Kubernetes manifest 배포
```

배포 자동화 자체보다 어려웠던 부분은 경계였다. 테스트와 런타임 설정의 경계, namespace 권한과 cluster 권한의 경계, 개발과 운영의 경계가 각각 다른 방식으로 파이프라인을 멈췄다.

실제로는 다음 네 문제가 순서대로 나타났다.

| 단계 | 증상 | 원인 | 해결 |
|---|---|---|---|
| 통합 테스트 | profile owner 불일치와 비동기 완료 타임아웃 | 두 선행 job의 dotenv가 같은 런타임 profile key를 전달 | 테스트 context와 fixture에 고정된 테스트 owner 사용 |
| 배포 사전 검사 | PV 조회 `Forbidden` | namespace Role로 cluster-scoped PV 조회 | 불필요한 PV 직접 조회 제거, PVC `Bound`를 gate로 사용 |
| manifest 적용 | NetworkPolicy 조회 `Forbidden` | 배포 Role에 새 리소스 권한 누락 | SA→RoleBinding→Role을 추적해 최소 권한 추가 |
| 신규 고객사 배포 | PVC `Pending` 타임아웃 | 정적 local PV와 노드 디렉터리 미준비 | 고객사·환경별 전용 PV를 먼저 준비하고 `Bound` 확인 |

중요한 점은 앞의 실패를 해결해야 다음 실패가 보였다는 것이다. 한꺼번에 추측해서 수정했다면 테스트 설정, RBAC, 스토리지 문제를 섞어 판단했을 가능성이 높다.

## 작업 배경: 고객사별 DRM 런타임 분리

DRM API는 일반적인 stateless API와 달랐다. 고객사별 네이티브 라이브러리와 라이선스 설정을 사용하고, 작업 파일도 서로 다른 볼륨에 저장해야 했다. 한 고객사의 Pod가 다른 고객사의 작업을 가져가거나 같은 저장 경로를 사용하는 상황을 막아야 했다.

그래서 다음 항목을 profile별로 분리했다.

- 런타임 base image와 최종 애플리케이션 image
- 라이선스 profile owner
- Deployment, Service, ConfigMap, Secret
- PVC와 local PV
- Gateway가 호출할 내부 endpoint

GitLab CI에서는 고객사별 추출 job이 벤더 JAR와 profile 정보를 artifact로 전달하고, 신뢰된 테스트 job이 두 artifact를 받은 뒤 애플리케이션을 검증했다. 테스트가 통과하면 profile별 image를 만들고 개발 또는 운영 manifest를 적용했다.

배포 템플릿도 함께 강화했다. `kubectl` 이미지는 mutable tag 대신 digest로 고정했고, FIPS 환경에서 내부 Git 서버의 manifest를 가져올 수 있도록 P-256 OpenSSL 설정을 Git 명령에만 적용했다. 이 부분은 정상 동작했다. 이후 발생한 실패는 Gradle 테스트, Kubernetes 인가, 스토리지 순서로 서로 다른 계층에서 나왔다.

## 첫 번째 실패: 테스트가 CI의 dotenv에 오염됐다

첫 실패는 Kubernetes가 아니라 통합 테스트였다.

```text
GatewayMetadataRepositoryIntegrationTest FAILED
IllegalArgumentException: job profile owner does not match repository profile

DrmFilePathKafkaIntegrationTest FAILED
timeout waiting for COMPLETED status
```

로컬에서는 통과하던 테스트가 protected branch CI에서만 실패했다. 선행하는 두 profile 추출 job이 각각 dotenv artifact에 같은 환경변수 key를 기록했고, downstream 테스트 job이 두 artifact를 모두 내려받고 있었다. 그 결과 Spring context에는 비어 있지 않은 런타임 profile owner가 주입됐지만 테스트 fixture가 만든 작업에는 owner가 없었다.

저장소는 다른 profile의 작업을 처리하지 않도록 owner 일치를 강제한다. 따라서 첫 테스트는 즉시 예외를 냈고, 두 번째 테스트에서는 owner 없는 mock 작업이 처리 대상에서 제외돼 완료 이벤트를 기다리다 타임아웃이 발생했다.

런타임 환경변수를 테스트 job에서 제거하는 것은 올바른 해결이 아니었다. 운영 코드가 non-blank owner를 요구하는 이유는 고객사 간 작업 격리이기 때문이다. 테스트가 런타임 불변식을 우회하면 실제 계약을 검증하지 못한다.

대신 통합 테스트 context와 모든 공용 fixture가 같은 테스트 전용 owner를 사용하도록 고정했다.

```java
private static final String PROFILE_OWNER = "integration-test";

registry.add("drm.metadata.profile-owner", () -> PROFILE_OWNER);

DrmJob.builder()
    .withProfileOwner(PROFILE_OWNER)
    .build();
```

원래 실패한 두 테스트를 실제 런타임 profile 환경변수와 함께 재현한 뒤 수정 전 RED, 수정 후 GREEN을 확인했다. 고객사 A와 B profile을 각각 주입한 실행과 전체 `clean test integrationTest bootJar`도 통과시켰다.

이 문제에서 얻은 결론은 단순했다.

> CI artifact가 전달한 환경변수도 테스트 입력이다.

소스 diff가 없어도 upstream dotenv 하나가 Spring context와 테스트 동작을 바꿀 수 있다. `needs`로 여러 dotenv artifact를 받는 job이라면 같은 key의 소유권과 precedence를 명시해야 한다.

## 두 번째 실패: namespace 계정으로 PV를 직접 조회했다

테스트와 이미지 빌드가 통과한 뒤 배포 job이 처음으로 실행됐다. 이번에는 정적 PV 존재 여부를 확인하는 단계에서 실패했다.

```text
Error from server (Forbidden): persistentvolumes "..." is forbidden:
User "system:serviceaccount:platform:gitlab-deployer"
cannot get resource "persistentvolumes" at the cluster scope
```

PersistentVolume은 cluster-scoped 리소스다. 반면 CI deployer는 특정 namespace에만 권한을 가진 Role을 사용했다. 여기서 PV 조회를 위해 ClusterRole을 추가하면 하나의 애플리케이션 배포 계정이 클러스터의 모든 PV 이름과 상태를 읽을 수 있게 된다.

배포 계약을 다시 보니 직접 `kubectl get pv`를 호출할 필요가 없었다.

1. PVC manifest의 `volumeName`이 승인된 입력과 같은지 검사한다.
2. PVC를 적용한다.
3. PVC의 phase가 `Bound`가 될 때까지 기다린다.

지정한 PV가 없거나 조건이 맞지 않으면 PVC가 `Bound`되지 않는다. 따라서 중복된 cluster-scoped PV 조회를 제거하고 namespace 안에서 확인할 수 있는 PVC 상태를 배포 gate로 사용했다.

```bash
kubectl apply -f pvc.yml

kubectl wait \
  --for=jsonpath='{.status.phase}'=Bound \
  pvc/app-data-pvc \
  -n platform \
  --timeout=120s
```

권한을 추가해서 검사를 통과시키는 대신 같은 안전 조건을 더 좁은 권한으로 증명한 것이다.

## 세 번째 실패: NetworkPolicy 권한 누락

PV 직접 조회를 제거하자 기존 PVC는 정상적으로 `Bound`됐다. 파이프라인은 다음 manifest로 진행했고 이번에는 아래 오류와 함께 멈췄다.

```text
Error from server (Forbidden):
networkpolicies.networking.k8s.io "app-gateway-only" is forbidden:
User "system:serviceaccount:platform:gitlab-deployer"
cannot get resource "networkpolicies"
in API group "networking.k8s.io"
in the namespace "platform"
```

NetworkPolicy가 새 manifest에 추가됐지만 CI ServiceAccount의 Role은 이전 배포 리소스만 알고 있었다. 이 경우 애플리케이션 코드나 이미지가 아니라 Kubernetes RBAC 경계를 확인해야 한다.

### 오류 메시지에 이미 계정이 적혀 있다

먼저 다음 문자열을 분해한다.

```text
system:serviceaccount:platform:gitlab-deployer
```

Kubernetes ServiceAccount 사용자는 아래 형식을 사용한다.

```text
system:serviceaccount:<namespace>:<serviceaccount-name>
```

따라서 이 배포 요청은 `platform` namespace의 `gitlab-deployer` ServiceAccount로 실행됐다. GitLab 사용자 계정이나 Runner 컨테이너 사용자를 찾을 필요가 없다. CI에 주입된 Kubernetes 토큰이 이 ServiceAccount를 가리킨다.

계정이 실제로 존재하는지 확인한다.

```bash
kubectl --context dev-cluster \
  -n platform get serviceaccount gitlab-deployer -o yaml
```

ServiceAccount가 존재한다면 토큰을 다시 만들기 전에 어떤 Role이 연결돼 있는지 확인해야 한다.

### RoleBinding을 따라 실제 Role 찾기

하나의 ServiceAccount에는 여러 RoleBinding이 연결될 수 있다. 이름만 추측하지 않고 subject를 기준으로 검색한다.

```bash
kubectl --context dev-cluster \
  -n platform get rolebinding -o json |
  jq -r '.items[]
    | select(any(.subjects[]?;
        .kind == "ServiceAccount"
        and .name == "gitlab-deployer"))
    | [.metadata.name, .roleRef.kind, .roleRef.name]
    | @tsv'
```

결과는 다음과 같았다.

```text
gitlab-deployer-binding    Role    deployment-manager
```

권한을 고칠 대상은 ServiceAccount나 토큰이 아니라 `Role/deployment-manager`다.

현재 Role을 확인한다.

```bash
kubectl --context dev-cluster \
  -n platform get role deployment-manager -o yaml
```

Role에는 Deployment, Service, ConfigMap, Secret, PVC, Ingress 권한이 있었지만 `networkpolicies`가 없었다. manifest에 NetworkPolicy가 추가됐는데 deployer의 권한 계약은 함께 갱신되지 않은 것이 직접적인 원인이었다.

### `auth can-i`로 가설 확인하기

Role을 수정하기 전에 실제 인가 결과를 확인한다. 이 명령은 해당 ServiceAccount를 impersonate할 수 있는 관리자 계정으로 실행해야 한다.

```bash
kubectl --context dev-cluster auth can-i \
  get networkpolicies.networking.k8s.io \
  -n platform \
  --as=system:serviceaccount:platform:gitlab-deployer
```

수정 전 결과는 `no`였다. CI 로그의 `Forbidden`과 동일한 권한 누락을 클러스터에서 직접 재현한 셈이다.

`kubectl apply`는 리소스가 있으면 조회하고 patch하며, 없으면 생성한다. 이 배포 경로에 필요한 동작을 각각 확인한다.

```bash
for verb in get create patch; do
  kubectl --context dev-cluster auth can-i "$verb" \
    networkpolicies.networking.k8s.io \
    -n platform \
    --as=system:serviceaccount:platform:gitlab-deployer
done
```

수정 전에는 세 항목 모두 `no`였다.

### Role을 누가 공유하는지 먼저 확인하기

Role에 권한을 추가하면 그 Role에 연결된 모든 subject가 같은 권한을 얻는다. 따라서 수정 전에 `deployment-manager`를 공유하는 계정을 확인한다.

```bash
kubectl --context dev-cluster \
  -n platform get rolebinding -o json |
  jq -r '.items[]
    | select(.roleRef.kind == "Role"
        and .roleRef.name == "deployment-manager")
    | [.metadata.name,
       (.subjects | map(.kind + "/" + .name) | join(","))]
    | @tsv'
```

확인 결과 배포 전용 ServiceAccount만 이 Role을 사용하고 있었다. 다른 애플리케이션 계정도 같은 Role을 사용하고 있다면 공용 Role을 넓히기보다 NetworkPolicy 전용 Role과 RoleBinding을 분리하는 편이 안전하다.

### 필요한 권한만 별도 rule로 추가하기

기존 Role에는 `ingresses` 규칙이 있었고 `delete`까지 허용했다. 여기에 `networkpolicies`를 함께 넣으면 NetworkPolicy 삭제 권한도 따라온다. 배포에 필요하지 않은 권한이다.

따라서 다음 rule을 별도로 추가했다.

```yaml
- apiGroups:
    - networking.k8s.io
  resources:
    - networkpolicies
  verbs:
    - get
    - create
    - patch
```

긴급 복구에서는 live Role을 편집할 수 있다.

```bash
kubectl --context dev-cluster \
  -n platform edit role deployment-manager
```

다만 live edit만으로 끝내면 다음 배포나 인프라 동기화가 Role을 이전 상태로 되돌릴 수 있다. 같은 rule을 Terraform, Helm 또는 Kubernetes manifest처럼 Role을 관리하는 실제 소스에도 반영해야 한다.

수정 후 다시 확인한다.

```bash
for verb in get create patch; do
  kubectl --context dev-cluster auth can-i "$verb" \
    networkpolicies.networking.k8s.io \
    -n platform \
    --as=system:serviceaccount:platform:gitlab-deployer
done
```

```text
yes
yes
yes
```

여기까지 확인된 것은 NetworkPolicy 인가 문제의 해결이다. 전체 Deployment rollout이나 애플리케이션 smoke test 성공을 의미하지는 않는다. CI job을 다시 실행하고 rollout과 Pod readiness를 별도로 확인해야 한다.

### 운영 클러스터는 별도로 추적한다

개발과 운영 클러스터가 분리돼 있다면 개발 Role을 수정해도 운영 권한은 바뀌지 않는다. 운영 CI가 별도 ServiceAccount를 사용한다면 처음부터 같은 절차를 반복한다.

```bash
kubectl --context prod-cluster \
  -n platform get serviceaccount gitlab-deployer-prod

kubectl --context prod-cluster \
  -n platform get rolebinding -o json |
  jq -r '.items[]
    | select(any(.subjects[]?;
        .name == "gitlab-deployer-prod"))
    | [.metadata.name, .roleRef.kind, .roleRef.name]
    | @tsv'
```

운영 ServiceAccount도 `deployment-manager` Role에 연결돼 있었지만 NetworkPolicy 권한은 없었다. PVC 조회 권한과 NetworkPolicy 권한을 각각 확인하니 차이가 명확해졌다.

```bash
kubectl --context prod-cluster auth can-i \
  get persistentvolumeclaims \
  -n platform \
  --as=system:serviceaccount:platform:gitlab-deployer-prod

for verb in get create patch; do
  kubectl --context prod-cluster auth can-i "$verb" \
    networkpolicies.networking.k8s.io \
    -n platform \
    --as=system:serviceaccount:platform:gitlab-deployer-prod
done
```

```text
yes
no
no
no
```

계정이나 토큰 전체가 잘못된 것이 아니다. PVC 권한은 정상이고 NetworkPolicy 권한만 빠져 있었다. 운영 Role에도 같은 최소 rule을 추가한 뒤 `yes` 세 개를 확인했다.

개발에서 통과한 설정을 운영에도 그대로 적용하면 된다는 뜻은 아니다. 다음 항목은 환경별로 따로 확인해야 한다.

- 실제 CI 토큰이 가리키는 ServiceAccount
- RoleBinding과 Role
- Role을 공유하는 다른 subject
- namespace와 kube-context
- GitOps 또는 IaC에 저장된 Role 원본

## 네 번째 실패: 신규 고객사의 PVC가 Pending에 머물렀다

NetworkPolicy 권한을 해결하는 동안 신규 고객사 배포는 더 앞선 PVC gate에서 120초 동안 대기하다 실패했다.

```text
persistentvolumeclaim/customer-b-drm-pvc created
error: timed out waiting for the condition
```

NetworkPolicy 권한을 추가해도 이 문제는 해결되지 않는다. 정적 PV를 사용하는 PVC라면 요청한 `volumeName`, StorageClass, 용량, access mode, node affinity를 별도로 확인해야 한다.

```bash
kubectl --context dev-cluster \
  -n platform describe pvc customer-b-drm-pvc

kubectl --context dev-cluster \
  get pv customer-b-drm-dev -o yaml
```

특히 local PV는 실제 노드 디렉터리와 `kubernetes.io/hostname` label이 manifest의 node affinity와 일치해야 한다. 존재하지 않는 PV를 기다리는 PVC는 권한을 아무리 넓혀도 `Bound`되지 않는다.

이번 작업에서는 기존 고객사와 신규 고객사가 파일을 섞지 않도록 환경별 전용 local PV를 준비했다.

| 환경 | PV | 저장 경로 예시 | 용량 |
|---|---|---|---|
| 개발 | `customer-b-drm-dev` | `/data/pv/customer-b-drm` | 100Gi |
| 운영 | `customer-b-drm-prod` | `/pv/customer-b-drm` | 500Gi |

PV는 각 클러스터의 지정 노드에 고정했다.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: customer-b-drm-dev
spec:
  capacity:
    storage: 100Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-path-pv
  local:
    path: /data/pv/customer-b-drm
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - worker-dev
```

적용 순서는 다음과 같다.

1. 대상 노드의 실제 디스크 여유 공간을 확인한다.
2. host directory를 만들고 Pod가 쓸 수 있는 소유권과 권한을 설정한다.
3. 해당 클러스터에 환경별 PV를 적용한다.
4. 기존 Pending PVC가 자동으로 `Bound`되는지 확인한다.

```bash
kubectl --context dev-cluster get pv customer-b-drm-dev
kubectl --context dev-cluster \
  -n platform get pvc customer-b-drm-pvc --watch
```

PV의 이름과 조건이 PVC와 일치하면 기존 Pending PVC는 자동으로 바인딩될 수 있다. 먼저 PVC부터 삭제하면 원인 증거를 잃거나 Retain 볼륨의 claim 관계를 더 복잡하게 만들 수 있다. `Released` PV가 보인다면 이전 claim과 보존 데이터를 확인한 뒤 처리해야 한다.

개발 PV와 운영 PV manifest는 준비했지만, 운영 배포는 별도 승인과 실제 `Bound` 증거가 필요한 단계로 남겼다. RBAC의 `yes` 결과와 manifest 준비만으로 운영 배포가 끝났다고 기록하지 않았다.

하나의 CI job에서 연달아 발견됐더라도 다음 두 문제는 분리해서 다뤄야 한다.

```text
Forbidden NetworkPolicy → ServiceAccount RBAC 문제
PVC Pending             → PV/StorageClass/노드 저장소 문제
```

## 잘못된 해결책 피하기

가장 빠르게 보이는 해결책이 가장 위험할 때가 있다.

### `cluster-admin`을 부여한다

배포 하나를 통과시키려고 CI ServiceAccount에 클러스터 전체 권한을 주면 사고 범위가 namespace 밖으로 커진다. NetworkPolicy apply에 필요한 namespaced 권한만 추가하면 된다.

### 토큰부터 다시 만든다

오류 로그에 기대한 ServiceAccount가 표시되고 다른 리소스 작업도 성공했다면 인증은 이미 통과한 것이다. 이때 토큰 재발급은 권한 누락을 해결하지 못하고 불필요한 credential rotation만 만든다.

### live Role만 수정한다

즉시 실패는 사라질 수 있지만 관리 원본이 그대로면 다시 되돌아간다. live 수정과 IaC 수정을 한 작업으로 관리해야 한다.

### 개발 결과를 운영에도 적용됐다고 본다

클러스터가 다르면 ServiceAccount와 Role도 별개다. 동일한 이름을 사용하더라도 live 상태는 각각 확인해야 한다.

## 배포 재시도 전 체크리스트

- 오류의 `system:serviceaccount:<namespace>:<name>`을 확인했다.
- ServiceAccount가 실제 클러스터에 존재한다.
- RoleBinding을 subject 기준으로 추적했다.
- Role을 공유하는 모든 subject를 확인했다.
- `auth can-i`로 실패 권한을 재현했다.
- 필요한 resource와 verb만 별도 rule로 추가했다.
- 개발과 운영 클러스터를 각각 확인했다.
- live Role과 IaC 원본을 함께 수정했다.
- PVC/PV 문제를 RBAC 문제와 분리했다.
- CI 재실행 후 rollout과 smoke test를 별도로 확인한다.

이번 배포에서 네 번의 실패는 서로 다른 답을 요구했다. 테스트에는 결정적인 fixture owner가 필요했고, PV 사전 검사에는 더 큰 권한이 아니라 더 좁은 PVC gate가 필요했다. NetworkPolicy에는 ServiceAccount가 실제로 사용하는 Role의 최소 권한이 필요했고, Pending PVC에는 클러스터 밖 노드의 실제 저장 공간이 필요했다.

`Forbidden`은 막연한 Kubernetes 오류가 아니다. 메시지에 요청한 사용자, 리소스, API group, namespace, verb가 모두 들어 있다. `Pending`도 단순한 대기 상태가 아니라 PV와 노드 계약을 확인하라는 신호다. 실패한 계층을 먼저 분리하면 토큰 재발급이나 `cluster-admin` 같은 큰 처방 없이 필요한 경계만 고칠 수 있다.
