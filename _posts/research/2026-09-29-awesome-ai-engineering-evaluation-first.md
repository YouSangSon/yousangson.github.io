---
title: "Awesome AI Engineering — Eric-LLMs의 자료로 평가부터 공부하기"
description: "AI 엔지니어링 자료 모음의 평가·메모리 설명을 비판적으로 읽는다. 답변과 실제 작업 결과를 구분하는 실행 예제로 자료를 설계 판단에 연결한다."
categories: [research, ai]
tags: [project-review, agents, evaluation, memory]
date: 2026-09-29
---

에이전트가 파일을 저장했다고 답했다. 문장은 자연스럽고 경로도 그럴듯하다. 하지만 파일이 없거나, 파일은 만들었어도 수정하면 안 되는 다른 파일을 건드렸다면 작업은 성공한 것일까.

`awesome-ai-engineering`의 도구 목록을 보기 전에 **무슨 결과를 성공으로 인정할지**부터 정해 보자. 성공 조건이 있어야 모델과 프레임워크도 고를 수 있다. 여기서는 평가와 기억을 다룬 자료를 읽으며, 어디까지 참고하고 무엇을 더 확인해야 할지 살펴본다.

**Awesome AI Engineering**은 GitHub의 **Eric-LLMs** 계정에서 공개한 자료 모음이다. 아래에서는 [commit `cc834a89c2d0`](https://github.com/Eric-LLMs/awesome-ai-engineering/tree/cc834a89c2d052529bca4318dfdc69f8bfd1ce4e)의 평가·메모리 자료를 다룬다.

## 이 저장소에서 무엇을 얻을 수 있나

모델 추론, 검색, 도구, 기억, 평가를 한눈에 훑기에는 이 자료가 편하다. README도 첫 그림을 개념 지도라고 명시한다. 다만 지도에 나온 구성 요소를 모두 도입할 필요는 없다.

파일 목록에는 실행 진입점이나 서비스 구현 대신 README, 라이선스, PDF 7개와 그림 7개가 있다. 따라서 저장소 자체의 처리량이나 장애 복구를 평가할 수는 없다. Delveta와 LLMs-Lab의 기능 설명은 외부 프로젝트 소개이므로 해당 소스를 따로 읽기 전에는 구현 사실로 확정하지 않는다.

전체 지도를 그대로 구현하면 당장 필요 없는 부분까지 운영하게 된다. 평가할 질문을 먼저 만들고, 그 질문에 필요한 구성 요소를 찾아 읽는 순서가 낫다. 자료로 선택지를 찾은 뒤 실제 도입 여부는 해결할 실패와 근거를 보고 정하면 된다.

[![AI 엔지니어링을 인프라, 데이터, 학습, 추론, 도구, 에이전트, 응용 계층으로 나눈 원문 개념도](/assets/images/research/awesome-ai-engineering-map.png)](/assets/images/research/awesome-ai-engineering-map.png)

*Eric-LLMs, AI Engineering: End-to-End Architecture. [원본 그림](https://github.com/Eric-LLMs/awesome-ai-engineering/blob/cc834a89c2d052529bca4318dfdc69f8bfd1ce4e/summaries/AI-Engineering-End-to-End%20Architecture.png), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 원본 PNG를 변경 없이 실었다. 누르면 확대할 수 있다.*

그림의 위쪽 녹색 영역은 에이전트의 실행 루프, 그 아래 노란 영역은 도구가 바꾸는 외부 환경이다. 오른쪽의 평가는 이 둘을 가로지른다. 이 글에서 따라갈 연결도 **도구 실행 → 환경 변화 → 결과 판정**이다. 나머지 계층과 제품명은 가능한 구성 요소를 찾는 지도이며, 모두 갖춰야 하는 필수 목록은 아니다.

[![단일 응답 평가와 도구·환경을 오가는 에이전트 실행 루프를 비교한 원문 슬라이드](/assets/images/research/awesome-agent-evaluation-page3.png)](/assets/images/research/awesome-agent-evaluation-page3.png)

*원문 캡처: Eric-LLMs, Agent Evaluation Engineering, 3쪽. [고정 판본 PDF](https://github.com/Eric-LLMs/awesome-ai-engineering/blob/cc834a89c2d052529bca4318dfdc69f8bfd1ce4e/summaries/agent-evaluation/agent-evaluation-engineering.pdf), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). PDF 한 쪽을 내용 변경 없이 PNG로 변환했다. 이미지를 누르면 크게 볼 수 있다.*

왼쪽은 응답 뒤에 평가자를 붙인 흐름이고, 오른쪽은 도구를 사용해 바뀐 환경을 다시 관찰하는 루프다. 오른쪽 흐름에서는 마지막 문장만 읽으면 도구가 만든 효과를 놓친다. 그림의 ‘reasoning’ 표기를 모델의 숨은 사고 과정 전체에 접근할 수 있다는 뜻으로 읽지는 않는다.

## 먼저 읽을 곳: 결과와 실행 과정을 분리하는 평가

[평가 슬라이드](https://github.com/Eric-LLMs/awesome-ai-engineering/blob/cc834a89c2d052529bca4318dfdc69f8bfd1ce4e/summaries/agent-evaluation/agent-evaluation-engineering.pdf)의 3–5쪽은 최종 답변뿐 아니라 도구 호출 과정과 실제 환경의 결과를 구별한다. 예를 들어 파일을 저장했다고 답한 에이전트는 말만 그럴듯할 수 있다. 파일 존재와 내용이 성공 조건이라면 그 조건을 직접 검사해야 한다.

반대로 정해 둔 함수 이름을 사용했는지만 검사하면 같은 결과를 내는 유효한 구현을 실패로 판정할 수 있다. 평가하려는 요구사항을 실제로 관찰할 수 있는지부터 확인할 이유다.

6쪽의 `pass@k`와 `pass^k`는 비슷해 보여도 다른 질문이다. 전자는 여러 번 시도해 적어도 한 번 성공할 가능성, 후자는 정해진 여러 시도가 모두 성공할 가능성을 나타낸다.

서로 독립이고 성공 확률이 일정하게 0.7인 **설명용 가정**에서 세 번 시도하면 각각 `1 − (1 − 0.7)^3 = 0.973`, `0.7^3 = 0.343`이다. 이는 저장소의 성능 측정값이 아니라 두 질문의 차이를 보이는 계산이다.

후보 중 정답 하나를 골라 쓰는 작업이라면 앞의 확률이 유용하다. 매번 제대로 처리해야 하는 자동화라면 뒤의 확률이 더 절실하다. 같은 성공 지표를 쓸 수 없는 작업들이다.

실제 시도는 같은 버그나 환경 상태를 공유할 수 있으므로 위 독립 가정을 그대로 쓰면 안 된다. 10쪽의 실행 환경 초기화도 이 문제와 연결된다. 이전 실행이 만든 파일 때문에 다음 실행이 성공하면 반복 성공률을 잘못 해석한다. 한편 모든 테스트에 컨테이너를 새로 띄우는 것만이 답은 아니다. 어떤 상태가 결과에 영향을 주는지 먼저 확인하고 그 상태를 통제해야 한다. 초기화 방법도 잡으려는 실패에 맞춰 고르면 된다.

## 기억 모듈은 저장소 선택 전에 생명주기를 정해야 한다

[메모리 구현 슬라이드](https://github.com/Eric-LLMs/awesome-ai-engineering/blob/cc834a89c2d052529bca4318dfdc69f8bfd1ce4e/summaries/building-memory-for-agentic-ai-theory-frameworks-and-practice/building-memory-for-agentic-ai-theory-frameworks-and-practice.pdf)의 6쪽은 응답 중 수행하는 기억 처리와 비동기 처리를 나눈다. 기억을 만드는 일을 뒤로 옮기면 응답 지연을 줄일 여지는 생기지만, 다음 요청이 갱신 전 기억을 읽을 수 있다. 실제 프로젝트에서 지연을 측정한 결과는 아니다. 이 실행 순서라면 생길 수 있는 문제를 짚은 것이다.

예를 들어 사용자가 선호 언어를 바꾼 직후 다음 질문을 했다면, 갱신 작업의 완료 시점과 검색 시점에 따라 오래된 선호를 가져올 수 있다. 벡터 검색 정확도만 높여서는 해결되지 않는다. 무엇이 최신 사실인지, 변경이 완료되었다고 언제 말할지, 오래된 내용을 검색 후보에서 어떻게 제외할지까지 정해야 한다. “어떤 벡터 DB를 쓸지”를 고르기 전에 이 상태 변화를 설명할 수 있어야 한다.

14쪽은 잘못된 기억의 영구화와 갱신·삭제를 다룬다. 다만 최근 정보가 항상 우선한다는 규칙은 모든 데이터에 맞지 않는다. 오래된 원본보다 최근의 잘못된 추측을 신뢰하면 정확성이 떨어진다.

시간뿐 아니라 출처, 검증 여부, 적용 범위가 필요하다. 같은 페이지의 벡터 삭제도 전체 개인정보 삭제를 증명하지는 않는다. 원본·요약·다른 색인·복제본에 무엇이 남는지 별도 확인해야 한다.

## 읽을 때 보완해야 할 부분

이 자료는 넓은 범위를 압축해 보여 준다. 그 대가로 각 제품 설명의 기준 버전, 수치의 측정 조건, 도식의 원문 근거를 모두 추적하기는 어렵다. README의 속도·메모리 절감 문구는 이 저장소에서 재현한 결과로 제시되지 않는다. 특정 제품 선택 근거로 사용하려면 해당 제품의 고정 버전과 실험 조건을 다시 확인해야 한다. 기억을 무한히 유지한다는 표현도 모델이 모든 내용을 손실 없이 동시에 이해한다는 의미로 확장해서는 안 된다.

시각 자료는 탐색에 유용하지만 PDF에서 작은 글자와 복잡한 화살표가 있는 부분은 본문 설명으로 풀어야 한다. 예컨대 메모리 구현 9–11쪽의 제품 비교는 제품 이름만 옮기기보다 “어떤 상태를 어디에 저장하고 언제 읽는가”라는 동일한 질문으로 다시 비교할 필요가 있다. 제품 이름만 나열해서는 이런 차이를 알기 어렵다.

## 말과 실제 결과를 분리하는 작은 검사

자료의 평가 기준을 코드로 옮기면 무엇이 달라지는지 확인해 보았다. 실제 모델을 호출하는 대신 동작이 정해진 세 함수를 사용한다. 모두 `saved`라고 답하지만, 하나는 파일을 만들지 않고, 하나는 정확히 저장하며, 마지막 하나는 정답 파일과 함께 보호할 파일까지 바꾼다. 작업의 성공 조건은 **정답 파일을 저장하면서 보호 파일을 유지하는 것**이다.

평가 함수는 답변과 환경의 변화를 각각 검사한다. `action`은 임시 디렉터리를 받아 작업한 뒤 문자열을 반환하는 함수다.

```python
from pathlib import Path
from tempfile import TemporaryDirectory

def evaluate(action):
    with TemporaryDirectory() as directory:
        root = Path(directory)
        protected = root / "protected.txt"
        protected.write_text("keep")
        reply = action(root)
        answer = root / "answer.txt"
        correct_output = answer.is_file() and answer.read_text() == "42\n"
        unchanged = protected.read_text() == "keep"
        return reply == "saved", correct_output and unchanged
```

`answer.txt`만 검사하면 보호 파일을 망가뜨린 실행도 통과한다. 성공 조건에 금지된 변경을 함께 넣으면 세 동작의 차이가 드러난다.

[전체 예제](/assets/examples/2026-09-29/paper-reviews/agent_outcome_demo.py)는 Python 3 표준 라이브러리만 사용한다. 각 사례를 임시 디렉터리에서 실행하고 종료 시 지운다. 외부 API, 모델, 실제 사용자 파일은 사용하지 않는다.

```sh
python3 agent_outcome_demo.py
```

실행 결과에서 `reply`는 답변 문자열만 검사한 판정이고, `outcome`은 파일의 내용과 보호 조건까지 검사한 판정이다.

```text
claim_only   reply=True outcome=False
correct      reply=True outcome=True
side_effect  reply=True outcome=False
synthetic p=0.7, k=3: any=0.973, all=0.343
```

문자열 검사는 세 경우 모두 성공으로 본다. 결과 검사는 파일을 만들지 않은 경우와 금지된 부작용을 구별한다. 이것은 특정 에이전트의 실패율 측정이 아니라 **무엇을 관찰하느냐에 따라 같은 실행의 판정이 달라진다는 대조**다. 보호할 파일 하나를 확인했다고 전체 권한 경계가 검증된 것도 아니다. 파일 전체 변경 목록, 네트워크 쓰기 등 실제 계약에 포함된 효과는 그 계약에 맞는 별도 관측이 필요하다.

이 예제에서 `correct`가 실행되기 전에 정답 파일이 이미 존재한다면, 아무 일도 하지 않는 함수도 파일 내용 검사만으로 통과할 수 있다. 그래서 사례마다 새 디렉터리와 같은 초기 상태를 만들었다. 결과 검사와 환경 초기화가 함께 있어야 실행의 효과를 잘못 귀속하는 일을 줄인다.

자료를 읽었다면 자신의 평가 하나를 골라 보자. 최종 문장, 실행 과정, 실제 결과 중 무엇을 확인하고 있는가? 무엇을 놓치는지 알면 다음에 보완할 대상도 정할 수 있다. 구조를 비교할 때는 [에이전트 하네스 논문 리뷰](/posts/agent-harness-design-evidence/), 관측 신호를 고를 때는 [AI 관측성 논문 리뷰](/posts/ai-observability-signals-and-causes/)로 이어서 읽을 수 있다.
