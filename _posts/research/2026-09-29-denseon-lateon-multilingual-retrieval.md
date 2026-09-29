---
title: "DenseOn with the LateOn — Raphaël Sourty 외 | 단일 벡터와 토큰별 검색의 차이"
description: "DPR의 단일 벡터와 ColBERT의 토큰별 MaxSim을 비교하고, Sourty 등의 2026년 다국어 검색 실험에서 학습에 없던 언어의 결과와 남은 비용·일반화 경계를 읽는다."
date: 2026-09-29
categories: [research, ai]
tags: [paper-review, retrieval, embeddings, colbert, multilingual]
---

검색 질의에 단서가 두 개 있다. 문서는 첫 단서만 두 번 말하고, 다른 문서는 두 단서를 각각 담았다. 문서마다 벡터를 하나만 남기면 두 문서가 같은 점수를 받을 수 있다. 단서별로 문서 안에서 가장 가까운 표현을 찾으면 순위가 갈린다. 이 작은 차이가 학습 때 보지 못한 언어로 검색기를 옮길 때도 남을까?

이 질문을 따라 읽을 원문은 세 편이다. 고전 두 편에서 점수식을 이해하고, 2026년 연구에서 다국어 평가의 범위를 확인한다.

- **DPR**: Vladimir Karpukhin 외, *Dense Passage Retrieval for Open-Domain Question Answering*. EMNLP 2020 논문이며 [2020년 4월 arXiv v1](https://arxiv.org/abs/2004.04906v1)을 읽었다.
- **ColBERT**: Omar Khattab·Matei Zaharia, *ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT*. SIGIR 2020 논문이며 [2020년 6월 arXiv v2](https://arxiv.org/abs/2004.12832v2)를 읽었다.
- **DenseOn with the LateOn**: Raphaël Sourty·Antoine Chaffin·Paulo Roberto Moura Junior·Amélie Chatelain, *DenseOn with the LateOn: Fully Open Dense and Late-Interaction Models for Multilingual, Long-Context, and Code Search*. [2026년 7월 31일 arXiv v2](https://arxiv.org/abs/2607.27178v2)를 기준으로 하며 별도 학회 심사 상태는 주장하지 않는다.

## 문서를 미리 계산하려면 무엇을 접어야 하나

DPR은 질문과 문서를 별도 인코더에 넣어 각각 벡터 하나로 바꾼다. 검색 점수는 두 벡터의 내적이다. 문서 벡터를 질문이 오기 전에 계산해 색인할 수 있고, 실제 질의 때는 질문 벡터와 가까운 문서를 찾는다. 원 논문은 2,100만 개 문서 조각을 이런 방식으로 색인했다. 질문과 문서를 함께 인코더에 넣는 방식보다 사전 계산이 쉬운 대신, 한 문서에 있던 여러 단서는 결국 하나의 표현으로 압축된다. 

이 마지막 문장은 점수식에서 나온 **표현상의 해석**이지, DPR 논문이 모든 복합 질의에서 실패했다고 측정한 결과가 아니다. [DPR v1, §3.1–3.2, PDF 3–4쪽](https://arxiv.org/pdf/2004.04906v1#page=3)

ColBERT도 문서를 미리 인코딩한다. 다만 문서마다 벡터 하나가 아니라 토큰별 벡터 묶음을 저장한다. 질의 토큰 하나마다 문서 토큰 중 가장 비슷한 것을 고르고, 그 최댓값들을 더한다. 이것이 **MaxSim**이다. 원 논문은 문맥을 반영한 토큰 벡터를 정규화하므로 벡터 내적을 코사인 유사도로 읽을 수 있다. 토큰별 표현은 따로 계산하고 두 표현 사이의 비교만 나중에 수행한다. 그래서 `late interaction`이라는 이름이 붙었다. 문서 인코더를 질의마다 다시 돌릴 필요는 없지만, 저장할 벡터와 질의 시 비교할 토큰 쌍이 늘어난다. [ColBERT v2, §3.1–3.3, PDF 4–5쪽](https://arxiv.org/pdf/2004.12832v2#page=4)

두 질의 토큰을 각각 `(1, 0)`, `(0, 1)`이라는 길이 1의 벡터로 놓자. 첫 좌표와 둘째 좌표는 서로 다른 두 단서의 방향을 뜻한다. 문서 A의 토큰은 `(1, 0)`, `(0, 1)`이고, 문서 B의 토큰은 `(1, 0)`, `(1, 0)`이라고 하자. 질의와 문서를 각각 **단순 평균**한 뒤 내적하면 A와 B가 모두 `0.5`다. 하지만 토큰마다 최대 내적을 더하면 A는 `1 + 1 = 2`, B는 `1 + 0 = 1`이다. B가 첫 단서를 두 번 갖고 있어도 둘째 단서를 대신하지는 못한다.

<div class="review-figure">
<iframe class="review-diagram" src="/assets/diagrams/2026-09-29/research/late-interaction-clues.html" title="단순 평균과 토큰별 최대 유사도의 차이" loading="lazy" width="100%" height="540" style="--diagram-height:540px;--diagram-mobile-height:900px" sandbox=""></iframe>
</div>

*두 단서를 평균으로 접으면 이 합성 예시에서는 동점이 된다. MaxSim은 질의의 각 단서가 문서에 대응하는지 따로 계산한다. 실제 모델의 성능 비교가 아니다.*

```python
q = [(1, 0), (0, 1)]
a = [(1, 0), (0, 1)]
b = [(1, 0), (1, 0)]

def dot(x, y):
    return sum(i * j for i, j in zip(x, y))

def mean(vectors):
    return tuple(sum(v[i] for v in vectors) / len(vectors) for i in range(2))

def maxsim(query, document):
    return sum(max(dot(token, candidate) for candidate in document) for token in query)

assert dot(mean(q), mean(a)) == dot(mean(q), mean(b)) == 0.5
assert (maxsim(q, a), maxsim(q, b)) == (2, 1)
```

이 코드는 외부 모델이나 검색 데이터 없이 점수식의 차이만 재현한다.

DPR과 2026년 DenseOn은 평균 대신 요약 토큰인 `[CLS]`의 학습된 표현을 쓰며, ColBERT의 실제 점수에는 문맥 인코딩·특수 토큰·토큰 필터링이 관여한다. 따라서 위 동점은 **단일 벡터 검색기의 일반적인 성능 결과가 아니다**. 다만 한 번 접은 표현에서 어떤 단서가 사라질 수 있는지, MaxSim이 무엇을 보존하려는지 확인할 수 있다.

2026년 논문의 다국어 late-interaction 모델은 원래 ColBERT의 합 대신 질의 길이로 나눈 MeanMaxSim을 학습에 사용한다. 위 예시에서도 A와 B는 각각 `1`과 `0.5`로 갈린다. [DPR v1, §3.1, PDF 3쪽](https://arxiv.org/pdf/2004.04906v1#page=3) · [ColBERT v2, §3.2–3.3, PDF 4–5쪽](https://arxiv.org/pdf/2004.12832v2#page=4) · [DenseOn/LateOn v2, §2.3.2·부록 C.2, PDF 5·14쪽](https://arxiv.org/pdf/2607.27178v2#page=5)

## 같은 재료로 학습해도 결과가 갈리는가

Sourty 등의 2026년 연구는 이 질문에 비교적 직접적으로 접근한다. 저자들은 영어 학습 쌍 약 14억 개에서 필터를 적용해 6억 6,500만 개를 골랐고, 여덟 언어로 번역한 자료와 교차 언어 쌍을 만들어 다국어 사전 학습 쌍 약 28억 개를 구성했다. 다국어 모델인 **mDenseOn**과 **mLateOn**은 같은 3억 700만 매개변수의 mmBERT-base 기반 모델, 학습 자료, 큰 훈련 목표를 공유한다. 전자는 문서 하나를 벡터 하나로, 후자는 토큰별 벡터로 검색한다. 

단, 정확히 한 변수만 바꾼 실험은 아니다. 모델별 접두어와 풀링·점수 함수가 다르고, 단일 벡터 쪽에는 작은 차원의 출력을 위한 Matryoshka 학습이 적용된다. 그래서 결과는 **이 두 완성된 학습 레시피의 비교**로 읽어야 한다. [DenseOn/LateOn v2, §2.1–2.3, PDF 3–5쪽](https://arxiv.org/pdf/2607.27178v2#page=3)

저자들이 보고한 MIRACL의 `nDCG@10`은 상위 10개 결과에서 관련 문서가 얼마나 앞에 놓였는지 평가하는 점수다. 같은 지표 안에서는 클수록 좋다. 논문 표 2의 값은 0–100 척도로 적혔다.

여기서 **대상 언어 평균**은 MIRACL의 18개 언어 중 검색 학습에 사용한 언어와 겹치는 5개(아랍어·영어·프랑스어·독일어·스페인어)만의 평균이다. **전체 평균**은 18개를 모두 포함한다. [DenseOn/LateOn v2, §3.2·표 2, PDF 6–7쪽](https://arxiv.org/pdf/2607.27178v2#page=6)

[![DenseOn/LateOn 원문 표 2의 열 머리글과 두 제안 모델 행](/assets/images/research/denseon-table2-our-models.png)](/assets/images/research/denseon-table2-our-models.png)

*원문 부분 인용: Raphaël Sourty 외, DenseOn with the LateOn v2, [PDF 6쪽 표 2](https://arxiv.org/pdf/2607.27178v2#page=6). 열 머리글과 제안 모델 두 행만 발췌했고 다른 모델 행은 생략했다. 이미지를 누르면 크게 볼 수 있다.*

원문은 mLateOn을 위에, mDenseOn을 아래에 놓았다. `MIRACL_tgt`는 대상 언어, `MIRACL`은 전체 언어 평균이다. 아래 표는 비교할 세 열을 골라 단일 벡터부터 읽도록 행 순서를 바꿨다.

| 모델 | MIRACL 대상 5개 언어 | MIRACL 전체 18개 언어 | MLDR 전체 13개 언어 |
| --- | ---: | ---: | ---: |
| mDenseOn, 단일 벡터 | 59.61 | 58.02 | 51.59 |
| mLateOn, 토큰별 벡터 | 65.61 | 67.04 | 77.92 |

위 표는 논문의 `nDCG@10` 저자 보고를 옮긴 것이다. MIRACL 대상 언어에서 6.00점, 전체에서 9.02점의 차이가 난다. 특히 검색 학습에 쓰지 않은 핀란드어는 `52.5 대 74.3`, 한국어는 `61.3 대 71.9`로 보고됐다. **검색 학습에 없었다**는 말은 기반 mmBERT의 사전 학습에서도 그 언어를 보지 않았다는 뜻이 아니다. 논문의 각 언어 결과는 부록 표 5에 있으며, 이 글은 모델 실행이나 성능 재현을 하지 않았다. [DenseOn/LateOn v2, 표 2, PDF 6쪽](https://arxiv.org/pdf/2607.27178v2#page=6) · [부록 B.3·표 5, PDF 13·17쪽](https://arxiv.org/pdf/2607.27178v2#page=17)

여기서 인과를 너무 빨리 확정하면 안 된다. 예시의 “두 단서를 따로 찾는다”는 원리는 원 논문의 점수식에서 직접 나온다. 그러나 핀란드어와 한국어의 점수 차이가 정확히 어느 토큰의 일치 덕분인지는 저자들이 토큰별 오류 분석으로 입증하지 않았다. 원문도 보지 못한 언어에서 late interaction이 mmBERT 사전 학습의 다국어 구조를 더 잘 보존했을 **가능성**으로 해석한다. 전체 평균 `67.04`가 대상 언어 평균 `65.61`보다 높다고 해서 모든 미학습 언어가 대상 언어보다 쉽거나 성능이 좋다는 뜻도 아니다. 두 평균의 언어 구성이 다르다. 

인도네시아어와 스와힐리어에서 mLateOn도 상대적으로 약하다는 저자 보고가 그 경계를 드러낸다. [DenseOn/LateOn v2, §3.2, PDF 7–8쪽](https://arxiv.org/pdf/2607.27178v2#page=7) · [부록 표 5, PDF 17쪽](https://arxiv.org/pdf/2607.27178v2#page=17)

## 점수 뒤에 남는 두 비용

첫째는 저장 공간과 질의 시간이다. DPR식 단일 벡터는 문서마다 하나를 저장한다. ColBERT식 표현은 문서 토큰 수만큼 벡터를 저장하고 질의 토큰별 비교 결과를 모은다. 2020년 ColBERT 원 논문에서도 MS MARCO 문서 집합을 표현하는 공간은 128차원·4바이트 설정에서 286 GiB, 24차원·2바이트 설정에서 27 GiB였고, 작은 설정의 MRR@10(상위 10개 안 첫 정답 순위의 역수 평균)은 `34.9`에서 `33.9`로 내려갔다. 

이 수치는 **당시 ColBERT의 설정별 저장·품질 교환관계**다. 2026년 mLateOn의 공간 사용량이나 실제 응답 시간을 뜻하지 않는다. Sourty 등의 논문에는 mDenseOn과 mLateOn의 배포 색인 크기·지연 시간 비교가 없다. [ColBERT v2, §4.5·표 4, PDF 9쪽](https://arxiv.org/pdf/2004.12832v2#page=9) · [DenseOn/LateOn v2, §3·한계, PDF 5–9쪽](https://arxiv.org/pdf/2607.27178v2#page=6)

둘째는 평가 자료의 성격이다. 저자들은 영어 학습 쌍을 기계 번역할 때 질의와 정답 문서를 함께 번역했다. 이 방식은 둘 사이에 비슷한 표현을 남겨 실제 사용자의 질문보다 양성 쌍을 쉽게 만들 수 있다.

다국어 세밀 조정에 MIRACL·MLDR의 자연 발생 자료를 더했지만, 사전 학습의 대부분은 번역 자료다.

번역 품질을 사람이 언어별로 검토하거나 도메인별 오류를 분석하지 않았고, 다른 기반 모델·규모·배포 환경으로 같은 결과가 옮겨지는지도 확인하지 않았다. MLDR에서는 대상 언어의 학습 분할을 세밀 조정에 사용했으므로, 그 자료 사용 여부가 분명하지 않은 외부 모델과의 순위 비교는 특히 조심해야 한다. [DenseOn/LateOn v2, §2.2·§3.2·한계, PDF 3–4·7–9쪽](https://arxiv.org/pdf/2607.27178v2#page=8)

이 논문으로 당장 선택할 수 있는 것은 “late interaction을 항상 쓰자”가 아니다. **보지 못한 언어와 긴 문서에서 관련 단서를 잃는 비용이 실제로 큰지** 먼저 측정할 수 있다. 자체 질의를 언어별·문서 길이별로 나누고, 같은 문서 집합과 정답 표지에서 한 벡터와 토큰별 벡터의 `nDCG@10` 또는 정답 포함률을 비교한다. 

그 뒤 색인 크기와 응답 시간을 함께 잰다. 짧은 문서와 한 가지 언어에서 단일 벡터가 필요한 품질을 내고 저장·지연 예산이 빡빡하다면 더 큰 토큰별 색인을 선택할 근거가 없다. 반대로 빠진 두 번째 단서가 순위를 자주 뒤집는다면, 위 합성 예시가 보여 준 차이를 실제 질의의 어느 토큰에서 찾을지 조사하면 된다. 이 선택 기준은 세 원문의 구조와 한계를 적용한 **리뷰어의 설계 추론**이며, 2026년 저자들이 제시한 배포 벤치마크 결과는 아니다.
