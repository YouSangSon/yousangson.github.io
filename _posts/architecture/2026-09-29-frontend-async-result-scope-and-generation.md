---
title: "검색 결과는 응답 순서가 아니라 현재 선택에 속한다"
description: "선택 범위와 요청 세대를 분리해 늦은 성공·실패·로딩 해제, 화면 종료와 IME 타이머 경쟁을 재현한다."
categories: [architecture, frontend]
tags: [react, abortcontroller, race condition, search, ime]
date: 2026-09-29
---

검색창에 `보고`를 입력하고 곧바로 `보고서`로 바꿨다. 두 번째 결과가 먼저 도착했는데 첫 번째 응답이 뒤늦게 화면을 덮는다. 응답 자체는 성공했지만 **현재 화면의 결과는 아니다**. 이 문제는 응답 순서를 통제해서 해결하기보다, 상태를 쓰기 직전에 “이 결과의 소유자가 지금도 같은가”를 확인하는 편이 작고 정확하다.

아래 예제는 네트워크와 React 렌더링을 쓰지 않는 **가상 검색 화면 모델**이다. Promise를 직접 완료해 문제 순서를 고정한다.

## 결과에는 선택 키와 요청 세대가 있다

한 요청의 선택 키를 `[로그인 사용자, 폴더, 검색어, 페이지]`로 정하자. `보고서`라는 검색어가 같아도 폴더 A의 첫 페이지와 폴더 B의 첫 페이지는 다른 결과다. 로그인 사용자가 달라지면 보이는 자료도 달라질 수 있다. 선택 키는 화면에 보여 줄 결과의 **소속**을 설명한다. 서버의 권한 검사를 대신하지는 않는다.

같은 키로 새로고침을 두 번 누르면 키만으로는 먼저 시작한 요청을 구분할 수 없다. 시작할 때마다 증가하는 **세대 번호**가 필요하다. 다음 표에서 응답의 성공 여부만 보면 마지막 줄을 잘못 처리한다.

| 순서 | 현재 선택·세대 | 도착한 작업 | 반영 결과 |
| --- | --- | --- | --- |
| 1 | 폴더 A, 세대 1 | A 요청 시작 | 로딩 |
| 2 | 폴더 B, 세대 2 | B 요청 시작 | A는 더 이상 화면 소유자가 아님 |
| 3 | 폴더 B, 세대 2 | B 성공 | B 결과 표시 |
| 4 | 폴더 B, 세대 2 | A 성공 | 무시 |
| 5 | 폴더 B, 세대 4 | 같은 B 키의 세대 3 실패 | 오류와 로딩 해제도 무시 |

React 문서는 Effect에서 수동으로 데이터를 가져올 때 cleanup의 `ignore` 표식으로 오래된 응답을 무시하는 예제를 제시한다. 단일 Effect가 한 요청을 소유한다면 그 방식으로 충분할 수 있다. 여러 선택 범위와 같은 키의 재시도가 하나의 화면 상태를 공유한다면, 어떤 값이 결과의 소속과 선후를 결정하는지 명시하는 편이 검토하기 쉽다. [React Effect 데이터 조회](https://react.dev/reference/react/useEffect#fetching-data-with-effects)

<iframe src="/assets/diagrams/2026-09-29/frontend-response-generation.html" title="이전 응답을 무시하는 시퀀스" loading="lazy" width="100%" height="676" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기](/assets/diagrams/2026-09-29/frontend-response-generation.html)

그림에서 먼저 출발한 응답이 나중에 도착한다. 화살표의 완료 순서와 결과를 화면에 쓸 자격은 별개다.

## 실패하는 모델을 먼저 실행한다

순진한 구현은 모든 Promise의 성공 결과를 같은 `visible`에 쓴다. 새 요청을 먼저 완료시키고 옛 요청을 나중에 완료시키면 마지막 값은 `old result`가 된다.

```js
const wrongOld = rawOld.promise.then(value => { naiveVisible = value; });
const wrongNew = rawNew.promise.then(value => { naiveVisible = value; });
rawNew.resolve('new result');
await wrongNew;
rawOld.resolve('old result');
await wrongOld;
assert.equal(naiveVisible, 'old result'); // 실제로 잘못된 상태를 재현
```

[전체 실행 예제](/assets/examples/2026-09-29/web-depth/async/example.mjs)를 저장해 `node example.mjs`로 실행할 수 있다. 첫 assert는 수정이 성공했다는 검사가 아니라 **기존 방식의 실패를 확인하는 검사**다. 타이머나 네트워크 운에 맡기지 않고 완료 순서를 직접 정했으므로 반복 실행해도 같은 상태가 된다.

## 상태를 쓰는 모든 경로에 같은 소유권 검사를 둔다

수정 모델은 새 요청을 시작하며 이전 `AbortController`를 취소하고 세대를 올린다. 완료 뒤에는 선택 키, 세대, 화면 생존 여부, 신호 취소 여부를 한 번에 검사한다.

```js
const current = () => mounted && mine === generation &&
  key === state.selection && !mineController.signal.aborted;

try {
  const value = await work(mineController.signal);
  if (current()) state.visible = value;
} catch (error) {
  if (current()) state.error = String(error);
} finally {
  if (current()) state.loading = false;
}
```

`visible`만 보호하면 절반만 고친 셈이다. 같은 키로 새로고침한 두 요청 중 옛 요청이 실패하면, 옛 `catch`가 새 결과 위에 오류를 띄울 수 있다. 옛 `finally`가 새 요청의 로딩 표시를 먼저 끌 수도 있다. 예제는 옛 실패를 새 요청이 살아 있는 동안 발생시키고, 오류가 비어 있으며 로딩이 계속되는지 확인한다. 이후 새 요청을 완료시키면 결과와 로딩이 함께 바뀐다.

`AbortController.abort()`는 연결된 fetch와 본문 읽기를 중단할 수 있다. 예제의 옛 작업은 신호를 **의도적으로 무시**한다. 그래서 취소 신호가 보내졌다는 사실만으로는 결과가 화면을 바꾸지 못한다고 증명할 수 없다. 취소는 불필요한 작업을 줄이고, 소유권 검사는 남아 있는 완료 경로를 막는다. [MDN AbortController.abort](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)

화면이 닫히면 세대를 무효화하고 진행 중인 작업을 취소한다. 예제는 닫힌 뒤 완료한 Promise가 화면 상태를 바꾸지 않는지도 검사한다. React의 Effect cleanup도 컴포넌트가 제거될 때 실행된다. 다만 별도로 만든 Blob URL이나 타이머 같은 자원이 있다면 그 자원의 소유자가 각각 정리해야 한다. [React Effect cleanup](https://react.dev/reference/react/useEffect#parameters)

## IME와 debounce 사이의 빈 시간도 선택 변경이다

한글처럼 여러 키 입력을 한 글자로 조합하는 입력기(IME)를 사용할 때 조합 중간의 문자열로 검색하지 않기로 했다면, 조합 중 `input`은 조회를 예약하지 않는다. `compositionend`는 조합이 완료되거나 취소될 때 발생한다. 조합이 끝난 뒤 확정된 입력창 값으로 다음 예약을 결정하고, 한 이벤트의 `data`만으로 검색어를 추측하지 않는다. `InputEvent.isComposing`도 조합 중인지 알려 준다. [MDN compositionend](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event), [MDN isComposing](https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/isComposing)

여기서 흔한 틈은 타이머다. `rep`를 위한 debounce가 예약된 뒤 입력창을 비웠다면, 옛 타이머가 나중에 실행돼 지운 검색어를 다시 조회해서는 안 된다. 새 입력을 받는 **즉시** 이전 타이머를 취소하고 현재 요청 세대를 무효화해야 한다. 폴더 변경처럼 입력창 밖에서 선택을 교체할 때도 그 타이머를 취소한다. 그렇지 않으면 옛 폴더의 예약 작업이 새 세대를 얻어 현재 결과를 덮을 수 있다. 새 조회를 시작할지는 조합 종료와 debounce 이후에 판단한다.

예제는 실제 시계 대신 `fire(ticket)`를 타이머 콜백으로 사용한다. 지운 입력과 이전 폴더의 ticket은 실행되지 않고, 조합 중 입력에는 ticket을 만들지 않는다. 확정된 `보고`만 검색된다. 이것은 이벤트 순서의 모델이며 특정 브라우저에서의 IME 이벤트 순서를 측정한 결과는 아니다.

```text
naive late response: old result
different selection: folder B result
old timer after direct selection: folder B direct result
same-key stale error ignored: refreshed result
after close unchanged: null
clear and IME: 보고 result
```

검색 화면을 검토할 때는 성공 응답 하나만 늦춰 보지 말자. **다른 폴더의 늦은 성공, 같은 조건의 늦은 실패, 옛 요청의 로딩 해제, 화면 종료 뒤 완료, 입력을 비우거나 폴더를 바꾼 뒤 타이머 실행**을 각각 강제로 일으키면 어떤 상태 변경에 소유권 검사가 빠졌는지 드러난다.
