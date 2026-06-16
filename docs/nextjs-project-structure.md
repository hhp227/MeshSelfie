# MeshSelfie Next.js 프로젝트 구조

## 1. 원칙

| 원칙 | 설명 |
| --- | --- |
| App Router | 현재 저장소의 Next.js App Router를 기준으로 한다. |
| Route Handler | API는 `app/api/**/route.ts`에 둔다. |
| Supabase 분리 | browser/admin client를 분리하고 service role은 서버에서만 사용한다. |
| 기능별 컴포넌트 | `components/auth`, `components/dashboard`, `components/upload`, `components/viewer`로 분리한다. |
| Provider 추상화 | AI Provider 관련 코드는 `lib/ai` 아래 둔다. |

## 2. 목표 구조

```text
app/
├── page.tsx
├── login/page.tsx
├── signup/page.tsx
├── dashboard/page.tsx
├── profile/page.tsx
├── upload/page.tsx
├── meshes/[meshId]/page.tsx
├── admin/page.tsx
└── api/
    ├── profile/route.ts
    ├── uploads/images/route.ts
    ├── generate/route.ts
    ├── generation-jobs/[jobId]/route.ts
    ├── meshes/route.ts
    ├── meshes/[meshId]/route.ts
    ├── meshes/[meshId]/download/route.ts
    ├── gallery/route.ts
    ├── webhooks/ai-provider/route.ts
    └── admin/
        ├── models/route.ts
        ├── models/upload/route.ts
        ├── models/[meshId]/route.ts
        └── metrics/route.ts
components/
├── auth/
├── dashboard/
├── upload/
├── viewer/
└── ui/
lib/
├── supabase/
│   ├── browser.ts
│   └── admin.ts
├── ai/
│   ├── interface.ts
│   ├── registry.ts
│   └── providers/
├── env.ts
└── api.ts
types/
├── database.ts
└── api.ts
```

## 3. Phase 1 구현 대상

| 파일 | 목적 |
| --- | --- |
| `.env.local.example` | Supabase 환경 변수 안내 |
| `lib/env.ts` | 환경 변수 접근 유틸 |
| `lib/supabase/browser.ts` | 브라우저 Supabase client |
| `lib/supabase/admin.ts` | service role Supabase client |
| `app/api/profile/route.ts` | Supabase JWT 기반 내 profile 조회 |
| `app/login/page.tsx` | 로그인 UI |
| `app/signup/page.tsx` | 회원가입 UI |
| `app/dashboard/page.tsx` | 로그인 후 기본 대시보드 |
| `app/profile/page.tsx` | 내 profile 표시 |
