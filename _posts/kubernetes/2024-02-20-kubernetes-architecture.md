---
title: Kubernetes 아키텍처 — 상태 제어와 요청 경로 구분하기
description: 컨트롤 플레인의 상태 제어와 애플리케이션 트래픽 경로를 나누어 Kubernetes 구조를 이해한다.
categories: [kubernetes]
tags: [kubernetes, k8s, architecture, interview]
date: 2024-02-20
---

Kubernetes 구조를 외울 때 컴포넌트 이름부터 나열하면 장애 상황에 적용하기 어렵다. 먼저 두 경로를 나누면 이해하기 쉽다. **원하는 상태를 기록하고 맞추는 경로**, 그리고 **사용자의 요청이 애플리케이션에 도달하는 경로**다.

## 원하는 상태는 어떻게 실제 상태가 되는가

`kubectl apply`로 Deployment를 제출하면 API 서버가 인증·인가와 검증을 거쳐 객체를 저장한다. 컨트롤러는 원하는 복제본 수와 실제 상태를 비교해 필요한 리소스를 만든다. 스케줄러는 아직 노드에 배치되지 않은 Pod의 실행 위치를 정하고, 해당 노드의 kubelet은 컨테이너 런타임을 통해 실행 상태를 맞춘다. [Kubernetes 컴포넌트](https://kubernetes.io/docs/concepts/overview/components/)

각 컴포넌트가 한 번씩 호출되는 단일 함수처럼 동작하는 것은 아니다. API 객체의 변화를 관찰하고 반복해서 상태를 맞추는 제어 루프다. 따라서 API 요청 성공과 Pod 실행 성공도 별도로 확인해야 한다.

## API 서버는 애플리케이션 트래픽의 중계기가 아니다

일반적인 서비스 요청은 Service와 클러스터 네트워크, 필요하면 Ingress 컨트롤러를 거쳐 Pod로 전달된다. 모든 요청이 Kubernetes API 서버를 통과하는 것은 아니다.

이 구분은 장애를 찾을 때 유용하다. `kubectl` 조회가 된다는 사실은 제어 경로의 일부가 동작한다는 뜻이다. 외부에서 API 서버 애플리케이션에 접속할 수 있는지는 DNS, 외부 진입점, Service 대상, Pod readiness 등을 따로 확인해야 한다. [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)

## 고가용성은 무엇을 복제하는가에 달려 있다

컨트롤 플레인과 etcd의 장애 대응, 애플리케이션 Pod의 복제, 노드·장애 영역의 분산은 서로 다른 문제다. Pod를 여러 개 만들어도 같은 노드에 몰려 있거나 같은 외부 DB에 의존하면 그 지점의 장애를 함께 겪을 수 있다.

면접에서도 “복제본을 늘립니다”에서 끝내기보다 어떤 장애를 견디려는지 설명하는 편이 정확하다. 노드 하나의 중단인지, 컨트롤 플레인 접근 불가인지, 저장소 장애인지에 따라 확인할 대상이 달라진다.

## 다음에 읽을 글

- [컨트롤 플레인과 워커 노드의 역할](/posts/master-worker-nodes/): 컴포넌트별로 무엇을 확인할지 정리한다.
- [Deployment와 StatefulSet](/posts/deployment-vs-statefulset/): 교체 가능한 복제본과 안정적인 식별자의 차이를 본다.
- [Ingress와 LoadBalancer](/posts/ingress-vs-loadbalancer/): 규칙과 실제 트래픽 처리 주체를 구분한다.
- [CI에서 NetworkPolicy와 RBAC를 구분한 사례](/posts/gitlab-ci-kubernetes-networkpolicy-rbac-debugging/): 연결 실패와 권한 거부를 같은 문제로 다루지 않는 방법을 설명한다.
