---
title: "Go 바이너리의 SBOM, go.mod만으로는 어떤 파일인지 알 수 없다"
description: "같은 go.mod로 만든 두 명령의 모듈 정보가 달라지는 이유를 독립 예제로 확인한다. 구성 목록을 실제 배포 파일의 이름·SHA-256에 연결하고, 해시 일치와 출처 신뢰를 구분하는 방법."
categories: [architecture, security]
tags: [go, sbom, supply-chain, build, integrity]
date: 2026-10-23
related:
  - slug: git-worktree-runtime-inputs
    reason: 같은 저장소를 사용해도 실제 실행을 결정하는 입력이 같지는 않다는 점을 작업 디렉터리에서 확인합니다.
  - slug: diagnostic-capture-status-and-trusted-identity
    reason: 기록한 값의 존재와 검증된 대상의 정체성을 구분하는 원리를 진단 로그에 적용합니다.
---

같은 `go.mod`에서 빌드한 Go 명령 두 개는 같은 구성 요소를 담고 있을까. 하나는 별도 모듈을 import하고 다른 하나는 표준 라이브러리만 사용하면 바이너리에서 읽은 의존 모듈 목록은 달라진다. 배포 파일의 SBOM을 검토할 때는 소스의 목록과 해당 파일에서 얻은 목록을 구분하고 어느 파일을 조사했는지 이름과 해시로 연결해야 한다.

SBOM(Software Bill of Materials)은 소프트웨어 구성 요소 명세, 즉 소프트웨어를 이루는 부품 목록이다. 이 글에서는 완성된 SBOM을 생성하는 대신 그 목록의 **조사 범위와 대상 파일**이 왜 필요한지를 작은 독립 예제로 확인한다. 실제 제품의 코드나 릴리스 결과를 옮긴 사례는 아니다.

## 같은 go.mod, 다른 명령

예제의 루트 모듈에는 `cmd/a`와 `cmd/b`가 있다. `a`는 직접 만든 `example.test/helper` 모듈의 함수를 호출하고 `b`는 `fmt.Println`만 호출한다. 두 명령은 다음 `go.mod`를 공유한다.

```go
module example.test/inventory

go 1.24.5

require example.test/helper v0.0.0
replace example.test/helper => ./helper
```

`replace`는 이 실험에서 의존 모듈을 로컬 디렉터리로 연결한다. `v0.0.0`은 예제용 선언이며 공개 저장소의 배포 버전이 아니다. 네트워크에서 가져올 패키지는 없다. 두 명령의 차이는 다음 호출에 있다.

```go
// cmd/a/main.go의 main
fmt.Println(helper.Message())

// cmd/b/main.go의 main
fmt.Println("stdlib")
```

소스 모듈 목록을 확인하는 `go list -m all`은 두 명령 중 하나를 골라 조사하지 않는다. 이 예제에서는 루트 모듈과 로컬 helper 모듈을 함께 출력한다. 반면 `go version -m command-a`는 만들어진 `command-a` 파일에 내장된 모듈 정보를 읽는다. 두 명령이 묻는 대상부터 다르다. [Go 1.24.5 명령 문서](https://pkg.go.dev/cmd/go@go1.24.5#hdr-Print_Go_version)

이 차이를 표로 읽으면 조사 범위가 선명해진다. “의존 모듈 없음”은 표준 라이브러리까지 없다는 뜻이 아니다.

| 확인한 대상 | helper가 나타나는가 | 그 결과로 알 수 있는 것 |
| --- | --- | --- |
| 루트의 `go list -m all` | 나타남 | 소스 모듈 관점에서 선택한 모듈 목록 |
| `command-a`의 내장 모듈 정보 | 나타남 | 이 바이너리 빌드에 helper 모듈이 패키지를 제공함 |
| `command-b`의 내장 모듈 정보 | 나타나지 않음 | 이 바이너리의 의존 모듈 기록에는 helper가 없음 |

Go의 `runtime/debug.BuildInfo.Deps`는 해당 바이너리 빌드에 패키지를 제공한 직접·간접 의존 모듈을 기술한다. 저장소 전체가 요구한 모듈을 모두 열거하는 필드가 아니다. 파일을 밖에서 읽으려면 `debug/buildinfo.ReadFile`, 실행 중인 자기 프로그램의 정보를 읽으려면 `runtime/debug.ReadBuildInfo`를 사용할 수 있다. [Go 1.24.5 BuildInfo](https://pkg.go.dev/runtime/debug@go1.24.5#BuildInfo), [debug/buildinfo](https://pkg.go.dev/debug/buildinfo@go1.24.5)

또한 모듈과 패키지는 단위가 다르다. 하나의 모듈이 여러 패키지를 담을 수 있으므로 모듈 한 줄에서 어떤 함수가 남았고 어떤 실행 경로로 호출되는지까지 읽어낼 수는 없다. 여기서는 **빌드에 참여한 모듈의 기록**을 관찰한다. 취약한 함수에 실제로 도달하는지를 입증하는 실험은 아니다.

## Go와 Python 표준 라이브러리로 확인하기

[실행 가능한 전체 예제](/assets/examples/2026-10-23/binary-inventory.py)에서는 Python이 임시 디렉터리에 위 모듈과 소스를 쓰고 Go로 두 명령을 빌드한다. Go 1.24.5와 Python 3.14.5, macOS arm64 환경에서 실행했다. 설치된 Go의 실제 위치를 먼저 찾으므로 버전 관리용 shim이 임시 디렉터리에서 다른 버전을 선택하는 일을 피한다. Go 버전이 다르면 자동 설치하지 않고 중단한다.

파일을 내려받은 위치에서 다음처럼 실행한다. Python의 `assert`를 사용하는 자체 검사가 있으므로 `-O` 옵션은 붙이지 않는다.

```sh
python3 binary-inventory.py
```

스크립트 안에서 두 파일을 만드는 결정적인 명령은 다음과 같다. 로컬 의존 모듈만 사용하며 `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`로 외부 모듈 조회와 도구 체인 자동 다운로드를 막는다. 소스와 빌드 캐시도 임시 디렉터리에 두고 종료할 때 제거한다.

```sh
go build -trimpath -buildvcs=false -o command-a ./cmd/a
go build -trimpath -buildvcs=false -o command-b ./cmd/b
go version -m command-a
go version -m command-b
```

`-trimpath`는 결과물에 기록되는 파일 경로에서 로컬 절대 경로를 제거한다. `-buildvcs=false`는 버전 관리 정보를 넣지 않는다. 이 예제에서는 로컬 경로와 Git 상태가 설명을 흐리지 않도록 선택한 입력이다. 실제 릴리스에서 커밋 정보를 제외하라는 권고는 아니며 두 옵션만으로 재현 가능한 빌드를 입증하지도 않는다. [Go 1.24.5 빌드 옵션](https://pkg.go.dev/cmd/go@go1.24.5#hdr-Compile_packages_and_dependencies)

실행 결과는 다음과 같다. 긴 `go version -m` 출력에서는 `dep` 행을 추출해 모듈 경로만 표시했다. 해시는 실행 중 계산하고 비교하므로 본문에 특정 빌드의 해시 문자열을 고정하지 않았다.

```text
go version go1.24.5 darwin/arm64
source modules:
example.test/inventory
example.test/helper v0.0.0 => ./helper
command-a dependency modules: example.test/helper
command-b dependency modules: (none)
original name+sha256 mapping: PASS
command-b bytes under command-a name: REJECT
go.mod unchanged: PASS
temporary resources removed: PASS
```

스크립트는 helper의 유무를 기대값과 비교하고 빌드 전후 `go.mod`의 SHA-256이 같은지도 검사한다. 목록이 달라진 이유를 선언 파일 변경으로 돌릴 수 없게 한 것이다. 같은 소스 모듈 목록을 두 파일에 복사하면 `b`에도 helper가 있는 것처럼 보이게 된다. 반대로 저장소의 개발·테스트 의존성까지 조사하려는 작업에서 바이너리 하나의 목록만 쓰면 조사 범위를 좁히게 된다. 어느 쪽을 사용할지는 문서가 설명할 대상을 먼저 정한 뒤 선택해야 한다.

## 파일 이름은 그대로 두고 내용만 바꾸면

모듈 목록을 읽었다고 해서 그 목록이 전달받은 파일의 것이라는 연결까지 생기지는 않는다. `command-a`라는 이름만 적어 두면 나중에 같은 이름으로 다른 빌드가 올라와도 기존 목록과 짝지어질 수 있다.

이를 확인하기 위해 스크립트는 각 파일의 이름과 SHA-256을 한 레코드에 묶는다. SHA-256은 파일의 바이트를 입력으로 계산하는 해시다. 예제에서는 여기에 앞서 읽은 모듈 목록도 함께 보관한다.

```python
records[name] = {
    "sha256": sha256(root / name),
    "modules": dependencies,
}
```

원래 두 파일은 각각 자신의 레코드와 일치한다. 그다음 `command-b`의 바이트를 `command-a` 경로에 복사한다. 경로는 여전히 `command-a`지만 이 파일의 해시는 처음 기록한 `command-a`의 해시와 다르다. 그래서 두 번째 검사는 거절한다.

```python
def matches(name, path):
    return path.name == name and sha256(path) == records[name]["sha256"]

shutil.copyfile(root / "command-b", root / "command-a")
assert not matches("command-a", root / "command-a")
```

이 실험은 파일 이름이 담당하는 **선택**과 해시가 담당하는 **내용 확인**을 분리한다. 이 예제의 정책에서는 이름도 정확히 일치해야 한다. 다른 시스템은 파일 이름 대신 배포 경로나 아티팩트 식별자를 쓸 수 있다. 어느 표현을 고르든 목록과 파일의 연결에 내용 해시가 빠지면 같은 이름의 다른 바이트를 구분하지 못한다.

SPDX 2.3.1의 `PackageChecksum`도 특정 패키지 내용의 변경을 확인하기 위한 필드다. 체크섬은 어떤 비트가 바뀌었는지 설명하지는 않는다. 위 Python 레코드는 그 연결 원리만 보여 주는 임시 자료이며 SPDX 문서 형식을 구현한 결과물이 아니다. [SPDX 2.3.1 Package checksum](https://spdx.github.io/spdx-spec/v2.3.1/package-information/#710-package-checksum-field)

## 해시가 맞는다는 것과 믿을 수 있다는 것

공격자가 파일과 옆에 놓인 해시 목록을 함께 바꿀 수 있다면 둘은 다시 일치할 수 있다. 따라서 해시 비교만으로 누가 만들었는지, 승인된 소스와 빌드 절차를 따랐는지를 증명할 수 없다. 실험의 레코드가 알려 주는 것은 실행 중 처음 관찰한 파일과 나중 파일의 일치 여부다.

출처 증명(provenance)은 이와 별도로 어디서·언제·어떻게 결과물을 만들었는지 기술한다. SLSA 1.2의 빌드 출처 증명은 결과물을 `subject`로 식별한다. 검증 절차는 이 대상과 실제 파일의 digest를 대조하는 데 더해 서명과 신뢰할 빌더, 기대한 빌드 입력도 확인한다. JSON에 필드가 존재하는 것과 검증자가 그 주장을 신뢰하는 것은 다른 단계다. [SLSA 1.2 Build provenance](https://slsa.dev/spec/v1.2/build-provenance), [아티팩트 검증](https://slsa.dev/spec/v1.2/verifying-artifacts)

이 구분을 유지하면 문서가 답할 수 있는 질문도 나뉜다.

| 자료·검사 | 답하려는 질문 | 그것만으로 알 수 없는 것 |
| --- | --- | --- |
| 소스 모듈 목록 | 이 소스가 선택하는 모듈은 무엇인가 | 특정 바이너리의 구성 |
| 바이너리 내장 모듈 정보 | 이 빌드에 어떤 모듈이 참여했는가 | 모든 구성 요소·라이선스·실행 가능 경로 |
| 파일 식별자와 해시 대조 | 조사한 파일과 전달받은 파일의 바이트가 같은가 | 작성자·빌더의 신뢰성 |
| 출처 증명 검증 | 신뢰한 주체가 기대한 입력으로 만든 결과인가 | 취약점이 없다는 보증 |

표준 라이브러리나 C 라이브러리, 함께 배포하는 별도 파일까지 조사해야 한다면 이 예제의 모듈 추출만으로는 부족하다. 실제 SBOM 도구와 출력 형식을 선택할 때도 해당 도구가 무엇을 읽었고 무엇을 놓칠 수 있는지 확인해야 한다. 구성 요소 목록이 있어도 취약점 데이터베이스와의 대조나 실제 영향 분석은 추가 작업이다.

다음에 여러 실행 파일을 한 릴리스로 묶는다면 저장소 루트에서 만든 목록을 모든 파일의 목록으로 재사용하기 전에 각 명령의 빌드 결과를 읽어 보자. 최종 파일이 바뀌면 기존 이름을 유지하더라도 다시 해시를 계산하고 목록의 연결을 갱신해야 한다. 받는 쪽에서는 그 해시를 실제 파일과 대조하고 목록과 출처 증명을 신뢰할 경로로 받았는지를 별도로 판단한다.
