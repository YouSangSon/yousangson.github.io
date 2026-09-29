---
title: Kubernetes Ingress vs 로드밸런서 차이점
description: Ingress와 로드밸런서의 차이점, 계층, 기능, 사용 사례 비교
categories: [kubernetes]
tags: [kubernetes, ingress, load balancer, k8s]
date: 2024-02-23
---

Ingress와 로드밸런서를 비교할 때는 범위를 먼저 맞춰야 한다. 로드밸런서는 트래픽을 분산하는 구현 전반을 뜻한다. 여기서는 Kubernetes의 **Service `type: LoadBalancer`**와 **Ingress 리소스**를 비교한다.

## 규칙과 구현을 나눠 보기

| 대상 | 선언하는 것 | 실제 처리 주체 |
| --- | --- | --- |
| LoadBalancer Service | 서비스를 외부에 노출할 진입점 | 클라우드나 클러스터의 로드밸런서 구현 |
| Ingress | 호스트·경로에 따른 HTTP/HTTPS 라우팅 규칙 | Ingress 컨트롤러와 연결된 프록시 또는 로드밸런서 |

Ingress YAML만 만들었다고 트래픽이 흐르지는 않는다. 해당 규칙을 읽고 적용할 컨트롤러가 있어야 한다. LoadBalancer Service도 실제 외부 진입점을 제공하는 구현이 필요하다. [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/), [Service](https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer)

## 함께 사용하는 구조

한 가지 구성은 외부 로드밸런서가 Ingress 컨트롤러로 요청을 보내고, 컨트롤러가 호스트나 URL 경로에 따라 내부 서비스의 백엔드로 전달하는 것이다. 컨트롤러가 외부 로드밸런서를 직접 구성하는 방식도 있다.

따라서 “Ingress는 L7이고 로드밸런서는 L4”라고 일반화할 수 없다. 로드밸런서 제품에도 L7 기능이 있으며, Ingress는 그 기능을 선언하고 연결하는 방식 중 하나다.

## 어떤 요구사항을 비교해야 할까

HTTP 요청을 여러 호스트·경로로 나누려는지, 일반 TCP/UDP 서비스를 외부에 노출하려는지부터 확인한다. TLS 종료 위치, 헬스 체크, 클라이언트 주소 보존 방식은 선택한 구현의 설정까지 살펴봐야 한다.

비용 역시 Ingress라는 이름만으로 결정되지 않는다. 공유하는 외부 진입점 수, 처리량, 컨트롤러 운영 비용, 장애 범위를 함께 비교해야 한다.

## 장애를 찾을 때의 적용

도메인이 해석되는지, 외부 진입점에 연결되는지, 라우팅 규칙이 맞는지, Service가 Ready 상태의 Pod를 대상으로 삼는지 차례로 확인한다. 리소스가 만들어졌다는 사실만으로 접속 성공을 판단하지 않는다.

[NetworkPolicy와 RBAC 장애를 분리한 사례](/posts/gitlab-ci-kubernetes-networkpolicy-rbac-debugging/)도 같은 접근을 사용한다. 네트워크로 도달하지 못하는 실패와 도달한 뒤 권한이 거부되는 실패는 해결할 위치가 다르다.
