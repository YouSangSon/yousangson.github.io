---
title: "검색 결과는 응답 순서가 아니라 현재 선택에 속한다"
description: "폴더 검색과 파일 미리보기에서 늦은 비동기 응답을 다루며 익힌 취소, 요청 식별자, 화면 반영 조건"
categories: [architecture, frontend]
tags: [react, abortcontroller, race condition, search, ime]
date: 2026-09-29
---

검색창에 단어를 입력하고 곧바로 다른 폴더를 선택한다. 새 폴더의 검색 결과가 먼저 나온다. 잠시 뒤 이전 폴더의 요청이 끝나면서 화면이 다시 바뀐다. 더 나쁜 경우에는 이전 폴더의 404 응답이 현재 폴더를 찾을 수 없다고 표시한다. 사용자의 마지막 선택과 화면에 남은 결과가 서로 다른 상태다.

파일 탐색 화면을 구현하면서 검색, 폴더 탐색, 파일 버전 미리보기에 이 실행 순서를 넣어 회귀 검사를 작성했다. 코드는 실제 구현의 문제 구조를 일반화했다. 특정 서비스의 API나 자료 구조를 재현하지 않는다. 핵심은 비동기 결과가 어느 화면 상태에 속하는지 판정하는 방법이다.

## 응답은 요청한 순서대로 도착하지 않는다

사용자가 `보고`를 검색하면 요청 A가 시작된다. 이어 `보고서`로 바꾸면 요청 B가 시작된다. B가 먼저 끝난 뒤 A가 끝날 수 있다. 두 요청 모두 성공했다고 해서 둘 다 현재 화면에 쓸 수 있는 결과는 아니다. React 문서도 수동 데이터 조회의 응답 순서가 요청 순서와 달라질 수 있으므로, Effect 정리 과정에서 오래된 결과를 무시하라고 설명한다. [React의 Effect 문서](https://react.dev/reference/react/useEffect)

문자열만 같아도 충분하지 않다. `보고서`라는 검색어를 전체 파일에서 찾을 때와 선택한 폴더 아래에서 찾을 때는 결과의 의미가 다르다. 같은 폴더라도 페이지와 페이지 크기가 바뀌면 현재 목록과 맞지 않는다. 로그인 주체나 접근 범위가 바뀌면 같은 파일 ID도 같은 요청으로 취급할 수 없다. 실제 구현은 접근 범위, 확인된 폴더 경로, 검색어, 페이지 등을 하나의 요청 키에 담고, 화면이 그 키에 맞는 결과만 표시하게 했다.

폴더 검색은 경로가 확인된 뒤 시작한다. 주소에서 복원한 폴더 문자열만 보고 검색하면, 존재하지 않거나 접근할 수 없는 폴더를 현재 위치로 가정할 수 있기 때문이다. 새 경로를 고르는 순간에는 예전 검색 결과를 잠시 보여 주는 대신 새 요청의 로딩 상태를 보여 준다. 새 검색이 실패했는데 이전 검색의 성공 페이지가 남아 있는 상태도 막는다. 이렇게 구분하면 사용자가 지금 보고 있는 자료의 범위를 잘못 이해하는 일을 줄인다. 화면을 깔끔하게 보이게 하는 데서 끝나지 않는다.

## 취소와 화면 반영은 서로 다른 책임이다

새 요청을 시작할 때 이전 `AbortController`를 취소하면 쓸모없는 네트워크 작업을 줄일 수 있다. MDN에 따르면 `abort()`는 연결된 `fetch` 요청과 응답 본문 읽기 등을 중단할 수 있다. [MDN AbortController 문서](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)

하지만 실제 함수가 항상 그 신호를 끝까지 지킨다고 가정할 수는 없다. 이미 해결된 Promise 뒤의 Blob 변환 같은 후속 작업이 진행 중일 수도 있고, 테스트용 함수가 취소 신호를 무시할 수도 있다. 따라서 취소는 작업을 멈추라는 신호이고, 상태를 쓰기 직전에는 결과의 소속을 다시 확인해야 한다. 검색 구현은 요청 순번과 현재 경로·검색어·페이지를 확인한 후에만 성공이나 오류를 반영한다. 늦은 이전 요청의 404 역시 현재 화면의 경로 오류로 승격하지 않는다. 세대 번호를 상태 반영 조건으로 쓰는 모델이다. 이전 작업을 물리적으로 완전히 없애지 못해도, 이전 세대가 새 세대의 상태를 바꾸지 못하게 한다.

미리보기에서는 파일 ID에 버전까지 넣어야 한다. 버전 2를 선택했는데 버전 1의 다운로드가 늦게 끝나거나 Blob 읽기가 뒤늦게 끝날 수 있다. 화면은 선택한 버전과 일치하는 패킷만 렌더링한다. 이전 작업은 취소 표시를 확인하고 중간 단계에서 빠져나온다. 미리보기를 닫거나 선택을 바꾸면 Blob URL도 해제한다. 요청 취소, 화면 반영 조건, 브라우저 자원 정리가 각자 맡은 일이다.

다음 코드는 그 판단만 재현하는 작은 Node.js 예시다. `node example.mjs`로 실행할 수 있다. 일부러 지연 작업이 취소 신호를 무시하도록 만들어, 취소만 믿어서는 충분하지 않은 상황을 검사한다.

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
const a = select(JSON.stringify(['team', 'folder-a', 'report', 1]), () => old.promise);
const b = select(JSON.stringify(['team', 'folder-b', 'report', 1]), () => next.promise);
next.resolve('folder-b result');
await b;
old.resolve('folder-a result');
await a;
assert.equal(visible, 'folder-b result');
console.log('late result ignored');
```

예시에서는 `generation`과 선택 키를 둘 다 검사한다. 세대 번호는 같은 검색 조건으로 연속 재시도한 요청의 선후관계를 가른다. 선택 키는 어떤 폴더와 버전에 속하는 결과인지 설명한다. 실제 화면에서는 접근 범위와 페이지 등 결과 의미를 바꾸는 입력을 빠뜨리지 않아야 한다. 반대로 표시와 무관한 값을 무턱대고 키에 넣으면 불필요한 재요청을 만든다.

## 검색어가 만들어지는 시간도 다르다

한글 입력은 또 다른 시간축을 만든다. 입력창에 보이는 글자와 서버에 보낼 확정 검색어가 항상 동시에 바뀌지는 않는다. IME가 글자를 조합하는 동안에는 보이는 값만 갱신하고, 조합이 끝난 뒤 검색어를 확정할 수 있다. MDN은 `compositionend`를 입력기의 현재 조합이 완료되거나 취소될 때 발생하는 이벤트로 정의한다. [MDN compositionend 문서](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event)

여기에도 오래된 작업이 남는다. 조합 중 예약된 타이머가 검색창을 지운 뒤 실행되면 지운 단어가 다시 검색된다. 따라서 외부에서 검색어를 바꾸거나 지울 때는 예약 타이머를 취소하고, 화면 값과 검색 대상 값을 함께 맞춰야 한다. 디바운스는 요청 빈도를 조절할 뿐, 이미 시작한 요청의 순서나 소속을 보장하지 않는다. 입력 단계의 타이머와 조회 단계의 응답을 각각 검사해야 한다.

## 어디까지 확인했나

로컬 회귀 검사에는 새 검색이 성공한 뒤 이전 검색이 실패하는 경우, 폴더나 접근 범위가 바뀐 뒤 이전 성공이 도착하는 경우, 검색어를 지운 뒤 이전 결과가 도착하는 경우가 있다. 미리보기 검사에는 버전 2를 선택한 뒤 늦게 끝난 버전 1의 Blob 처리가 버전 2 화면을 덮지 않는 경우와 URL 해제가 있다. 입력 검사에는 조합 중 외부 리셋과 즉시 지우기가 있다. 저장소에 기록된 전체 Jest와 정적 검사·빌드는 통과했다. 이 근거는 로컬 코드의 동작을 지지한다. 실제 브라우저에서 모든 입력기 조합을 확인하거나 배포된 API와 연결해 검증한 결과로 확대할 수는 없다.

다음에 비슷한 화면을 볼 때는 두 질문을 먼저 적어 보자. “이 결과의 소속을 결정하는 입력은 무엇인가?” 그리고 “그 입력이 바뀐 뒤에도 이전 작업이 화면을 바꿀 수 있는가?” 이 두 질문이 정리되면 취소, 키, 세대 번호, 타이머 정리 중 무엇이 필요한지 코드에서 비교적 분명해진다.
