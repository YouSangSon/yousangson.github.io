---
title: "Git worktree를 만들었는데 로컬 설정은 왜 없을까"
description: "새 worktree가 가져오는 커밋과 가져오지 않는 로컬 입력을 임시 저장소에서 확인한다. 추적 여부·ignore 규칙·설정 로더를 나눠 실행 환경을 준비하는 방법."
categories: [architecture, tooling]
tags: [git, worktree, configuration, reproducibility]
date: 2026-10-16
related:
  - slug: database-index-preparation-and-startup
    reason: 코드 밖의 선행 조건을 준비하고 기동에서 확인하는 같은 문제를 DB 환경으로 옮겨 봅니다.
  - slug: diagnostic-capture-status-and-trusted-identity
    reason: 파일의 존재와 실제로 확인한 실행 환경을 구분해 진단 근거를 남기는 방법을 살펴봅니다.
---

같은 저장소의 새 worktree에서 서버를 실행했는데 기존 폴더에서는 읽히던 로컬 설정이 없다. `git worktree add`는 선택한 커밋을 새 작업 디렉터리에 펼치며 기존 폴더의 미커밋 수정이나 무시된 설정까지 복제하지 않는다. 새 worktree의 준비 완료는 checkout 성공과 별도로 확인해야 한다.

여러 서비스의 작업 폴더를 옮기며 반복해서 확인한 경계다. 아래에서는 실제 설정이나 경로를 옮기지 않고 임시 Git 저장소로 차이를 재현한다.

## 같은 저장소가 같은 폴더를 뜻하지는 않는다

worktree는 하나의 저장소에 여러 작업 디렉터리를 연결한다. 커밋 객체와 일반 브랜치 참조 같은 저장소 정보는 공유하지만 각 worktree는 자신의 `HEAD`와 인덱스를 갖는다. 여기서 인덱스는 다음 커밋에 넣을 파일 상태를 기록하는 Git의 staging 영역이다. [Git worktree 문서](https://git-scm.com/docs/git-worktree)

새 worktree를 특정 커밋에서 만들면 그 커밋의 추적 파일이 나온다. 기존 폴더의 파일을 모두 복사한 다음 브랜치를 바꾸는 과정으로 이해하면 로컬 입력이 사라진 것처럼 보인다. 실제로는 처음부터 복사 대상이 달랐다.

독립 예제에는 상태가 다른 파일 네 개를 준비했다. `.env.local`에는 비밀이 없는 예제 값만 넣었다.

| 파일 | 기존 폴더의 상태 | 새 worktree에서 확인할 것 |
| --- | --- | --- |
| `config.txt` | 커밋 뒤 로컬에서 내용 수정 | 커밋된 예전 내용 |
| `.env.local` | 미추적, ignore 규칙과 일치 | 파일 없음 |
| `notes.txt` | 미추적, ignore 규칙 없음 | 파일 없음 |
| `.tool-versions` | 커밋에 포함, 나중에 ignore 규칙 추가 | 파일 있음 |

마지막 행이 헷갈리기 쉽다. `.gitignore`에 적힌 이름이라고 해서 이미 추적 중인 파일까지 checkout에서 빠지지는 않는다. ignore 규칙은 이미 추적된 파일을 추적 해제하지 않는다. [Git ignore 문서](https://git-scm.com/docs/gitignore)

## 새 worktree의 내용을 직접 대조하기

[실행 예제](/assets/examples/2026-10-16/worktree-inputs.py)는 임시 디렉터리 안에서 저장소를 만들고 최초 커밋을 남긴다. 그 뒤 원본의 `config.txt`를 수정하고 로컬 파일을 추가한 다음, 같은 커밋의 새 worktree를 만든다. 실험 디렉터리는 종료 시 정리하며 기존 저장소나 전역 Git 설정은 바꾸지 않는다.

Python 3.14.5와 Git 2.56.0에서 실행한 결과는 다음과 같다.

```sh
python3 worktree-inputs.py
```

```text
git version 2.56.0
tracked edit: source=local change; target=committed
ignored input: target missing
untracked note: target missing
tracked file matching ignore pattern: target present
linked worktree .git: file
```

원본의 미커밋 수정은 원본에 남았고 새 worktree에는 커밋 내용이 나왔다. 미추적 파일 두 개는 모두 없으며 ignore 규칙과 이름이 같아도 커밋된 버전 선택 파일은 존재한다. 실험은 내용을 `assert`로 비교하므로 파일이 있다는 사실만 검사하지 않는다.

이 차이를 확인할 때는 파일의 추적 여부부터 살핀다. 다음 명령은 파일 본문을 출력하지 않고 해당 경로가 인덱스에 들어 있는지 확인한다.

```sh
git ls-files -- config/config_local.yaml
```

경로가 출력되면 추적 중이다. 출력이 없다고 파일이 없거나 불필요하다는 뜻은 아니다. 다음 단계에서 미추적 파일이 어떤 제외 규칙에 걸렸는지 확인한다. [Git ls-files](https://git-scm.com/docs/git-ls-files)

```sh
git check-ignore -v -- config/config_local.yaml
```

기본 `check-ignore`는 추적 파일을 보고하지 않는다. 그래서 두 명령을 순서대로 해석한다. 규칙과 일치하는지만 따로 조사하려면 `--no-index`가 있지만 그 결과로 파일이 미추적이라고 판단해서는 안 된다. [Git check-ignore](https://git-scm.com/docs/git-check-ignore)

## 복사할 파일은 설정 로더가 결정한다

Git은 어떤 로컬 파일이 실행에 필요한지 모른다. 예를 들어 이름이 `config_local.yaml`인 파일이 있어도 로더가 기본 `config.yaml`만 읽는다면 복사만으로 실행 설정이 바뀌지 않는다. 실행 명령의 환경변수나 인자로 다른 경로를 선택하는지까지 확인해야 한다.

준비할 입력을 찾을 때는 기존 실행 명령에서 시작한다. 그 명령이 고르는 설정 경로를 찾고 대상 파일의 추적·제외 여부를 확인한다. 추적 파일은 대상 브랜치의 checkout 결과를 사용하고 필요한 미추적 입력만 같은 상대 경로에 준비한다. 원본의 추적 파일에 수정이 있다면 그 변경을 새 worktree로 통째로 덮어쓰지 않는다.

설정 파일을 복사할 때도 대상에 이미 파일이 있으면 비교부터 한다. `cmp -s`는 내용을 출력하지 않고 동일 여부를 종료 코드로 알려 준다. 일반 파일의 동일성, 파일 권한과 Git 제외 여부를 각각 확인하고 비밀값은 출력하지 않는다. 원본이 symlink라면 실제 대상과 관리 주체를 먼저 확인한다.

가상환경이나 의존성 디렉터리를 통째로 복사하면 경로와 버전이 섞일 수 있다. lockfile과 버전 선언으로 대상에서 준비하고 실제 실행 파일을 확인하는 편이 입력을 추적하기 쉽다. `.tool-versions`가 존재한다는 사실만으로 현재 터미널이 그 버전을 선택했다고 볼 수는 없다.

```sh
command -v go
go version
command -v python3
python3 --version
```

이 명령은 현재 셸의 선택을 보여 준다. 별도의 가상환경이나 wrapper로 테스트한다면 그 명령이 실제로 실행한 버전도 확인한다. 버전 선언, 셸의 실행 파일, 검증 명령의 실행 환경이 일치하는지 보는 과정이다.

## `.git`도 디렉터리라고 가정하지 않기

실험의 마지막 출력에서 linked worktree의 `.git`은 파일이다. 별도의 관리 디렉터리를 가리키기 때문에 `.git/info/exclude`를 직접 열려는 도구는 실패할 수 있다.

Git 내부 경로는 Git에 물으면 된다. 다음 명령은 파일 내용을 읽지 않고 실제 exclude 경로를 반환한다.

```sh
git rev-parse --git-path info/exclude
```

이 경로의 exclude는 저장소 내 worktree들이 공유할 수 있다. 다른 작업까지 숨기는 넓은 패턴을 추가하지 말고 필요한 정확한 로컬 경로만 다룬다. 설정을 worktree별로 분리할 때도 공통 Git 설정과 worktree별 설정의 경계를 먼저 확인한다. [Git 경로 해석](https://git-scm.com/docs/git-rev-parse), [worktree의 공유 정보](https://git-scm.com/docs/git-worktree#_details)

## checkout 다음에 남은 준비

새 worktree에서 실패한 명령을 기존 폴더와 비교할 때 같은 커밋인지부터 확인한다. 그다음 설정 로더가 고른 경로와 실제 실행 버전을 대조하면 코드 차이와 로컬 입력 차이를 나눌 수 있다. 파일 이름이 익숙하다는 이유로 다른 환경의 설정을 가져오는 것은 이 비교를 흐린다.

다음번 worktree에서는 필요한 로컬 설정 하나를 골라 보자. 추적 중인지, 어떤 로더가 읽는지, 대상에서 같은 실행 파일이 선택되는지를 차례로 확인하면 된다. 파일 복사가 끝났다는 사실과 의존성 설치·테스트·서버 기동의 성공은 각각 별도로 남긴다.
