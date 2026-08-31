---
title: Python으로 Kubernetes 기반 배치 작업 플랫폼 구축하기
description: Template Method 패턴과 Decorator 기반 Job Registry를 활용한 확장 가능한 배치 플랫폼 설계
categories: [python, kubernetes]
tags: [python, kubernetes, batch, design patterns, cronjob, clean architecture]
date: 2024-07-20
---

Kubernetes CronJob 환경에서 단일 Docker 이미지로 다양한 배치 작업을 관리하는 플랫폼을 Python으로 개발한 경험을 공유합니다.

## 프로젝트 개요

### 목표
- **통합 배치 플랫폼**: 하나의 Docker 이미지로 여러 배치 작업 실행
- **사용자/조직 동기화**: HR 시스템(MariaDB) → 인증 시스템(Keycloak) + API Gateway
- **복잡한 시나리오 처리**: 입사, 퇴사, 복직, 부서 이동, 직급 변경 등
- **안정적 운영**: Dry-run 모드, 재시도 로직, 상세 리포트

### 기술 스택

```
Language: Python 3.13
CLI Framework: Click
HTTP Client: Requests
Database: PyMySQL (MariaDB), PyMongo (MongoDB)
Config: PyYAML
Container: Docker (Python 3.13-slim)
Orchestration: Kubernetes (Kustomize)
CI/CD: GitLab CI
```

---

## 아키텍처 설계

### 프로젝트 구조

```
batch-platform/
├── src/batch_platform/
│   ├── cli.py                    # Click CLI 진입점
│   │
│   ├── core/                     # 도메인 레이어
│   │   ├── config.py            # 설정 데이터클래스
│   │   ├── report.py            # 동기화 리포트
│   │   ├── retry.py             # 재시도 큐
│   │   ├── state.py             # 증분 동기화 상태
│   │   └── exceptions.py        # 커스텀 예외
│   │
│   ├── infrastructure/           # 인프라 레이어
│   │   ├── config_loader.py     # 설정 로더
│   │   └── clients/             # API 클라이언트
│   │       ├── base.py          # 기본 클라이언트
│   │       ├── keycloak.py      # Keycloak 클라이언트
│   │       ├── api_gateway.py   # API Gateway 클라이언트
│   │       └── mariadb.py       # MariaDB 클라이언트
│   │
│   ├── jobs/                     # Job 구현
│   │   ├── base.py              # BaseJob (Template Method)
│   │   ├── registry.py          # JobRegistry (Decorator)
│   │   └── sync_user_info/      # 사용자 동기화 Job
│   │       ├── job.py
│   │       ├── models.py
│   │       ├── fetcher.py
│   │       └── seeder.py
│   │
│   └── utils/
│       └── password.py
│
├── k8s/                          # Kubernetes 매니페스트
│   ├── base/                    # 기본 설정
│   └── overlays/                # 환경별 오버레이
│       ├── dev/
│       └── prod/
│
├── Dockerfile
├── pyproject.toml
└── requirements.txt
```

---

## 핵심 디자인 패턴

### 1. Template Method 패턴 (BaseJob)

Job 실행의 **불변 흐름**을 정의하고, 서브클래스에서 각 단계를 구현합니다.

```python
# jobs/base.py
from abc import ABC, abstractmethod

class BaseJob(ABC):
    """모든 배치 Job의 기본 클래스"""

    name: str = ""  # 서브클래스에서 정의

    def run(self, dry_run: bool = False) -> dict:
        """Template Method: 불변 실행 흐름"""
        try:
            # 1. 검증 단계
            self.validate()

            # 2. 데이터 추출 단계
            data = self.fetch()

            # 3. 실행 단계
            result = self.execute(data, dry_run=dry_run)

            # 4. 정리 단계
            self.cleanup()

            return result

        except Exception as e:
            self.handle_error(e)
            raise

    @abstractmethod
    def validate(self) -> None:
        """설정 및 연결 검증"""
        pass

    @abstractmethod
    def fetch(self) -> dict:
        """소스에서 데이터 추출"""
        pass

    @abstractmethod
    def execute(self, data: dict, dry_run: bool = False) -> dict:
        """핵심 비즈니스 로직"""
        pass

    def cleanup(self) -> None:
        """리소스 정리 (optional)"""
        pass

    def handle_error(self, error: Exception) -> None:
        """에러 핸들링 (optional)"""
        logger.error(f"Job failed: {error}")
```

**장점**:
- 실행 흐름의 일관성 보장
- 공통 로직 중복 제거
- 각 단계별 테스트 용이

### 2. Decorator 기반 Job Registry

```python
# jobs/registry.py
from typing import Type, Dict

class JobRegistry:
    """싱글톤 Job 레지스트리"""

    _jobs: Dict[str, Type[BaseJob]] = {}

    @classmethod
    def register(cls, job_class: Type[BaseJob]) -> Type[BaseJob]:
        """데코레이터로 Job 등록"""
        if not job_class.name:
            raise ValueError(f"Job class {job_class.__name__} must define 'name'")

        cls._jobs[job_class.name] = job_class
        return job_class

    @classmethod
    def get(cls, name: str) -> Type[BaseJob]:
        """이름으로 Job 클래스 조회"""
        if name not in cls._jobs:
            raise KeyError(f"Unknown job: {name}")
        return cls._jobs[name]

    @classmethod
    def create(cls, name: str, config: dict) -> BaseJob:
        """Factory: Job 인스턴스 생성"""
        job_class = cls.get(name)
        return job_class(config)

    @classmethod
    def list_jobs(cls) -> list[str]:
        """등록된 모든 Job 이름 반환"""
        return list(cls._jobs.keys())
```

**Job 등록 예시**:

```python
# jobs/sync_user_info/job.py
from batch_platform.jobs.base import BaseJob
from batch_platform.jobs.registry import JobRegistry

@JobRegistry.register  # 데코레이터로 간단히 등록!
class SyncUserInfoJob(BaseJob):
    """사용자 정보 동기화 Job"""

    name = "sync-user-info"

    def __init__(self, config: dict):
        self.config = config
        self.fetcher = MariaDBFetcher(config)
        self.seeder = OrganizationSeeder(config)
        self.report = SyncReport()

    def validate(self) -> None:
        self.fetcher.test_connection()
        self.seeder.test_connections()

    def fetch(self) -> dict:
        return {
            "organization": self.fetcher.fetch_organization(),
            "users": self.fetcher.fetch_users(),
        }

    def execute(self, data: dict, dry_run: bool = False) -> dict:
        return self.seeder.sync(data, dry_run=dry_run)

    def cleanup(self) -> None:
        self.fetcher.close()
        self.report.save()
```

**새 Job 추가가 매우 간단**:

```python
@JobRegistry.register
class DataBackupJob(BaseJob):
    name = "data-backup"
    # ... 구현
```

### 3. 3단계 설정 로딩

CLI 인자 → YAML 파일 → 환경 변수 순으로 우선순위 적용:

```python
# infrastructure/config_loader.py
import os
import yaml
from dataclasses import dataclass, field

@dataclass
class SyncConfig:
    """동기화 Job 설정"""
    environment: str = "dev"

    # MariaDB
    mariadb_host: str = ""
    mariadb_port: int = 3306
    mariadb_database: str = ""
    mariadb_user: str = ""
    mariadb_password: str = ""

    # Keycloak
    keycloak_url: str = ""
    keycloak_realm: str = ""
    keycloak_client_id: str = ""
    keycloak_client_secret: str = ""

    # API Gateway
    api_gateway_url: str = ""
    api_gateway_username: str = ""
    api_gateway_password: str = ""

    # 재시도 설정
    max_retries: int = 3
    retry_delay: float = 1.0

def load_config(
    config_file: str | None = None,
    env: str = "dev",
    **cli_overrides
) -> SyncConfig:
    """3단계 설정 로딩"""

    config_dict = {}

    # 1. 환경 변수 (가장 낮은 우선순위)
    env_mapping = {
        "MARIADB_HOST": "mariadb_host",
        "MARIADB_PASSWORD": "mariadb_password",
        "KEYCLOAK_URL": "keycloak_url",
        # ...
    }
    for env_var, config_key in env_mapping.items():
        if value := os.getenv(env_var):
            config_dict[config_key] = value

    # 2. YAML 파일
    if config_file and os.path.exists(config_file):
        with open(config_file) as f:
            yaml_config = yaml.safe_load(f)
            config_dict.update(yaml_config)

    # 3. CLI 인자 (가장 높은 우선순위)
    for key, value in cli_overrides.items():
        if value is not None:
            config_dict[key] = value

    config_dict["environment"] = env
    return SyncConfig(**config_dict)
```

---

## 복잡한 동기화 시나리오 처리

### 사용자 시나리오

| 시나리오 | 감지 방법 | 처리 |
|----------|-----------|------|
| **신규 입사** | MariaDB에만 존재 | Keycloak 계정 생성 + 조직/팀 멤버십 추가 |
| **퇴사** | MariaDB에서 사라짐 | 계정 비활성화 + 멤버십 제거 |
| **복직** | `enabled=false` 사용자 재등장 | 계정 재활성화 + 멤버십 복구 |
| **부서 이동** | `DEPT_CD` 변경 | 기존 팀 멤버십 제거 + 새 팀 추가 |
| **직급 변경** | 직급 코드 변경 | 팀 내 역할(Role) 업데이트 |

### 조직 시나리오

| 시나리오 | 감지 방법 | 처리 |
|----------|-----------|------|
| **부서 신설** | MariaDB에만 존재 | 팀 생성 + 상위 부서 연결 |
| **부서 폐지** | API에만 존재 | 재귀적 삭제 (리프 노드부터) |
| **부서 이동** | `UPPER_DEPT_CD` 변경 | 부모 팀 변경 |
| **부서명 변경** | 동일 `DEPT_CD`, 다른 이름 | 팀 이름 업데이트 |

### 구현 예시: 부서명 변경 감지

**문제**: 부서 코드(`DEPT_CD`)는 같은데 이름만 바뀐 경우를 어떻게 감지?

**해결**: 팀의 `description` 필드에 `[DEPT_CD]`를 저장하여 매칭

```python
# jobs/sync_user_info/seeder.py

def sync_teams(self, source_teams: list[Team], existing_teams: list[dict]) -> None:
    """팀 동기화"""

    # description에서 DEPT_CD 추출하여 매핑 생성
    existing_by_code = {}
    for team in existing_teams:
        # description 형식: "[DEPT_CD] 부서 설명"
        if match := re.match(r"\[(\w+)\]", team.get("description", "")):
            dept_code = match.group(1)
            existing_by_code[dept_code] = team

    for source_team in source_teams:
        if existing := existing_by_code.get(source_team.code):
            # 이름 변경 감지
            if existing["name"] != source_team.name:
                self.report.add_team_rename(
                    code=source_team.code,
                    old_name=existing["name"],
                    new_name=source_team.name
                )
                if not self.dry_run:
                    self.api_client.update_team(
                        team_id=existing["id"],
                        name=source_team.name
                    )
        else:
            # 새 팀 생성
            if not self.dry_run:
                self.api_client.create_team(
                    name=source_team.name,
                    description=f"[{source_team.code}] {source_team.description}",
                    parent_id=self._get_parent_id(source_team.parent_code)
                )
```

---

## 역할 기반 접근 제어 (RBAC) 자동 할당

직급 코드에 따른 자동 역할 할당:

```python
# jobs/sync_user_info/models.py
from dataclasses import dataclass
from enum import Enum

class MemberRole(Enum):
    ORG_ADMIN = "org_admin"      # 조직 관리자
    TEAM_ADMIN = "team_admin"    # 팀 관리자
    TEAM_MEMBER = "team_member"  # 일반 멤버

# 직급 코드 → 역할 매핑
ORG_ADMIN_GRADES = {"22_0N", "22_01"}  # 임원급
TEAM_ADMIN_GRADES = {"22_08", "22_13", "22_28", "22_79", "22_07"}  # 부서장급

def determine_role(grade_code: str, is_root_dept: bool) -> MemberRole:
    """직급과 부서 위치에 따른 역할 결정"""
    if grade_code in ORG_ADMIN_GRADES:
        return MemberRole.ORG_ADMIN
    elif grade_code in TEAM_ADMIN_GRADES:
        # 최상위 부서의 장은 조직 관리자
        return MemberRole.ORG_ADMIN if is_root_dept else MemberRole.TEAM_ADMIN
    else:
        return MemberRole.TEAM_MEMBER

@dataclass
class User:
    employee_id: str
    name: str
    email: str
    department_code: str
    grade_code: str

    @property
    def role(self) -> MemberRole:
        return determine_role(self.grade_code, is_root_dept=False)
```

---

## 에러 처리 및 재시도

### 커스텀 예외 계층

```python
# core/exceptions.py

class BatchPlatformError(Exception):
    """기본 예외"""
    pass

class ConfigurationError(BatchPlatformError):
    """설정 오류"""
    pass

class AuthenticationError(BatchPlatformError):
    """인증 실패 (401) - 재시도 가능"""
    pass

class AuthorizationError(BatchPlatformError):
    """권한 부족 (403) - 설정 문제"""
    pass

class ResourceNotFoundError(BatchPlatformError):
    """리소스 없음 (404) - 스킵 가능"""
    pass

class ConflictError(BatchPlatformError):
    """충돌 (409) - 이미 존재"""
    pass
```

### 재시도 큐

```python
# core/retry.py
from dataclasses import dataclass, field
from typing import Callable, Any
import time

@dataclass
class RetryItem:
    operation: Callable
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)
    attempts: int = 0
    last_error: Exception | None = None

class RetryQueue:
    """실패한 작업 재시도 관리"""

    def __init__(self, max_retries: int = 3, delay: float = 1.0):
        self.max_retries = max_retries
        self.delay = delay
        self.queue: list[RetryItem] = []
        self.permanent_failures: list[RetryItem] = []

    def add(self, operation: Callable, *args, **kwargs) -> None:
        """재시도 대상 추가"""
        self.queue.append(RetryItem(operation, args, kwargs))

    def process(self) -> tuple[int, int]:
        """큐의 모든 항목 처리"""
        success_count = 0

        while self.queue:
            item = self.queue.pop(0)
            item.attempts += 1

            try:
                item.operation(*item.args, **item.kwargs)
                success_count += 1

            except Exception as e:
                item.last_error = e

                if item.attempts < self.max_retries:
                    time.sleep(self.delay)
                    self.queue.append(item)  # 다시 큐에 추가
                else:
                    self.permanent_failures.append(item)

        return success_count, len(self.permanent_failures)
```

---

## 토큰 관리

자동 갱신이 포함된 토큰 관리:

```python
# infrastructure/clients/base.py
import time
import requests

class BaseClient:
    """API 클라이언트 기본 클래스"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._token: str | None = None
        self._token_expires_at: float = 0
        self.session = requests.Session()

    def get_token(self) -> str:
        """토큰 조회 (만료 60초 전 자동 갱신)"""
        if not self._token or time.time() > self._token_expires_at - 60:
            self._token, expires_in = self._authenticate()
            self._token_expires_at = time.time() + expires_in
        return self._token

    def _authenticate(self) -> tuple[str, int]:
        """인증 (서브클래스에서 구현)"""
        raise NotImplementedError

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        """인증 헤더가 포함된 HTTP 요청"""
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self.get_token()}"

        response = self.session.request(
            method,
            f"{self.base_url}{path}",
            headers=headers,
            **kwargs
        )

        if response.status_code == 401:
            # 토큰 만료 시 갱신 후 재시도
            self._token = None
            headers["Authorization"] = f"Bearer {self.get_token()}"
            response = self.session.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                **kwargs
            )

        return response
```

---

## CLI 인터페이스

```python
# cli.py
import click
from batch_platform.jobs.registry import JobRegistry
from batch_platform.infrastructure.config_loader import load_config

@click.group()
def cli():
    """Batch Platform CLI"""
    pass

@cli.command()
@click.argument("job_name")
@click.option("--env", default="dev", help="Environment (dev/prod)")
@click.option("--config", type=click.Path(), help="Config file path")
@click.option("--dry-run", is_flag=True, help="Preview without changes")
@click.option("--verbose", is_flag=True, help="Verbose logging")
def run(job_name: str, env: str, config: str, dry_run: bool, verbose: bool):
    """Execute a batch job"""
    config = load_config(config_file=config, env=env)
    job = JobRegistry.create(job_name, config)
    result = job.run(dry_run=dry_run)
    click.echo(f"Completed: {result}")

@cli.command()
@click.argument("job_name")
@click.option("--env", default="dev")
@click.option("--output", type=click.Choice(["json", "table"]), default="table")
@click.option("--save", type=click.Path(), help="Save to file")
def fetch(job_name: str, env: str, output: str, save: str):
    """Fetch data without syncing (preview)"""
    config = load_config(env=env)
    job = JobRegistry.create(job_name, config)
    data = job.fetch()
    # 출력 처리...

@cli.command()
def list_jobs():
    """List all registered jobs"""
    for name in JobRegistry.list_jobs():
        click.echo(f"  - {name}")

if __name__ == "__main__":
    cli()
```

**사용 예시**:

```bash
# 데이터 미리보기
batch-platform fetch sync-user-info --env dev --output json --save preview.json

# Dry-run 테스트
batch-platform run sync-user-info --env dev --dry-run --verbose

# 실제 실행
batch-platform run sync-user-info --env prod

# 등록된 Job 목록
batch-platform list-jobs
```

---

## Kubernetes 배포

### CronJob 설정

```yaml
# k8s/base/cronjobs/sync-user-info.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-user-info
  namespace: batch-platform
spec:
  schedule: "0 2 * * *"  # 매일 02:00
  concurrencyPolicy: Forbid  # 중복 실행 방지
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3

  jobTemplate:
    spec:
      activeDeadlineSeconds: 1800  # 30분 타임아웃
      backoffLimit: 2  # 실패 시 2회 재시도

      template:
        spec:
          restartPolicy: Never

          containers:
          - name: sync-user-info
            image: harbor.example.com/batch-platform:latest
            command: ["batch-platform", "run", "sync-user-info"]
            args: ["--env", "prod"]

            envFrom:
            - configMapRef:
                name: batch-platform-config
            - secretRef:
                name: batch-platform-secrets

            resources:
              requests:
                memory: "256Mi"
                cpu: "100m"
              limits:
                memory: "512Mi"
                cpu: "500m"
```

### Kustomize 오버레이

```yaml
# k8s/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: batch-platform

resources:
- ../../base

patches:
- patch: |-
    - op: replace
      path: /spec/schedule
      value: "0 2 * * *"
  target:
    kind: CronJob
    name: sync-user-info

configMapGenerator:
- name: batch-platform-config
  behavior: merge
  literals:
  - ENVIRONMENT=prod
  - LOG_LEVEL=INFO

secretGenerator:
- name: batch-platform-secrets
  behavior: merge
  files:
  - secrets/mariadb-password
  - secrets/keycloak-client-secret
```

### 수동 실행

```bash
# 즉시 실행
kubectl create job sync-now --from=cronjob/sync-user-info -n batch-platform

# 로그 확인
kubectl logs -f job/sync-now -n batch-platform
```

---

## 리포트 생성

```python
# core/report.py
from dataclasses import dataclass, field
from datetime import datetime
import json

@dataclass
class SyncReport:
    """동기화 결과 리포트"""

    environment: str = ""
    job_name: str = ""
    started_at: datetime = field(default_factory=datetime.now)
    finished_at: datetime | None = None

    # 카운터
    users_created: int = 0
    users_updated: int = 0
    users_disabled: int = 0
    users_enabled: int = 0
    teams_created: int = 0
    teams_updated: int = 0
    teams_renamed: int = 0
    memberships_added: int = 0
    memberships_updated: int = 0
    memberships_removed: int = 0

    # 상세 정보
    team_rename_details: list = field(default_factory=list)
    resigned_users: list = field(default_factory=list)
    failures: list = field(default_factory=list)

    def add_team_rename(self, code: str, old_name: str, new_name: str):
        self.teams_renamed += 1
        self.team_rename_details.append({
            "code": code,
            "old_name": old_name,
            "new_name": new_name
        })

    def to_json(self) -> str:
        self.finished_at = datetime.now()
        return json.dumps({
            "environment": self.environment,
            "job_name": self.job_name,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat(),
            "duration_seconds": (self.finished_at - self.started_at).total_seconds(),
            "users_created": self.users_created,
            "users_updated": self.users_updated,
            "users_disabled": self.users_disabled,
            "teams_renamed": self.teams_renamed,
            "team_rename_details": self.team_rename_details,
            "failures": self.failures,
        }, indent=2, ensure_ascii=False)
```

---

## 핵심 교훈

### 1. Template Method로 일관성 확보
- Job 실행 흐름이 항상 동일
- 새 Job 추가 시 핵심 로직에만 집중
- 테스트 및 디버깅 용이

### 2. Decorator 패턴으로 확장성
- `@JobRegistry.register` 한 줄로 등록 완료
- 런타임에 사용 가능한 Job 동적 조회
- 결합도 최소화

### 3. Dry-run 모드 필수
- 프로덕션 데이터 손상 방지
- 변경사항 미리 검토
- 신뢰도 높은 배포

### 4. 상세한 리포트의 가치
- 문제 발생 시 빠른 원인 파악
- 감사(Audit) 로그로 활용
- 운영팀과의 소통 도구

### 5. 증분 동기화로 효율성
- 변경된 데이터만 처리
- API 호출 최소화
- 대규모 조직에서 필수

---

## 참고

- [Click Documentation](https://click.palletsprojects.com/)
- [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Kustomize](https://kustomize.io/)
- Design Patterns: Template Method, Decorator, Factory
