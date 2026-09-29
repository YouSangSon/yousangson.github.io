// Reader-facing topics; each published post belongs to exactly one topic.
export const topics = [
  {
    slug: 'research-reviews',
    startWith: 'parnas-modularity-hidden-decisions',
    title: '논문·프로젝트 리뷰',
    description: '컴퓨터 과학의 고전과 최근 AI 연구를 원리, 실험 근거, 적용 한계로 읽는 글.',
    posts: [
      'parnas-modularity-hidden-decisions',
      'flashattention-io-to-fp4-bottlenecks',
      'agent-harness-design-evidence',
      'ai-observability-signals-and-causes',
      'awesome-ai-engineering-evaluation-first',
    ],
  },
  {
    slug: 'ai-search',
    startWith: 'immutable-versions-through-rag-pipeline',
    title: 'AI·RAG·검색',
    description: '문서 파싱부터 벡터 저장과 검색까지, 답변의 근거를 다루는 방법.',
    posts: [
      'unified-search-security-implementation',
      'vector-db-document-cleanup-strategy',
      'immutable-versions-through-rag-pipeline',
      'parser-cancellation-resource-ownership',
    ],
  },
  {
    slug: 'concurrency-memory',
    startWith: 'thread',
    title: '동시성·메모리',
    description: '고루틴과 스레드의 실행 수명, 취소, 메모리 비용을 이해하는 글.',
    posts: [
      'thread',
      'goroutine',
      'cpu-100-percent-goroutine-leak-fix',
      'cancellation-does-not-kill-running-threads',
      'virtual-threads-in-kotlin',
      'cloudflare-dns-cache-memory-optimization',
    ],
  },
  {
    slug: 'messaging-locks',
    startWith: 'kafka-vs-redis-realtime-messaging',
    title: '메시징·분산 락',
    description: '메시지 순서와 재시도, 락의 소유권을 분산 환경에서 지키는 방법.',
    posts: [
      'kafka-vs-redis-realtime-messaging',
      'distributed-lock-ttl-auto-renewal',
      'redis-lock-queue-race-condition-fix',
      'kafka-poison-partition-and-commit-frontier',
    ],
  },
  {
    slug: 'files-data',
    startWith: 'file-upload-concurrency-control',
    title: '파일·데이터',
    description: '업로드·삭제·복구와 데이터 일관성, 실행 책임의 경계를 다루는 글.',
    posts: [
      'membership-projection-atomic-commit',
      'moving-cleanup-execution-ownership',
      'file-upload-concurrency-control',
      'restore-preflight-and-toctou-boundary',
      'upload-memory-admission-before-body',
    ],
  },
  {
    slug: 'web-frontend',
    startWith: 'null-array-initialization-api-consistency',
    title: '웹·프론트엔드',
    description: '비동기 응답을 현재 화면에 적용하는 조건과 API 표현을 다루는 글.',
    posts: [
      'null-array-initialization-api-consistency',
      'frontend-async-result-scope-and-generation',
    ],
  },
  {
    slug: 'infrastructure',
    startWith: 'kubernetes-architecture',
    title: 'Kubernetes·운영',
    description: '컨테이너 배포, 클러스터 구성과 장애 진단을 다루는 글.',
    posts: [
      'kubernetes-architecture',
      'deployment-vs-statefulset',
      'master-worker-nodes',
      'ingress-vs-loadbalancer',
      'gitlab-ci-kubernetes-networkpolicy-rbac-debugging',
      'jib',
      'diagnostic-capture-status-and-trusted-identity',
    ],
  },
]

export function getPostTopic(slug: string) {
  return topics.find(topic => topic.posts.includes(slug))
}
