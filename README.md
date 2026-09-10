# Yousang · 엔지니어링 노트

[블로그](https://yousangson.github.io/) · Astro + [Retypeset](https://github.com/radishzzz/astro-theme-retypeset)

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm verify
pnpm preview
```

Node.js 24와 pnpm 10.33을 사용합니다. 검색은 `pnpm build` 이후 `pnpm preview`에서 확인합니다.

글 원본은 `_posts/`에 작성합니다. 빌드가 `.generated/posts/`에 Astro용 메타데이터를 생성하고 Liquid의 `raw` 래퍼만 제거합니다. 기존 `/posts/.../` 주소를 유지하므로 파일명 변경은 URL 변경으로 이어질 수 있습니다. 이미지 경로는 `public/assets/images/`입니다.

`master`의 GitHub Actions가 검사와 빌드를 통과한 뒤 GitHub Pages로 배포합니다.

테마 코드는 Retypeset `a636b6d393be714cab52d3fc4baddd3f3905f701`을 기반으로 합니다. MIT 라이선스와 원저작자 표기는 [LICENSE](LICENSE)에 보존합니다. 이 표기는 블로그 글의 별도 재배포 허가를 의미하지 않습니다.
