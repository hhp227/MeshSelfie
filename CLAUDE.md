# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

MeshSelfie generates a photorealistic 3D head/neck GLB mesh from a user's selfie(s), not a stylized/character avatar. Product and architecture background lives in `docs/`:

- `docs/meshselfie-prd.md` — product requirements
- `docs/technical-design.md` — technical design derived from the PRD
- `docs/supabase-schema.md` — full DB schema, RLS policies, storage layout (source of truth for enums/tables — the actual migration is `supabase/migrations/001_initial_schema.sql`)
- `docs/storage-structure.md` — Storage bucket/path conventions
- `docs/hybrid-head-reconstruction.md` — design for the in-progress FLAME-based head reconstruction worker (the current priority; see `docs/project-status.md` for status/history)
- `docs/openapi.yaml` — API spec

Most prose docs and code comments/errors are in Korean; user-facing API error messages are Korean strings.

## Commands

```bash
npm run dev      # start Next dev server (may not bind to 3000 if already in use — check the printed Local: URL)
npm run build    # production build; treat this as the primary correctness check pre-commit
npm run lint     # eslint (eslint-config-next core-web-vitals + typescript)
```

There is no test suite/framework configured in this repo. Verification is `npm run build` + `npm run lint` plus manual E2E through the browser (see `docs/project-status.md` for the last manual E2E pass).

## Architecture

### Request flow: images → mesh generation → viewer

1. `POST /api/uploads/images` stores raw images in the private `avatars` Storage bucket and creates `source_images` rows (`front` required, `side`/`angle45` optional with `left`/`right` direction).
2. `POST /api/generate` (`app/api/generate/route.ts`) validates the selected source images, computes `quality_grade` from image count (`lib/uploads.ts::calculateQualityGrade`: 1→`B`, 2→`A`, 3→`A+`), creates `human_meshes` + `generation_jobs` rows, mints short-lived signed URLs for the input images, and calls the selected `AIProvider.createJob(...)`. Any provider failure marks the job/mesh `failed` with a public Korean message plus an internal error string (never expose provider internals to the client).
3. `GET /api/generation-jobs/[jobId]` polls the provider for status and, on completion, calls `lib/generation/finalize.ts::finalizeGeneration` to download the output GLB, validate the GLB v2 header/magic/length, enforce a 50MB cap, upload it to `models/{userId}/{meshId}/mesh.glb`, and flip `human_meshes`/`generation_jobs` to `completed`.
4. `/result/[id]` (`components/result/result-client.tsx`) polls mesh/job status and renders the completed GLB with `components/viewer/glb-viewer.tsx` (Three.js `GLTFLoader` + `OrbitControls`, bounding-box camera framing, explicit disposal of geometry/materials/textures/renderer on unmount).

There is no background worker/queue — polling from the client drives both provider status checks and finalization.

### AI provider abstraction (`lib/ai/`)

`lib/ai/interface.ts` defines the `AIProvider` contract (`supports`, `estimate`, `createJob`, `getJob`, `cancelJob`) and the `ProviderKey` union (`replicate`, `trellis`, `hunyuan3d`, `triposr`, `self_hosted`). `lib/ai/registry.ts` selects a provider at runtime:

- If `HEAD_RECONSTRUCTION_API_URL`/`HEAD_RECONSTRUCTION_API_KEY` are set → `HeadReconstructionProvider` (`self_hosted`, calls an external Python/GPU worker's `POST /v1/jobs`, `GET /v1/jobs/{id}`, `POST /v1/jobs/{id}/cancel`). This is the intended long-term path (FLAME-based face/neck fitting + hair shell) and takes priority when configured.
- Else if `REPLICATE_API_TOKEN` is set → a Replicate-backed provider chosen by `REPLICATE_MODEL_FAMILY`: `hunyuan3d` → `HunyuanMultiViewProvider` (`tencent/hunyuan3d-2mv`, per-view `front_image`/`left_image`/`right_image` inputs mapped from front/side/angle45 by direction); anything else (default) → `ReplicateHumanMeshProvider` (`firtoz/trellis`). Both versions are pinned in `lib/env.ts`. These are generic image-to-3D models kept for E2E/quality comparison — neither is a face-identity model; do not treat them as the quality baseline.
- Else → `StubHumanMeshProvider` for local dev without any provider credentials.

`getAIProviderForJob(modelName)` re-derives the correct provider instance for an existing job (used for cancellation) — keep it in sync with `getDefaultAIProvider()` when adding providers.

When adding a provider: implement `AIProvider`, register it in `registry.ts`, and add its output host(s) to the trusted-host check in `lib/generation/finalize.ts::assertTrustedOutputUrl` (only `*.replicate.delivery`, `HEAD_RECONSTRUCTION_OUTPUT_HOSTS`, and the worker's own API host are trusted; localhost/127.0.0.1 are allowed over plain HTTP for local dev only).

### Auth model

Auth is Supabase email/password, but **not** cookie/SSR session based — there is no `@supabase/ssr` integration. The browser client (`lib/supabase/browser.ts`) holds the session in memory/localStorage; every authenticated fetch sends `Authorization: Bearer <access_token>` (`lib/supabase/session.ts::getAccessTokenWithRetry` handles the race where the session isn't hydrated yet on first render). Route handlers verify that token via `lib/auth.ts::getAuthenticatedUser`, which uses the **admin** (service-role) Supabase client to call `supabase.auth.getUser(token)` — route handlers otherwise operate with the service role, not a per-request RLS-scoped client, so ownership checks (`.eq("user_id", user.id)`) in query filters are load-bearing, not just an optimization. `lib/admin.ts::getAuthenticatedAdmin` layers a `profiles.role === "admin"` check on top.

Client-side route protection is `components/auth/authenticated-page.tsx`, which redirects to `/login?next=<path>` if no session is found.

### Supabase clients

- `lib/supabase/browser.ts` — anon-key client for client components, memoized on `globalThis` to avoid recreating across HMR/renders.
- `lib/supabase/admin.ts` — service-role client, server-only, used by every route handler (see Auth model above — this is also the query client, not just for token verification).
- Never use the admin client in client components; never import `SUPABASE_SERVICE_ROLE_KEY` outside `lib/supabase/admin.ts`.

### Storage conventions

Single private bucket `avatars`. DB rows store `bucket` + `object_path`, never a public URL — signed URLs are always minted on demand server-side (short TTLs: 10 min for provider input images, 5 min for viewer/download). Fixed path layout:

```text
avatars/images/{user_id}/uploads/{upload_group_id}/{front|side|angle45}.{jpg|png}
avatars/models/{user_id}/{human_mesh_id}/mesh.glb
avatars/models/{user_id}/{human_mesh_id}/admin_uploaded.{glb|gltf}
avatars/thumbnails/{user_id}/{human_mesh_id}/{thumbnail|preview}.jpg
avatars/admin/sample_models/{sample_id}/mesh.{glb|gltf}
```

### Mesh/job lifecycle

`human_meshes.status` and `generation_jobs.status` progress through `queued → validating → preprocessing → generating → postprocessing → thumbnailing → completed` (or `failed`/`canceled`/`deleted`). Deleting a mesh (`DELETE /api/meshes/[meshId]`) is a soft delete (`soft_deleted_at`, `purge_after` = +30 days, `status='deleted'`) that also cancels any in-flight `generation_jobs` row and best-effort cancels the provider job; provider-cancel failure must not block the user-facing delete. There's no purge job implemented yet for rows past `purge_after`.

### Route handler conventions

- Dynamic route params are async: `context.params` is a `Promise<{...}>`, always `await`ed (Next.js 16 App Router convention — see the `AGENTS.md` note about breaking changes vs. training data before touching routing/data-fetching APIs).
- Errors return `{ error: { code, message } }` via `lib/api.ts::jsonError`; `code` is a stable machine-readable string, `message` is the Korean string shown to users. Follow this shape for any new endpoint.
- Success bodies are `{ data: {...} }`.
