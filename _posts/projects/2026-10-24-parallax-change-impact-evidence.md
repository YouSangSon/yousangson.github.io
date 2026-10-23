---
title: "Parallax 개발기 — 변경 영향에 파일 목록보다 근거가 필요한 이유"
description: "변경 파일에서 호출자·테스트·문서까지 이어지는 관계를 로컬 인덱스에 저장하는 Parallax 개발기. 실제 TypeScript import 해석과 자기 소스 검증 코드를 따라가며 영향 후보, 신뢰도, 누락 경계를 살펴본다."
categories: [projects, developer-tools]
tags: [parallax, change-impact, code-graph, developer-tools, coding-agent]
date: 2026-10-24
related:
  - slug: git-worktree-runtime-inputs
    reason: 같은 소스 경로라도 실제 작업 폴더와 로컬 입력이 다르면 분석의 전제가 달라지는 문제를 이어 봅니다.
  - slug: parnas-modularity-hidden-decisions
    reason: 변경이 퍼지는 관계를 찾은 뒤, 어떤 결정을 모듈 안에 숨겨야 할지 생각해 봅니다.
---

`src/store.ts`를 고칠 때 확인할 범위는 그 이름이 등장하는 파일만으로 정해지지 않는다. 호출자는 `./store.js`로 가져올 수 있고 테스트는 다른 진입점을 거쳐 저장 계층에 도달할 수 있다. 개인 프로젝트 **Parallax**에서는 변경 파일에서 관련 코드·테스트·문서로 이어지는 관계와 그 근거를 함께 꺼내는 흐름을 만들었다.

Parallax는 코드를 직접 수정하는 도구가 아니다. 코딩 에이전트나 개발자가 수정 전에 검토할 범위를 정하도록 저장소를 로컬에 색인하고 변경 영향 보고서를 만드는 도구다. 이 글은 공개 커밋 [`feebc93`](https://github.com/YouSangSon/Parallax/tree/feebc93f24daf7c72d64e125194803608a914fc2)의 구현을 따라간다. 아래 명령은 사용 입력을 설명하며 결과에 관한 설명은 소스 분석에 근거한다.

## 문자열이 같다는 사실과 의존한다는 사실

이 버전의 `src/analyzer.ts`는 저장소와 인덱스를 다루는 함수들을 다음 경로에서 가져온다.

```typescript
'./store.js'
```

분석할 실제 소스는 `src/store.ts`다. TypeScript의 NodeNext/ESM 방식에서는 소스의 import에 출력 파일 확장자인 `.js`를 적는 경우가 있다. `store.ts`라는 정확한 문자열만 찾으면 이 import를 놓칠 수 있다. 반대로 `store`를 넓게 검색하면 설명 문장이나 관계없는 이름도 함께 나온다. 검색은 출발점이지만 결과마다 무엇을 가리키는지 다시 판단해야 한다. [실제 import](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/analyzer.ts#L14-L15)

그래서 Parallax의 그래프는 파일을 점으로 놓고 파일 사이 관계를 방향이 있는 선으로 저장한다. `analyzer.ts`가 `store.ts`를 가져오면 관계 방향은 **사용하는 파일 → 사용되는 파일**이다. 저장 계층을 바꿨을 때는 이 선을 거슬러 올라가 호출자 후보를 찾는다. 이름이 비슷한 파일을 모으는 방식에서, 왜 함께 확인해야 하는지를 설명하는 방식으로 질문을 바꾼 셈이다.

## 변경 파일 하나가 보고서가 되기까지

저장소에 인덱스를 준비한 뒤 넣는 입력은 파일 경로다. 내부 그래프에는 심벌도 있지만 이 CLI 사용 사례의 변경 단위는 파일이다.

```bash
parallax analyze --changed src/store.ts --depth 2 --json
```

CLI는 변경 경로와 탐색 깊이를 읽어 `analyzeDiff`에 넘긴다. `--json`에서는 보고서를 표준 출력으로 내보내고 분석 보고서를 파일이나 DB 보고서 행으로 저장하는 옵션은 끈다. 색인을 새로 만드는 명령은 별도의 `parallax index`다. [CLI의 분석 진입점](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/cli.ts#L373-L414)

분석 전에 필요한 상태는 저장소 안의 `.parallax/impact.db`가 소유한다. 인덱서는 언어별 추출기를 통해 파일·심벌·관계를 모으고 관계의 출처 코드와 위치를 함께 저장한다. import가 가리키는 로컬 파일을 찾으면 `DEPENDS_ON` 관계를 만들고 `proven`이라는 신뢰도를 붙인다. 해석하지 못하면 외부 대상을 나타내는 항목에 `heuristic` 관계를 남긴다. 같은 import 문장이라도 로컬 의존성이 확인됐는지에 따라 이후 해석이 달라진다. [관계 추출](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/adapters/multi-language-regex.ts#L417-L465) · [근거 저장](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/indexer.ts#L2503-L2520)

`./store.js`와 `store.ts`의 연결도 이 단계에서 해결한다. 경로 해석 함수는 `.js`, `.jsx`, `.mjs`, `.cjs` 확장자를 제거한 후보를 추가하고 `.ts` 등을 붙여 인덱스에 있는 파일인지 확인한다. 파일명을 바꿔 놓는 작업이 아니라 import 표기와 실제 소스 파일을 연결하는 작업이다. [경로 해석 구현](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/adapters/multi-language-regex.ts#L5270-L5300)

분석기는 가장 최근에 완료된 인덱스를 고른 뒤 `file:src/store.ts`를 시작점으로 삼는다. 그 파일을 대상으로 하는 관계를 조회하고 관계의 출발 파일을 다음 탐색 대상으로 넣는다. 깊이 2라면 직접 의존 파일과 그다음 관계까지 살펴본다. 파일별 결과에는 관계 경로, 탐색 깊이, 신뢰도를 남기고 근거에는 파일·코드 조각·위치를 붙인다. [분석 시작과 인덱스 확인](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/analyzer.ts#L136-L208) · [역방향 탐색](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/analyzer.ts#L486-L573)

이 소스에서 확인할 수 있는 한 경로는 다음과 같다. 실제 보고서를 실행해 캡처한 출력이 아니라 import와 탐색 코드를 연결한 설명이다.

| 단계 | 확인할 대상 | 이 단계가 남기는 판단 근거 |
| --- | --- | --- |
| 입력 | `src/store.ts` 변경 | 분석을 시작할 파일 |
| 색인 | `analyzer.ts`의 `./store.js` import | 로컬 `store.ts`를 대상으로 하는 의존 관계 |
| 탐색 | `store.ts`로 들어오는 관계 역조회 | `analyzer.ts`를 검토 후보로 삼는 이유 |
| 출력 | 영향 후보와 근거 | 관련 경로·신뢰도·소스 위치를 열어 볼 수 있는 보고서 |

이 연결이 있어도 `analyzer.ts`의 동작이 반드시 깨지는 것은 아니다. `store.ts` 내부 구현만 바꾸고 함수 계약을 지켰다면 호출자가 정상일 수 있다. 보고서는 변경의 결과를 예언하기보다 검토할 후보와 이유를 제공한다.

## 테스트와 문서도 같은 무게로 묶으면 안 된다

코드 의존성만 찾으면 검증과 설명의 변경을 놓칠 수 있다. Parallax는 테스트의 import나 이름을 통해 대상 파일을 추론하고 `VERIFIES` 관계를 만든다. Markdown에서 소스 경로를 언급하면 문서 종류에 맞는 관계도 만든다. 다만 근거의 강도가 다르다. [테스트와 문서 연결](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/adapters/multi-language-regex.ts#L482-L525)

| 관계의 근거 | 구현에서 붙이는 신뢰도 | 사람이 확인할 것 |
| --- | --- | --- |
| 로컬 파일로 해석된 import | `proven` | 무엇을 가져와 어떤 계약에 의존하는가 |
| 테스트 import·이름으로 추론한 검증 대상 | `inferred` | 실제로 바뀐 동작을 검증하는가 |
| 문서에서 발견한 소스 경로 언급 | `heuristic` | 현재 규칙인가, 과거 사례나 단순 소개인가 |

여기서 `proven`은 제품이 붙이는 관계 신뢰도 이름이다. **테스트 실패나 사용자 영향이 증명됐다는 뜻은 아니다.** 테스트 파일이 공통 도우미를 가져온다는 사실과 그 테스트가 특정 분기를 검증한다는 사실도 다르다.

문서가 과거 예제에서 파일명을 한 번 언급했다면 관련 후보에는 오를 수 있어도 수정 대상은 아닐 수 있다. 이런 오탐을 없애려고 모든 약한 관계를 버리면 실제로 갱신해야 할 운영 문서도 놓칠 수 있다. 낮은 신뢰도의 후보를 남기고 근거를 열어 판단하게 하는 것이 이 구현의 선택이다.

보고서는 영향을 받는 JavaScript 계열 테스트 경로에서 검증 명령도 제안한다. 명령을 제안하는 단계와 실제 실행은 분리되어 있다. 에이전트가 보고서를 받았다는 사실만으로 검증이 끝나지는 않는다. [보고서와 검증 동작 생성](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/analyzer.ts#L271-L317)

## 도구 자신에게 적용할 때 드러나는 검증 단위

Parallax에는 자기 소스를 임시 디렉터리에 복사해 색인하는 dogfood 테스트가 있다. 이 테스트는 `src/store.ts`를 변경 입력으로 주고 `proven`으로 분류된 `src/` 의존 파일이 최소 5개인지 확인한다. 별도의 조회는 내부 `DEPENDS_ON` 관계가 로컬 파일 대신 외부 대상으로 흩어지지 않았는지도 검사한다. [자기 소스 검증 코드](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/tests/dogfood.integration.ts#L12-L110)

테스트 주석에는 NodeNext의 `.js` import가 외부 대상으로 처리되면서 저장 계층의 코드 의존성이 거의 사라졌던 회귀가 설명되어 있다. 이 경우 추출 함수의 작은 예제들이 통과해도 실제 저장소에서 변경 파일과 호출자가 연결되지 않으면 도구의 핵심 사용 흐름은 실패한다. 그래서 검증 대상에 **실제 소스의 import → 로컬 파일 관계 → 영향 보고서** 전체를 넣었다.

최소 개수를 검사하는 이유도 있다. 정상적인 리팩터링으로 파일 수는 달라질 수 있으므로 정확한 목록을 고정하기보다 내부 관계가 거의 사라지는 실패를 잡는 기준을 둔 것이다. 이 검사는 전체 영향 관계가 정확하다는 보증은 아니다. 또한 이 글에서는 테스트를 새로 실행하지 않았으므로 해당 커밋에 이런 회귀 방지 검사가 있다는 근거로만 다룬다.

## 작은 결과를 주려면 빠진 범위도 알려야 한다

그래프를 무제한으로 따라가면 공통 모듈 하나가 저장소 대부분을 연결할 수 있다. 분석기는 깊이와 노드별 유입 관계 수에 상한을 두고 관계 수가 상한을 넘으면 잘렸다는 경고를 남긴다. 같은 경로의 순환을 피하는 처리도 있다. 결과가 작다는 이유만으로 영향이 작다고 해석하면 안 되는 이유다. [탐색 상한과 순환 처리](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/analyzer.ts#L502-L566)

에이전트에 전달하는 context pack도 같은 문제를 갖는다. context pack은 보고서에서 선택한 영향 후보·문서·근거를 예산에 맞게 줄인 묶음이다. 구현은 선택 개수만 줄이는 데서 멈추지 않고 `omittedCounts`와 잘림 여부를 남긴다. 에이전트가 받은 항목이 전체인지 일부인지 판단할 수 있어야 하기 때문이다. [context pack의 선택과 생략 정보](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/src/context_pack.ts#L127-L211)

결과가 비어 있을 때도 전제가 있다. 분석 시점의 파일 해시가 인덱스와 다르면 오래된 인덱스라는 경고가 붙는다. 변경 파일이 인덱스에 없으면 `unknown` 후보와 coverage gap을 남긴다. 이 상태에서는 “관련 코드가 없다”는 결론부터 내릴 수 없다. 먼저 최신 상태를 색인했는지, 사용한 언어 추출기가 필요한 관계를 지원하는지 확인해야 한다.

현재 공개 버전은 모든 언어의 완전한 의미 분석을 제공하지 않는다. 동적 호출이나 고급 타입 관계를 충분히 추적하지 못하는 영역도 남아 있다. 따라서 검색보다 항상 정확하거나 검토 시간을 얼마나 줄였다고 말할 근거는 이 글에 없다. [공개 기능 범위와 한계](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/README.md#%EF%B8%8F-current-limitations)

Parallax의 변경 영향 분석은 검증할 수 있는 연결을 얼마나 남기는지로 살펴볼 수 있다. 공통 함수 하나를 바꿀 때 직접 import하는 호출자 하나와 그 동작을 확인하는 테스트 하나를 먼저 골라 보자. 도구가 둘을 찾아냈다면 관계의 근거를 열어 보고 찾지 못했다면 인덱스·경로 해석·추출 범위 중 어디에서 연결이 끊겼는지 확인한다. 그렇게 검증할 수 있는 연결이 쌓여야 변경 전에 꺼내 볼 만한 지도가 된다.

## 프로젝트

[Parallax](https://github.com/YouSangSon/Parallax)는 YouSangSon 계정에서 공개한 개인 프로젝트다. 이 글의 기준은 2026년 10월 24일 검토한 `feebc93`이며 [MIT 라이선스](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/LICENSE)로 공개되어 있다. 설치 조건과 사용법은 같은 판본의 [README](https://github.com/YouSangSon/Parallax/blob/feebc93f24daf7c72d64e125194803608a914fc2/README.ko.md)에서 확인할 수 있다.
