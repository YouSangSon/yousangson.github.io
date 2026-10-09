# Yousang · 엔지니어링 노트

[블로그](https://yousangson.github.io/) · Astro + [Retypeset](https://github.com/radishzzz/astro-theme-retypeset)

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm verify
pnpm verify:reader
pnpm preview
```

Node.js 24와 pnpm 10.33을 사용합니다. 검색은 `pnpm build` 이후 `pnpm preview`에서 확인합니다.

`pnpm verify:reader`는 빌드 결과를 임시 포트에서 열고 검색 → 글 → 뒤로 가기, 검색어 공유·새로고침, 모바일 읽기와 관련 글을 Chromium으로 검사합니다. 최초 실행에는 `pnpm exec playwright install chromium`이 필요합니다. 공유 카드의 한글 렌더링은 시스템 글꼴을 사용합니다. Linux에서는 `fonts-noto-cjk`를 설치하며 배포 workflow도 같은 글꼴을 준비합니다.

원문의 `updated`는 실제 본문을 보완한 날짜입니다. 최초 `date`는 유지합니다. 논문 글의 `displayTitle`·`attribution`은 읽기용 제목과 출처 표시이며 원래 `title`은 검색·공유 메타데이터에 보존합니다. `related`에는 연결할 글의 slug와 함께 읽는 이유를 2~3개 적습니다. 빌드가 글별 1200×630px 공유 이미지를 생성합니다.

글 원본은 `_posts/`에 작성합니다. 빌드가 `.generated/posts/`에 Astro용 메타데이터를 생성하고 Liquid의 `raw` 래퍼만 제거합니다. 기존 `/posts/.../` 주소를 유지하므로 파일명 변경은 URL 변경으로 이어질 수 있습니다. 이미지 경로는 `public/assets/images/`입니다.

글을 추가하면 `src/utils/topics.ts`에서 독자가 찾을 대표 분야 한 곳에 배치합니다. `pnpm verify`가 미분류·중복 분류와 카테고리별 글 수·요약을 검사합니다. 의도적으로 삭제한 글은 `scripts/retired-posts.json`에 기록하며, 기존 주소 검사의 보존 목록에서도 해당 주소만 제외합니다. 이 목록의 글이 다시 빌드되면 검사가 실패합니다.

`master`의 GitHub Actions가 검사와 빌드를 통과한 뒤 GitHub Pages로 배포합니다.

테마 코드는 Retypeset `a636b6d393be714cab52d3fc4baddd3f3905f701`을 기반으로 합니다. MIT 라이선스와 원저작자 표기는 [LICENSE](LICENSE)에 보존합니다. 이 표기는 블로그 글의 별도 재배포 허가를 의미하지 않습니다.
