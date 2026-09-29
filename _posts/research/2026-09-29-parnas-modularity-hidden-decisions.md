---
title: "Decomposing Systems into Modules — D. L. Parnas의 모듈 분해 기준"
description: "1972년 Parnas 논문의 KWIC 예제를 따라가며 처리 단계와 책임 경계의 차이를 살펴본다. 두 저장 표현을 교체하는 실행 예제로 정보 은닉의 효과와 한계를 확인한다."
categories: [research, computer science]
tags: [paper-review, modularity, information-hiding, software-design]
date: 2026-09-29
---

입력을 읽고, 변환하고, 정렬하고, 출력하는 프로그램이 있다. 함수도 네 단계로 나눴다. 그런데 문자열 저장 방식을 바꾸자 입력부터 출력까지 전부 수정해야 한다. 함수가 짧고 역할 이름도 명확한데 왜 변경은 작아지지 않았을까.

각 단계가 같은 저장 구조를 직접 읽고 있었다면 답은 단순하다. 실행 순서는 나눴지만 **저장 방식에 관한 지식은 나누지 못했다.** 코드를 여러 파일에 두는 것과 한 가지 결정을 한 곳에서만 알게 하는 것은 다르다.

David L. Parnas의 1972년 논문 *On the Criteria To Be Used in Decomposing Systems into Modules*는 이 차이를 작은 색인 프로그램으로 설명한다. 논문의 예제를 따라가며 저장 표현을 바꿔 보자. 호출자는 그대로 두고 구현만 교체할 수 있을까? 이를 확인하려고 별도의 예제를 작성했다. 대규모 프로젝트의 생산성까지 측정한 연구는 아니다. [ACM 서지](https://doi.org/10.1145/361598.361623) · [원문 PDF](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf)

## 같은 출력에 도달하는 두 가지 분해

논문의 예제는 KWIC, 즉 키워드를 주변 문맥과 함께 찾아볼 수 있게 만드는 색인이다. 입력 문장의 맨 앞 단어를 뒤로 옮기는 작업을 반복하고, 그렇게 얻은 모든 문장을 사전순으로 출력한다. 원문의 설명을 단순화한 입력으로 시작하자.

```text
입력
red blue green

회전한 문장들
red blue green
blue green red
green red blue

정렬한 출력
blue green red
green red blue
red blue green
```

첫 분해는 처리 순서를 따른다. 입력 모듈이 메모리에 문자를 저장하고, 회전 모듈이 원본 줄과 시작 위치를 가리키는 목록을 만든다. 정렬 모듈은 그 목록을 재배열하고, 출력 모듈이 원본 저장소를 다시 읽는다.

각 단계가 공유 메모리의 레이아웃과 포인터 규칙을 알아야 한다. 실행 흐름 자체는 이해하기 쉽다. 변경이 퍼지는 원인은 각 단계가 같은 저장 표현에 의존한다는 데 있다. [원문 1054쪽, PDF 2쪽](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=2)

두 번째 분해는 저장 결정의 주인을 따로 둔다. 줄 저장 모듈은 문자를 실제로 어떻게 배치하는지 숨긴다. 회전 모듈은 회전 결과를 미리 만들어 두었는지, 원본 위치만 기록했는지, 요청 시 계산하는지 숨긴다. 정렬 모듈은 정렬을 언제 수행하는지 숨긴다.

다른 모듈은 필요한 값을 요청하고 정해진 의미의 결과를 받는다. [원문 1054–1055쪽](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=2)

| 변경할 결정 | 공유 표현을 직접 읽는 경우 | 그 결정을 감춘 경우 |
|---|---|---|
| 원본 문자의 메모리 배치 | 원본을 읽는 여러 단계가 영향을 받는다 | 줄 저장 모듈 안에서 바꿀 수 있다 |
| 회전 결과를 복사할지 위치로 표현할지 | 정렬·출력도 위치 표현을 알아야 한다 | 회전 결과를 읽는 계약을 유지한다 |
| 전체 정렬을 미리 끝낼지 필요할 때 계산할지 | 출력이 정렬 완료 시점을 가정한다 | 정렬 순서 조회의 의미만 유지한다 |

표의 변경 사례에서 호출자가 알아야 할 것은 연산의 의미다. 어떤 결과를 받는지는 약속하되, 그 결과를 내부에서 어떻게 만드는지까지 약속하지 않는다. 이것이 여기서 말하는 정보 은닉이다.

## 모듈은 함수가 아니라 결정에 대한 책임이다

논문에서 모듈은 책임을 배정하는 단위다. 반드시 함수 하나, 클래스 하나, 실행 단계 하나에 대응하지 않는다. 같은 알고리즘과 같은 메모리 배치를 사용해도, 개발자가 무엇을 알아야 코드를 고칠 수 있는지에 따라 분해는 달라진다.

Parnas는 두 방식으로 만든 프로그램이 최종 실행 표현에서는 같을 수도 있다고 설명한다. 차이는 수정·문서화·이해에 쓰는 표현에 남는다. [원문 1054–1055쪽](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=2)

현대 코드에서도 `private` 키워드만으로는 이 효과가 생기지 않는다. 내부 배열을 숨겨 놓고 반환값으로 배열의 가변 참조를 그대로 넘긴다면 호출자가 그 표현에 의존할 여지가 남는다.

반대로 거대한 추상 인터페이스가 없어도, 파일 하나가 특정 형식의 읽기와 쓰기를 책임지고 밖에는 필요한 연산만 내보낸다면 결정의 확산을 줄일 수 있다. 이는 원문의 기준을 오늘의 코드에 적용한 해석이지 특정 언어나 프레임워크를 논문이 권장했다는 주장은 아니다.

저장 방식을 바꿀 때 함께 고쳐야 하는 코드를 찾아보면 경계가 드러난다. 그 코드가 왜 저장 표현을 알아야 할까? 같은 변경 때문에 여러 모듈을 계속 고친다면, 폴더나 이름을 바꾸기 전에 모듈 사이의 계약부터 살펴보자.

## 표현과 열거 순서를 함께 바꿔 본다

다음은 논문의 소스를 옮긴 것이 아니라, 정보 은닉의 효과를 확인하려고 작성한 Python 예제다. 회전 색인은 `count()`로 항목 수를, `text(shift_id)`로 해당 항목의 문자열을 돌려준다. `shift_id`는 한 색인 인스턴스 안에서 항목을 선택하는 번호다. 서로 다른 구현에서 같은 번호가 같은 회전 결과를 뜻한다는 약속은 없다.

정렬하는 쪽은 이 두 연산만 사용한다.

```python
def alphabetized(index):
    return sorted(index.text(i) for i in range(index.count()))
```

첫 구현은 회전한 문장을 모두 문자열로 저장한다. 두 번째 구현은 원본 단어와 `(line_id, start)`만 저장하고 읽을 때 문자열을 만든다. 이 쌍에서 `line_id`는 원본 줄 번호, `start`는 회전을 시작할 단어 위치다. 예를 들어 `(0, 1)`은 첫 번째 줄의 두 번째 단어부터 읽는 회전이다. 호출자는 이 쌍을 직접 받지 않는다.

문자열을 미리 만드는 구현은 생성할 때 회전 결과를 복사한다. 이후 `text()`는 저장된 값 하나를 반환한다.

```python
class MaterializedShifts:
    def __init__(self, lines):
        self._rows = []
        for line in lines:
            words = line.split()
            for start in range(len(words)):
                self._rows.append(" ".join(words[start:] + words[:start]))

    def count(self):
        return len(self._rows)

    def text(self, shift_id):
        return self._rows[shift_id]
```

위치만 저장하는 구현은 `text()`를 호출할 때 원본 단어를 조합한다. 두 구현 모두 `count()`와 `text()`의 결과 의미를 지키므로 앞의 정렬 함수는 그대로 쓸 수 있다.

```python
class IndexedShifts:
    def __init__(self, lines):
        self._lines = [line.split() for line in lines]
        # Deliberately reverse enumeration: the public contract promises no order.
        self._locations = [
            (line_id, start)
            for line_id, words in enumerate(self._lines)
            for start in range(len(words))
        ][::-1]

    def count(self):
        return len(self._locations)

    def text(self, shift_id):
        line_id, start = self._locations[shift_id]
        words = self._lines[line_id]
        return " ".join(words[start:] + words[:start])
```

여기에 차이를 하나 더 넣었다. 두 번째 구현은 내부 항목 순서를 거꾸로 열거한다. 첫 항목부터 같은지 비교하면 실패하지만, 계약에 맞게 모든 항목을 정렬하면 같은 결과가 나온다. 표현만 바꾸고 우연히 같은 내부 순서를 유지하면 호출자의 불필요한 의존을 놓칠 수 있기 때문이다.

[전체 예제 내려받기](/assets/examples/2026-09-29/paper-reviews/kwic_demo.py). Python 3 표준 라이브러리만 사용하며 외부 통신이나 파일 변경은 없다.

```sh
python3 kwic_demo.py
```

확인한 출력은 다음과 같다. 코드에는 첫 항목이 서로 다르다는 대조와, 정렬 결과가 같다는 검사가 함께 들어 있다. 빈 입력·중복 단어·한글 입력도 두 구현으로 비교한다.

```text
same sorted output; different internal enumeration
blue green red
green red blue
red blue green
```

두 구현의 저장 표현과 열거 순서는 다르지만 `alphabetized`는 고칠 필요가 없었다. 예제로 확인한 것은 여기까지다. 메모리 사용량이나 실제 프로그램의 변경 비용은 측정하지 않았다. 특히 `sorted`가 출력 문자열을 모으므로, 이 결과만 보고 메모리도 적게 쓴다고 판단할 수는 없다.

## 좋은 경계도 불필요한 약속 하나로 좁아진다

논문에서 특히 읽을 만한 부분은 두 번째 분해의 결함을 저자가 스스로 지적하는 대목이다. 회전 모듈이 결과 생성 방식을 숨겼지만, 회전 결과의 열거 순서는 고정했다. 이 약속 때문에 처음부터 사전순으로 회전을 만들어 정렬 일을 없애는 구현을 선택하기 어려워졌다. [원문 1056쪽, Improvement in Circular Shift Module](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=4)

값의 의미와 무관한 순서를 외부 계약으로 만든 순간 내부 선택권이 줄어든다. 앞의 예제에서 번호별 문자열 대신 최종 정렬 결과를 비교한 이유도 여기에 있다. 테스트가 내부 순서를 그대로 기대하면 테스트 자체가 필요 없는 계약을 굳힐 수 있다.

그렇다고 순서를 항상 숨겨야 하는 것은 아니다. 사용자가 정렬된 결과를 요청하거나 페이지를 이어 읽는 동안 동일한 순서를 기대한다면 순서는 기능의 일부다. 사용자에게 약속한 순서는 유지하되, 내부 구현 때문에 우연히 생긴 순서는 계약에 넣지 않는 편이 낫다.

## 추상화의 비용도 경계 안에 넣는다

Parnas는 두 번째 분해가 무조건 빠르다고 주장하지 않는다. 문자 하나를 읽을 때마다 복잡한 함수 호출이 발생하면 첫 방식보다 느려질 수 있다고 따로 논의한다. 당시에는 호출처럼 작성하되 다른 형태로 코드를 조립하는 도구를 제안했다. 오늘의 인라이닝이나 일괄 처리와 연결해 생각할 수 있지만, 그 도구가 비용을 모두 없앤다는 결론은 원문에서 나오지 않는다. [원문 1057쪽, Efficiency and Implementation](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=5)

가령 저장소를 원격 서비스로 바꾼 뒤 `text()`를 항목마다 네트워크 호출로 구현하면 표현은 숨겨도 지연 비용은 커진다. 호출자의 기능 계약이 같다는 것과 운영 특성이 같다는 것은 별개다. 요구된 지연을 만족하려고 묶음 읽기를 추가하면 그때는 계약 변경을 함께 검토해야 한다. 미래의 모든 저장소를 대비해 처음부터 인터페이스를 키우기보다, 실제 바꾸려는 결정과 그 비용을 기준으로 경계를 잡을 수 있다.

계층 구조도 별개다. 의존 방향이 위에서 아래로 정돈되어 있어도 각 계층이 같은 내부 데이터 형식을 안다면 변경은 여전히 퍼진다. 원문은 의존 계층과 좋은 분해를 서로 독립적인 속성으로 구분한다. [원문 1057–1058쪽](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf#page=5)

## 내 코드에서는 한 가지 변경으로 시험한다

모듈화를 검토할 때 가장 작은 출발점은 바뀔 이유가 있는 결정 하나다. 예를 들어 회전 결과를 미리 저장하던 코드를 필요할 때 계산하도록 바꿔 본다. 출력의 의미는 그대로인데 정렬·출력까지 고쳐야 한다면 어떤 지식이 새어 나갔는지 확인한다. 필요한 기능 계약이 달라진 것이라면 호출자 변경은 정당하며, 이를 모두 결합도 문제로 취급할 필요는 없다.

**어떤 결정을 다른 코드가 몰라도 되는가?** 같은 파일에 넣을 코드를 고르기 전에 이 질문부터 해 보자. 다음에 그 결정을 바꿀 때 호출자를 고치지 않아도 된다면, 경계가 제 역할을 한 셈이다. 함수의 실행 책임을 옮기는 구체적인 사례는 [삭제 판단의 책임을 옮기는 글](/posts/moving-cleanup-execution-ownership/)과 함께 읽을 수 있다.
