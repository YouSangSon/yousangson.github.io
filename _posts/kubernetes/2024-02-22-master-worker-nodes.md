---
title: Kubernetes 컨트롤 플레인과 워커 노드의 역할
description: API 서버, 스케줄러, kubelet, 런타임과 네트워크 구현의 책임을 구분한다.
categories: [kubernetes]
tags: [kubernetes, master node, worker node, k8s]
date: 2024-02-22
---

Kubernetes의 컨트롤 플레인은 클러스터의 원하는 상태를 관리하고, 워커 노드는 애플리케이션을 실행한다. 예전 자료에서 말하는 “마스터 노드”의 역할을 현재 문서에서는 주로 **컨트롤 플레인**으로 설명한다.

역할을 구분하는 것이 특정 물리 서버 구성을 강제하는 것은 아니다. 여기서는 컴포넌트의 책임을 기준으로 나눈다.

## 컨트롤 플레인의 책임

| 컴포넌트 | 책임 |
| --- | --- |
| kube-apiserver | Kubernetes API의 진입점. 요청을 인증·인가하고 객체를 검증한다. |
| etcd | 클러스터 상태를 저장한다. 일반 애플리케이션 데이터베이스를 대신하지 않는다. |
| kube-scheduler | 노드가 지정되지 않은 Pod의 실행 위치를 선택한다. |
| kube-controller-manager | 복제본 수 등 원하는 상태와 실제 상태를 맞추는 컨트롤러를 실행한다. |

스케줄러가 컨테이너를 직접 실행하는 것은 아니다. 노드 배치가 결정된 이후 실행을 담당하는 것은 노드의 kubelet과 컨테이너 런타임이다. [공식 컴포넌트 설명](https://kubernetes.io/docs/concepts/overview/components/)

## 워커 노드의 책임

| 컴포넌트 | 책임 |
| --- | --- |
| kubelet | 노드에 할당된 Pod의 컨테이너가 실행되도록 관리한다. |
| 컨테이너 런타임 | containerd, CRI-O 등 CRI를 지원하는 런타임이 컨테이너를 실행한다. |
| Service 네트워크 구현 | kube-proxy 또는 이를 대체하는 구현이 Service의 트래픽 전달을 지원한다. |
| Pod 네트워크 구현 | CNI 플러그인 등을 통해 Pod의 네트워크를 구성한다. |

kube-proxy가 모든 Pod 간 네트워크를 혼자 구현하는 것은 아니다. Service 처리와 Pod 네트워크 구성을 나누어 봐야 한다.

## 장애 증상을 역할에 연결하기

Pod가 `Pending`이라면 먼저 이벤트를 보고 스케줄링 실패인지, 볼륨 준비 문제인지 좁힌다. 노드에 배치됐지만 컨테이너가 시작하지 못하면 이미지 다운로드, 런타임, 볼륨 마운트 등 해당 단계의 증거를 확인한다.

Pod가 실행 중인데 요청이 실패한다면 제어 경로 밖의 문제일 수 있다. [Ingress와 Service 경로](/posts/ingress-vs-loadbalancer/)에서 실제 트래픽을 처리하는 주체를 따라가 보자. 리소스가 존재한다는 사실과 그 경로가 동작한다는 사실을 구분하는 것이 출발점이다.
