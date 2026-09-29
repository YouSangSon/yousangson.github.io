---
title: "Incr — Yizheng Xie 외 | 다시 실행할 때 무엇을 생략해도 되는가"
description: "MapReduce의 장애 복구와 Incr의 수정 후 재실행을 비교하고, 명령을 생략하려면 입력뿐 아니라 파일·스트림 효과까지 확인해야 하는 이유를 작은 실행 추적으로 설명한다."
date: 2026-09-29
categories: [research, systems]
tags: [paper-review, incremental-computation, shell, fault-tolerance]
---

스크립트의 앞부분을 고쳤지만 최종 파일은 예전과 같을 때, 뒤의 명령도 다시 실행해야 할까? `sort`의 입력 바이트가 그대로라면 계산을 되풀이할 이유는 없어 보인다. 그런데 `sort` 뒤에 파일을 쓰는 명령이 있다면 이야기가 달라진다. 그 명령을 실행하지 않더라도 이번 실행에서 있어야 할 파일과 출력 스트림은 만들어야 한다.

Yizheng Xie, Evangelos Lamprou, Jerry Xia, Nikos Vasilakis의 **_Incr: Faster Re-Execution via Bolt-On Incrementalization_**은 이 문제를 수정 중인 셸 프로그램에서 다룬다. OSDI 2026년 7월에 발표된 논문이다. 변경된 스크립트를 통째로 다시 실행하는 대신 명령별 의존성과 효과를 관찰하고, 안전한 경우 이전 효과를 적용한다.

비교할 고전은 Jeffrey Dean과 Sanjay Ghemawat의 **_MapReduce: Simplified Data Processing on Large Clusters_**, OSDI 2004 논문이다. 두 연구 모두 재실행을 다루지만, 한쪽은 작업자의 실패 후 계산을 복구하고 다른 쪽은 개발자가 프로그램을 고친 뒤 중복 계산을 줄인다. [Incr 원문, 2–4쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=2) · [MapReduce 원문, 1·4–5쪽](https://storage.googleapis.com/gweb-research2023-media/pubtools/4449.pdf#page=4)

## 같은 재실행, 다른 질문

MapReduce에서 작업자는 입력 조각의 `map` 작업을 마친 뒤 중간 결과를 자신의 로컬 디스크에 둔다. 이 작업자가 실패하면 완료 표시가 있더라도 그 중간 결과를 읽을 수 없으므로 `map`을 다시 배정한다. 완료된 `reduce` 결과는 전역 파일시스템에 남아 있으므로 같은 이유로 다시 돌릴 필요가 없다. 결정적 `map`·`reduce` 함수에 대해서는 작업별 임시 출력과 확정을 이용해 장애가 없는 순차 실행과 같은 결과를 제공한다.

반대로 보조 파일 같은 **사용자 정의 부수 효과**는 애플리케이션 작성자가 원자적이고 멱등하게 만들어야 한다. MapReduce는 *잃어버린 작업 결과를 복구*하려고 다시 실행한다. [MapReduce §3.3, 원문 4–5쪽](https://storage.googleapis.com/gweb-research2023-media/pubtools/4449.pdf#page=4) · [§4.5, 7쪽](https://storage.googleapis.com/gweb-research2023-media/pubtools/4449.pdf#page=7)

Incr는 셸 프로그램을 고친 뒤의 재실행을 다룬다. 앞 단계의 출력이 우연히 그대로일 수도 있지만, 입력 파일·환경 변수·명령 인수는 달라졌을 수 있다. 셸 명령은 표준 출력뿐 아니라 파일 생성·삭제·덮어쓰기와 종료 상태도 남긴다. Incr는 각 명령을 둘러싼 관측 지점(probe)으로 실행을 관찰하고, 다음 실행에서는 의존성이 같은지 검사해 이전 출력을 흘려보내고 파일 효과를 적용하거나 명령을 다시 실행한다. 그래서 단순한 `함수(입력) → 출력` 캐시보다 관찰 범위가 넓다. [Incr §3–5, 4–7쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=4)

## 출력은 같아도 실행 효과는 사라지지 않는다

다음 **설명용 실행 추적**으로 살펴보자. 논문의 벤치마크나 Incr 내부 코드를 옮긴 예제는 아니다. 입력 파일 `raw.txt`는 ASCII 두 줄 `B\nA\n`이고, 처음 실행에서는 다음 파이프라인을 쓴다고 하자.

```sh
cat raw.txt | tr '[:upper:]' '[:lower:]' | sort | tee result.txt | wc -l > count.txt
```

`tr`의 출력은 `b\na\n`, `sort`의 출력은 `a\nb\n`이다. `tee`는 같은 두 줄을 `result.txt`에 쓰고 표준 출력으로도 넘긴다. 따라서 `count.txt`에는 `2`가 기록된다. 이제 개발자가 둘째 명령을 아래처럼 바꾼다. 여기서는 ASCII 두 줄에 한정해 이전 명령과 같은 바이트를 낸다.

```sh
cat raw.txt | awk '{ print tolower($0) }' | sort | tee result.txt | wc -l > count.txt
```

새 `awk` 명령은 인수가 달라졌으므로 실행해야 한다. 하지만 그 명령이 낸 바이트가 이전과 같고 `sort`가 읽는 파일·환경 등 다른 의존성도 그대로라면, `sort`의 계산 결과를 다시 만들 필요가 없다. Incr는 파이프라인의 스트리밍을 유지하려고 각 명령을 먼저 시작할 수 있다. 입력 해시와 의존성을 확인한 뒤 재사용 가능하다고 판정하면 진행 중인 명령을 중단하고 저장된 출력으로 이어 간다. 즉 “생략”하더라도 프로세스는 잠깐 시작됐다가 멈출 수 있다. [Incr §5–6, 6–7쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=6)

`tee`와 마지막 리다이렉션까지 생각해야 추적이 끝난다. 계산만 건너뛰고 `tee`의 파일 쓰기까지 생략하면 이번 실행 뒤 `result.txt`가 있어야 한다는 계약을 놓친다. Incr가 저장하는 것은 표준 출력·표준 오류·종료 상태와 재적용 가능한 로컬 파일 효과다.

파일을 **덮어쓰는지 더 쓰는지**를 구분하려고 쓰기 의존성의 콘텐츠 해시도 검사한다. 예를 들어 `tee -a history.txt`였다면 재실행마다 추가되는 기록을 단순한 “같은 입력이니 아무것도 안 함”으로 처리할 수 없다. 이전 파일 상태와 기록된 효과의 의미를 함께 확인해야 한다. 위 셸 입력으로 Incr를 직접 실행한 결과는 아니다. 논문에 설명된 의존성 검사와 효과 재적용 방식을 이 예에 대입했다. [Incr §5, 6–7쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=6)

<div class="review-figure">
<iframe class="review-diagram" src="/assets/diagrams/2026-09-29/research/incr-effect-replay.html" title="의존성 확인과 실행 효과의 재사용" loading="lazy" width="100%" height="540" style="--diagram-height:540px;--diagram-mobile-height:900px" sandbox=""></iframe>
</div>

*의존성이 같고 재사용을 지원하는 효과라면, 명령 계산 대신 저장한 스트림·파일 효과를 적용한다. 의존성이 바뀌면 명령을 실행하며, 지원 밖 효과의 안전성을 이 도식이 보장하지는 않는다.*

## 관찰하지 못한 효과는 재사용의 근거가 될 수 없다

Incr는 명령을 격리한 파일시스템 뷰에서 실행해 변경분을 모으고, 시스템 호출을 추적해 읽기 의존성을 찾는다. 셸 내장 명령·함수·별칭 등은 같은 방식으로 probe를 씌우지 못하므로 별도 구문 처리가 필요하다. 모든 환경 변수를 의존성으로 취급하면 무관한 변수 변경에도 다시 실행하는 비용이 생긴다. 파일 읽기는 수정 시각으로, 쓰기는 콘텐츠 해시로 확인하는 것도 비용과 정밀도 사이의 선택이다. [Incr §4–5, 5–7쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=5)

어떤 효과를 다루느냐에 따라 가능한 일도 달라진다. 일반 파일과 표준 스트림 등은 기록했다가 재적용할 수 있다. 네트워크 통신은 감지할 수 있어도 같은 효과를 로컬에서 재생할 수 있는 것은 아니다. `-N` 옵션은 시간·네트워크·난수 관련 시스템 호출을 쓰는 명령의 재사용을 보수적으로 막는 휴리스틱을 추가한다.

원문 표 1의 다섯 분류를 실행 여부와 연결하면 다음과 같다. 단순히 “관찰된다”는 사실만으로 재사용할 수 있는 것은 아니다.

| 효과의 분류 | 예 | 재실행에서의 처리 |
| --- | --- | --- |
| 기록·재적용 가능 | 일반 파일 생성·덮어쓰기, 표준 출력 | 의존성이 같으면 저장한 효과를 적용 |
| 감지 가능 | 네트워크 통신 등 | 정확히 재적용할 수 없으면 다시 실행. 네트워크·시각·난수 감지는 `-N` 설정과 함께 해석 |
| 차단 | probe 밖의 프로세스에 신호 보내기 | 격리 경계를 넘는 동작을 막음 |
| 현재 구현에서 무시 | 호스트 이름 같은 시스템 상태 조회 | 바뀐 상태를 결과에 반영하지 못할 수 있음 |
| 범위 밖 | 실제 경과 시간에 의존하는 대기 | 일반적인 재사용 보장의 대상이 아님 |

*Incr §3·표 1의 분류를 한국어로 재구성했다. 셸 내장 명령에는 probe를 씌우지 않는다는 예외가 있어, 같은 이름의 동작을 모두 차단한다고 읽어서는 안 된다.*

“임의의 셸 명령을 모두 정확히 캐시한다”는 해석은 원문의 다섯 효과 분류와 맞지 않는다. [Incr 표 1·§3, 4–5쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=5) · [§5, 7쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=7)

파일 효과를 격리해 다루는 기반은 같은 OSDI 2026의 Evangelos Lamprou 등 연구 **_Controlling Opaque-Component Effects with Semisolates and Try_**와 연결된다. Incr는 이 `try` semisolate를 명령별 사설 파일시스템 뷰에 사용한다. 외부 HTTP 요청까지 이 격리로 되돌릴 수는 없다. 이미 보낸 요청을 재시도하거나 생략해도 되는지는 외부 시스템의 계약을 따로 확인해야 한다. [Incr §4, 6쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=6) · [Semisolates and Try 원문](https://www.usenix.org/system/files/osdi26-lamprou.pdf)

## 빠른 재실행의 값과 첫 실행의 비용

저자들은 14개 셸 작업에서 85번의 수정 후 재실행을 평가했다. Koala 작업을 바탕으로 하되 변경 이력은 원 개발자와의 논의, Git 이력, 수작업으로 구성한 편집을 섞었다. 각 수정 단계에서 일반 Bash와 Incr의 실행 시간을 **각각 세 번 재고 평균**으로 속도 비율을 계산했다. 실험 환경은 Ubuntu 22.04, Linux 5.15, 8코어 Xeon D-1548, 메모리 64GB, NVMe 저장소를 갖춘 CloudLab 장비 한 대다. [Incr 표 2·§8, 9–11쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=9)

14개 작업에 배정된 수정 횟수도 균등하지 않다. 원문 표 2에서 입력 크기와 수정 횟수를 옮겼다. 코드 줄 수·변경 사유 열은 생략했다.

| 작업 | 입력 크기 | 수정 후 재실행 수 |
| --- | ---: | ---: |
| dpt | 2.4 GB | 9 |
| bio | 3.5 GB | 6 |
| dict | 30 MB | 1 |
| ngram | 106 MB | 2 |
| uppercase | 200 MB | 1 |
| unixgame | 1.0 GB | 5 |
| nginx | 974 MB | 21 |
| weather | 887 MB | 2 |
| covid | 381 MB | 4 |
| spell | 3.1 GB | 6 |
| poet | 1 GB | 3 |
| image | 38 MB | 6 |
| music | 16 MB | 6 |
| beginner | 974 MB | 13 |
| 합계 | 크기는 원문 단위 유지 | 85 |

따라서 85번의 수정 결과를 평균 낸 값과 14개 작업을 같은 비중으로 평균 낸 값은 다를 수 있다. `nginx`의 21번과 `dict`의 한 번이 같은 수의 관측값을 제공하지 않기 때문이다.

85건 가운데 **69건은 빨라지고 16건은 느려졌다.** 평균을 읽기 전에 어느 집합을 평균 냈는지 나누어야 한다.

| 대상 | 원문 결과 | 분모와 의미 |
| --- | --- | --- |
| 빨라진 69건 | 평균 34.2배, 최대 373.3배 | 이 69건에서의 Bash/Incr 실행 시간 비율 |
| 느려진 16건 | 평균 0.73배 | 같은 속도 비율이 1보다 작아 Incr가 더 느림 |
| 5초를 넘는 작업의 첫 실행 | Bash 시간의 평균 2.01배 | 아직 재사용 결과가 없어 추적·격리·저장 비용을 부담 |
| 전체 작업의 캐시 | 원본 입력 크기의 평균 6.05배 | 시간 절약과 별도로 필요한 저장 비용 |

따라서 34.2배를 전체 85건의 평균이나 첫 실행의 개선으로 읽으면 안 된다. 추가 최적화와 선택적 주석에 따른 개선도 기본 설정의 값과 따로 보아야 한다. [Incr §8.1–8.2, 11–12쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=11) · [§8.4–8.5, 13쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=13)

[![Incr 원문 그림 4 중 unixgame과 music의 Bash·Incr 누적 실행 시간](/assets/images/research/incr-figure4-cost-cases.png)](/assets/images/research/incr-figure4-cost-cases.png)

*원문 부분 인용: Yizheng Xie 외, Incr, [PDF 11쪽 그림 4](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=11). unixgame·music 두 패널만 발췌했고 나머지 12개 작업은 생략했다. 이미지를 누르면 크게 볼 수 있다.*

각 패널의 왼쪽 막대가 Bash, 오른쪽이 Incr이고 세로축 단위는 초다. 막대는 수정 단계별 실행 시간을 쌓은 값이다. 작업이 작거나 시스템 호출이 많으면 추적·격리 비용이 재사용으로 아낀 시간을 잡아먹을 수 있다. 전체 결과 중에서 그 비용이 드러나는 두 사례를 골랐다.

속도가 빨라도 실행 결과가 바뀐다면 같은 작업을 최적화한 것이 아니다. 저자들은 벤치마크의 출력·종료 상태를 Bash와 대조했다. 이어 Bash 5.2.37(1) 테스트를 실행해 출력이 같은지 비교했다. 아래는 **원문 표 3의 모든 그룹과 합계**다. 예시 테스트 이름 열은 생략하고, 불일치 줄 수는 전체에서 일치 수를 빼 계산했다.

| 테스트 그룹 | 일치 / 비교한 출력 줄 | 불일치 줄 |
| --- | ---: | ---: |
| 파일명 패턴 확장 | 868 / 868 | 0 |
| 배열·자료구조 | 1,261 / 1,261 | 0 |
| 인용·이스케이프 | 877 / 877 | 0 |
| 치환·별칭 확장 | 1,701 / 1,703 | 2 |
| 유틸리티 | 80 / 80 | 0 |
| 환경 | 1,610 / 1,610 | 0 |
| 구문·함수·분기 | 1,547 / 1,547 | 0 |
| 프로세스 간 통신·실행 | 1,355 / 1,356 | 1 |
| POSIX | 536 / 536 | 0 |
| 셸 옵션 | 444 / 444 | 0 |
| 합계 | **10,279 / 10,282** | **3** |

*출처: Yizheng Xie 외, [Incr, PDF 12쪽 표 3 및 §8.3](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=12). 저자의 보고값으로 만든 한국어 표다. 분모는 테스트 파일 수나 명령 수가 아니라 비교한 출력 줄 수다.*

불일치는 확장과 프로세스 실행 그룹에 몰려 있다. 두 줄은 재귀 별칭을 확장할 때 probe를 둘 위치를 결정하지 못한 경우이고, 한 줄은 `PATH`를 지운 테스트에서 Incr가 자신의 실행 의존성을 찾지 못한 경우다. 전체 일치 비율만 보면 놓치기 쉬운 호환성 경계다.

파서 오류 사례 19건은 별도 제외했다. 이 수를 위 표의 불일치 세 줄에 더하면 사례 수와 출력 줄 수를 섞게 된다. 이는 조사한 프로그램과 테스트의 호환성 근거이지, 앞 절에 적은 외부 효과나 모든 가능한 셸 프로그램에 대한 증명은 아니다. 여기서 Incr 구현이나 전체 벤치마크를 직접 재현하지는 않았다. [Incr §8.3·표 3, 12–13쪽](https://www.usenix.org/system/files/osdi26-xie-yizheng.pdf#page=12)

## 느린 명령보다 먼저 실행 효과를 적는다

두 논문을 나란히 읽으면 재실행 여부를 결정하기 전에 물어야 할 것이 보인다. **무엇을 실행 결과로 볼 것인가?**

MapReduce의 기본 출력은 작업별로 확정되는 파일이고 보조 부수 효과는 작성자 책임이다. Incr는 명령의 스트림과 로컬 파일 효과까지 재사용 대상으로 삼지만, 감지·차단·무시·범위 밖 효과를 구분한다. 수정할 때마다 오래 걸리는 스크립트가 있다면, 먼저 느린 명령이 읽는 입력과 남기는 효과를 적어 보자. 그 효과를 관찰하고 안전하게 다시 적용할 수 있는가? 확인할 수 없다면 이전 출력이 같더라도 다음 실행을 생략하기는 어렵다.

## 참고 논문

- Yizheng Xie, Evangelos Lamprou, Jerry Xia, Nikos Vasilakis, [_Incr: Faster Re-Execution via Bolt-On Incrementalization_](https://www.usenix.org/conference/osdi26/presentation/xie-yizheng), OSDI 2026, 683–699쪽, 2026년 7월.
- Jeffrey Dean, Sanjay Ghemawat, [_MapReduce: Simplified Data Processing on Large Clusters_](https://research.google/pubs/mapreduce-simplified-data-processing-on-large-clusters/), OSDI 2004, 137–150쪽.
- Evangelos Lamprou 외, [_Controlling Opaque-Component Effects with Semisolates and Try_](https://www.usenix.org/conference/osdi26/presentation/lamprou), OSDI 2026, 453–471쪽. Incr가 사용한 효과 격리 기반에 관한 관련 원문이다.
- Charlie Curtsinger, Daniel W. Barowy, [_Riker: Always-Correct and Fast Incremental Builds from Simple Specifications_](https://www.usenix.org/conference/atc22/presentation/curtsinger), USENIX ATC 2022, 885–898쪽. 빌드 입력 의존성을 자동 추적하는 별도의 문제 설정을 비교할 때 읽을 자료다.
