---
title: "Akasha 개발기 — 에이전트가 기억을 찾는 것과 토큰을 아끼는 것 사이"
description: "코딩 에이전트의 결정과 제약을 세션 밖에 보관하는 Akasha를 만들며, 검색 결과를 context pack으로 조립하는 흐름과 MCP·CLI 전달 방식에 따라 달라진 입력 토큰 평가를 정리했다."
date: 2026-10-24
categories: [projects, ai]
tags: [akasha, agent-memory, mcp, retrieval, context-pack, evaluation]
related:
  - slug: atommem-learned-memory-operations
    reason: 기억 저장 기능과 과제에 맞는 기억 선택 정책을 구분해 봅니다.
  - slug: immutable-versions-through-rag-pipeline
    reason: 원본과 파생 검색 색인의 책임을 나누는 이유를 이어 읽습니다.
---

새 코딩 세션을 시작할 때 지난 대화 전체보다 먼저 필요한 것은 “어떤 결정을 했고, 어떤 제약을 지켜야 하는가”다. 내가 만드는 **Akasha**는 그 결정과 제약을 세션 밖에 저장하고 다음 작업에 필요한 부분을 다시 꺼내 주는 개인 프로젝트다. 개발하면서 확인해야 할 질문도 둘로 나뉘었다. 필요한 기억을 되찾는가, 그리고 그 기억을 전달하는 과정까지 포함해 모델의 입력을 줄이는가.

이 글은 공개 저장소의 [2026년 10월 24일 기준 소스][source]를 따라 설명한다. Akasha는 [MIT 라이선스][license]로 공개되어 있다.

## 대화 전체 대신 다시 사용할 결정을 남기기

Akasha의 출발점은 세션이 끝나도 결정·제약·요약을 다음 세션에서 찾을 수 있게 하는 것이다. 코드를 다시 분석하면 현재 구현은 알 수 있어도 왜 그 구현을 택했는지까지 항상 복원할 수는 없다. 그래서 기억의 단위를 전체 대화가 아니라 다시 사용할 수 있는 기록으로 잡았다. 이 목적은 [프로젝트 소개][readme]에도 명시되어 있다.

저장과 검색에는 서로 다른 책임을 줬다. 기본 구성에서 PostgreSQL은 기억의 원본을 소유하고 Qdrant는 잘게 나눈 기억의 벡터를 보관한다. 벡터는 텍스트를 의미가 가까운 정도로 비교하기 위한 수치 표현이다. 검색 색인을 다시 만드는 작업은 PostgreSQL에 남은 내용을 읽어 수행한다. 임베딩의 기본 공급자는 로컬 ONNX 모델을 실행하는 `transformers`다. [저장·검색 구조][architecture]

이렇게 하면 “기억이 저장돼 있다”와 “이번 작업에서 그 기억을 찾았다”를 분리해 볼 수 있다. 원본이 남아 있어도 검색 후보에서 빠지면 다음 세션에는 도움이 되지 않는다. 반대로 검색 후보가 나왔다고 그 텍스트를 곧바로 신뢰할 지시로 취급해서도 안 된다.

## 작업 한 문장이 context pack이 되기까지

README에는 결제 재시도에 멱등성 키를 쓰기로 한 결정을 저장하고 환불 엔드포인트 작업용 기억 묶음을 만드는 예제가 있다. 멱등성 키는 같은 요청을 재시도했을 때 중복 처리를 막기 위한 식별자다. 여기서는 그 예제의 마지막 요청을 따라가 보자. 아래는 구현을 읽기 위한 입력이며 새로 실행한 결과는 아니다. [README 사용 예제][worked-example]

```json
{
  "projectKey": "checkout",
  "task": "add refund endpoint"
}
```

이 입력은 `build_context_pack`으로 들어간다. **Context pack**은 새 세션에 전달할 기억을 섹션별로 묶은 Markdown이다. 기본 서비스 경로의 핸들러는 빈 작업 문장과 범위 식별자를 검사하고 작업 문장 `add refund endpoint`를 검색 질의로 임베딩한다. 조직 범위도 필요하며 HTTP 인증 등 호출 경로에서 결정된 조직 식별자가 검색 계층으로 전달된다. [context pack 진입점][handler]

검색은 한 갈래로 끝나지 않는다. 해당 프로젝트의 벡터 후보, 요청에 포함된 사용자 범위의 벡터 후보, PostgreSQL의 어휘 검색 후보를 함께 가져온다. 벡터 검색에서 받은 ID는 PostgreSQL 원본으로 다시 조회한다. 이때도 조직 조건을 전달한다. 후보를 합친 뒤 벡터·어휘 점수와 기억 종류·최신성 등을 반영해 순위를 정하고 요청 개수만큼 남긴다. 따라서 의미가 비슷한 문장뿐 아니라 정확한 식별자가 들어 있는 기록도 후보가 될 수 있다. [검색과 재정렬][retrieval]

검색 결과는 코드에서 기록의 종류와 접두어를 보고 분류해 묶음으로 조립한다. 새 LLM을 호출해 요약하지는 않는다. 가령 아래 세 기록이 검색됐다고 가정하면 다음처럼 배치된다. **입력 기록은 설명을 위해 구성한 예시**이며, 검색이 실제로 이 세 항목을 반환했다는 뜻은 아니다.

| 검색된 기록 | 조립 규칙 | 들어가는 섹션 |
| --- | --- | --- |
| 종류가 `decision`인 “결제 재시도에 멱등성 키를 쓴다” | 결정 종류 또는 결정 출처 | Recent Decisions |
| `Constraint: Never log raw payment data.` | `Constraint:` 접두어 | Constraints |
| `Open question: Which refund retries are allowed?` | `Open question:` 접두어 | Open Questions |

구현은 미해결 질문, 제약, 결정, 프로젝트 요약 순으로 분류 조건을 확인한다. 따라서 종류가 `decision`이어도 내용이 `Constraint:`로 시작하면 제약 섹션에 들어간다. 프로젝트 요약은 최대 2개, 나머지 섹션은 각각 최대 5개를 선택한다. 선택한 ID와 이유도 결과에 남기고 기본 서비스 경로는 묶음과 선택 ID를 DB에 기록한다. [조립 규칙][pack]

이 규칙은 **항목 개수를 제한할 뿐, 토큰 예산에 맞춰 내용을 다시 요약하거나 자르지는 않는다.** 긴 기록을 선택하면 묶음도 길어진다. `Constraint:` 같은 접두어도 저장된 기록에 실제로 있어야 분류에 쓰인다. 검색 품질과 기록 작성 방식이 둘 다 결과를 바꾼다.

묶음에는 출처와 범위가 붙고 검색된 기억을 신뢰하지 않는 참고 자료로 취급하라는 문구가 들어간다. 일부 지시문 패턴에는 경고도 붙인다. 이것을 완전한 프롬프트 주입 방어로 보지는 않는다. 과거 기록은 현재 사용자의 지시보다 높은 권한을 얻지 않는다. [출력과 경고 처리][pack]

## 답을 맞혀도 입력은 거의 줄지 않을 수 있다

검색과 조립이 연결된 뒤에는 “묶음이 더 짧아 보인다”를 넘어 실제 클라이언트 입력을 비교할 필요가 생겼다. 공개 평가 코드는 기억을 끈 조건에 원본 코퍼스를 주고 켠 조건에 Akasha를 통해 필요한 문맥을 전달한다. 답은 정해진 필수 항목으로 채점한다. 과제는 원본 저장소와 벡터 복구, 사용자 응답 언어와 로깅 규칙, context pack 다양성과 청크 설정의 세 가지다. 각 과제를 세 번 반복해 9쌍, 총 18개 답변을 평가한다. 일반적인 코드 수정 과제의 성공률을 측정한 것은 아니다. [평가 입력][fixture] · [프롬프트와 채점 집계][evaluation]

저장소에 기록된 두 전달 방식의 결과는 다음과 같다. 둘 다 코퍼스 v3와 Codex CLI 0.163.0을 사용했고 요청 모델은 `gpt-6.1-sol`, 추론 수준은 `medium`이었다. CLI 이벤트가 실제 모델 ID를 제공하지 않아 관측 모델은 확인되지 않았다.

| 전달 방식과 평가 소스 | 끈 조건 / 켠 조건 | 정답 | 입력 토큰 감소율 중앙값 | 15% 기준 |
| --- | --- | --- | --- | --- |
| MCP 왕복 · `fe24b4d` | 원본 코퍼스 / 모델이 `build_context_pack`을 한 번 호출 | 18/18 | 0.35% | 미달 |
| CLI 사전 검색 · `d459e20` | 원본 코퍼스 / CLI가 만든 묶음을 첫 프롬프트에 삽입 | 18/18 | 53.40% | 통과 |

두 행은 **공개 저장소에 기록된 평가 결과**다. 이 글을 쓰며 모델을 다시 실행하지 않았고 고정 소스에는 실행별 원시 영수증이 포함되어 있지 않아 각 쌍의 수치를 독립 재계산하지 않았다. 평가 기록은 두 방식 모두 누락과 조직 간 유출이 없었다고 보고한다. [측정 결과와 조건][gates]

감소율은 각 쌍의 `(끈 조건 입력 토큰 - 켠 조건 입력 토큰) / 끈 조건 입력 토큰`을 구한 뒤 9개 값의 중앙값을 취한다. 캐시된 입력도 입력 토큰에 포함한다. MCP 방식의 전체 입력 합계는 끈 조건 576,427, 켠 조건 573,546이었다. 두 합계의 차이를 나누면 약 0.50%지만, 표의 0.35%는 **쌍별 감소율의 중앙값**이므로 서로 다른 계산이다. [집계 코드][aggregation] · [측정 기록][gates]

MCP 방식은 필요한 답을 유지했지만 목표만큼 입력을 줄이지 못했다. 여기에는 모델의 도구 호출과 그 뒤의 결과 전달까지 포함된다. 다만 요청별 프롬프트 기여량을 따로 수집하지 않았으므로 공통 지시나 응답 필드 중 무엇이 비용을 지배했는지는 확정할 수 없다. 사용자 지시나 공개 응답 필드를 지워서 숫자를 낮추는 식으로 기준을 바꾸지는 않았다. [MCP 결과 분석][gates]

## 같은 검색을 모델 호출 전에 끝내면

CLI 사전 검색은 전달 시점을 바꾼 별도 평가다. 모델이 도구를 호출하도록 기다리는 대신 기존 `pack` CLI를 먼저 실행하고 그 출력을 첫 프롬프트에 넣는다. 켠 조건과 끈 조건 모두 MCP에 연결하지 않으며 모델 도구 호출도 0회여야 한다. [CLI 사전 검색 프로토콜][gates]

여기서 출력 문자열을 임의로 정리하면 평가 대상이 달라진다. 그래서 실행 직전 DB 기록의 위치를 잡는다. 실행 후에는 조직·프로젝트·작업이 일치하는 새 기록을 찾고 정확히 하나인지 확인한다. CLI 표준 출력은 마지막 줄바꿈을 제외하고 DB의 `pack_markdown`과 바이트 단위로 같아야 한다. 필수 기억 ID와 내용도 확인한다. **모델이 받은 문맥이 실제 Akasha 출력이었는지**를 연결하는 검사다. [CLI 출력 대조][prefetch]

이 조건의 53.40%는 사전 검색 경로에서 유용한 결과다. 동시에 MCP 경로의 0.35%를 대체하지 않는다. 전자는 모델 호출 전에 검색한 묶음을 받았고 후자는 모델이 검색 도구를 호출하는 경로를 거쳤기 때문이다. 평가 기록의 CLI 프로세스 시간은 31.21~34.60초였으므로 입력 토큰 감소를 전체 지연이나 금액 절감으로 바꿔 말할 수도 없다. Claude 클라이언트도 아직 검증되지 않았다. [평가 경계][gates]

Akasha를 만들며 저장할 것, 검색할 것, 모델에 전달할 것을 각각 확인하게 됐다. 다음 세션에 필요한 결정을 보존하는 일이 첫 단계라면 그 결정을 빠뜨리지 않고 작은 입력으로 전달하는 일은 별도의 제품 가설이다. 다른 에이전트 도구에 기억을 붙일 때도 같은 과제와 원본을 두고 검색을 켜서 **정답과 실제 전달 경로 전체의 입력량을 함께 비교**해야 한다. 저장소에 기억이 늘었다는 사실만으로 그 다음 판단까지 좋아졌다고 결론 내릴 수는 없다.

[source]: https://github.com/YouSangSon/akasha/tree/ee032a4a400edd50f37e42a80110dd0692961c54
[license]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/LICENSE
[readme]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/README.md#why
[architecture]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/docs/architecture.md
[worked-example]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/README.md#worked-example
[handler]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/mcp/tool-handlers.ts#L266-L347
[retrieval]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/search/retrieve-memory.ts#L42-L135
[pack]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/context-pack/build-context-pack.ts
[fixture]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/tests/eval/fixtures/client-ab.json
[evaluation]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/eval/client-ab.ts#L294-L307
[gates]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/GATES.md
[prefetch]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/eval/client-cli-prefetch.ts
[aggregation]: https://github.com/YouSangSon/akasha/blob/ee032a4a400edd50f37e42a80110dd0692961c54/src/eval/client-ab.ts#L468-L492
