---
title: "검색 결과는 응답 순서가 아니라 현재 선택에 속한다"
description: "늦은 검색 응답이 현재 화면을 덮는 이유를 재현하고, 요청 취소와 결과 반영 조건을 구분한다."
categories: [architecture, frontend]
tags: [react, abortcontroller, race condition, search, ime]
date: 2026-09-29
---

검색창에 `보고`를 입력한 뒤 곧바로 `보고서`로 바꾼다. 두 번째 검색 결과가 먼저 도착해 화면에 표시된다. 잠시 뒤 첫 번째 응답이 도착하면 어떻게 해야 할까? 서버가 정상적으로 응답했더라도 이미 사용자가 떠난 검색의 결과다.

이 문제는 느린 요청을 없애는 것만으로 해결되지 않는다. **결과를 쓰는 순간에도 그 결과가 현재 선택에 속하는지** 확인해야 한다. 아래는 검색 화면을 가정한 독립 예제다.

## 응답의 성공과 화면에 쓸 자격은 다르다

React의 Effect 문서에는 수동 데이터 조회에서 오래된 응답을 무시하는 예제가 있다. 요청 순서와 응답 순서가 다를 수 있기 때문이다. 이 문제는 React에만 있는 것이 아니다. 비동기 결과로 공유된 화면 상태를 바꾸는 곳이라면 같은 경쟁이 생긴다. [React: Effect에서 데이터 가져오기](https://react.dev/reference/react/useEffect#fetching-data-with-effects)

<iframe src="/assets/diagrams/2026-09-29/frontend-response-generation.html" title="이전 응답을 무시하는 시퀀스" loading="lazy" width="100%" height="676" style="border:0;display:block;width:100%;" sandbox=""></iframe>

[그림 크게 보기](/assets/diagrams/2026-09-29/frontend-response-generation.html)

검색어만 비교하면 충분할까? 같은 검색어라도 폴더나 페이지가 다르면 다른 결과다. 로그인 계정이 바뀌면 조회 권한도 달라질 수 있다. 요청의 의미를 바꾸는 입력을 묶어 **선택 키**로 삼으면 어떤 결과인지 설명할 수 있다.

같은 조건으로 두 번 새로고침하는 경우도 있다. 이때 선택 키는 같지만 먼저 시작한 요청의 결과를 나중 요청 위에 덮고 싶지는 않다. 그래서 요청을 시작할 때마다 **세대 번호**를 증가시킨다. 키는 결과의 소속을, 세대는 같은 소속 안에서 요청의 선후관계를 나타낸다.

## 일부러 늦게 도착시키면 검사하기 쉽다

아래 코드를 `example.mjs`에 저장해 `node example.mjs`로 실행한다. 네트워크 대신 직접 완료시키는 Promise를 사용한다. 이전 작업이 취소 신호를 무시해도 최신 선택을 덮지 않아야 한다.

```js
import assert from 'node:assert/strict';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let selection = '';
let generation = 0;
let controller;
let visible;

async function select(key, work) {
  controller?.abort();
  const mineController = new AbortController();
  controller = mineController;
  selection = key;
  const mine = ++generation;
  const result = await work(mineController.signal);
  if (mine === generation && key === selection && !mineController.signal.aborted) {
    visible = result;
  }
}

const old = deferred();
const next = deferred();
const a = select('folder-a:report', () => old.promise);
const b = select('folder-b:report', () => next.promise);
next.resolve('folder-b result');
await b;
old.resolve('folder-a result');
await a;
assert.equal(visible, 'folder-b result');
console.log('late result ignored');
```

`if`를 지우고 실행하면 마지막 assert가 실패한다. 먼저 시작한 작업을 취소하려 했다는 사실과 그 작업의 결과를 무시하는 것은 별개의 조건이라는 뜻이다.

이 코드는 성공 결과만 검사한다. 실제 화면에서는 `catch`의 오류 표시와 `finally`의 로딩 해제에도 같은 세대 검사가 필요하다. 늦은 실패가 현재 검색의 성공 화면을 지우거나, 옛 요청의 `finally`가 새 요청의 로딩 표시를 꺼서는 안 된다. 화면을 닫는 경우에도 현재 세대를 무효화하고 남은 작업을 정리해야 한다.

## 취소가 담당하는 범위

`AbortController.abort()`는 신호와 연결된 fetch 및 응답 본문 읽기 등을 중단할 수 있다. 하지만 모든 비동기 함수가 그 신호를 받거나 존중하는 것은 아니다. 이미 완료된 요청 뒤에 다른 변환 작업을 붙였다면, 그 후속 작업도 별도로 살펴봐야 한다. [MDN: AbortController.abort](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)

취소는 불필요한 작업을 줄인다. 세대 검사는 남아 있는 작업이 현재 화면을 바꾸지 못하게 한다. 미리보기용 Blob URL처럼 별도로 만든 자원은 선택 변경이나 화면 종료 시 해제해야 한다. 어느 하나로 나머지를 대신할 수는 없다.

## 한글 입력에는 타이머도 남는다

IME 조합 중인 글자와 검색에 사용할 확정 문자열은 다를 수 있다. `compositionend`는 현재 조합이 완료되거나 취소됐음을 알리는 이벤트다. 이 시점을 활용해 조회를 미루더라도, 앞서 예약한 debounce 타이머는 따로 관리해야 한다. [MDN: compositionend](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event)

검색창을 비운 뒤 옛 타이머가 실행되면 지웠던 단어가 다시 검색될 수 있다. 입력 초기화 때는 타이머를 취소하고, 이미 진행 중인 조회의 세대도 무효화한다. 디바운스는 요청 빈도를 낮출 뿐 결과의 최신성을 보장하지 않는다.

다음 화면을 검사할 때는 응답 지연부터 늘리지 않아도 된다. 위 예제처럼 완료 순서를 직접 바꾸고 성공·오류·로딩 상태가 모두 현재 선택에 남는지 확인하면 된다.
