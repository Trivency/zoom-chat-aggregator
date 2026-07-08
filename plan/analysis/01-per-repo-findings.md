# 01 — Per-Repo Findings (Phase 1 Deep Reads)

> Produced 2026-07-08 by the AV-suite architecture analysis session. Each section is a
> read-only deep read of one repo at its then-current HEAD (shallow clones under /workspace/,
> zoom-chat-aggregator at its local checkout). All claims carry file:line citations into the
> repo they describe. Low-confidence items are flagged inline by each report.
>
> Repos with no deep read: **qnet-dist-** (a single README; installer/release distribution shell for QNet — no source to analyze) and **agency-agents** (public fork of msitarzewski/agency-agents, a community AI-agent roster used for team process, not a product).

---

I'll start by exploring the repository structure and reading key configuration files in parallel.
I'll now read the core config files and explore the source structure in parallel.
Now let me read the core server files and the data layer in parallel.
Now let me read the transport/realtime, webhook, socket handler, and auth files in parallel.
Now let me read the Recall manager, key services, and auth files in parallel.
Now let me read the auth layer, AI services, and remaining service files in parallel.
Now let me read the AI services, tiers, and grep for Trivency/other-app references, plus check docs.
Let me check git remote, CI workflow, env example, docs, TODOs, and remaining services in parallel.
Let me enumerate all route endpoints and socket events, and read the docs headers plus remaining key files.
Let me read the remaining services, ROADMAP, launcher, and tests in a final batch.
Let me quickly check the tests, ROADMAP parked/pending, and client structure.
# Zoom Chat Aggregator — Architecture Deep-Read

Repo: `/home/user/zoom-chat-aggregator` · git remote `Trivency/zoom-chat-aggregator` (proxied) · latest commit `e80509a`. Single Node process (Express + Socket.IO) serving a React SPA, deployed on Railway, fronted by a thin macOS Swift/WKWebView launcher. Docs are unusually rich and current (`docs/ARCHITECTURE.md`, `docs/backend/`).

## 1. Languages, frameworks, runtimes & versions

- **Backend: JavaScript (ES modules), not TypeScript.** `package.json:5` `"type":"module"`; entry `src/server/index.js` (`package.json:6`). Engine `node >=18.0.0` (`package.json:30-32`); CI runs Node 22 (`.github/workflows/ci.yml`).
- **No tsconfig anywhere** — plain JS backend and JSX client. `@types/react` present in client dev deps but only for editor tooling; client is JSX (`client/package.json:18-20`).
- **Backend deps (`package.json:16-29`):** `@anthropic-ai/sdk ^0.70.0`, `bcryptjs ^3.0.3`, `cookie ^0.7.2`, `cookie-parser ^1.4.7`, `cors ^2.8.5`, `dotenv ^16.4.5`, `express ^4.21.0`, `pg ^8.21.0`, `resend ^6.12.4`, `socket.io ^4.7.5`, `stripe ^22.2.0`, `uuid ^10.0.0`. Notably **no `@zoom/rtms`** — RTMS is stubbed/mocked (see §5).
- **Client deps (`client/package.json`):** `react ^18.3.1`, `react-dom ^18.3.1`, `react-router-dom ^7.13.0`, `socket.io-client ^4.7.5`, `html-to-image ^1.11.13` (PNG quote-card export). Dev: `vite ^7.3.1`, `tailwindcss ^3.4.4`, `postcss ^8.4.38`, `autoprefixer ^10.4.19`, `@vitejs/plugin-react ^4.3.1`.
- **Launcher:** Swift, WKWebView, targets macOS 13+, universal (arm64+x86_64) binary, ad-hoc signed (`launcher-v2/build.sh`, `launcher-v2/Sources/main.swift`).
- **Stripe API version pinned** `2025-04-30.basil` (`src/services/StripeService.js:24`). AI model pinned `claude-haiku-4-5` (`src/services/AIClient.js:34`).

## 2. Build tooling, package manager, layout

- **npm** (root `package-lock.json` + `client/package-lock.json`). Two separate `package.json` files — a **two-package layout, not a formal monorepo** (no workspaces field). Root `postinstall` builds the client (`package.json:14`); `build` does `cd client && npm install --include=dev && npm run build` (`package.json:13`).
- Scripts: `start` (`node src/server/index.js`), `dev` (`node --watch ...`), `test` (`node --test test/*.test.mjs`), `zoom:panelist-test` (`package.json:7-14`).
- **Deploy:** Railway, NIXPACKS builder, `startCommand: npm start`, restart-on-failure max 10 (`railway.json`). `Procfile`: `web: npm start`. Production serves `client/dist` statically + SPA fallback (`src/server/index.js:830-835`).
- Client build: Vite + Tailwind + PostCSS (`docs/backend/build-tooling.md`). CI has two jobs (backend syntax-check via `node --check` + `npm test`; client production build), on push to main + all PRs (`.github/workflows/ci.yml`).
- `START-SERVER.command` is a double-click macOS bootstrap script for local dev.

## 3. Data layer

- **PostgreSQL via `pg` Pool** — sole DB module `src/db/index.js`. Pool `max: 25` (bumped for high-volume rooms, `src/db/index.js:384`), conditional TLS for Railway public proxy (`:380`), 5-retry connect loop (`:394`).
- **Graceful no-DB fallback:** if `DATABASE_URL` unset, `initDatabase` returns `null` and the app runs in-memory only (`src/db/index.js:371-374`, `src/server/index.js:866`). Many handlers guard on `rosterManager.isAvailable()` / `if (this.db)`.
- **Schema location: inlined SQL constant** `SCHEMA_SQL` (`src/db/index.js:18-346`), applied on every boot via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. **Migrations strategy: none/framework-free** — idempotent DDL on boot is deliberate (`src/db/index.js:5-14`). One data-migration constant `MIGRATION_SQL` (`:351-361`) seeds the `ryte-org` organization and backfills `org_id` from legacy `tenant_id='ryteproductions'`.
- **Tables:** `sessions`, `messages`, `bot_usage`, `sent_messages`, `rosters`, `roster_entries`, `organizations`, `users`, `auth_sessions`, `email_tokens`, `invitations`, `presenter_notes`, `org_zoom_credentials`, `ai_faqs`, `ai_faq_events`. Dual tenancy columns: legacy `tenant_id` (default `'ryteproductions'`) coexists with newer `org_id` FK — Phase 7+ plans to drop `tenant_id` (`src/db/index.js:194-195`).
- **In-memory state (single-replica assumption):** per-org ring buffer of last 500 messages (`MessageAggregator.messages`, `src/services/MessageAggregator.js:31`); Recall bot routing maps `botsByMeeting`/`meetingsByBot` (`src/recall/RecallBotManager.js:158-159`); per-org moderation state Map (`src/server/socketHandler.js:21`); per-org runtime container `OrgState.byOrg` with **no eviction** (`src/services/OrgState.js:16-17`); Zoom S2S token cache (`src/services/ZoomApiClient.js:34`). Routing maps are **reseeded from open `bot_usage` rows at boot** to survive restarts (`RecallBotManager.reseedFromDatabase`, `:183`).

## 4. API surface & external APIs

**Public REST (`src/server/index.js`):** `GET /health` (:110), `GET /api/status` (:114). 
**Webhooks (`src/routes/webhook.js`):** `POST /webhook/zoom` (:74, legacy RTMS/mock path), `POST /webhook/recall/chat` (:193), `POST /webhook/recall/status` (:359), `POST /webhook/stripe` (:231).
**Auth (`src/routes/auth.js`, mounted `/api/auth`):** `POST /signup` (:29), `/login` (:103), `/logout` (:137), `GET /me` (:147), `POST /verify-email` (:153), `/resend-verification` (:163), `/password-reset/request` (:173), `/password-reset/confirm` (:189).
**Billing (`src/routes/billing.js`, `/api/billing`):** `GET /tiers` (:22), `POST /checkout` (:35), `POST /portal` (:66).
**Invitations (`src/routes/invitations.js`, `/api/invitations`):** admin `GET /` (:29), `POST /` (:54), `DELETE /:id` (:104), `DELETE /members/:userId` (:120), `PATCH /members/:userId` (:139); public `GET /accept/:token` (:161), `POST /accept` (:190).
**AI (`src/routes/ai.js`, `/api/ai`):** `GET /state` (:40), `GET/PATCH /settings` (:46/:52 admin), `GET/POST /faqs` (:59/:65), `POST /faqs/:id/approve|pause|resume` (:73/:91/:99), `PATCH/DELETE /faqs/:id` (:82/:107), `GET /faqs/:id/events` (:115).
**Session history (`src/routes/sessionHistory.js`, `/api/sessions`):** `GET /:id/stats` (:33), `GET /:id/messages` (:123).
**Presenter notes (`src/routes/presenterNotes.js`, `/api/presenter-notes`):** `GET /` (:26), `POST /` (:52), `DELETE /:id` (:85).
**Core (auth-gated, in `index.js`):** meetings `GET /api/meetings` (:176), `POST /connect` (:193), `POST /:id/disconnect` (:254); sessions `GET/PATCH /api/sessions/current` (:274/:279), `GET /api/sessions` (:294), `POST /api/sessions/end` (:305); saved `POST/DELETE /api/messages/:id/save` (:319/:333), `GET /api/saved` (:346), `GET /api/saved/export.csv` (:358); outbound `POST /api/meetings/:meetingId/reply` (:386), `POST /api/broadcast` (:419); rosters full CRUD + `POST /api/rosters/:id/deploy` (:565) + `/register-panelists` (:713); Zoom creds `GET/PUT/DELETE /api/zoom/credentials` (:650/:671/:682) + `POST /test` (:696); org settings `GET/PATCH /api/org/settings` (:788/:806).

**Socket.IO events** (see §5). 

**External APIs consumed:**
- **Recall.ai** (raw `fetch`, API v1, region us-east-1): `POST /bot/` dispatch (`RecallBotManager.js:336`), `POST /bot/{id}/leave_call/` (:419), `POST /bot/{id}/send_chat_message/` (:702). Inbound realtime `participant_events.chat_message` + workspace `bot.*` status webhooks.
- **Zoom REST v2** (S2S OAuth, no SDK): token mint `zoom.us/oauth/token` (`ZoomApiClient.js:24`), `/webinars/{id}/panelists` GET/POST/DELETE (:175/:188/:192). Zoom Event Webhooks + HMAC URL-validation (`webhook.js:48-69`).
- **Stripe** (`stripe` SDK): customers, checkout sessions, billing portal, subscription retrieve, webhook `constructEvent` (`StripeService.js`, `webhook.js:231-357`).
- **Anthropic** (`@anthropic-ai/sdk`): Messages API, forced tool-use classifier, prompt caching (`AIClient.js:124-153`).
- **Resend**: transactional email, console-fallback when unconfigured (`src/auth/email.js:13-32`).

## 5. Real-time / transport

- **Socket.IO shares the Express HTTP server** (`src/server/index.js:34-44`); CORS credentials, prod origin `true`.
- **Auth on handshake:** `io.use` parses the `zoomchat_session` cookie and validates it against DB, rejecting unauthenticated sockets (`src/server/socketHandler.js:35-51`).
- **Org isolation via rooms:** each socket joins `org:<id>`; per-meeting subscriptions namespaced `org:<id>:room:<meetingId>` (`socketHandler.js:55,106-111`).
- **Server→client emits:** `initialState`, `ai:state`, `presenterNotesInitial`, `history`, `rooms`, `stats`, `moderationState`/`moderationUpdate`, `serverError` (socketHandler); `newMessageBatch` + per-room `roomMessageBatch` (batched every 100ms, `MessageAggregator.js:49-64`); `messageSaved`/`messageUnsaved`, `roomAdded`/`roomRemoved`, `messagesCleared`; `meetingConnected`/`meetingDisconnected`; `presenterNote`/`presenterNoteDismissed`; `trialUpdate`/`trialWarning`/`trialExhausted` (`TrialEnforcer.js:93-169`); `ai:faqPending`/`ai:faqUpdated`/`ai:autoReplied`/`ai:feedbackAlert`/`ai:faqDismissed`/`ai:settings` (AIResponder).
- **Client→server:** `getHistory`, `getRooms`, `getStats`, `subscribeToRoom`/`unsubscribeFromRoom`, `getModerationState`/`moderationUpdate`.
- **Zoom RTMS: mocked, inactive.** `RTMSManager.useMockMode = true` hardcoded (`src/rtms/RTMSManager.js:13`); `createRTMSClient` throws "RTMS client not implemented - requires @zoom/rtms package" (:95); `startMockMessages` emits fake demo chat on a 3–8s interval (:128-190). Docs record RTMS was **abandoned May 2026** in favor of the Recall.ai participant-bot path (`docs/RTMS-INTEGRATION.md` header, `docs/CHAT-CAPTURE-ARCHITECTURE.md`). The `/webhook/zoom` route + RTMSManager are kept as a dormant fallback (`src/server/index.js:49,53`). Recall path is selected iff `RECALL_API_KEY` + `PUBLIC_WEBHOOK_URL` set (`RecallBotManager.isConfigured`, `index.js:59`).
- **Recall inbound webhook verification:** Svix-style HMAC over `id.timestamp.rawBody`, 300s tolerance (`src/recall/verifyRecallWebhook.js`); enforced in production, warn-and-accept in dev (`webhook.js:169-185`).

## 6. Auth model

- **Multi-tenant by `organization`.** Every user belongs to exactly one org (`users.org_id` FK, `src/db/index.js:143-152`); all runtime state and sockets keyed by `org_id`. Roles: `admin` | `operator` (default). Plan tiers on org: `trial` (default, 30min/1 bot), `solo`/`pro`/`studio` (paid), `admin` (RYTE bypass, `ryte-org`), `canceled`.
- **Hand-rolled server-side sessions (Lucia-style, no library).** Session id = random 256-bit hex in an **HTTP-only cookie** `zoomchat_session` (`src/auth/sessions.js:13,104-112`); source of truth is the `auth_sessions` row. 30-day sliding expiry (`:14-17,67-72`). Cookie `secure` only in production, `sameSite: 'lax'` (`:105-111`).
- **Passwords:** `bcryptjs`, 12 salt rounds, 8-char minimum (`src/auth/passwords.js:6,13`). Pure-JS bcrypt chosen to avoid native builds on Railway (`:3-5`).
- **Middleware (`src/auth/middleware.js`):** `attachUser` (soft, sets `req.user`/`req.org`), `requireAuth` (401), `requireAdmin` (403). Global gate `app.use('/api', requireAuth)` sits below public auth/billing/invitation mounts (`index.js:155`).
- **One-shot email tokens** for verify/reset, 24h TTL, single-use via atomic `UPDATE ... SET used_at` (`src/auth/tokens.js`). Invitations 7-day TTL.
- **Zoom S2S client secrets encrypted at rest** with AES-256-GCM via `CRED_ENCRYPTION_KEY` (`src/services/secretBox.js`); never returned in plaintext.
- ⚠️ **Low-confidence flag:** `.env.example` documents a `SESSION_SECRET` ("must be set in production…defaults to a dev-only constant"), but `src/auth/sessions.js` uses random session ids and does **not** read/sign with `SESSION_SECRET` — the env var appears unused/vestigial. Verify before relying on it.

## 7. State of the code: prototype vs production-hardened

Mixed, but leaning **production-hardened for the Recall path**; the RTMS path is vestigial prototype.
- **Hardened signals:** HMAC verification on all three inbound webhooks (Zoom, Recall, Stripe) with `timingSafeEqual` and length guards (`webhook.js:38-42`); production refuses unsigned Recall webhooks (`webhook.js:179-182`); DB connect retries; encrypted secrets; per-bot token-bucket rate limiting (20/min, `RecallBotManager.js:161-163,721`); echo dedup (`MessageAggregator.js:161-175`); boot reseed of routing maps; batched socket emits for high-volume rooms; org isolation enforced on every DB query (`org_id = $N` guards); AI layer is fail-safe (empty results → no action, `AIClient.js:162-167`) and wrapped so it "must never break the capture path" (`MessageAggregator.js:214-220`).
- **Tests:** 19 tests across 3 files (`test/AIResponder.test.mjs` 7, `test/RecallBotManager.test.mjs` 5, `test/notetakerFilter.test.mjs` 7), using node's built-in runner with hand-rolled DB stubs. Coverage is concentrated on AI logic, reseed, notetaker filter — **no HTTP route / auth / Stripe / Zoom integration tests.**
- **Prototype/rough edges:** `RTMSManager` mock mode hardcoded on (`:13`), real client throws not-implemented (`:95`); `src/routes/webhook.js:89` reads `req.app.get('messageAggregator')` which is **never set** in the current `index.js` (the RTMS webhook path would NPE if hit — dead code confirming RTMS is abandoned). Console-log-heavy (structured logging absent). `OrgState` has no eviction (`:16-17`). Single-replica assumption is the stated #1 operational gotcha (`docs/ARCHITECTURE.md §0.5`).
- **Hardcoded values:** README shows a hardcoded ngrok webhook URL `https://unfilamentous-meteorographic-caren.ngrok-free.dev/webhook/zoom` (`README.md`, "Webhook Setup"); launcher hardcodes the Railway URL `https://web-production-92d23.up.railway.app` (`launcher-v2/Sources/main.swift:8`) with a TODO to switch to `zoomchat.ryteproductions.com`; default email sender `noreply@zoomchat.ryteproductions.com` (`src/auth/email.js:14`); default `us-east-1.recall.ai` region (`RecallBotManager.js:144`); default room color `#ef4444` throughout. `tenant_id` default `'ryteproductions'` baked into schema. Very few literal `TODO/FIXME` markers — most "not done" is tracked in ROADMAP instead.

## 8. Docs inventory

Extensive and current (dates run May–July 2026; today is 2026-07-08). 
- **`docs/ARCHITECTURE.md`** — master spec; tech-stack table, end-to-end data flows, contracts, "single process/single replica" gotcha called out as #1 risk. Current.
- **`docs/backend/README.md`** + 13 per-system references: `recall.md`, `ai.md`, `zoom.md`, `railway.md`, `postgres.md`, `stripe.md`, `resend.md`, `socketio.md`, `express.md`, `auth.md`, `react-frontend.md`, `build-tooling.md`, `mac-launcher.md`. Each pins versions and (per README) carries `file:line` risk registers. Current and detailed.
- **`docs/CHAT-CAPTURE-ARCHITECTURE.md`** — decision record (May 2026): the RTMS→Recall/Meeting-SDK pivot, explains the mock-mode history and cross-org constraint (external client accounts like `@ugenticai.com`).
- **`docs/RTMS-INTEGRATION.md`** — marked **ABANDONED May 2026**, kept for reference.
- **`docs/MONETIZATION-PLAN.md`** — pricing/tier design (Free trial/Solo/Pro/Studio), Recall cost ~$0.50/bot-hr, margin tables; drove the billing schema. Mostly shipped.
- **`docs/USER-GUIDE.md` (+ .pdf)**, `docs/CHAT-CAPTURE-ARCHITECTURE.md`.
- **`ROADMAP.md`** (18KB, current to July 2026): large "Shipped" section (Recall capture, Postgres, sessions, outbound reply/broadcast, saved+PNG export, rosters, Mac launcher, presenter display, Phases 1–6 SaaS auth/org-isolation/trial/Stripe/team/domain, scheduled bots, registration-URL support, panelist auto-registration, AI auto-responder Phase A, session history). **Parked:** rotate `RECALL_WEBHOOK_SECRET`, Apple Developer signing. **Future ideas:** "Better Tiles" (would revive RTMS), list virtualization, multi-org membership per user, per-room moderation, Railway migration.
- **`launcher-v2/` purpose:** builds a ~5MB native macOS `.app` (WKWebView thin client) that loads the Railway-hosted React UI, adds a borderless presenter pop-out on a secondary display and ⌘R reload; bundles **no** Node/source/secrets (`launcher-v2/build.sh` header). Supersedes an older AppleScript launcher (gitignored `launcher/`, `.gitignore`).

## 9. References to other Trivency apps / shared contracts

- **No code or doc references** to `webinar-stack`, `ShowEngine`, `QNet`, or "Trivency" as an app/integration (grep returned zero matches across the repo).
- The only Trivency linkage is the **git remote org** (`Trivency/zoom-chat-aggregator`) and PR branches (`Trivency/claude/...`). The product/brand is consistently **"RYTE Productions" / "ZoomChat"** in code and docs, not Trivency.
- External-integration hooks are limited to the third-party SaaS in §4 (Recall, Zoom, Stripe, Resend, Anthropic). The only cross-app "contract" surface is the docs' explicitly stated goal of being liftable into another platform (`docs/ARCHITECTURE.md` purpose header), but no concrete shared schema/API with a sibling Trivency repo exists here.
- ⚠️ **Low-confidence:** if integration with webinar-stack/ShowEngine/QNet is expected, it is **not present in this repo** — it would live entirely in those other repos or in infra not checked in here.

---

Research complete. Here is the dense architecture report.

---

# Webinar AI Studio (`/workspace/webinar-stack`) — Architecture Deep-Read

Working title "Webinar AI Studio" (`README.md:1`); a remote-operated broadcast/webinar studio on Zoom, run headless on a single Mac Studio and operated over the network (`CLAUDE.md:5`, `plan/00-MASTER-PLAN.md:8`). Note on naming: **no string "Trivency" appears anywhere in this repo** — the org/brand throughout is **"RYTE" / GitHub `rytepro1`** (`plan/01-ARCHITECTURE.md:9`, `plan/00-MASTER-PLAN.md:33,71`). Treat "Trivency" as an external framing not reflected in-repo (low confidence it maps to anything here beyond RYTE).

State of the codebase overall: **Phase-0 foundation is real and runs; everything AV/native is planned or a throwaway spike.** The four Node/TS workspaces (contracts, bus, cloud, console) contain working code; the `engine/` C++ side is a single build-ready-but-never-run macOS spike plus empty `.gitkeep` stubs.

---

## 1. Languages / frameworks / runtimes + versions per workspace

Root: npm workspaces monorepo `webinar-stack` v0.0.0, `private` (`package.json:1-8`). **Node `>=22`** engine constraint (`package.json:12`), pinned `.nvmrc` = `22` (`.nvmrc:1`). Shared `tsconfig.base.json`: target ES2022, module ESNext, moduleResolution Bundler, `strict:true`, `declaration:true`, lib ES2022 (`tsconfig.base.json:1-14`). TypeScript `^5.6.3` in every TS workspace.

- **contracts** (`@webinar-stack/contracts` v0.0.0): pure TS, ESM (`"type":"module"`), builds with `tsc` → `dist/`. Sole runtime dep **zod `^4.4.3`** (`contracts/package.json`). Emits declarations; `main: dist/index.js`. `CONTRACTS_VERSION = "0.1.0"` (`contracts/src/index.ts`).
- **bus** (`@webinar-stack/bus` v0.1.0): Node/TS ESM. Deps: `@webinar-stack/contracts:*` + **`ws ^8.18.0`**; dev `@types/node ^22.7.0`, `@types/ws ^8.5.12` (`bus/package.json`). tsconfig adds `types:["node"]`.
- **cloud** (`@webinar-stack/cloud` v0.1.0): Node/TS. Deps: **`express ^4.21.2`**, **`better-sqlite3 ^12.4.1`**, **`bcryptjs ^3.0.2`** (`cloud/package.json`). Uses global `fetch` for Zoom REST. tsconfig overrides to `module: NodeNext`, `moduleResolution: NodeNext` (`cloud/tsconfig.json`) — differs from base Bundler.
- **console** (`@webinar-stack/console` v0.1.0): **React `^19.1.0`** + react-dom 19, **Vite `^6.3.5`**, **Tailwind v4 `^4.1.8`** via `@tailwindcss/vite`, `@vitejs/plugin-react ^4.5.0` (`console/package.json`). tsconfig adds DOM libs, `jsx: react-jsx`, `noEmit`. Imports `@webinar-stack/contracts` (zod runs in-browser).
- **engine** (C++, not an npm workspace): CMake ≥3.25, `project(... LANGUAGES CXX OBJCXX)`, **`CMAKE_CXX_STANDARD 20`** (`engine/CMakeLists.txt:2-6`). Apple-only; adds `spike-raw-capture` subdir only `if(APPLE)` (`engine/CMakeLists.txt:14-19`). CONVENTIONS says "C++17/20 core" (`plan/CONVENTIONS.md:8`) — slight doc/CMake drift (CMake pins 20).

**Engine libraries** (`engine/spike-raw-capture/CMakeLists.txt`): Apple frameworks only, nothing vendored — **Cocoa, Metal, MetalKit, IOSurface, CoreVideo, QuartzCore** (lines 30-33). Metal shaders compiled `xcrun metal -c` → `.air` → `metallib` → bundled as `default.metallib` resource (lines 36-52). **Zoom Meeting SDK** linked *optionally* from `ZOOM_SDK_ROOT` env/cache path via `-framework ZoomSDK`, embedded+signed into the `.app`, guarded by `SPIKE_WITH_ZOOM_SDK` compile def (lines 55-83); **never vendored** (`.gitignore` blocks `ZoomSDK.framework/`). **No FFmpeg, no AVFoundation, no NDI, no Dante** appear in any engine build file — those are named only in plan docs as future planes (`plan/01-ARCHITECTURE.md:18,26`). The `engine/{capture,compositor,switcher,egress,media,bridge}` subdirs contain **only `.gitkeep`** (empty) except `bridge/BusStubPublisher.swift`. Sources present are all in `spike-raw-capture/src/` (Obj-C++ `.mm`), ARC-enabled (`-fobjc-arc`). Bundle min macOS 13.0 (`Info.plist.in`).

## 2. Build tooling / package manager / monorepo layout

Package manager **npm workspaces** (`package.json:4-9`, `package-lock.json` committed, 134 KB). Root scripts: `build` = `npm run build --workspaces --if-present`; `typecheck` builds contracts first then per-workspace (`package.json:15-18` — this order was a deliberate CI fix, `PROGRESS.md:49`); `lint` is a stub echo. Build order per README: contracts → bus → cloud → console (`README.md`). TS workspaces build via `tsc`; console via `vite build`. Engine builds via **CMake → macOS `.app` bundle** (frozen build pattern, `plan/CONVENTIONS.md:9`, `PROGRESS.md:40`). Top-level dirs: `contracts/ bus/ cloud/ console/ engine/ infra/ plan/ reference/ .github/` (`plan/CONVENTIONS.md:17-28`). CI: `.github/workflows/ci.yml` — two jobs: `node` on ubuntu-latest (npm install + typecheck + build, Node 22) and `engine` on macos-latest (**cmake configure-only**, no compile, to stay green without Xcode/SDK). `infra/` is docs-only (`infra/README.md`).

## 3. Data layer — DB, schema, entities

Frozen decision (S0.3, `plan/01-ARCHITECTURE.md:63`): **PostgreSQL** for cloud control plane (multi-tenant, billing/CRM), **SQLite** for engine-local durable state on the Studio box. Per-tenant external creds AES-256-GCM at rest (`plan/CONVENTIONS.md:48`, `plan/ACCESS.md:58-63`). **Reality: no Postgres exists** — cloud runs on **`better-sqlite3` behind a `Storage` interface seam** (`cloud/src/storage.ts`), WAL mode, schema kept to portable subset for a documented mechanical swap to `pg` (the "SWAP POINT", `storage.ts:11-19`; only `index.ts` constructs `new SqliteStorage`). DB file `dev.db` via `CLOUD_DB_FILE` (`cloud/src/index.ts`).

Implemented SQL schema (`cloud/src/storage.ts` `SCHEMA`): tables **users** (id, email UNIQUE, password_hash, role, created_at), **sessions** (id, user_id FK, created_at, expires_at), **campaigns** (id, name, zoom_topic, zoom_description, session_type, status, start_at, zoom_sync_stale, created_by FK, created_at, updated_at), **zoom_events** (id, campaign_id FK, meeting_id, join_url, start_url, driver, created_at). Timestamps are epoch-ms INTEGER.

TS entities: `Role` = super-admin | studio-admin | production-operator | moderator | presenter (`storage.ts`); `User`, `Session`, `Campaign` (`SessionType` = live|hybrid|like-life|evergreen; `CampaignStatus` = draft|scheduled|completed; `zoomSyncStale` bool), `ZoomEvent`. Planned-but-unbuilt entities (arch doc only, `plan/01-ARCHITECTURE.md:34-54`): Organization/Tenant, Studio, TimelineAction, Segment, Registrant/Contact (unified cross-campaign CRM profile), MediaAsset; runtime: Show, Room, Participant, Source, Scene, OutputBus, MixMinusBus. None of these have tables/code yet.

**State-bus design** (the other half of the "data layer", `plan/01-ARCHITECTURE.md:29-32,65-71`): one real-time source of truth; pattern lifted from the chat aggregator — fire-and-forget ingest → in-memory current-state store + ring buffer → ~100ms batched fan-out → best-effort persistence off hot path. Implemented as MQTT-retained-style **retained events** map in the bus daemon (`bus/src/server.ts`, `retained: Map<ch, Map<slot, BusEvent>>`), not persisted to disk (in-memory only).

## 4. API surface — contracts exported types/events (critical enumeration)

**`contracts/src/index.ts`** re-exports `envelope.js` + `messages.js`; `CONTRACTS_VERSION="0.1.0"`; `BUS_PROTOCOL_VERSION = 1`.

**Wire envelope** (`contracts/src/envelope.ts`, zod schemas): `ClientKind` = `"engine" | "console" | "cloud" | "ai" | "tool"`. `BusEvent` = {ch, type, seq (per-channel monotonic, server-assigned), ts (epoch ms), data}. Client→server frames (discriminated union `ClientFrame` on `op`): **`hello`** (v, client{kind,name}, optional token), **`sub`** (ch: string[], exact or `"prefix.*"`), **`pub`** (ch, type, data, optional retain, optional key). Server→client (`ServerFrame`): **`welcome`** (v, sid, now), **`evt`** (batch: BusEvent[]), **`err`** (code: `"bad_frame"|"unauthorized"|"internal"`, msg). Helper `channelMatches(pattern, ch)` (exact or trailing `.*` prefix wildcard).

**Domain messages** (`contracts/src/messages.ts`) — the real registered event/type names, `MESSAGE_SCHEMAS`:
- **`participant.joined`** → `ParticipantState` (participantId, roomId, displayName, role host|cohost|panelist|attendee, videoOn, audioOn, handRaised, isSpeaking, resolution 90p|180p|360p|720p|1080p) — retained per participant.
- **`participant.updated`** → `ParticipantState` (same; replaces joined in the same key slot).
- **`participant.left`** → `ParticipantLeft` (participantId, roomId).
- **`chat.message`** → `ChatMessage` (id, roomId, sender, senderParticipantId?, content, ts, kind chat|reply|broadcast|ai_reply) — labeled "aggregator contract".
- **`scene.changed`** → `SceneChanged` (bus program|wall, sceneId, sceneName) — the switcher's active scene per output bus, retained.
- **`engine.health`** → `EngineHealth` (daemon, ok, fps?, note?) — daemon heartbeat, retained.

`validateMessage(type,data)` parses registered types with zod and **passes unregistered types through** (forward-compat). Channel conventions (comment): `studio.<studioId>.room.<roomId>.participants|chat`, `studio.<studioId>.switcher`, `studio.<studioId>.health`.

**Cloud REST API** (`cloud/src/index.ts`), all under `/api`, everything except signup/login behind `requireAuth`:
- `GET /health` (public).
- `POST /api/auth/signup` (first user → super-admin), `/login`, `/logout`, `GET /me` (`cloud/src/auth.ts`).
- `GET /api/bus/token` → mints short-lived HMAC bus token (503 if `BUS_TOKEN_SECRET` unset).
- `/api/campaigns` (`cloud/src/campaigns.ts`, role-gated to super-admin/studio-admin/production-operator; moderator/presenter → 403): `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, **`POST /:id/duplicate`** (A-Event workflow #1), **`POST /:id/schedule`** (only Zoom touchpoint), **`GET /:id/zoom-events`** (future engine-priming source, not wired to bus). PATCH of a scheduled campaign's zoom-relevant fields flips `zoomSyncStale=true` (A-Event pain point #2, recorded only).
- Catch-all `/api` → 404 behind auth (hard gate for future routes).

Console consumes: `/api/auth/*`, `/api/bus/token` (via Vite proxy to :8080), and the bus WS directly.

## 5. Real-time transports / latency-sensitive paths

- **State bus** = **raw WebSocket + JSON envelope** (one JSON object per text frame), Node `ws` server (`bus/src/server.ts`), default `ws://127.0.0.1:7070`, LAN-only (binds 127.0.0.1 unless `BUS_HOST`), `~100ms` batched fan-out (`BUS_BATCH_MS`), per-channel monotonic seq, retained current-state slots keyed `(channel, key ?? type)` with `data:null` tombstones, retained-snapshot replay to late subscribers on `sub`. Chosen over Socket.IO (weak native client) and NATS/Redis (broker on an appliance) (`plan/01-ARCHITECTURE.md:66-67`).
- **Native attach**: Swift **`URLSessionWebSocketTask`, zero deps** (`engine/bridge/BusStubPublisher.swift`) — the proven S0.3 round-trip publisher (3 `participant.joined` retained + `engine.health`). C++ daemons planned to go through the Swift bridge (or libwebsockets later).
- **Console attach**: `console/src/useBus.ts` — fetch `/api/bus/token` → WS → hello(token) → welcome → `sub ["studio.dev.*"]` → renders retained snapshot then live batches; 3s reconnect with fresh token; statuses connecting/online/offline/unauthorized; log capped 300 (`MAX_LOG`).
- **Zoom capture path** (spike, `engine/spike-raw-capture/`): Zoom Meeting SDK raw I420 → `onYUV420DataReceive` callback → IOSurface (`SpikeCreateI420Surface`/`SpikeCopyI420IntoSurface`) → Metal `MTKView` fragment-shader YUV→RGB (BT.709 limited range, `shaders/yuv.metal`), zero-copy one R8Unorm texture per plane. Latency instrumented via `mach_absolute_time` (raw-callback→GPU-present "pipeline latency", explicitly *not* glass-to-glass). `FrameSource` protocol seam has two impls: `SyntheticSource` (animated I420, no SDK) and `ZoomRawSource` (real, `#if SPIKE_WITH_ZOOM_SDK`, else a link stub).
- **OSC show control, NDI, Dante, TUIO**: named only in plan docs (`plan/00-MASTER-PLAN.md:26-27`, `01-ARCHITECTURE.md:18`, backlog `02-SESSION-SPLIT-STRATEGY.md:98`) — **no code, no libraries, no OSC/NDI dependency anywhere**. ZoomOSC appears only as a reference PDF and as an incumbent tool being replaced.

## 6. State of code: real vs planned + session progress

**Real & verified:** contracts (frozen v1), bus daemon (round-trip + auth verified, `PROGRESS.md:13`), cloud auth + bus-token broker + campaigns/mock-Zoom (curl-verified, `PROGRESS.md:52`), console login+event-log shell. **Real but never run on hardware:** the S0.2 raw-capture spike — "code-complete & build-ready; NOT yet measured on hardware" (`engine/spike-raw-capture/README.md`); non-Zoom code passes `clang -fsyntax-only`, but Metal link + Zoom path never built (no full Xcode, no SDK, no creds in-session). **Planned only (empty `.gitkeep`):** capture, compositor, switcher, media, egress daemons.

Session split (`plan/02-SESSION-SPLIT-STRATEGY.md`) + status board (`plan/PROGRESS.md:6-30`): **Done** = S0.0 (scaffold), S0.1 (access track), S0.3 (arch freeze + round-trip), S0.4 (cloud auth + console shell). **In progress** = S0.2 (spike merged to main, awaiting Theo's on-hardware run — gates R1), S3.1 (campaign+scheduling; mock verified, real Zoom pending creds → THEO T10). **Not started:** S1.1–S1.6 (AV spine), S3.2–S3.4 (registration/CRM/GHL, reminders, native chat), S2.1–S2.4 (audio/mix-minus, multi-room, multi-output, feature/pin), S3.0 (pilot dry run). Autonomous mode ON since 2026-06-08; human tasks parked in `THEO-ACTIONS.md`. **Killed WIP branches** noted (spend-limit interrupt, `PROGRESS.md:50`): `wip/s1.2-gallery-compositor`, `wip/s1.6-console-show-mode`, `wip/s3.1-campaign-scheduling` (last one since landed). Doc-vs-code consistent overall; docs are ahead of code by design (documentation-driven method). Only visible git history in this shallow clone: one merge commit (`Merge pull request #4 … s3.1-campaign-scheduling`), branch `main`.

## 7. Docs inventory

- `CLAUDE.md` (root) — session entry point, read-order, locked decisions D1–D13, guardrails.
- `README.md` (root) — overview, dev quickstart, layout.
- `plan/00-MASTER-PLAN.md` — what/why, pilot, 6 planes, business model, D1–D13, phases, Figma link.
- `plan/01-ARCHITECTURE.md` — local/cloud split, module map, state bus, core entities/data model, frozen DB+bus choices.
- `plan/02-SESSION-SPLIT-STRATEGY.md` — every gated build session S0.0…S3.0 + "done when".
- `plan/CONVENTIONS.md` — frozen stack/structure/naming/API patterns.
- `plan/PROGRESS.md` — ground-truth status board + append-only decisions log + open questions + handoff.
- `plan/RISK-REGISTER.md` — R1 (raw capture, critical/open) … R8.
- `plan/ACCESS.md` (346 lines) — procurement checklist, secrets-location convention (3 tiers), Zoom R1 deep-dive, sources.
- `plan/THEO-ACTIONS.md` — human action queue T0–T10.
- `plan/prompts/S0.1.md`, `S0.2.md` — reusable session-launch prompts.
- Per-package READMEs: `engine/README.md`, `engine/spike-raw-capture/README.md` (detailed R1 runbook), `cloud/README.md`, `console/README.md`, `infra/README.md`.
- `reference/` — client SOW + licensed vendor docs (not canon): `Webinar _ Challenge Platform - Live & Evergreen.docx` (UgenticAI/A-Event SOW), `Tiles for Zoom v.1.2.3 Documentation.pdf`, `ZoomOSC 4.4.1 Command Syntax.pdf` + `User Manual.pdf`, `From Dillon.rtf` (RTMS-vs-native-raw-pipe rationale).

## 8. References to other apps / external targets

- **Chat aggregator** (in-house, `~/Dev/chat-aggregator`, `plan/00-MASTER-PLAN.md:72`): the reuse lineage — realtime fan-out, moderation, presenter-display, AES-256-GCM creds, auth patterns. Cited at `plan/01-ARCHITECTURE.md:30,63,66`, `plan/CONVENTIONS.md:10-11,38,48`, `cloud/src/auth.ts:2`, `bus/src/server.ts:5`, `contracts/src/messages.ts:33`, `console/README.md:6`, `plan/00-MASTER-PLAN.md:34` (chat-moderation SaaS revenue layer). (This is likely the sibling `/workspace/zoom-chat-aggregator` / `/home/user/zoom-chat-aggregator` repo; webinar-stack references it only by the `~/Dev/chat-aggregator` path, not by that repo name.)
- **OSC / ZoomOSC**: incumbent tool being replaced (`plan/00-MASTER-PLAN.md:8`), reference PDFs only; OSC show control listed as a future Plane-5 capability (`00-MASTER-PLAN.md:27`) — no OSC targets or code.
- **CRM**: "build our own CRM (paid add-on) + integrate external CRMs (GoHighLevel etc.)" D8 (`CLAUDE.md`, `00-MASTER-PLAN.md:35,49`); unified cross-campaign Contact profile is the planned CRM moat (`01-ARCHITECTURE.md:42`). No CRM code yet (S3.2 not started).
- **UgenticAI SOW**: the pilot client (ops Olga Geistfeld, Allison Hoyt, Anil — same names seeded in `BusStubPublisher.swift`), SOW at `reference/Webinar _ Challenge Platform - Live & Evergreen.docx`, authoritative for the management plane / A-Event replacement (`plan/00-MASTER-PLAN.md:16-19`). GHL-agency open question is UgenticAI's-vs-ours (`ACCESS.md:186`, `THEO-ACTIONS.md` T4).
- **`rytepro1` GitHub hosting**: README ">Hosted on GitHub `rytepro1`" (`README.md`), `CLAUDE.md` team line, remote `https://github.com/rytepro1/webinar-stack.git` (PRIVATE, `PROGRESS.md:35`). CI merge commit confirms `rytepro1/...` PRs.
- Other named integration targets (planned, no code): GoHighLevel, OmniSend, Twilio (A2P 10DLC), Google Sheets/Calendar, Sly Broadcast, Zapier, WhatsApp (`plan/01-ARCHITECTURE.md:24`, `cloud/README.md`, `ACCESS.md`). Recall.ai / Zoom cloud RTMS named only as **fallbacks** if R1 fails (`RISK-REGISTER.md` R1, `From Dillon.rtf`).

## 9. Auth / identity model

Cloud-owned. **Signup/login** with **bcryptjs cost 12** password hashing; **server-side sessions stored in the DB** (68-char opaque token, 7-day TTL, lazy-expiry sweep); **HTTP-only cookie `webinarstack_session`** (`sameSite:lax`, `secure` in production) (`cloud/src/auth.ts`, `storage.ts createSession`). `attachUser` soft middleware + `requireAuth` hard gate on all `/api` except auth endpoints. **First signup → `super-admin`; later signups default to `production-operator`** (`auth.ts` `DEFAULT_ROLE`). Roles: super-admin | studio-admin | production-operator | moderator | presenter.

**Bus auth** (`cloud/src/bus-token.ts` ↔ mirrored verifier in `bus/src/server.ts`): cloud issues a short-lived **HMAC-SHA256** token = `base64url(JSON{sub,name,role,iat,exp}) + "." + base64url(sig)`, exp in epoch **seconds**, TTL **300s**, secret = shared env **`BUS_TOKEN_SECRET`**. Token rides `hello.token`, checked only at connect. If `BUS_TOKEN_SECRET` is unset the bus is **dev-open (no auth)**; if set, bad/expired/missing token → `err unauthorized` + WS close code 4001. Design intent (`plan/01-ARCHITECTURE.md:70`): remote operators reach the bus only through the cloud broker, never a raw exposed port. Console: D6 — console is a *client* holding no engine secrets. No org/tenant/studio brokering implemented yet (planned, `01-ARCHITECTURE.md:38`).

---

### Flags / low-confidence
- **"Trivency"**: not present in-repo; brand throughout is RYTE/`rytepro1`. The task's "other Trivency apps" likely maps to the sibling repos in `/workspace` (e.g. `zoom-chat-aggregator`, `livesalesengine`) but webinar-stack itself references only the in-house chat aggregator by path.
- **C++ standard drift**: CONVENTIONS says "C++17/20" (`CONVENTIONS.md:8`) while CMake hard-pins `CMAKE_CXX_STANDARD 20` (`engine/CMakeLists.txt:5`). Minor.
- **Zoom SDK version sensitivity**: the real raw-data path is explicitly flagged as unverified against actual SDK headers (5.x/6.x symbol drift), `ZoomRawSource.mm` header comment + spike README "Known version-sensitivity".
- Git history here is a shallow single-commit clone; branch/PR detail comes from `PROGRESS.md`, not from `git log`.

---

I have thorough coverage. Here is the architecture deep-read.

# ShowEngine / liveSalesEngine — Architecture Deep-Read

Read-only survey of `/workspace/livesalesengine` (git HEAD `9cdf62b` "Merge PR #56 (V2.3 — Hide on TV, backdrop-only view)"). Owner: Theo Nelson / RYTE Productions. Repo: github.com/rytepro1/liveSalesEngine (per `plan/PROGRESS.md:241`). "One state, three renderers" real-time live-selling game engine.

## 1. Languages / frameworks / runtimes / versions

- **Monorepo root** `package.json:1-37`: `"type":"module"`, `engines.node ">=20"` (`:7-9`), npm workspaces `["shared","server","web"]` (`:10-14`). Dev tooling: TypeScript `^5.7.2`, ESLint `^9.15.0`, typescript-eslint `^8.15.0`, Prettier `^3.4.1` (+ `prettier-plugin-svelte`), `tsx ^4.19.2`, `concurrently ^9.1.0`.
- **tsconfig.base.json:1-20**: target ES2022, module ESNext, moduleResolution Bundler, `strict:true`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`, `declaration:true`, `sourceMap:true`, `isolatedModules`.
- **shared** (`@showengine/shared` `shared/package.json`): framework-free TS; build = `tsc`, emits `dist/index.{js,d.ts}`. Pure types + a few consts. Consumed by both server and web via workspace `*`.
- **server** (`@showengine/server` `server/package.json:26-44`): Node + Express `^4.21.1`, Socket.IO `^4.8.1`, Drizzle ORM `^0.36.4` + drizzle-kit `^0.28.1`, `postgres ^3.4.5`, `multer ^1.4.5-lts.1`, `@aws-sdk/client-s3` + `s3-request-presigner ^3.1075.0` (R2), `resend ^6.16.0` (email), `dotenv`. Dev = `tsx watch`; prod = `node dist/index.js`. `@types/node ^22`.
- **web** (`@showengine/web` `web/package.json`): **Svelte `^5.2.0`** (runes — `$state`), Vite `^5.4.11`, `@sveltejs/vite-plugin-svelte ^4`, `svelte-check ^4.1`, socket.io-client `^4.8.1`, six `@fontsource/*` packages (anton, bungee, fredoka, inter, nunito, rajdhani). SPA, no SSR.

## 2. Build tooling / package manager / structure

- **npm workspaces** (npm is the locked PM, `CONVENTIONS.md:10`). Root scripts (`package.json:15-25`): `dev` builds shared then runs shared/server/web concurrently; `build` = shared → web → server (order matters: server/web typecheck resolve `@showengine/shared` from its `dist`); `typecheck`/`lint`/`format` fan across workspaces.
- Structure matches `CONVENTIONS.md:17-52`: `shared/src/{events,domain,index}.ts`; `server/src/{index,db,ws,routes,storage,auth,email,lib}`; `web/src/{main.ts,App.svelte,lib,surfaces,games}`.
- **Deploy**: Railway NIXPACKS (`railway.json`): build `npm install --include=dev && npm run build`; preDeploy `db:migrate:prod`; start `npm start`; healthcheck `/api/health`; restart ON_FAILURE (max 10).
- **CI** (`.github/workflows/ci.yml`): two jobs on PR + push-to-main + manual dispatch — (a) typecheck + build on Node 22; (b) "WS smokes" spins up Postgres 16 service, migrates, starts the built server, runs 6 smoke scripts. No unit-test runner in CI.

## 3. Data layer / state / snapshot-recovery

- **DB = Postgres (Railway) + Drizzle**, snake_case cols, UUID PKs via `gen_random_uuid()` (`server/src/db/schema.ts`). Tables: `brands`, `products`, `packages`, `package_items`, `game_setups`, `rounds`, `round_slots`, `sessions`, `winners`, `videos`, `accounts`, `account_brands`. Enum-ish cols are `text().$type<…>()`-narrowed.
- **Authoritative live game state is IN-MEMORY, one `RoundState` per brand room**, held in a `Map<string,RoundState>` (`server/src/ws/state.ts:7`, `getRoundState` `:24`). `RoundState` shape at `shared/src/domain.ts:188-224` (round, slots, theme, recordedPositions, skippedPositions, winnersPending, showInventoryValue, boardHidden, activeVideo).
- **Persistence model**: every lifecycle transition writes through to Postgres AND mutates the in-memory state (`round-machine.ts` — armRound `:141`, revealSlot `:354`, recordWinner `:623`, resetBoardTo `:711`). Winners are an append-only audit log; `package_items` are a **snapshot** of products (name/sku/image copied at build time; `product_id` kept only for traceability, `ON DELETE set null`) so editing/deleting a product never mutates a built package or a recorded winner (`schema.ts:64-124`, `01-ARCHITECTURE.md:102-112`).
- **Recovery/snapshot**: NOT rehydrated from DB on boot — the in-memory state comment says "Rehydratable from the DB later; for S0.3 it lives only in memory" (`state.ts:1-3`). **⚠ Low-confidence risk**: a server restart mid-show loses in-memory `RoundState` (revealedPositions, spinner landing, activeVideo, boardHidden). Slot/round/winner rows survive in Postgres but there's no code re-seeding `getRoundState` from them — a reconnecting surface would get an empty `state:full` until re-armed. Some transient facts (spinner phase/landing `spinnerLandings`/`spinnerPhases`, `revealOrders`, `inventoryValueShown`) are module-level Maps in `round-machine.ts`, in-memory only.
- Several toggles are "sticky per brand" via module Maps (e.g. `inventoryValueShown` `round-machine.ts:59`).

## 4. API surface (HTTP + WebSocket)

**HTTP / REST** (`server/src/index.ts` + `routes/index.ts`), envelope `{data}` / `{error:{code,message}}`:
- `GET /api/health` (`index.ts:41`) — status/version/uptime; the healthcheck + shared-link proof.
- Non-prod debug seams: `POST /api/_debug/round-status` (`:61`), `POST /api/_debug/arm` (`:77`) — inject an armed round to test renderers before real handlers.
- `GET /media/:key` (`:127`) — serves stored assets; 404 (never index.html) so client CSS-placeholder fallback works.
- SPA static serve + non-`/api` fallback to `index.html` (`:139-146`).
- Auth: `GET /api/auth/check`, `POST /api/auth/login`, `POST /api/auth/signup` (invite-code gated by `SIGNUP_CODE`, per-IP throttle 5/60s) (`routes/index.ts:52-131`).
- Routers (`routes/index.ts:133-145`): `/api/accounts`, `/api/brands` (+ fulfillment-email), `/api/sessions`, `/api/products`, `/api/packages`, `/api/game-setups`, `/api/rounds`, `/api/winners`, `/api/videos`, `/api/assets`. Unknown `/api/*` → JSON 404. Central 500 error envelope registered last (`:154-160`).

**WebSocket** (Socket.IO, one room per `brandId` = `brand:<id>` `ws/server.ts:65`). The contract is **defined in `shared/src/events.ts`** (authoritative; `WS_EVENTS` const map `:192-219`) and documented in `plan/04-WS-CONTRACT.md`. **Doc vs code comparison: they match closely, but the code is AHEAD of the doc.**

Real **Client→Server** events (from `events.ts:144-162` + `WS_EVENTS`, all wired in `ws/server.ts`):
`hello`, `round:arm`, `round:start`, `slot:reveal`, `winner:record`, `winner:skip`, `round:reset`, `round:replay`, `spinner:start`, `spinner:stop`, `setup:launch`, `inventory:show-value`, `spinner:void`, `slot:undo`, `board:hide`, `video:trigger`, `video:stop`.

Real **Server→Client** events (`events.ts:164-175`): `state:full`, `state:revealed`, `state:eliminated`, `spinner:spinning`, `spinner:result`, `round:status`, `op:error`, `video:play`, `video:stopped`.

**Doc drift (flag)**: `plan/04-WS-CONTRACT.md` (tables at `:11-38`) lists only a subset — it documents `round:arm/start`, `slot:reveal`, `winner:record`, `board:hide`, `winner:skip`, `round:reset`, `spinner:start/stop`, `setup:launch`, `video:trigger/stop`, and server events `state:*`, `spinner:*`, `round:status`, `video:play/stopped`. It **omits** `round:replay`, `inventory:show-value`, `spinner:void`, `slot:undo`, and `op:error` — all of which ARE implemented in code (`shared/src/events.ts` + `ws/server.ts`). So the shared contract file and server implement more than the markdown doc records; the doc is stale relative to the S4.x additions.

**Drive authorization is per-event, not a blanket read-only flag** (`events.ts:10-23`, `ws/server.ts:363-404`): `operator` (password → `canDrive`) may emit everything incl. rigged `spinner:stop` w/ `targetPosition`; `tv` may emit PLAY actions (`slot:reveal`, `spinner:start`, non-rigged `spinner:stop`) + `round:reset`/`round:replay` corner tap — authorized by brand-room membership via unguessable URL, NOT password; `obs` drives nothing. Guards: `driver()`, `canPlay()`, `gateBlocked()` (S4.2 winner gate → `op:error` code `winners_pending`), `noLiveSession()` (S4.8 gate → `no_session`).

## 5. Real-time transports / OBS / audio triggers

- **Transport**: Socket.IO `^4.8.1` server sharing the Express HTTP server, single origin, `cors:{origin:true}` to allow the Vite dev port + smokes (`ws/server.ts:85-91`). Auto-reconnect + `state:full` resync on every (re)connect (`web/src/lib/socket.svelte.ts:74-93`). Client uses **default transports (polling→websocket upgrade)** deliberately, not ws-first, to survive proxies (`socket.svelte.ts:143-163`). Web state mirrors are Svelte 5 runes (`$state`, `live` store `:99`; `createSurfaceConnection` `:385`).
- **OBS integration**: OBS is just a Browser Source loading `/obs` — the SAME Svelte renderer as `/tv`, only the background differs (TV paints branded backdrop/bg-video; OBS paints nothing = transparent overlay composited over the live camera). Locked in `CLAUDE.md:50-53`. OBS is read-only (no `drive` API built; server also rejects its emits, `socket.svelte.ts:467-501`).
- **No OSC / NDI / MIDI / audio-hardware triggers anywhere.** "Triggers" are purely WebSocket events. Video is a `<video>` element feature (S4.5): a triggered full-screen overlay (`video:trigger`→`video:play`, rides `RoundState.activeVideo{storageKey,nonce}` for mid-clip joiners) played on BOTH TV+OBS, plus a looping muted ambient TV-only background (`brands.video_bg_path` → `Theme.bgVideoPath`) that OBS ignores (`round-machine.ts:70-100`, `04-WS-CONTRACT.md:42-53`).
- **Audio is browser-side only** (`web/src/games/shared/sound.ts`). Fallback chain per cue: brand override (`brands.sounds[key]` via `/media/<key>`) → bundled default MP3 (`web/public/sounds/default/`) → Web Audio synth blip → silence (`:212-225`). Game-aware keys (`SoundKind` `:28-39`): Pick-a-Box `pick1..4` by reveal order, Sweet16 `sweet16Pick/Win/Grand`, Spinner looping `spin` + `spinnerWin` (= grand sting). Per-slot mutes stored as reserved `mute:<slot>` keys in `brands.sounds` (`:84-112`). Every path is best-effort/silent-on-failure ("sound is a flourish, never a dependency" — handles suspended AudioContext with no user gesture on TV/OBS).
- **"Game Audio/" (81MB) is a raw asset library, NOT wired into the app.** `Game Audio/Extracted/…` holds Envato/adg3 WAV+MP3 source packs (8-bit pack, jackpot/casino/slot wins, fanfares, background music). The app actually ships only the 10 curated MP3s in `web/public/sounds/default/` (pick-1..4, reveal, spin, sweet16-{pick,win,grand}, win). The `Game Audio` folder is a source/scratch bin (candidate sounds), not referenced by any code — confirmed by grep; `sound.ts` points only at `/sounds/default/`.

## 6. State of code: prototype vs hardened

- **More hardened than a prototype, but light on automated tests.** V1 is feature-complete and has been through a real dress rehearsal with a paying beta customer (Jaron / All American Canine); v1.1 (S4.x) sessions in progress (`plan/PROGRESS.md:8`, `team-onboarding-deck.md:25`).
- **Tests: NO unit tests.** Despite `CONVENTIONS.md:14` / `00-MASTER-PLAN.md:47` naming Vitest, no `*.test.ts`/`*.spec.ts` exist and no vitest dep is installed. Coverage is **6 integration "smoke" scripts** run in CI against live Postgres + a built server (`server/scripts/`: `ws-smoke`, `run-smoke`, `touch-drive-smoke`, `setup-smoke`, `setup-expansion-smoke`, `inventory-spinner-smoke`, `accounts-smoke`, plus `video-smoke` present but not in CI). **Flag**: this is a real gap vs the stated bar.
- **Error handling is deliberate and defensive**: server-authoritative gates never silently no-op — they emit `op:error` with a reason (`ws/server.ts:374-396`); winner double-submit defence claims the position synchronously before the awaited insert, rolls back on throw (`round-machine.ts:623-672` — this fixes the dress-rehearsal double-tap bug); missing assets fall back to CSS placeholders; missing/deleted packages are skipped at expansion, never crash a show (`existingPackages` `:194`); R2 env vars validated + normalized loudly at first use (`storage/provider.ts:55-109`). REST uses an `asyncHandler` wrapper + central error middleware (`routes/index.ts:22-28,154-160`).
- **Risk register** `plan/05-RISK-REGISTER.md`: R1 Railway ephemeral FS → Volume behind `StorageProvider` (HIGH/HIGH); R2 TV↔OBS state drift → single authoritative server (MED/HIGH); R3 TikTok integration fragility → deferred to phase 2, manual winner entry in v1; R4 connection loss → Socket.IO reconnect + `state:full` resync; R5 auth too weak/strong → single shared password; R6 scope creep per session → bounded-scope discipline; R7 video media at scale → R2 swap + presigned direct-to-R2 uploads (multer memory 10MB won't hold video), target 1080p on the 75" Google TV (Theo accepts decode risk, verify on hardware).

## 7. Docs inventory

- `plan/00-MASTER-PLAN.md` — what/why, locked stack table, phases (Phase 1 core v1; Phase 2 TikTok/multi-TV/R2/accounts), success = full dress-rehearsal show end-to-end.
- `plan/01-ARCHITECTURE.md` — surface model table, full Postgres data model (ASCII), entity relationships, realtime state machine (armed→live→complete), server/web module maps, theming.
- `plan/02-SESSION-SPLIT-STRATEGY.md` (35KB) — the build as bounded dependency-ordered sessions S0.x→S4.x (not fully read; largest planning doc).
- `plan/03-GAME-RULES.md` — business rules: shared full-screen takeover reveal + tap-to-dismiss; per-game sound map; Pick-a-Box (locked 3 boxes, shuffle-at-arm, undo+reshuffle); Sweet 16 (16-slot, eliminationary, Grand Prize + auto-fill fillers, server-random position); Spinner (5–10 seg, default 8, start/stop tap, non-eliminationary/replayable, riggable operator-only); Inventory Spinner (4th type, quantity+value, decrement, sold-out retire); Game Setups.
- `plan/04-WS-CONTRACT.md` — WS event tables (stale — see §4 drift), video split, sync principles, per-event drive auth.
- `plan/05-RISK-REGISTER.md` — R1–R7 (§6 above).
- `plan/06-DESIGN-SYSTEM.md` — token contract + 3 theme presets (neon/broadcast/pop); games must be token-pure (only `var(--se-…)`). (Not fully read.)
- `plan/07-V2-BACKLOG.md` — deferred features (Whatnot SDK auto-session, multi-host/remote presenter tied to accounts phase-2, live guest invite, Duck Hunt hardware game, chess overlay) + productization (~$99/mo software sub, $3.5–6k hardware kit, white-label) + operational items (on-site setup Jul 6–7, password floated `sell4me`, do-not-sell "Gaines"). Sourced from Dress Rehearsal V1 (Theo + Jaron/AAC, 2026-06-26).
- `plan/CONVENTIONS.md` — frozen contract: stack, folder tree, naming (files kebab, components PascalCase, WS `domain:action`), API patterns (`{data}`/`{error}`, `/api`, password header on writes), WS/state rules, git/conventional-commits, **SHARED-CORE file list + parallel-work file-ownership rules** (learned from S1.2+S2.1 collisions on `socket.svelte.ts`/`vite.config.ts`).
- `plan/PROGRESS.md` (160KB) — living tracker; ground-truth status board + append-only decisions log + handoff notes. Says V1 feature-complete, dress rehearsal done, Dev-Ops-Manager session owns merges/PROGRESS.
- `plan/Dress Rehearsal V1.rtf` (97KB) — raw beta-customer walkthrough transcript.
- `showengine-plan.md` (root) — original brain-dump, superseded by `plan/`.
- `CLAUDE.md` — session entry point: read-order, doc index, locked decisions, guardrails, current state (foundation frozen, parallel worktrees).
- `docs/OPERATOR-GUIDE.md` + `docs/RUNBOOK.md` (internal, "do NOT share outside RYTE"; deploy/infra incl. R2 CDN `salesmedia.ryteproductions.com`).

**Team/process context** (from the three agency docs — the agency-context repo is unavailable, so extracting here):
- `framework-kickoff-prompt.md` — reusable doc-driven, session-split bootstrap prompt ("same framework used on the eLCie rebuild"). Interviews user → produces `plan/` + `CLAUDE.md`; no feature code until plan approved. Core: "docs+git are memory, chat is disposable"; one bounded scope per session (~8–10 new files max); freeze foundation single-threaded, then parallel worktrees; mandatory PROGRESS handoff + commit.
- `agency-starter-kit.md` — the layer above: production-grade AI-orchestrated dev shop. **Roles**: Tech Lead / Dev Ops Manager (coordinator session — plans, sequences, writes build prompts, reviews/merges PRs, owns PROGRESS); Builders (one bounded scope each, own branch/worktree); QA/Breaker (adversarial: `/code-review ultra`, `/security-review`, hammers preview, files Linear bugs, converts to regression tests). **Rule: two people never share one AI session.** Stack: GitHub (source of truth) + devcontainer, Linear (PM, + Linear MCP + Linear↔GitHub), GitHub Actions CI, branch protection, Railway (stateful hosting — NOT Vercel for WS/state), preview-per-PR → staging → prod, Sentry monitoring. Access model: shared resource + individual identity (own Linear/GitHub/Railway credentials; service secrets server-side only). Phased adoption §9.
- `team-onboarding-deck.md` — source content for a ~28–34-slide training deck to onboard beginners (Tony & Dillon). "Not vibe coding — AI-orchestrated engineering with discipline." Cites ShowEngine as proof (live with a paying beta customer). Explains Claude Code as an agent, GitHub/Linear/Railway/Resend/R2/Sentry/Codespaces, the session lifecycle (Orient→Scope→Build→Verify→Handoff→Commit), roles, "plan first / always verify."

## 8. Shared domain entities (`shared/src/domain.ts`)

- **Surface** = `'operator'|'tv'|'obs'` (`:8`). **GameType** = `'pickbox'|'sweet16'|'spinner'|'spinner_inventory'` (`:14`; inventory is a separate 4th type, classic spinner untouched). `PICKBOX_BOX_COUNT=3` (`:18`). RoundStatus `armed|live|complete`; SlotState `available|won|eliminated`; PackageType `single|bundle`; PresetId `neon|broadcast|pop` (default neon, `:25-27`).
- **Brand** (`:39-53`) — themed container (renamed from "clients", `CLAUDE.md:64-67`): id, name, logoPath, bgPath, videoBgPath, colors/fonts/sounds (nullable), themePreset, createdAt.
- **Product** (`:57-65`) — reusable per-brand catalog (CSV-importable): id, brandId, name, sku, description, imagePath. (DB adds priceCents, archivedAt soft-delete, inStock — `schema.ts:79-90`.)
- **Package** (`:80-87`) + **PackageItem** (`:67-78`, snapshot of product) + **PackageWithItems** (`:91`, carried in reveal payloads).
- **GameSetup** (`:96-104`) + **GameSetupConfig** union (`:107-132`): `SlotsConfig` (explicit slots), `GrandFillersConfig` (Sweet16 grand+fillers, server-expands to 16), `InventoryConfig` (items w/ quantity+valueCents), `ActiveItemsConfig` (`{kind:'active'}` — server draws 3 random in-stock products at launch).
- **Round** (`:134-142`), **RoundSlot** (`:144-160`, incl. isGrandPrize, quantity, valueCents for inventory), **Winner** (`:162-168`), **Theme** (`:172-184`), **RoundState** (`:188-224`).
- **Operators/accounts**: NOT in `shared/domain.ts` — they live only in the DB layer (`schema.ts:243-267`: `accounts` role `agency|brand` + rotated `token`, `account_brands` join). Auth v1 = single shared `OPERATOR_PASSWORD`; accounts are the additive phase-2 layer (`CLAUDE.md:62,68-71`, `schema.ts:237-242`). "Players" are not modeled as entities — winners are captured only as a free-text `winnerHandle` (manual entry; TikTok auto-capture deferred).
- **Duplication note**: domain types are hand-mirrored between `shared/src/domain.ts` (wire shapes) and Drizzle `$inferSelect` row types in `schema.ts` (`schema.ts:23-41,269-290`), kept in sync manually ("small + stable", `domain.ts:3-5`).

## 9. References to other Trivency / RYTE apps

- **None in code or plan docs.** Grep for `webinar-stack`, `zoom-chat`, `qnet`, `ryte-live`, `manufacturer-database`, `daw`, `translation` across the repo returned no cross-app references. The sibling repos exist alongside it under `/workspace/` (agency-agents, daw, manufacturer-database, qnet-*, ryte-live-translation, webinar-stack) but livesalesengine does not import, link, or mention them.
- Only shared identity is organizational: **RYTE Productions** ownership (`00-MASTER-PLAN.md:4`, `showengine-plan.md:2`), the RYTE production domain for surfaces, R2 CDN `salesmedia.ryteproductions.com` (`docs/RUNBOOK.md:42`), and one historical mention of "the eLCie rebuild" as the origin of the doc-driven framework (`framework-kickoff-prompt.md:5`). Third-party integrations named as **phase-2/deferred only**: TikTok (`tiktok-live-connector` + signing backend, R3) and Whatnot SDK (`07-V2-BACKLOG.md:11`). Resend (email) and Cloudflare R2 (media) are the only live external services wired in.

## Notable flags / low-confidence items
- **State recovery gap**: no boot-time rehydration of in-memory `RoundState` from Postgres; a server restart mid-show drops live game state (see §3). Not a claim about intent — just what the code does today.
- **WS contract doc is stale**: `plan/04-WS-CONTRACT.md` omits 5 implemented events (`round:replay`, `inventory:show-value`, `spinner:void`, `slot:undo`, `op:error`); `shared/src/events.ts` is the true authority (§4).
- **No unit tests despite Vitest being "locked"**; coverage is 6–8 integration smokes (§6).
- **`Game Audio/` (81MB) is unused source assets**, not app-wired (§5).
- I did not fully read `02-SESSION-SPLIT-STRATEGY.md`, `06-DESIGN-SYSTEM.md`, the RTF transcript, or the bulk of `PROGRESS.md` (160KB) — summaries of those are from their headers/index only.

---

I'll start by locating the target repository and getting an overview of its structure.
The target repo is at `/workspace/ryte-live-translation`. Let me explore its structure.
Now let me read the root config files and all key files in parallel.
Critical security finding confirmed: API_KEYS.rtf contains real credentials. Note `.gitignore` excludes `API_KEYS.md` but NOT `.rtf`. Let me verify it's git-tracked and read the app sources.
Now let me read the shared package, API entry, and services in parallel.
Let me read the full saved output file.
Now let me read the service implementations and routes/websocket handlers.
Now the routes, websocket handlers, and web frontend key files.
Now the WebSocket handlers and web frontend lib files.
Now let me check the frontend pages (operator console maturity, attendee), mock services, configs, and cross-app references.
Let me get line counts for the dynamic-route pages and check the operator live page maturity plus cross-app references.
No tests, no cross-app references. Let me read the two key client pages (operator live console, attendee playback) for the real-time path and maturity.
Let me read the operator live console (maturity) and check the mock services and voices script briefly.
I have a comprehensive picture. Let me do a final quick check on mock services, the voices script, and tailwind branding.
I now have a complete picture. Here is the architecture deep-read.

---

# RYTE Live Translation — Architecture Deep-Read

Real-time live event translation: speaker audio → STT → translate → LLM-improve → AI voice → attendee phones. npm-workspaces monorepo. Located at `/workspace/ryte-live-translation` (NOT the cwd `zoom-chat-aggregator`). Single git commit on record (`0e489fc`).

## 1. Languages / frameworks / runtimes

- **Monorepo root** `package.json:20-22`: `engines.node >=20.0.0`; npm workspaces `apps/*`, `packages/*`; `private`, license `UNLICENSED`. All TypeScript ^5.3.3, no JS source.
- **apps/api** (`apps/api/package.json`): `@ryte/api` v1.0.0, `"type":"module"` (ESM). Runtime **Node 20 + Fastify ^4.26.0**. Notable deps: `@fastify/cors ^9`, `@fastify/websocket ^10`, `@deepgram/sdk ^4.11.3`, `deepl-node ^1.24.0`, `@anthropic-ai/sdk ^0.52.0`, `livekit-server-sdk ^2.15.0`, `@livekit/rtc-node ^0.13.24`, `nanoid ^5`, `ws ^8.16`, `dotenv ^17`, `jiti ^2.6.1`. Dev: `tsx ^4.7`, `esbuild ^0.27`, `typescript`. Dev runs `tsx watch`; start via `node --import jiti/register src/index.ts` (runs TS directly, no compiled JS shipped). tsconfig `apps/api/tsconfig.json`: target ES2022, module ESNext, moduleResolution bundler, strict.
- **apps/web** (`apps/web/package.json`): `@ryte/web` v1.0.0. **Next.js ^14.2.35 (App Router) + React ^18.3.1 + Tailwind ^3.4.1**. Deps: `livekit-client ^2.17`, `@livekit/components-react ^2.1`, `qrcode.react ^4.2`. tsconfig target ES2017, strict, `moduleResolution: bundler`. `next.config.js` transpiles `@ryte/shared`, `experimental.esmExternals`.
- **packages/shared** (`packages/shared/package.json`): `@ryte/shared`, `"type":"module"`, `main`/`types` point directly at `./src/index.ts` (raw TS consumed via jiti server-side and Next transpilePackages client-side — no build step). Only devDep is typescript.

## 2. Build tooling, package manager, deploy

- **Package manager**: npm (root `package-lock.json` 137 KB). Root scripts fan out `--workspaces --if-present` (`package.json:10-19`).
- **API deploy — Fly.io** (`fly.toml`): app `ryte-live-translation-api`, region `ord`, builds `apps/api/Dockerfile`; env `NODE_ENV=production`, `PORT=3001`; `http_service` internal port 3001, force_https, `auto_stop_machines=off`, `min_machines_running=1`, connection concurrency soft 400 / hard 500; extra raw TCP port **3478** exposed (STUN/TURN, for LiveKit WebRTC); vm shared 1 cpu / 1024 MB.
- **Dockerfile** (`apps/api/Dockerfile`): two-stage `node:20-bookworm` pinned `--platform=linux/amd64`; `npm ci`, `npm run build`; production stage does `npm ci --omit=dev` then `npm rebuild @livekit/rtc-node` + installs `@livekit/rtc-node-linux-x64-gnu` (native bindings workaround). Ships `src/` (TS) not dist; CMD `npm run start`. HEALTHCHECK curls `/health`.
- **Web deploy — Vercel** (`apps/web/vercel.json`, `DEPLOY.md:26-36`): framework nextjs, root dir `apps/web`, install/build run from monorepo root. `DEPLOY.md` also documents Fly secrets and env vars.
- `.dockerignore` excludes `apps/web` from API image.

## 3. Data layer

- **NO database. All state is in-memory `Map`s; everything is lost on restart.** PostgreSQL/Redis are Phase-2 aspirational only (commented in `.env.example:15-19`; README Phase 2 checklist unchecked).
- **Events + channels**: `apps/api/src/routes/events.ts:20-21` — `const events = new Map<string, Event>()` and `const channels = new Map<string, LanguageChannel[]>()`. Event codes are 6-char, ambiguous chars removed (`events.ts:24-31`).
- **Attendee sessions (rooms/languages/listeners)**: `apps/api/src/websocket/operator-handler.ts:164` — `attendeeConnections = Map<eventId, Map<LanguageCode, Set<WebSocket>>>`; listener counts mutated in `events.ts:285-296`. Caption sessions: `caption-handler.ts:11`. Active pipelines: `operator-handler.ts:17`.
- **Usage**: `apps/api/src/routes/usage.ts:18` `usageByEvent = Map`. **Voice config**: `apps/api/src/routes/voices.ts:11` a single module-level `voiceConfig` (global, not per-event; "persists until server restart").
- **Transcripts**: buffered in-memory on the pipeline instance (`pipeline.ts:66 transcripts: TranscriptEntry[]`), exported via API.

## 4. API surface

**HTTP (Fastify), registered in `apps/api/src/index.ts:54-59`:**
- `GET /health` (`index.ts:50`)
- Events (`routes/events.ts`): `POST /api/events`, `GET /api/events`, `GET /api/events/:id`, `PATCH /api/events/:id`, `POST /api/events/:id/start`, `POST /api/events/:id/stop`, `GET /api/events/:id/transcript?format=json|csv|txt` (`events.ts:172`), `PUT /api/events/:id/glossary` (live glossary update), `DELETE /api/events/:id`.
- Join (`routes/join.ts`): `GET /api/join/:code`, `GET /api/join/:code/token?language=` — **note this token endpoint is still a stub returning `"mock-token-"+Date.now()` (`join.ts:73-79`)**.
- LiveKit (`routes/livekit.ts`): `GET /api/livekit/token?eventId=&language=` (real JWT via `AccessToken`), `GET /api/livekit/status`.
- Usage (`routes/usage.ts`): `GET /api/usage/:eventId`, `GET /api/usage/summary`.
- Voices (`routes/voices.ts`): `GET /api/voices/search`, `GET /api/voices/config`, `POST /api/voices/config`, `GET /api/voices/preview` (proxies ElevenLabs to dodge CORS).

**WebSocket** (`index.ts:62-64`):
- `GET /ws/operator?eventId=` (`operator-handler.ts:20`) — binary frames = audio chunks; text frames = control.
- `GET /ws/attendee?eventId=&language=` (`attendee-handler.ts:34`) — receives binary PCM audio + JSON transcript.
- `GET /ws/caption?eventId=&language=` (`caption-handler.ts:14`) — receives JSON captions only.

**Real message/event names** (`packages/shared/src/types.ts:122-136`):
- Operator→Server: `audio:start`, `audio:chunk`, `audio:stop`, `channel:toggle`.
- Server→Operator: `transcript`, `translation`, `listeners`, `usage`, `error`, `status`.
- To attendee/caption sockets: JSON `{type:"transcript"|"caption", text, language}` (`attendee-handler.ts:25`, `caption-handler.ts:73`).

**External AI services consumed:**
- **STT: Deepgram** Nova-2 streaming (`services/deepgram-stt.ts:6,53-63`) — linear16, 16 kHz mono, `interim_results`, `endpointing:300`, keepAlive every 10 s.
- **Translation: DeepL** (`services/deepl-translation.ts:6,46,66`) via `deepl-node`; custom source/target code maps (`deepl-translation.ts:10-35`).
- **Translation improvement: Anthropic Claude** — `claude-3-5-haiku-latest`, max_tokens 500 (`services/translation-improver.ts:6,75`), glossary + event-context aware, gated on `ANTHROPIC_API_KEY` and `LLM_IMPROVEMENT_ENABLED!=="false"`; sanity-checks output length and falls back to raw DeepL. (This is the newest feature per the sole commit.)
- **TTS: ElevenLabs** REST `text-to-speech/{voiceId}?output_format=pcm_16000`, model `eleven_turbo_v2_5` (`services/elevenlabs-tts.ts:61-78`); preview uses `eleven_multilingual_v2` (`voices.ts:150`). Voice IDs hardcoded per lang×gender in `packages/shared/src/languages.ts:61-105`.
- **Media distribution: LiveKit Cloud** (`services/livekit.ts`, `services/livekit-publisher.ts`).

**SECURITY FINDING — `API_KEYS.rtf` at repo root contains LIVE committed secrets and IS git-tracked** (confirmed `git ls-files` shows `API_KEYS.rtf`). It names and includes real-looking credentials for: **Deepgram** (40-char key), **DeepL** (UUID key), **ElevenLabs** (`sk_...` key), and **LiveKit** (cloud URL `wss://live-translation-service-...livekit.cloud`, API key `API...`, API secret), plus allocated Fly.io dedicated IPv4/IPv6. `.gitignore` deliberately ignores `API_KEYS.md` (line 4) but NOT the `.rtf`, so the secrets file slipped into version control. **These keys should be treated as compromised and rotated.** (Values not reproduced here.)

## 5. Real-time / latency path

Capture → playback:
1. **Browser capture** (`apps/web/lib/audio.ts`): `getUserMedia` at 16 kHz mono, echo/noise/AGC **off**; `ScriptProcessorNode` (deprecated API) chunks ~100 ms (`AUDIO_CONFIG.chunkDurationMs`, buffer rounded to power-of-2); Float32→Int16 PCM; sent as binary WS frames. Operator live page opens `/ws/operator` and streams (`operator/event/[id]/live/page.tsx:83-145`).
2. **Server pipeline** (`services/pipeline.ts`): binary chunk → optional pitch-based gender detection (`gender-detector.ts`, autocorrelation F0, 165 Hz threshold) → Deepgram. On **final** transcript only (`pipeline.ts:288`): parallel per active language → DeepL → Claude-Haiku improve → ElevenLabs synth. Interim transcripts go to operator only.
3. **Distribution** — dual path (`pipeline.ts:269-281 handleTTSAudio`): always emits PCM over WebSocket to attendees (`operator-handler.ts:167 broadcastAudioToAttendees`), and also publishes to LiveKit rooms **if enabled**. Translation text also broadcast to caption + attendee sockets.
4. **Attendee playback** (`apps/web/app/event/[code]/page.tsx`): supports both LiveKit (`livekit-client` Room, `TrackSubscribed`→`track.attach()`) and WebSocket PCM. **Buffering**: a promise-chain queue (`playbackChainRef`, lines 349-356) plays chunks strictly sequentially, Int16→Float32→`AudioBufferSourceNode` at 16 kHz through a gain node, with a 100 ms inter-chunk gap (`:338`). Heavy iOS-Safari AudioContext resume/user-gesture handling. Headphones-required UI.

**Transports**: WebSocket (Fastify `ws`) is the primary/active audio transport; **LiveKit WebRTC is implemented but currently force-disabled** — `routes/livekit.ts:82-91` hardcodes force-disable and comments "server-side LiveKit publishing currently has UDP connectivity issues," and the attendee page explicitly `"Skip LiveKit entirely - use WebSocket for audio"` (`event/[code]/page.tsx:273-275`). Publisher has a `LIVEKIT_FORCE_RELAY` TURN/TCP escape hatch (`livekit-publisher.ts:24-25,79-89`). No HLS anywhere. `join.ts` token endpoint still returns a mock token (superseded by `livekit.ts` real one). *Confidence: high on WS-active/LiveKit-dormant.*

## 6. Shared entities (`packages/shared/src`)

- `types.ts`: `LanguageCode` (10 langs: en/es/fr/de/pt/it/zh/ja/ko/ar), `VoiceGender`, `EventStatus`; models `GlossaryEntry`, `TranscriptEntry`, `Event`, `LanguageChannel`, `UsageLog`; request/response `CreateEventRequest/Response`, `JoinEventResponse`, `LiveKitTokenResponse`; WS unions `OperatorMessage`/`ServerMessage`; `AUDIO_CONFIG` (16 kHz/mono/16-bit/100 ms); `COST_PER_UNIT` + `estimateCost()`.
- `languages.ts`: `LANGUAGE_NAMES`, `LANGUAGE_NATIVE_NAMES`, `LANGUAGE_FLAGS`, `DEEPL_LANGUAGE_CODES`, `ELEVENLABS_VOICES` (male/female voice IDs per lang), `ELEVENLABS_VOICE_DEFAULT`, `ALL_LANGUAGES`, `getLanguageInfo()`.
- `index.ts`: barrel re-export.

## 7. State of code — prototype vs production

**Advanced prototype / early-beta, single-instance.** Real API integrations all wired (Deepgram/DeepL/ElevenLabs/Claude/LiveKit) — beyond the "Phase 1 mock" README claim; mock services (`mock-stt.ts`/`mock-translation.ts`/`mock-tts.ts`, ~414 lines) exist but are **not imported anywhere** — `pipeline.ts` uses real services unconditionally and throws if keys are missing (`deepgram-stt.ts:40`, etc.), so the documented "runs without keys" fallback is effectively dead.
- **Tests: none** (no `*.test.*`/`*.spec.*`, no test runner/CI config found).
- **Error handling**: consistent try/catch with console logging and `onError` callbacks; graceful LiveKit degradation to WS; LLM improver fails safe to raw translation. But no auth (`operatorId:"default" // TODO: Add auth`, `events.ts:66`), no persistence, no rate limiting; CORS defaults to `*` (`index.ts:24`). `index.ts:88` has a `// Cache bust` marker.
- **Scaling caveat**: all coordination via in-process Maps → cannot horizontally scale (yet Fly concurrency allows 400/500 conns, README targets "400 concurrent"). Single machine only.
- **Operator console maturity — fairly mature**: `operator/page.tsx` (list, 147 ln), `operator/event/new/page.tsx` (356 ln — full create form incl. speakerGender, `dynamicGenderDetection` toggle, glossary term editor, LLM `context` field, `operator/event/new/page.tsx:20-24`), `operator/event/[id]/page.tsx` (167 ln detail), `operator/event/[id]/live/page.tsx` (417 ln — live streaming, device picker, mute, audio meter, live transcript/translations, listener counts, usage, QR code), `operator/settings/voices/page.tsx` (335 ln voice browser/config). Attendee `event/[code]/page.tsx` (552 ln) and `caption/[code]/page.tsx` (369 ln) both substantial. RYTE branding present (`tailwind.config.ts` ryte primary/secondary/accent `#FF6B00`, Inter font; PWA `manifest.json`; referenced icon-192/512 PNGs are absent from `public/`).

## 8. Docs inventory

- `README.md` (149 ln): overview, tech-stack table, quick start, phased roadmap, API-key signup links.
- `DEPLOY.md` (92 ln): Fly + Vercel deploy, secrets list, env-var reference tables, troubleshooting.
- `.env.example` (root) + `apps/web/.env.local.example`: all env vars incl. commented Phase-2 `DATABASE_URL`/`REDIS_URL`.
- `API_KEYS.rtf`: **should be documentation but is a committed live-secrets file (see §4)**.
- No `docs/` directory. No CHANGELOG/CONTRIBUTING/ARCHITECTURE/LICENSE file (license only declared in package.json). Inline JSDoc headers on every service file. `scripts/find-voices.ts` (98 ln) is a standalone ElevenLabs voice-library discovery utility.

## 9. References to other Trivency / RYTE apps

**None found in-repo.** Grep for `trivency|showengine|zoom-chat|webinar-stack|livesalesengine|qnet` across all ts/tsx/md/json returned zero hits. The only cross-branding is "RYTE Productions." Note: sibling repos DO exist alongside this one under `/workspace/` (`webinar-stack`, `livesalesengine`, `qnet-*`, `agency-agents`, `daw`, `manufacturer-database`) and `zoom-chat-aggregator` under `/home/user/`, but this codebase contains no code, config, or doc references linking to any of them. *Confidence: high (repo is self-contained).*

---

The target is `/workspace/daw` (not the cwd). Let me explore it thoroughly.
Let me read the config files, docs, and the audio engine in parallel.
Now the audio engine, effects, state, and types.
Now the pages, App, and plan docs.
Now the plan docs and remaining components (to gauge implementation depth and Trivency references).
Let me check remaining components, CONVENTIONS, and grep for persistence, export, and Trivency-suite references.
No suite references found in the daw repo. Let me quickly confirm no tests exist and check the file-upload wiring in ChannelStrip.
I have enough to compile the report. Let me quickly confirm ChannelStrip's playback wiring and the shallow git history.
I have a complete picture. Here is the deep-read.

---

# `/workspace/daw` — Architecture Deep-Read (read-only)

Web-first DAW, working name "DAW" (SPECTRE rename deferred). Three-page model: Mix / Build / Run ("Show"). React 18 + Vite, **no backend**. All paths absolute below.

## 1. Languages / frameworks / runtimes + versions
- **React 18 + TypeScript (strict) + Vite**, ESM (`"type": "module"`). `/workspace/daw/package.json:13-23`:
  - `react` ^18.3.1, `react-dom` ^18.3.1 (only two runtime deps — deliberately lean).
  - dev: `typescript` ^5.6.3, `vite` ^6.0.3, `@vitejs/plugin-react` ^4.3.4, `@types/react(-dom)` ^18.3.x.
- **Node 22** pinned: `/workspace/daw/.nvmrc:1`.
- **TS config** `/workspace/daw/tsconfig.json`: target ES2020; `module`/`moduleResolution` ESNext/bundler; `jsx: react-jsx`; `noEmit`; `strict:true` + `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` (line 16-19). No path aliases.
- Entry: `/workspace/daw/index.html:11` → `/src/main.tsx`. Standard `createRoot` mount expected (main.tsx present, not separately read).

## 2. Build tooling + deploy
- Scripts `/workspace/daw/package.json:7-12`: `dev`=vite; `build`=`tsc -b && vite build`; `preview`; `start`=`vite preview --host 0.0.0.0 --port ${PORT:-4173}`.
- `/workspace/daw/vite.config.ts`: react plugin; `server.host:true`; `preview.host:true`, `preview.allowedHosts:true` (comment lines 11-13 explain this is for Railway's assigned hostname).
- **Deploy = Railway / Nixpacks**, `/workspace/daw/railway.json`: builder NIXPACKS, `startCommand: npm start`, restart ON_FAILURE max 10. **No Dockerfile.** README (`/workspace/daw/README.md:34-38`) confirms Railway serves the *built web app only* (not audio). PROGRESS notes the live Railway deploy is **still unconfirmed** (`/workspace/daw/plan/PROGRESS.md:83-85`).
- Local dev launch config `/workspace/daw/.claude/launch.json` (nvm + `npm run dev` on :5173).

## 3. Audio engine (Web Audio API)
Single source of truth: `/workspace/daw/src/audio/engine.ts` (391 lines) + `/workspace/daw/src/audio/effects.ts`. **Discipline enforced**: only `src/audio/` creates/wires nodes (CONVENTIONS `/workspace/daw/plan/CONVENTIONS.md:24-27`).

- **Singleton** `engine` `/workspace/daw/src/audio/engine.ts:390`. Lazy `AudioContext` created after user gesture via `ensureStarted()` (:171-183); one master `GainNode`(0.9) → masterAnalyser + destination (:175-179). "Start engine" button drives it: `/workspace/daw/src/App.tsx:20-23,47-49`.
- **Per-track chain** `class TrackChain` (:26-161). Signal flow (:5-8):
  `source → [Gain] → [EQ] → [Compression] → [Saturation] → fader → master → dest`.
  - **Gain**: `GainNode`, `dbToGain` `/workspace/daw/src/audio/effects.ts:10-16`.
  - **EQ**: three chained biquads lowshelf(120Hz)→peaking(Q1)→highshelf(8k), `createEq`/`applyEq` `effects.ts:25-48`.
  - **Compression**: native `DynamicsCompressorNode`, knee hardcoded 6 `effects.ts:50-56`.
  - **Saturation**: `WaveShaperNode`, soft-clip curve `k=(drive/100)*100`, 1024 samples, `oversample:"2x"` `effects.ts:62-78`.
- **Bypass by rewiring** (crown-jewel pattern): `rewire()` `engine.ts:69-94` disconnects all then relinks only `enabled` stages; disabled stages skipped so all-off = true pass-through. Analyser tap re-established each rewire (:93). `fftSize` 1024, smoothing 0.8 (:45-46).
- **Live input**: `startLive()` `engine.ts:280-290` calls `navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})` → `MediaStreamAudioSourceNode`. `stopLive` stops tracks (:144-153). **Single-device, mono-ish; no `enumerateDevices`, no channel/device selection yet** (that's S1.2 — `AVAILABLE_INPUTS` in types is a 16-entry placeholder, `types.ts:99-102`).
- **File playback**: `loadFile` decodes ArrayBuffer via `decodeAudioData`, caches `AudioBuffer` in `buffers` map (:261-267); `playFile`/`playBuffer` (:113-121, 269-274). Upload wired in UI: `/workspace/daw/src/components/ChannelStrip.tsx:31-37,151` (`<input type=file accept=audio/*>` → `engine.loadFile` → stores `fileName`+`duration`).
- **Metering**: `getMasterAnalyser`/`getTrackAnalyser` expose `AnalyserNode`s (:186-193); consumed by `SignalIndicator`, `Rta`, `LevelMeter`, `IoOverviewPage` SignalDot (RMS>threshold → "live" dot, `/workspace/daw/src/pages/IoOverviewPage.tsx:98-131`).
- **Waveforms**: `getPeaks(id,buckets,startSec,durSec)` downsamples channel 0 to peak buckets `engine.ts:200-228`; drawn on canvas in BuildPage `Waveform` (:706-756).
- **Build transport**: `playArrangement(clips, fromSec)` `engine.ts:313-370` — schedules per-clip `AudioBufferSourceNode` with `playbackRate = sourceLen/duration` (varispeed), equal-power sin/cos fade curves to true silence (:329-335, 357-364); `stopArrangement` (:372-386). Driven by BuildPage transport (`/workspace/daw/src/pages/BuildPage.tsx:237-256`, rAF playhead).
- **Export / bounce path: NOT implemented.** Planned via `OfflineAudioContext` (`/workspace/daw/plan/01-ARCHITECTURE.md:56`, CONVENTIONS `:44`); the "Bounce → new track" button is hard-`disabled` (`/workspace/daw/src/pages/BuildPage.tsx:499-501`). No `OfflineAudioContext` occurrences in `src/` (grep confirms only docs mention it). No recording (`MediaRecorder`) either.

## 4. Data layer / persistence
- **NONE.** No `localStorage`, `IndexedDB`, `sessionStorage`, or file save/load anywhere in `src/` (grep across repo returns only plan/doc mentions). 
- Session state is **in-memory only**: `/workspace/daw/src/state/session.ts` — a hand-rolled observable store (`state` object + `listeners` Set + `emit`/`setState`/`subscribe`/`getSnapshot`) consumed via `useSyncExternalStore` (:24-49, 133-143). No Redux/Zustand (CONVENTIONS forbids, `:7`).
- Build page **layers/clips are local React state** in `BuildPage`, not even in the session store (`/workspace/daw/src/pages/BuildPage.tsx:75-77`; PROGRESS confirms `:132`). Run page cues are derived on the fly from tracks, not persisted (`/workspace/daw/src/pages/RunPage.tsx:20-24`).
- Persistence (versioned JSON w/ `schemaVersion`, localStorage-first) is **planned S0.3/S4.1**, unstarted (`/workspace/daw/plan/02-SESSION-SPLIT-STRATEGY.md:26-30,92-94`; open question localStorage-vs-file `/workspace/daw/plan/PROGRESS.md:149`). IDs are ephemeral `t{timestamp}-{counter}` (`session.ts:45-49`).

## 5. API surface / server hooks
- **Fully client-side. Confirmed.** No `fetch`, no server, no auth, no env vars, no API routes anywhere in `src/`. Railway only static-serves the Vite build via `vite preview`. Explicit non-goal: no accounts/auth/billing in Wave 1 (`/workspace/daw/plan/00-MASTER-PLAN.md:57-61`, CLAUDE.md `:37`). The only external I/O is browser `getUserMedia` + local file upload.

## 6. State of code: prototype vs hardened
- **Prototype / design-forward.** ~3,121 LOC of TS/TSX across 22 files.
- **Tests: NONE** (no `*.test`/`*.spec`, no vitest/jest — grep + config confirm). Quality gate is manual: "`npm run build` clean + verify in browser" (`/workspace/daw/plan/CONVENTIONS.md:55-58`). TS strict is the main safety net.
- **Implemented vs planned** (per `/workspace/daw/plan/PROGRESS.md:9-38` status board vs actual `src/`):
  - **Engine core**: real & working (Gain/EQ/Comp/Sat + bypass-rewire + live + file playback + arrangement playback). Missing: metering-on-strips wiring, multichannel capture, recording, bounce.
  - **Mix**: heavily built visually (SD.1–SD.7 all ✅). BUT a **critical gap**: the elaborate modeled channel-strip (`Track.strip`: SSL-style 8-band EQ+HPF/LPF, Waves C1 comp, expander, 6 insert slots, reorderable chain) is **UI-only — does NOT touch the audio graph**. Audio still runs through the *separate* `Track.effects` path, which is **bypassed by default** (`defaultEffects` all `enabled:false`, `/workspace/daw/src/types.ts:190-203`). Two parallel effect models coexist; unifying them is deferred (PROGRESS `:54-57,165-166`; types comment `:74-77`). Analysers ARE live.
  - **Build**: timeline is genuinely functional (SB.1/SB.2 ✅) — drag clips, layers, zoom, fade/crossfade/cut/trim/stretch varispeed, spacebar/playhead transport, live waveforms. Only **Bounce** missing.
  - **Run/Show**: **concept layout only.** 8-ch console (faders/mute/solo local state), QLab cue stack with GO advancing a `standby` index + ALL STOP — but **no real cue firing/audio** (RunPage `:29-36`; cue engine is S3.2/S3.3, unstarted). Solo is dead UI state (`:71-75`).
  - Cross-cutting S4 (save/load, hardwire bypass) and Wave 2 entirely unstarted.
- **Git**: single squashed commit `d89e467` on `main`, no branches/tags (despite the rich multi-session decisions log — history was flattened; **flag**: PROGRESS narrative far exceeds git evidence). No CI (`.github/` absent in daw; the one at repo root belongs to a different project).

## 7. Docs inventory
- `/workspace/daw/CLAUDE.md` — orientation + locked decisions; mandates read-order and "audio graph is the crown jewel."
- `/workspace/daw/docs/ARCHITECTURE.md` — **superseded** (banner line 3-5), historical.
- `/workspace/daw/plan/` (canonical): `00-MASTER-PLAN.md` (locked stack/decisions/phases 0-5+Wave2), `01-ARCHITECTURE.md` (layering law "UI→state→engine→nodes", entities, signal flow), `02-SESSION-SPLIT-STRATEGY.md` (S0.1–S5.1 session gates), `CONVENTIONS.md` (frozen stack/naming/discipline), `PROGRESS.md` (living tracker — declared ground-truth over chat).
- **Two-wave plan** (CLAUDE.md `:27-40`, MASTER-PLAN `:24-53`): **Wave 1** = this web app (Web Audio, Railway). **Wave 2** = wrap same React/TS UI in **Tauri + Rust real-time core** (`cpal`, `symphonia`), adding VST3/AU plugin hosting, low-latency multichannel I/O, Dante-as-device (via Dante Virtual Soundcard, no SDK). `src-tauri/` to be added later; `src/` reused unchanged. Honest constraints doc explicitly rules out "same code as Pro Tools", browser VST3/AU, AAX/UAD-2, direct Dante SDK (docs/ARCHITECTURE.md `:32-51`).

## 8. Trivency-suite integration (ShowEngine / webinar-stack / QNet)
- **No references whatsoever.** Grep for `Trivency|ShowEngine|QNet|webinar|Game Audio` across the daw repo → **zero hits.** No cross-imports, no shared packages, no monorepo wiring. `package.json` has no `@trivency`/workspace deps.
- The other suite apps (`livesalesengine`, `webinar-stack`, `qnet-*`, etc.) merely live as **sibling directories under `/workspace/`** — coincidental colocation, not a dependency.
- **Conclusion: this DAW is standalone.** Nothing in code or docs positions it as part of the Trivency suite or as an integration target for ShowEngine/webinar/QNet audio. (Low-confidence caveat: the QLab-style cue/show model is *conceptually* adjacent to show-control tooling, but there is no stated or coded linkage.)

## Notable flags / risks
- **Dual effect models** (wired-but-bypassed `Track.effects` vs UI-only `Track.strip`) is the biggest architectural debt — the impressive Mix UI produces **no audible processing** today (`/workspace/daw/src/types.ts:74-77`, PROGRESS `:54-57`).
- Run page is a **non-functional mockup** (no cue audio).
- No persistence, no tests, no bounce/export, single-commit history — consistent with an early, doc-heavy prototype.
- `setVolume`/`setMuted` interaction (`engine.ts:102-109`) restores fader to `1` when unmuting if stored value was 0 — minor latent bug (low confidence, edge case).

---

I have comprehensive coverage. Compiling the report.

---

# QNet (`qnet-control`) — Architecture Deep-Read

Read-only analysis of `/workspace/qnet-`. Beta software; v0.1.0. "QNet" = open software replacement for a Crestron AV control processor (TS/Node 22, runs on PC/NUC/RPi). All paths absolute. Low-confidence items flagged `⚠`.

## 1. Languages / Frameworks / Runtimes

- **TypeScript ESM**, Node.js 22+. `package.json:5` `"type":"module"`; `package.json:2` name `qnet-control`, `:3` version `0.1.0`, `:7` license `UNLICENSED` (proprietary © Trivency — see `/workspace/qnet-/LICENSE`).
- **tsconfig** (`/workspace/qnet-/tsconfig.json`): target ES2022, module ESNext, moduleResolution `Bundler`, `strict:true`, `noUncheckedIndexedAccess:true`, `outDir dist`, `rootDir src`, `resolveJsonModule`.
- **Runtime deps** (`package.json:33-45`): `@anthropic-ai/sdk ^0.104.2`, `mqtt ^5.15.1`, `protobufjs ^8.6.5`, `ws ^8.21.0`, `node-cron ^4.5.0`, `web-push ^3.6.7`, `zod ^3.24.2`, `selfsigned ^5.5.0`, plus `@types/*`.
- **devDeps** (`:46-53`): `tsx ^4.19.2`, `typescript ^5.8.3`, `esbuild ^0.28.1`, `@yao-pkg/pkg ^6.20.0` (the maintained pkg fork), `playwright ^1.49.1` (screenshots only).
- **pkg binary targets** (`package.json:24-32`): `node22-{win-x64, macos-x64, macos-arm64, linux-x64}`, out `dist`; `bin` = `build/qnet.cjs`.
- **Dockerfile** (`/workspace/qnet-/Dockerfile`): base `node:22-slim`, `npm install`, `HTTP_PORT=8080`, `VOLUME /app/data`, `CMD npm start` (runs via `tsx`, not the compiled bundle). `docker-compose.yml` uses `network_mode: host` (needs raw LAN + broadcast for discovery/Art-Net); image `ghcr.io/dmwebster/qnet:beta` ⚠ still hardcodes old owner `dmwebster` in compose despite MIGRATION claiming no hardcoded owner remains.

## 2. Build Tooling

- **Dev/run**: `tsx watch src/index.ts` / `tsx src/index.ts` (`package.json:9-10`). No transpile step for normal run.
- **Bundle** (`scripts/build.mjs`): esbuild bundles `src/index.ts` → single CJS `build/qnet.cjs` (platform node, target node22), bakes `__QNET_VERSION__`/`__QNET_BUILD__` defines (read by `src/version.ts`), shims `import.meta.url` for CJS, copies `src/server/public` → `build/public`. Catalog drivers deliberately NOT bundled (fetched at runtime).
- **Binaries** (`package.json:20`): `build.mjs` then `pkg build/qnet.cjs` → `dist`.
- **installer/** — per-OS packaging: `installer/windows/qnet.iss` (Inno Setup) + `qnet-launch.vbs`; `installer/macos/build-pkg.sh` + `com.qnet.node.plist` (LaunchDaemon) + `scripts/postinstall`; `installer/linux/build-deb.sh` + `qnet.service` (systemd). `installer/README.md`.
- **deploy/** — `deploy/qnet.service` (systemd unit).
- **scripts/** — `install.sh`, plus `.cmd` wrappers (`scan-network.cmd`, `read-brompton.cmd`, `probe-vu.cmd`, `blackout-demo.cmd`, `discover-leds.cmd`, `setup.cmd`, `start-control.cmd`) and `screenshots.mjs` (Playwright).
- **CI** (`.github/workflows/`): `ci.yml`, `release.yml` (GHCR image `ghcr.io/${{ github.repository_owner }}/qnet`), `installer-{windows,macos,linux}.yml`, `installers.yml`. Owner-agnostic via `${{ github.repository_owner }}`.

## 3. Data Layer

- **No database.** All persistence is flat JSON files under a single `DATA_DIR` (default `./data`; Docker `/app/data`; Win `%ProgramData%\QNet\data`; mac `/usr/local/var/qnet`; Linux `/var/lib/qnet` — README:143-158).
- **Store primitive** (`src/core/json-store.ts`): `readJson(file,fallback)` / `writeJson` — try/catch, never throws, `mkdirSync recursive`, pretty-printed. This is the entire "DB engine."
- **Files** (each module owns one, env-overridable): `devices.json` (`src/devices/loader.ts:316`), `profiles.json` (`src/core/auth.ts:31`), `panels.json` (`panels.ts:65`), `kiosk.json` (`kiosk.ts:37`), plus macros, schedules, rules, flows, triggers, tokens, calendar, alert-config, topology, av-streams, device-config, crestron-config, join-map, site, adopted-store, activity log, audit log, health-history, fleet, license, snapshots, templates. Runtime driver cache: `data/drivers/` (`catalog.ts:20`).
- **Device runtime state** is in-memory only: `DeviceManager.entries: Map<tag, {driver, state}>` (`src/core/device-manager.ts:47`), rebuilt each boot from config + adopted-store. `DeviceState` shape in `src/types.ts:66-76` (tag/name/kind/model/capabilities/health/metrics/updatedAt).
- **Backup/restore** = zip/export of the whole `data/` dir (`src/core/backup.ts`, `/api/backup`, `/api/restore`).

## 4. API Surface (`src/server/http.ts`, 1573 lines)

Hand-rolled Node `http` server (no framework) — one giant `if (method && pathname===...)` chain. Static PWA served from `src/server/public/` with path-traversal guard (`http.ts:140-142`). SSE stream at `GET /api/events` pushes `DeviceManager.snapshot()` (`onUpdate` hook). HTTPS via `selfsigned` (`src/core/tls.ts`, `/api/tls/selfsigned`). Security headers in `src/server/security-headers.ts`.

**Route families** (all `/api/*`): `state`, `events` (SSE), `command`, `group`, `macros{,/run,/save,/delete}`, `scenes`, `schedules{,/toggle,/run,/delete}`, `rules`, `triggers`, `flows{,/get,/save,/run,/delete}`, `panels{,/get,/save,/generate,/delete,/asset,/asset/upload}`, `calendar`, `topology{,/graph,/save}`, `streams/routes`, `sensors`, `conferencing`, `joins{,/set}`, `crestron/ipid`, `device-config`, `device/{address,remove,diagnose,androidtv/pair/*}`, `scan{,/sync,/status}`, `identify`, `adopt`, `drivers{,/test}`, `health/history`, `activity`, `audit`, `alerts/config`, `push/{vapid,subscribe}`, `backup`/`restore`, `report/activity.csv`, `tokens`, `users/{create,update,delete}`, `profiles/pin`, `login`/`logout`/`kiosk/login`/`setup`/`me`/`auth/config`, `admin/{2fa,2fa/verify,2fa/disable,homeassistant}`, `fleet/{state,enroll}`, `license`, `update{,/download}`, `avtools{,/launch}`, `netinfo`, `templates*`, `snapshots*`, `demo/{seed,clear}`, `reset`, `tls/selfsigned`, `site{,/export,/import}`, `logo`, `feedback`.

**External integration API** (`/api/ext/*`, `http.ts:174-207`): token-authed (`x-...` API token via `src/core/api-tokens.ts`): `GET /api/ext/state`, `POST /api/ext/command`, `/api/ext/scene`, `/api/ext/trigger`, `/api/ext/sensor` — inbound webhooks/triggers for third-party systems.

**Portal consumes** (the SPA `src/server/public/app.js`, ~3.7k lines per PROJECT_STATUS:82): renders against `/api/state` + `/api/command` + SSE `/api/events`; panels render widgets against same. `catalog/index.json` format ≠ manufacturer-DB (see §6): `{drivers:[{id,version,url,sha256,label,kind}]}` (`catalog/index.json`), a hash-pinned remote-driver index consumed by `src/core/catalog.ts`.

## 5. Hardware Transports — CRITICAL SECTION

### Transports (`src/transports/`)
- `tcp.ts` — `TcpTransport` (persistent socket, `request(payload, quietMs)` collects until silence) + `tcpRequest()` one-shot. Workhorse for ASCII/telnet gear.
- `ping.ts` — `tcpPing(host,port,timeout)` reachability probe.
- `sacn.ts` — `SacnSender`: ANSI E1.31 sACN/DMX-over-IP UDP:5568, full 512-slot packet builder (`buildSacnPacket`), unicast default. Replaces Crestron "SACN SenderDirectSockets."
- No `serialport` dependency — RS-232 is done over IP via Global Caché gateways, not local serial.
- Additional transport code inline in drivers: `node:dgram` UDP (WoL, ATEM, OSC, BirdDog, Resolume, Behringer X32, ChamSys, ZoomOSC, Dante), `ws` WebSocket (Samsung Tizen, OBS, Vū/Unreal, LG webOS; also referenced in discovery), `protobufjs` (**only** `src/drivers/androidtv.ts` — Android TV Remote v2 protobuf over TLS), `web-push` (`src/core/push.ts`), `node-cron` (`src/core/scheduler.ts`).

### Bridge (`src/bridge/`) — cloud Portal link (NOT the Crestron bridge)
- `portal-telemetry.ts` — `PortalBridge`: outbound POST to Portal `/api/public/ingest/{telemetry,hardware,topology}`, auth header `x-agent-key` (plaintext; portal stores sha256). Reuses the existing one-way monitoring-agent contract.
- `command-poller.ts` — `CommandPoller`: NAT-friendly PULL model. Node polls `GET /api/public/commands/pull`, runs each command locally (kind `device` → `DeviceManager.execute`; kind `api` → proxies ANY `/api/*` to loopback with `x-internal-token`), POSTs `/api/public/commands/result`. Gives portal full parity with on-site panel. Gated by `REMOTE_CONTROL` (default true).

### Drivers (`src/drivers/`, ~57 files) — the driver registry is `DRIVER_CATALOG` + `createDeviceDriver()` switch in `src/devices/loader.ts:116-314`. Each row is `{id,label,kind,protocol}` with protocol string `<protocol> / <transport> <port>`:

| id | Vendor/Protocol | Transport:port |
|---|---|---|
| boland | Boland broadcast monitor | TCP 5009 |
| samsung-mdc | Samsung MDC | TCP 1515 |
| lg-display | LG RS-232-over-IP | TCP 9761 |
| sony-bravia | Sony BRAVIA REST JSON-RPC (PSK) | HTTP 80 |
| nec-display | NEC External Control | TCP 7142 |
| webos | LG webOS SSAP | WebSocket 3000 |
| samsung-tizen | Samsung Tizen remote | WebSocket 8001 |
| androidtv | Android/Google TV Remote v2 (protobuf) | TLS 6466 (pairing) |
| pjlink | PJLink (most projectors/displays) | TCP 4352 |
| epson-projector | Epson ESC/VP.net | TCP 3629 |
| bss | BSS Soundweb London DI | TCP 1023 |
| qsys | QSC Q-SYS QRC (JSON-RPC) | TCP 1710 |
| biamp-tesira | Biamp Tesira TTP | Telnet 23 |
| behringer-x32 | Behringer X32/Midas M32 OSC | UDP 10023 |
| yamaha-rcp | Yamaha CL/QL/TF RCP ASCII | TCP 49280 |
| allen-heath | A&H SQ/dLive MIDI-over-TCP | TCP 51325 |
| shure-mxa | Shure Microflex MXA ASCII | TCP 2202 |
| denon-avr | Denon/Marantz ASCII | Telnet 23 |
| dante | Dante audio | mDNS `_netaudio` |
| avpro | AVPro Edge matrix ASCII | TCP 23 |
| extron-sis | Extron SIS matrix | TCP 23 |
| kramer-p3000 | Kramer Protocol 3000 | TCP 5000 |
| bmd-videohub | Blackmagic Videohub | TCP 9990 |
| atem | Blackmagic ATEM | UDP 9910 |
| roland-v60hd | Roland V-60HD/V-160HD | TCP 8023 |
| sacn | Lighting sACN (E1.31) | UDP 5568 |
| etc-eos | ETC Eos OSC | TCP 3032 |
| chamsys | ChamSys MagicQ remote | UDP 6553 |
| lutron | Lutron Integration Protocol (LIP) | Telnet 23 |
| wled | WLED JSON API | HTTP 80 |
| showxpress | ShowXpress/TheLightingController/QuickDMX/Sweetlight | TCP 7348 |
| ptz | VISCA PTZ | TCP 5678 |
| birddog-ptz | BirdDog PTZ REST | HTTP 8080 |
| panasonic-ptz | Panasonic AW CGI | HTTP 80 |
| obs | OBS obs-websocket | TCP 4455 |
| vmix | vMix Web API | HTTP 8088 |
| tricaster | NewTek TriCaster Shortcut API | HTTP 80 |
| resolume | Resolume Arena/Avenue OSC | UDP 7000 |
| propresenter | ProPresenter 7 REST | HTTP (configurable) |
| vu | Vū / Unreal Remote Control | HTTP 30010 |
| zoomosc | ZoomOSC/ZoomISO OSC | UDP 9090 |
| vlc | VLC web (Basic auth) | HTTP 8080 |
| roku | Roku ECP | HTTP 8060 |
| wolfvision | WolfVision | TCP 50915 |
| ndi | NDI source/output | mDNS `_ndi._tcp` |
| datavideo-nvs | Datavideo NVS (monitor-only, no control API — `ReachabilityStubDriver`) | ping :80 |
| onair | On-Air light via Global Caché relay IP2CC | TCP 4998 |
| ir | IR device via Global Caché IP2IR | TCP 4998 |
| serial | RS-232 via Global Caché IP2SL | TCP 4999 |
| mqtt | Smart device (Zigbee2MQTT/Matter/Shelly) | MQTT broker |
| wol | Wake-on-LAN magic packet | UDP 9 |
| tcpraw | Generic raw TCP/telnet | TCP 23 |
| osc | Generic OSC | UDP 9000 |
| simulator | In-memory demo/test | — |
| brompton | Brompton Tessera LED processor ASCII | TCP 23 |
| analogway | Analog Way Aquilon/Midra ASCII | TCP 10500 |
| **crestron** | **Crestron CIP bridge** | **TCP 41794** |

Extra driver files beyond catalog rows: `brompton-api.ts` (HTTP API variant of Brompton), `globalcache-serial.ts`, `_template.ts` (SDK scaffold), `reachability-stub.ts`. Aliases (legacy fingerprint ids → catalog ids) in `src/core/driver-factory.ts:28-39`.

**Crestron CIP bridge** (`src/drivers/crestron-cip.ts`, 514 lines) — the headline "modernize alongside Crestron" feature. Acts as a touchpanel/XPanel on TCP 41794: registers an IP-ID (default 0x03), does the `0x0F→0x02→0x01` handshake, replies to `0x0D` heartbeats with `0x0E`, and encodes/decodes digital/analog/serial joins (1-based joins, wire = join−1; documented Crestron inverted-logic 0x80 bit for digital). Actions: `press/release/pulse/set_analog/send_serial`. Maintains in-memory feedback maps (`fbDigital/fbAnalog/fbSerial`) with a change-`seq` for the panel "learn/join monitor" UI (`feedbackSnapshot()`). **⚠ Explicitly self-flagged (crestron-cip.ts:44-49): the 0x05 sub-headers and update-request bytes are from published FOSS/CIP captures, NOT an official Crestron spec — needs packet-capture verification before production.** Auto-reconnect + dead-link watchdog (`HEARTBEAT_TIMEOUT_MS=45000`). Well unit-tested: `crestron-cip.test.ts` + `crestron-cip.socket.test.ts`. Join config precedence: runtime UI override > devices.json > default (`loader.ts:214-218`, via `join-map.ts`/`crestron-config.ts`).

**Not present:** no SNMP driver, no PJLink-class-2 extras, no dedicated OSC-generic-in beyond `osc`/`zoomosc`. PJLink covers the projector long tail; VISCA the PTZ tail; OSC/MQTT/Q-SYS whole ecosystems; `tcpraw`/`httpcmd` are catch-alls.

### Internal state model
- Domain types in `src/types.ts`: `Health` (ok/warn/critical/unknown/offline), `DeviceKind` (16 kinds incl. led/matrix/onair/dante/ndi), `Driver` interface (`src/core/driver.ts`: connect/disconnect/health/poll/execute) + `BaseDriver` no-op base. Drivers omit `device_tag`; manager stamps it.
- `DeviceManager` (`src/core/device-manager.ts`) is the "brain": concurrent poll loop (`POLL_INTERVAL_MS` default 15000; `REFRESH_TIMEOUT_MS=8000` hard per-device timeout; skips overlapping cycles), health derived from whether `poll()` throws, logs power/onair/blackout metric transitions + health transitions to activity, feeds proactive offline alerts (`alerts.ts`) + rolling `health-history.ts`, and every 6th cycle rolls topology (`topology.ts buildGraph`) to the portal.
- Devices materialized from `data/devices.json` via `createDeviceDriver` (`loader.ts`), plus optional built-in `STUDIO7_PRESET` set (`src/devices/registry.ts`), legacy `custom-devices.ts`, and re-attached auto-discovered gear (`adopted-store.ts`). Unknown driver ids fall through to the remote catalog.

### Discovery (`src/discovery/`)
- `scanner.ts` — active TCP-connect sweep of curated `SCAN_PORTS` across a range (CIDR / `a.b.c.x-y` / single IP; 4096-host cap; concurrency 256; 600ms timeout; no ICMP/root). Reads OS ARP cache (`arp -a[n]`) for MACs. `identifyHost()` powers UI auto-detect. Passive discovery: `listenArtNet()` (UDP 6454), `discoverSsdp()` (SSDP/UPnP M-SEARCH), `discoverMdns()` (hand-rolled mDNS/DNS-SD packet builder+parser on ephemeral port to avoid port-5353 conflict with avahi/mDNSResponder). `enrichDevice()` adds reverse-DNS + HTTP banner/title; `guessRoom()` heuristics (⚠ hardcoded to the AdventHealth "Studio 7" room names: Green Room, Vestibules, Edit Bay Master, Nicky's Office, etc.).
- `fingerprints.ts` — the knowledge base: `SCAN_PORTS` (port→proto/driver/kind), `OUI` MAC-vendor table (Crestron `C4:42:68`, Brompton, Panasonic, etc.), `MDNS_SERVICES` (`_pjlink._tcp`, `_ndi._tcp`, `_netaudio-*`, `_samsungmsf._tcp`, Matter/HomeKit/Cast, printer-ignore set), `BRAND_DRIVERS` name→driver regexes, `DRIVER_PORTS` for the connection diagnostic, `identify()`/`identifyMdns()` with printer-guard. Tests: `fingerprints.test.ts`, `scanner.test.ts`.
- `credentials.ts` (default creds e.g. PJLink `panasonic`), `scan-jobs.ts` (async scan job store), `llm-label.ts` (AI — see §9).

## 6. Relationship to Manufacturer-Database repo

**No runtime or build reference.** Grep for `manufacturer-database|protocol database|av protocol` across `qnet-` returns nothing. The sibling repo `/workspace/manufacturer-database` ("AV Device Protocol Database") is a **dev-time source of truth**: its README states it's "Built so a Claude Code session can generate per-device integration code without re-researching each protocol" — one JSON per manufacturer (`manufacturers/<slug>.json` conforming to `schema.json`, with `control_interfaces[]` = transport, `protocols[]` = command layer, `example_commands`, `confidence`, `sources`). Its schema (PJLink/Art-Net/QRC/CIP/VISCA vocabulary) maps 1:1 onto QNet's hand-written drivers, and its vendor list (analog-way, bss, qsc-qsys, allen-heath, chamsys, epson, sharp-nec, ptzoptics, etc.) mirrors `DRIVER_CATALOG`. QNet's own `catalog/` is a **different, unrelated** artifact: a hash-pinned *remote-driver-download* index (`catalog/index.json` → `{id,version,url,sha256,label,kind}`; one example driver `catalog/drivers/httpcmd.mjs` exporting `createDriver(spec)`), the "Companion download-a-module" model implemented by `src/core/catalog.ts` (SHA-256 integrity, disk cache, dynamic `import()`). So: the Manufacturer-DB feeds driver *authoring*; the QNet catalog feeds driver *distribution*. Relationship is conceptual/pipeline, not code-linked. ⚠ Inference — no explicit cross-reference exists to confirm the authoring pipeline.

## 7. State of Code (beta)

- **Beta**, v0.1.0. PROJECT_STATUS.md: `tsc --noEmit` clean, "**141/141 tests passing**", builds green; every branch commit gated on typecheck+test. 23 `*.test.ts` files present (node built-in test runner: `node --import tsx --test`).
- Test coverage skews to pure/core logic: crestron-cip (×2, incl. socket), fingerprints, scanner, flows, join-map, kiosk, license, panels, panel-gen, recurrence, sun, topology, totp, ratelimit, sensors, conferencing, device-config, crestron-config, dist-repo, envfile, propresenter, showxpress. Most *drivers* have NO tests.
- **Error handling is defensive throughout**: `installProcessGuards()` (`index.ts:28`, `process-guard.ts`) so a bad driver/socket can't crash the node; `json-store` never throws (corrupt file → fallback); `DeviceManager` per-device timeout + catch; drivers wrap protocol errors into `{ok,detail}`. `panels.ts`/`kiosk.ts` sanitize untrusted input rather than reject.
- **Hardening caveat (PROJECT_STATUS:64-67)**: "driver fixes are **protocol-audited, not yet hardware-verified**." ~53 drivers audited, ~40 had real bugs fixed, adversarially re-reviewed; P1 open task = field-verify against real hardware. Discovery smart-TV scan gap fixed.
- **Rate limiting** (`ratelimit.ts`) on login; TOTP 2FA (`totp.ts`, `/api/admin/2fa`); audit log (`audit.ts`); self-update (`self-update.ts`/`update-check.ts`/`dist-repo.ts`, default `Trivency/qnet-dist-`, env `QNET_DIST_REPO`).
- **MIGRATION.md** — GitHub org-migration runbook (dmwebster→Trivency), the "downloads" repo `qnet-dist-` two-repo split, DIST_TOKEN handling, GitHub redirect preservation for existing installs' updater, rollback. Code already owner-agnostic via `${{ github.repository_owner }}` + `dist-repo.ts` default. ⚠ `docker-compose.yml:3` still hardcodes `dmwebster` (contradicts MIGRATION §2 claim).

## 8. Docs Inventory

- **docs/** (28 md + images): README (index), GETTING_STARTED, USER_GUIDE, INSTALL, RUNNING_LOCALLY, OPERATOR_QUICKSTART, DRIVER_SDK, DRIVER_TIERS (vendor prevalence ranking), INTEGRATION_COVERAGE, PACKAGING, PORTAL_DEPLOYMENT, REMOTE_OPERATIONS, PROJECT_STATUS (handoff — read-first), BETA_ROADMAP, ROADMAP_1.0, ECOSYSTEM_STRATEGY, SYSTEM_DEBRIEF, COMMISSIONING_CHECKLIST, FIELD_LOG, NDI_DANTE, VOICE_AND_HA, TALLY_LIGHT_REPLACEMENT, VU_AND_ANALOGWAY_CONTROL, BSS_AUDIO_DESIGN, CRESTRON_FUNCTION_MAP, STUDIO7_SYSTEM_MAP, BROMPTON_API_NOTES, custom-devices.example.json. 36 UI screenshots in `docs/images/` (login-picker → security-audit — full feature tour).
- **docs/reference/** — vendor protocol PDFs (Brompton Tessera IP Control API 3.3.1, Boland RS232/Ethernet, 4K55-HDR) + **⚠ customer site-dumps** (`AH Devices Config Dump`, `Advent Studio Crestron Dump`) flagged in PROJECT_STATUS P4 to move to a private repo.
- **design/** — `AH_Zoom_Studio.audioarchitect` (Harman Audio Architect project file — the BSS design).
- **examples/** — `devices.example.json`, `studio7/` (crestron-config.json, devices.json, join-map.json, asbuilt-inventory-raw.json, VLAN110 master control list) — the original AdventHealth Studio 7 deployment as a sample config.
- **MIGRATION.md** — see §7.
- **portal/** — the optional separate cloud Portal app (`server.mjs`, own `package.json`, README) — multi-site fleet/monitoring/remote-map. Deployed independently.

## 9. Other Trivency Apps + AI Features

- **Trivency** is the owner org (LICENSE © 2026 Trivency; MIGRATION target). Sibling repos in `/workspace`: `qnet-monitor`, `qnet-dist-` (downloads), `manufacturer-database`, `webinar-stack`, `livesalesengine`, `daw`, `ryte-live-translation`, `agency-agents`, plus this session's cwd `zoom-chat-aggregator`. **⚠ Within `qnet-` code there are NO references to qnet-monitor, webinar-stack, or ShowEngine** — grep for those names returns only `Trivency` hits in dist-repo/portal/docs/LICENSE. "QNet Portal" here = the in-repo `portal/` + `PortalBridge`; the reused telemetry contract (`portal-telemetry.ts:5-11`) references "the existing one-way monitoring agents" — plausibly qnet-monitor, but not named in code. ShowEngine/webinar-stack: no reference found.
- **AI (`@anthropic-ai/sdk`)** — used in exactly ONE runtime path: `src/discovery/llm-label.ts`. When `ANTHROPIC_API_KEY` is set, after a scan it makes ONE `client.messages.create` call (model `"claude-opus-4-8"`, `max_tokens:4000`, `output_config.format.type:"json_schema"` with `effort:"low"`) to turn raw discovery signals (vendor/ports/hostname/HTTP banner) into friendly device names + room guesses; best-effort, silently falls back to heuristics on any failure. Enabled via README config `ANTHROPIC_API_KEY`. `panel-gen.ts` "generate panel" is heuristic (`generatePanelForRoom` at `panel-gen.ts:46`), **not** LLM. ⚠ Model id `claude-opus-4-8` + `output_config`/`effort` params are newer-API shapes; confirm SDK ^0.104.2 supports them at runtime.

## 10. Auth / Identity for Touch Panel (role-aware)

- **PIN-based profiles** (`src/core/auth.ts`). Roles: `super | admin | operator | guest` (`auth.ts:20`). PINs = `scrypt(pin, per-profile random salt)`, `timingSafeEqual` compare, per-profile failed-attempt lockout (`MAX_FAILS=5`, `LOCKOUT_MS=5min`). Sessions = opaque 32-byte random token in **HttpOnly cookie**, 12h TTL, server-side `sessions` Map. Fresh install seeds only `admin` (super, PIN set in setup wizard) + open `guest`. Optional TOTP 2FA for admins (`totp.ts`).
- **Enforcement is server-side, not just UI-hidden** (auth.ts:16 comment, and http.ts):
  - `ADMIN_PATHS` set (`http.ts:393`) — ~75 admin-only endpoints gated at `http.ts:394` by `isAdminRole(effectiveProfile.role)` → 403.
  - Per-command role+room check (`http.ts:489`): `allowed(tag,action) = roleAllowsAction(role,action) && allowsRoom(profile, roomOf(tag))`. Guest limited to `GUEST_ACTIONS` set (route/set_gain/mute/select_source — `auth.ts:36`). `/api/command` and `/api/group` both enforce it (`http.ts:498,514`); `/api/macros/run` blocked for guest (`http.ts:398`).
  - Room scoping (`auth.ts:42 allowsRoom`): operator/guest limited to `profile.rooms[]`; admin/super = all.
  - Global `requireAuth` toggle (`http.ts:323`): when off, unauthenticated `/api/*` gets a synthesized `guest` profile (`http.ts:330`); when on, 401.
  - Loopback internal token (`http.ts:319-322`) elevates the in-process portal command-poller to a synthetic `super` "Remote (portal)" identity — only on 127.0.0.1 with matching `x-internal-token`.
- **Kiosk / wall-panel mode** (`src/core/kiosk.ts`) — the "repurposed Crestron TSW" surface. A kiosk is NOT a stored Profile: a 24-byte opaque token (`?kiosk=<token>`) resolves via `resolveKiosk()` to a **synthetic restricted profile** (`id:"kiosk:<id>"`, role `guest|operator` only — never admin, single pinned room). `/api/kiosk/login` mints a session (`mintSession`, `auth.ts:122`) embedding that synthetic profile inline. Enforced through the same `allowed()`/`ADMIN_PATHS` machinery.
- **External API tokens** (`api-tokens.ts`) authorize `/api/ext/*` independently of PIN sessions.

---
### Cross-cutting flags
- ⚠ `docker-compose.yml` hardcodes old owner `dmwebster` (contradicts MIGRATION).
- ⚠ Crestron CIP wire constants unverified against official spec (self-documented).
- ⚠ Discovery `guessRoom()` and `STUDIO7_PRESET`/`examples/studio7` retain customer-specific (AdventHealth) data pending extraction (PROJECT_STATUS P4).
- ⚠ Manufacturer-Database → driver-authoring link is inferred, not code-enforced.
- ⚠ Test count "141" is the doc's figure; 23 test files exist (many `describe`/`test` cases each) — not independently re-run here.

---

I have gathered comprehensive findings. Here is the architecture deep-read.

---

# QNet Portal (`/workspace/qnet-monitor`) — Read-Only Architecture Deep-Read

**Repo identity:** Single git repo, branch `main`, one commit visible (`ac7d9d2 docs: vendor accumulated project memory into docs/context/`). It is the real S7 (AdventHealth Studio 7, ~216 devices across ~13 VLANs) deployment, transferred as-is. Product = **QNet Portal**, a Trivency/QSE proprietary product (`README.md:1-10`, `CLOUD_HANDOFF.md:10-13`). One 4.3 MB ScreenConnect `.avi` and `agent_data.json`/`_scan_parsed.json` are working artifacts, not code.

The system is **three connected pieces** (`CLOUD_HANDOFF.md:15-19`): (1) the **Agent** (this repo, Python→exe), (2) the **Portal** (separate Lovable/Supabase repo — NOT in this repo), (3) **QRM** (QSE's CRM, third-party, consumes our data).

---

## 1. Languages / runtimes / build

- **All three Python files are Python 3, stdlib-only at runtime.** `qnet_agent.py:1` shebang `#!/usr/bin/env python3`; imports are all stdlib (`qnet_agent.py:23-38`: argparse, configparser, json, os, platform, re, socket, statistics, subprocess, sys, threading, time, urllib.request/error, concurrent.futures, datetime). Stdlib-only claim stated explicitly at `README.md:37`, `qnet_agent.py:19`, `Qnet_Portal_QRM_INTEGRATION_BRIEF.md:30`.
- **Python version assumption: 3.12.** CI pins `python-version: "3.12"` (`.github/workflows/ci.yml`, "Set up Python" step). No `python_requires`/`from __future__`/typing hints found (grep returned nothing) — so it's loosely bound but built/tested on 3.12.
- **Non-stdlib deps are build/tray-only, imported lazily:** `pystray` (`qnet_agent.py:5507`) and `PIL`/Pillow (`qnet_agent.py:5379`) are imported *inside* `tray_main()`/`load_tray_icon()` so the headless path stays stdlib-pure. CI installs `pyinstaller pystray pillow` explicitly labeled "agent is stdlib-only at runtime; these are for the tray + build" (`.github/workflows/ci.yml`).
- **PyInstaller spec (`qnet_agent.spec`):** single-file build of `qnet_agent.py`, `name='qnet_agent'`, `console=False` (noconsole/windowed), `upx=True`, no datas/hiddenimports. Produces `dist/qnet_agent.exe` (`README.md:66-67`). Build is Windows-only — a cloud/Linux session cannot build the exe; the path is tag `vX.Y.Z` → GitHub Actions `windows-latest` → GitHub Release asset (`CLOUD_HANDOFF.md:55-58`).
- **Two older Python entry points (superseded):** `monitor_studio7.py` (30s up/down check + optional push; "superseded by the agent", `DEPLOY_RUNBOOK.md:43`) and `discover_studio7.py` (discovery/inventory verifier, `--all`/`--sweep`/`--identify`). Both are stdlib-only, read-only (ping + connect-only TCP), and predate the product rename (still branded "Studio 7", `monitor_studio7.py:3`, `discover_studio7.py:3`). Their discovery logic has since been folded into `qnet_agent.py`'s `discover_devices()`.
- **Versioning:** `AGENT_VERSION = "1.4.0"`, `AGENT_BUILD_DATE = "2026-07-05"` (`qnet_agent.py:44-45`), stamped into every heartbeat. Ledger in `VERSIONS.md`. Note: repo is at 1.4.0 but the **live VM still runs 1.1.0** (`CLOUD_HANDOFF.md:30-32`).
- **Selftest gate:** `python qnet_agent.py --selftest` validates every parser + every read-only egress guard offline (`qnet_agent.py:4792` `def selftest()`, `README.md:63-64`, CI runs it on both source and built exe).

---

## 2. Where the dashboard/portal actually lives

**The dashboard is NOT in this repo.** It is a **separate TanStack Start (React + TanStack Router) + Supabase (Postgres) app**, TypeScript, currently **Lovable-hosted** at custom domain **`https://s7.qse-ent.com`** (`CLOUD_HANDOFF.md:18,97`, `Qnet_Portal_QRM_INTEGRATION_BRIEF.md:26-33`). Ingest handlers are TanStack Start server route handlers, *not* a Python web framework (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:31`). A stale local export (`QSE Studio Watch Website/`) exists on someone's PC but is explicitly "do not use" and is NOT in this repo (`CLOUD_HANDOFF.md:18`).

**Confirmed Supabase** — high confidence from SQL + docs. Migrating from Lovable to Cloudflare/wrangler is planned (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:33`, `README.md:42`).

**DB schema (from SQL seeds — these run in the Supabase SQL editor, `DEPLOY_RUNBOOK.md:5-11`):**

| Table | Key columns | Source |
|---|---|---|
| `public.hardware_assets` | `device_name`, `ip_address` (unique inet, join key), `zone`, `status`, `criticality`, `notes`; `serial_number`/`model`/`mac` planned-added | `all_seeds.sql:6-179`, unique index `hardware_assets_ip_ux` on `ip_address` (line 7); upsert `on conflict (ip_address)` |
| `public.devices` | `tag` (unique, `AV-<vlan>-<octet>`), `kind`, `model`, `hostname`, `ip::inet`, `vlan`, `zone`; upsert `on conflict (tag)` | `all_seeds.sql:182-354` |
| `public.led_processors` | `name` (unique), `zone` — 6 Brompton SX40 | `all_seeds.sql:357-366` |
| `public.canaries` | `kind`, `label` (unique), `target`, `zone` — Dante clock + 12 PTZ cams | `all_seeds.sql:369-386` |
| `public.device_telemetry` | tall/long: one row per sample; `value_num`/`value_text`, `unit`, `ts`, `agent_id` FK→agents.id | `Qnet_Portal_QRM_INTEGRATION_BRIEF.md:86,96,163` |
| `public.agents` | `name`, `api_key_hash`, `version`, `revoked_at`, `last_seen_at` | `Qnet_Portal_QRM_INTEGRATION_BRIEF.md:92,161-164,228-238` |
| `public.critical_alerts` | `id` bigserial, `source`, `source_ref`, `zone`, `severity`, `title`, `message`, `dispatched`/`dispatched_at`, `raw` jsonb, `created_at` | `Qnet_Portal_QRM_INTEGRATION_BRIEF.md:176-203` |
| `public.alert_rules` | metric-rule engine table (RLS read-only to clients; service-role writes) | `LOVABLE_SPEC_alert-rules.md:42-96` |
| `public.dashboard_notices` | notices (RLS read-only) | `LOVABLE_SPEC_alert-rules.md:104-123` |
| `public.discovered_devices` | for `/ingest/discovery` (portal-side, **not yet built** per `VERSIONS.md:15`) | `VERSIONS.md:15` |

`kind` enum values seen in seed: `generic_av`, `master_clock`, `video_frame`, `brompton_sx40`, `network_switch` (`all_seeds.sql:184-353`). `criticality`: `mission_critical`/`non_critical`. `zone`: `broadcast`/`film`/`shared`. Statuses: `ok`/`warn`/`critical`/`unknown`/`offline` (`docs/context/studio7-monitoring-project.md:22`).

**Supabase specifics confirmed:** RLS present (`OVERNIGHT_BUILD_BACKLOG.md:28`, `LOVABLE_SPEC_alert-rules.md:91-96`); Supabase project id `lvsieyefqivkewzelmjx` (`docs/context/studio7-monitoring-project.md:22`); Lovable project id `e4c8d9ac-...` (`CLOUD_HANDOFF.md:98`). **Edge functions:** none in the classic Supabase sense — the "server functions" are TanStack Start server routes (TypeScript) + Postgres triggers. A **`dispatch_critical_alert()` Postgres trigger** fires `net.http_post` (pg_net) on critical-alert insert (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:213-215`), and `evaluate_alert_rules`/schedule-sweep are DB/server functions (`:206-212`). *(Low confidence on exact function names — the brief flags them as [LIVE AHEAD], not in the stale local migrations.)*

---

## 3. Ingest API surface

All endpoints are **outbound HTTPS POST from agent → portal**, under base `https://s7.qse-ent.com/api/public/ingest` (`qnet_agent.py:1515`, DEFAULT_CONFIG). Auth header **`x-agent-key: <plaintext>`**, server sha256-hashes and matches `agents.api_key_hash` where `revoked_at IS NULL` (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:228-230`, `docs/context/studio7-monitoring-project.md:22`). All POSTs go through `http_post_json()` (`qnet_agent.py:4229`), fully exception-wrapped.

| Endpoint | Builder fn | Payload shape |
|---|---|---|
| `/ingest/hardware` | `push_hardware` `qnet_agent.py:4466-4494` | `{type:"hardware", agent, agent_version, agent_build, ts, assets:[{ip_address, device_name, vlan, tag, status:"ok"/"offline", serial?, model?, mac?}]}` — **batched ≤250/POST**; auto-register by ip_address |
| `/ingest/telemetry` | `push_telemetry` `qnet_agent.py:4497-4671` | `{agent, agent_version, agent_build, ts, samples:[{device_tag, metric, value(num or str), unit?}]}` — **batched ≤500/POST**; metrics: `link_state`, `reach_latency_ms`, `reach_method`, `link_flapping`, `flap_transitions` + all deep-reader metrics (`lea_*`, `dbamp_*`, `sw_*`, `brompton_*`, `hd_*`, `pjlink_err_*`, `*_serial`/`*_model`) |
| `/ingest/canary` | `push_canary` `qnet_agent.py:4674-4688` | `{agent, ts, checks:[{canary(label), status, latency_ms?, jitter_ms?}]}` — real ping_multi measurements |
| `/ingest/led` | `push_led` `qnet_agent.py:4691-4701` | `{agent, ts, processor(name), status:{...}}` — Brompton; `push_led=false` by default (`qnet_agent.py:1554`) |
| `/ingest/discovery` | `push_discovery` `qnet_agent.py:4418-4432` | `{agent, agent_version, ts, summary:{known,unknown,total}, devices:[{ip,mac,oui,known,first_seen,last_seen,name}]}` — **portal side not yet built** (`VERSIONS.md:15`) |

Non-ingest POSTs the agent also makes: `/cron/schedule-tick` (drives server-side fault sweep, `qnet_agent.py:4251`), `/cron/rollup-uptime` (hourly, `qnet_agent.py:4305`), and `GET /api/public/agent/version` for check-for-updates (`qnet_agent.py:4269`). QRM consumes `GET /api/public/qrm/feed` (header `x-qrm-key`) — portal-side, done (`CLOUD_HANDOFF.md:35,101`).

---

## 4. Hardware protocols (read-only) — enumerated

All readers dispatched from `push_telemetry` via a bounded `ThreadPoolExecutor(8)` under a 45s wall deadline, DOWN devices skipped (`qnet_agent.py:4537-4614`). Each has an in-code egress guard / verb allowlist:

| Protocol / vendor | Transport | Reader fn:line | Guard / notes |
|---|---|---|---|
| **ICMP ping / TCP reach** | ping + TCP connect | `ping_once/ping_multi/tcp_alive/reach_check` `1678-1735`; flap `flap_eval 1735` | connect-only, no payload |
| **Blackmagic HyperDeck** | TCP 9993 "transport info"/"slot info" | `read_hyperdeck 1785` | query verbs only; record-time fixed to SECONDS |
| **Lectrosonics DSQD** | TCP 4080 ASCII "pollrx? $" | `read_lectrosonics 1871` | reverse-engineered; battery/RF not emitted (blank beats wrong) |
| **FOR-A HVS-6000** | HTTP GET /status.html + WebSocket | `read_fora 1947`, `read_fora_ws 2096`, `fora_ws_collect 2017` | `_NoRedir` no-redirect opener `1937`; WS bounded/deadlined |
| **LEA Professional amps** | WebSocket ws://ip:1234 Open API, GET only | `read_lea 2192`, `parse_lea_frames 2129` | PSU volts/watts, per-ch temp/fault/clip/load |
| **Brompton Tessera** | (a) passive syslog UDP 514; (b) HTTP GET http://ip/api/ | `read_brompton 2281` (syslog), `read_brompton_api 4081`, `_brompton_guard 3935` | guard restricts to GET /api/ |
| **PJLink projectors** | TCP 4352 | `read_pjlink 2308` | err_temp/fan/filter/lamp |
| **SNMP v2c** (PDU/UPS/env, switches PoE/sensors) | UDP 161 GET/GETNEXT only | `snmp_get 2422`, `snmp_walk 2478`, `read_power_env 2543`, `read_switch_snmp 2757` | hand-rolled BER encoder; GET/GETNEXT only, never SET; error-status + Null-varbind handled |
| **d&b amplifiers** | OCA/AES70 over OCP.1 TCP 30013 | `read_dbamp_oca 3061`; `OcaEgressDenied 2861` | GetReading only; `_oca_reading_def_level` gates to read methods |
| **Dante / Audinate** | passive mDNS/DNS-SD 224.0.0.251 udp/5353 | `dante_mdns_listener 3450`, `read_dante 3513`; `DanteEgressDenied 3274`, `_guard108 3280` | receive + PTR queries only; pinned to 108.0/24 |
| **Yamaha RCP** | TCP 49280 GET-only | `read_yamaha_rcp 3562`, `_yamaha_guard 3550` | VLAN 105/108 scoped |
| **Sonifex** | SNMP/HTTP | `read_sonifex 3628` | |
| **Allen & Heath** | reachability | `read_ah 3662` | |
| **AVPro Edge AC-MX** | Telnet/raw TCP 23 | `read_avpro 3726`, `_avpro_guard 3698`; `AVEgressDenied 3690` | allowlist `^(GET…|STA|H)$`, rejects `;`/CR/LF |
| **Panasonic AW PTZ** | HTTP /live/camdata.html | `read_pana_cam 3814` | |
| **BirdDog NDI** | REST TCP 8080 | `read_birddog 3845` | serial/fw/model |
| **Analog Way Aquilon/Eikos** | AWJ TCP 10606, `op:get` only | `read_analogway 3890`, `_awj_frame 3880` | `ANALOGWAY_READER_SPEC.md` (SNMP path PEN 60391, `awj.txt`, `alta_snmp.txt`) — no subscriptions (subscribe = a write) |
| **Vestel displays** | Telnet 1986 GET-only | `read_vestel 4116`, `_vestel_guard 4100` | |
| **ENTTEC DMX gw** | HTTP/0.9 ?config=1 | `read_enttec 4176`, `_enttec_guard 4169` | |
| **BSS Soundweb** | TCP 1023 reachability only | `read_bss 4210` | deep SV reads need on-site object map |
| **ARP (identity)** | local `arp -a` | `read_arp_table 4327` | local OS table only, never touches a device |

Read-only is enforced structurally: no-redirect HTTP opener (defeats device-controlled 302, `HARDENING_FIX_PLAN.md:11-19`), per-protocol `*EgressDenied` exceptions + verb allowlists, outbound-only POSTs, passive listeners. Reference protocol dumps in-repo: `awj.txt` (Analog Way AWJ programmer's guide), `alta_snmp.txt` (Alta 4K SNMPv2-MIB), `lea_tcp.txt`/`lea_ws.txt`/`lea_objects.txt` (LEA Open API), `_livecore.js`/`_lc_feedbacks.js` (FOR-A/LiveCore research).

---

## 5. Embedded `Manufacturer-Database-main/` — dead weight (in-code terms)

**Not referenced by any Python code.** Grep of `*.py` for `Manufacturer-Database`/`manufacturers/`/`schema.json` returned **zero hits**. It is a **vendored copy** of the standalone `Trivency/Manufacturer-Database` repo (`CLOUD_HANDOFF.md:80`), used only as a human/Claude reference to build new readers without re-researching protocols (`README.md:43-45`, `Manufacturer-Database-main/README.md:1-4`). It's an 80-manufacturer JSON DB: `manufacturers/<slug>.json` (86 files present: absen…yamaha), `index.json`, `schema.json` (draft-07), `coverage-report.json`. Consumption is manual/documentary (`MFRDB_ENHANCEMENT_PLAN.md` ranks read-only telemetry additions derived from it). **Drift risk:** it's a snapshot named `-main`; no sync mechanism exists vs the standalone repo — treat as potentially stale. Confidence high that it is inert to the running agent.

---

## 6. Data / entity model

- **Devices:** IP-keyed `hardware_assets` (current status) + tag-keyed `devices` (telemetry target). Two parallel identity keys: `ip_address` (hardware channel) and `tag` `AV-<vlan>-<octet>` (telemetry channel) (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:128-134`). In-agent source of truth is hardcoded `AGENT_DATA` (`qnet_agent.py:47+`) with per-protocol target lists (`fora_targets`, `lea_targets`, `dbamp_targets`, `yamaha_targets`, `brompton_targets`, `vestel_targets`, `enttec_targets` `1502`, `bss_targets` `1505`, etc.).
- **Canaries:** reference ping targets — Dante Leader Clock (172.16.108.11) + 12 PTZ cams on VLAN 103 (`all_seeds.sql:369-386`, `canaries_seed.sql`). Emit real latency + jitter.
- **Incidents / timeline:** `LOVABLE_SPEC_incident-timeline.md` (portal-side rollup of state transitions).
- **Alerts:** `critical_alerts` table + `alert_rules` engine (metric thresholds by device/kind/prefix) + schedule-aware offline sweep for mission-critical devices; dispatch via Postgres trigger → Slack/Resend webhook (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:174-217`, `LOVABLE_SPEC_alert-rules.md`).
- **Health scores:** 0–100 per device/system/fleet, computed server-side from latest telemetry, with a "monitoring depth: basic vs deep" honesty badge; stale = "unknown" not 100 (`LOVABLE_SPEC_health-score.md:1-25`).
- **Discovered devices:** known/unknown classification with `first_seen` persisted to `discovered.json` (`qnet_agent.py:4344-4416`); OUI-derived vendor.
- **Client/site separation:** NO `client_id`/`tenant_id` column anywhere — separation is **per-deployment** (one Supabase project + subdomain per client); within a deployment `agents.name` distinguishes agents (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:153-170`).

---

## 7. State of code — production hardening & deploy

- **Hardening:** `HARDENING_FIX_PLAN.md` — a **54-finding adversarial review** (synthesized from 40 confirmed findings → 27 deduped work items), ranked by `(breaks_readonly, severity, likelihood)`. Group A "must-fix tonight" items (A1 no-redirect HTTP, A2 listener-thread respawn, A3/A4 WebSocket deadline+bounds, A5 double-run_loop guard, A6 restart-green fix) are **done** per `VERSIONS.md:18` (v1.1.0 "Group A complete") and v1.2.0 (Groups B/C: deep-read pool, atomic json, log rotation, single-instance mutex). Note the plan still references the pre-rename path `studio7_agent.py` and a local Windows path (`HARDENING_FIX_PLAN.md:3`).
- **Deploy story:** `DEPLOY_RUNBOOK.md` (seed 4 SQL files → create agent key → configure `.env` → run on VM, ScreenConnect scheduled task); `CLOUD_HANDOFF.md` (the authoritative "read first" continuity doc — status, IDs, connectors, invariants, open threads); `TRANSFER_RUNBOOK.md` (stand up under Trivency org/cloud/secrets rotation); `VERSIONS.md` (release ledger + rename-cutover deploy steps). CI (`.github/workflows/ci.yml`) gates every push on `--selftest` (source + built exe) and publishes the exe as a GitHub Release on `v*` tags.
- **`_archive/`** — 3 superseded planning docs: `PLAN.md` (original monitor-only rebuild plan), `QUICKSTART_STEPS.md` (early go-live steps), `LOVABLE_UPDATE_PLAN.md` (early dashboard/Supabase seeding plan). Historical only.
- **Known live-vs-repo gap:** repo at v1.4.0, **live VM at v1.1.0** (`studio7_agent.exe`); deploying 1.4.0 is the rename cutover that activates serial/model/MAC identity + unknown-device detection (`CLOUD_HANDOFF.md:30-32,112`).

---

## 8. Docs inventory (grouped, one line each)

**Entry / continuity:** `README.md` (product overview + the one read-only rule) · `CLOUD_HANDOFF.md` (read-first continuity) · `RECOVERY_INDEX.md` (index of everything built) · `CONTRIBUTING.md` (preserve read-only) · `VERSIONS.md` (release ledger) · `docs/context/README.md` + `MEMORY.md` (curated memory index).

**Roadmap / planning:** `OVERNIGHT_BUILD_BACKLOG.md` · `PROACTIVE_ROADMAP.md` · `STUDIO7_PRODUCT_DASHBOARD.md` · `STUDIO7_READER_ROADMAP.md` · `DISCOVERY_DESIGN.md` (discovery-first inventory — flagship next feature) · `MFRDB_ENHANCEMENT_PLAN.md` (ranked read-only telemetry adds from protocol DB) · `TELEMETRY_COVERAGE.md`.

**Hardening / release / compliance:** `HARDENING_FIX_PLAN.md` (54-finding review) · `WHITEWASH_AND_RELEASE_BRIEF.md` (secret-scrub before public release) · `QNET_ROLLOUT_AND_COMPLIANCE.md` · `TRANSFER_RUNBOOK.md` · `DEPLOY_RUNBOOK.md`.

**Integration / vendor:** `Qnet_Portal_QRM_INTEGRATION_BRIEF.md` (QRM contract + data model — richest schema source) · `VENDOR_INTEGRATION_MAP.md` (120KB AV vendor map) · `ANALOGWAY_READER_SPEC.md` (parked Analog Way reader spec).

**Lovable (portal) specs — ~20, all "paste to Lovable":** `LOVABLE_SPEC_` alert-rules, audit-log, dashboard-catchup, demo-polish, displays-badge-fix, flap-unstable, health-score, incident-timeline, maintenance-mode, notifications, overview-redesign, power-thermal (P0 fire-prevention), reporting, responsive, standby-and-demo, topology-map, trends · `LOVABLE_SQL_fix-known-names.md` · `LOVABLE_WEBSITE_UPGRADES.md`.

**Studio-7 site ops:** `STUDIO7_START_HERE/STATUS/INVENTORY/FIX_GUIDE/DEMO_PLAN/DEMO_RUNSHEET/ONSITE_CHECKLIST/ONSITE_NEXT_STEPS/ONSITE_ONEPAGER/RIEDEL_GUIDE.md` · `RACK_AUDIT.md` (photographed reality vs docs) · CSVs (`studio7_devices.csv`, `studio7_full_inventory.csv`, `hardware_assets_seed.csv`, `DEVICE_NAMING_WORKLIST.csv`).

**docs/context/ (memory notes):** `studio7-monitoring-project.md` (master narrative) · `av-monitoring-product-vision.md` (cable-fire origin) · `av-vm-deploy-topology.md` · `studio7-power-topology.md` · `manufacturer-protocol-db.md` · device read-path refs: `panasonic-aw-ptz-reader.md`, `rivage-pm-readonly-poller.md`, `skaarhoj-unisketch-tally-reader.md`.

---

## 9. Relationship to `qnet-control` (`Trivency/Qnet-`)

**Same product family branding, but a DIFFERENT product — no code sharing.** `CLOUD_HANDOFF.md:78-80` is explicit: *"`Trivency/Qnet-` is a different product (a read/**write** Crestron-control replacement, TypeScript)"* — i.e. it *controls* devices, the opposite of this repo's read-only invariant. QNet Portal (this repo) and "QNet control" share the **QNet** brand and the AV domain, and the plan is a unified Trivency product family, but: (a) different languages (this = Python agent + TS portal; that = TypeScript control), (b) no imported code, (c) opposite safety posture. Shared *entities* are conceptual only (both deal with AV devices/vendors); the concrete shared asset is the vendored `Manufacturer-Database` (also its own `Trivency/Manufacturer-Database` repo). **Confidence: high** on "different product, no code sharing" (stated in the handoff); the exact contents of `qnet-control` are not in this repo, so anything beyond the one-line description is unverifiable here.

---

## 10. Auth model for the portal

- **Agent → portal ingest:** header `x-agent-key: <plaintext>`; server sha256-hashes → matches `agents.api_key_hash` where `revoked_at IS NULL` (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:228-230`). Ingest-only bearer key, not a read credential. Same auth on `/cron/*` (`OVERNIGHT_BUILD_BACKLOG.md:236`).
- **Dashboard UI (human):** Supabase Auth — routes under `_authenticated/` layout guarded by `requireSupabaseAuth` (`LOVABLE_SPEC_power-thermal.md:42-43`, `LOVABLE_SPEC_responsive.md:27`). Clients are **SELECT-only via RLS**; all writes go through **admin-gated service-role server functions** (`assertAdmin(context.userId)` + `supabaseAdmin`, the `agents.functions.ts` pattern) (`LOVABLE_SPEC_alert-rules.md:13,36,91-96,248-264`, `LOVABLE_SPEC_notifications.md:22-23`, `OVERNIGHT_BUILD_BACKLOG.md:28`). There is an admin role (`isAdmin`) and a PREVIEW bypass for demos (`LOVABLE_SPEC_alert-rules.md:267-269`).
- **QRM → portal:** header `x-qrm-key` vs `app_config.qrm_api_key` on `GET /api/public/qrm/feed` (`CLOUD_HANDOFF.md:101`); alternatively direct Supabase read with a service-role/read-only key per deployment (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:234-261`).
- **No public read API** exists — every public endpoint is inbound POST; UI reads Supabase directly under RLS (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:223-226`).
- **Secrets:** never in git (`.gitignore` blocks `.env`); portal secrets in Supabase `app_config`/env; an anon JWT was seeded in a DB migration and service-role/anon/Resend keys need rotation on transfer (`WHITEWASH_AND_RELEASE_BRIEF.md:114-119`, `TRANSFER_RUNBOOK.md:41`, `CLOUD_HANDOFF.md:91-92`).

---

### Low-confidence / unverifiable flags
- **Everything about the portal's actual code (TanStack Start handlers, server functions `evaluate_alert_rules`/`dispatch_critical_alert`, exact live schema, RLS policy bodies)** is reconstructed from specs + the QRM brief, which itself warns the reviewed portal snapshot is **stale/[LIVE AHEAD]** — the live Supabase has evolved past it (`Qnet_Portal_QRM_INTEGRATION_BRIEF.md:8-14`). The portal repo is not in this workspace; confirm with `supabase db pull` against production.
- **`discovered_devices` table + `/ingest/discovery` portal handler:** agent side ships (v1.4.0) but portal side is flagged "needed"/not-yet-built (`VERSIONS.md:15`) — though `CLOUD_HANDOFF.md:33-34` later claims the discovered-devices feature + QRM feed shipped. These two docs disagree; live state unverifiable from this repo.
- **Manufacturer-Database drift:** it's a vendored `-main` snapshot with no sync mechanism; staleness vs the standalone repo is plausible but not measurable here.
- **`qnet-control` internals:** only the one-line handoff description is available; not in this workspace.
- **Python min-version:** only CI's 3.12 pin is concrete; no explicit floor declared, so older-3.x compatibility is unverified.

---

I'll explore the manufacturer-database repo thoroughly.
Now let me sample manufacturer files across categories and check for tooling and Qnet alignment.
Let me sample audio (qsc-qsys) and LED (novastar) files for command depth, and check the Qnet- repo for catalog/driver alignment.
Qnet- has a catalog/drivers structure. Let me inspect it for format alignment with the manufacturer-database.
Let me compare the qnet driver shape against the DB and check the audinate/dante entry plus a control-vendor driver.
I have enough to compile the report.

# AV Device Protocol Database — Architecture Deep-Read

Location: `/workspace/manufacturer-database` (single initial commit `8ec2b62`, branch `main`). Repo is pure data: `schema.json`, `README.md`, `coverage-report.json`, `manufacturers/` (80 vendor JSON files + `index.json`). No code, no CI, no `.github/`. `.gitignore` only excludes `.DS_Store`.

## 1. Schema (`schema.json`, JSON Schema draft-07)
Root object, `required: ["manufacturer","devices"]` (`schema.json:7`).
- Manufacturer-level fields: `manufacturer` (`:9`), `parent_company` (`:13`), `aka[]` (`:17`), `categories[]` — closed enum of 27 category slugs (`led-processing`, `video-switching`, `audio-dsp`, `control-system`, `av-over-ip`, `ptz-camera`, `lighting-fixture`, `hvac-control`, `shade-control`, etc.) (`:22-35`), `prevalence_rank` int (`:36`), `priority_tier` enum 1/2/3 (`:40`), `official_docs[]` (`:45`), `notes` (`:50`), `devices[]` → `#/definitions/device` (`:51`).
- `definitions.device` (`:57`), `required: ["model","category","control_interfaces","protocols"]` (`:59`): `model`, `product_line`, `category`, `aliases[]`, `release_year` (int|null), `discontinued` (bool|null), `active_window` (`:61-67`).
- `firmware` object (`:68-87`): `latest_known_version`, `as_of` (ISO date), `control_relevant_changes[]` of `{version, change, impact_on_integration}` (`:73-84`) — this is the "did firmware break control" tracker.
- `control_interfaces[]` = **transport layer** (`:88`), `required:["transport"]`; `transport` closed enum of 20 values (RS-232/422/485, TCP, UDP, USB, IR, GPIO, Contact-Closure, HTTP(S), WebSocket, Bluetooth, Zigbee, Z-Wave, CEC, MIDI, DMX-physical…) (`:96-98`); plus `connector`, `default_settings` (e.g. "9600 8N1", "TCP port 4352"), `pinout`, `notes` (`:99-102`).
- `protocols[]` = **logical layer** (`:106`), `required:["name"]`. Rich per-protocol fields (`:112-141`): `name`, `version`, `role[]` (enum control/feedback/discovery/media-transport/sync/configuration/monitoring), `transport_binding`, `default_port` (int|string|null), `authentication` (free text: None/password/token/cert/pairing), `message_format` (framing/terminators/checksums), `command_set_summary`, `example_commands[]` of `{intent, request, response}` (literal bytes/strings) (`:124-134`), `feedback_polling`, `discovery_method`, `sdk_or_library`, `spec_reference[]`, `license_or_access`, `notes`.
- Device-level trust: `integration_notes` (`:144`), `confidence` enum high/medium/low (`:145-149`), `sources[]` URLs (`:150`).

Schema is well-designed for machine consumption: transport enum + `default_port` + `example_commands.request/response` are the actionable fields.

## 2. Content inventory (`manufacturers/`)
80 manufacturer files (confirmed by `ls`; `coverage-report.json:568` totals: `manufacturers: 80, devices: 608, protocol_entries: 1426`). File sizes 26KB–68KB (yamaha 68KB, panasonic 65KB largest; megapixel-vr 26KB smallest) — all substantive, none stub-sized.
- `index.json` adds `scope_years:"2016-2026"` (`index.json:5`), `ranking_basis` disclaimer that ranks are batching estimates not market share (`:6`), `status_values` [pending/researching/complete/needs-review] (`:12`), and per-vendor `key_lines[]` + `status` (Crestron/Extron shown `status:"complete"`, `:38`,`:59`).
- Categories covered (per coverage-report roster, `:5-565`): **video/LED/processing** — NovaStar, Brompton, Megapixel VR, Absen, ROE Visual, Unilumin, Leyard/Planar, RGBlink, Analog Way, Green Hippo/tvONE, Barco, Christie; **displays/projection** — Samsung, LG, Sharp/NEC, Epson, Sony, Panasonic; **audio** — QSC/Q-SYS, Yamaha, Shure, Biamp, Bose Pro, Sennheiser, L-Acoustics, d&b, Behringer/Midas, Symetrix, BSS, ClearOne, Crown, Lab.gruppen, Allen&Heath, DiGiCo; **audio-network standard** — Audinate/Dante (tier 1); **control/routing** — Crestron, Extron, AMX, Kramer, Lightware, Atlona, Control4, Savant, RTI, ELAN, URC, Vantage; **lighting consoles/fixtures** — ETC, MA Lighting, ChamSys, Avolites, High End Systems, Martin, Robe, Vari-Lite, Pathway, Pharos; **cameras/PTZ** — BirdDog, PTZOptics, Vaddio, Marshall, Canon, Lumens; **production/broadcast** — Blackmagic, Roland, AJA, Datavideo, Vizrt/NewTek, Avid, disguise, Dataton, AV Stumpfl; **smart building** — Lutron, KNX, Somfy, Sonos, Russound, Honeywell, Nest/Ecobee, Josh.ai.
- Tier split (`:576`): tier1=22, tier2=25, tier3=33. Confidence distribution (`:571-575`): high 371, medium 211, low 26. 26 named low-confidence devices listed (`:581-608`) — heavily LED walls (Absen, Unilumin, Leyard, Barco TruePix) and long-tail control (URC MRX/DMS, Josh.ai, Savant power).

## 3. Data quality (sampled Crestron / QSC / NovaStar)
Depth is genuine — actual command sets and wire-level detail, not just metadata.
- **Crestron** (`crestron.json`): manufacturer `notes` (`:27`) enumerate real protocol families with ports (CIP/SCIP TCP 41794/41796, CTP/SCTP 41795/41797, CresNext REST/WSS 443, Cresnet RS-485). Device CP4 has 5 `control_interfaces` with concrete ports/baud (`:51-82`) and CIP protocol with binary framing description, join model, and a literal UDP 0x14 probe example with 394-byte response decode (`:94-102`). Auth handled per-protocol (`:93` notes XSRF-TOKEN requirement in mfr notes).
- **QSC** (`qsc-qsys.json`): Core Nano (audio-dsp, confidence high) carries QRC on port 1710 with JSON-RPC 2.0 `example_commands` (literal `{"jsonrpc":"2.0","method":"StatusGet"...}`, Logon auth, NoOp keep-alive) and ECP on 1702 with ASCII `cgc/cga/cgp` change-group commands terminated `\r\n`. Six real QSC help-portal source URLs.
- **NovaStar** (`novastar.json`): MX40 Pro (led-processing, high) has COEX binary protocol port 5200 with full hex frames (`55 AA 00 00 FE FF...` for brightness/blackout/preset) **and** a parallel COEX HTTP REST API port 8001 with literal `PUT /api/v1/device/...` bodies. Sources cite NovaStar OSS PDF manuals with versions/dates.

Assessment: ports and transport enums are fully machine-actionable; `example_commands.request` values are copy-pasteable wire payloads (hex strings, JSON-RPC, ASCII, REST). Non-printables are escaped as `\r\n`, `\0`, `\x14` (string-escaped, so a consumer must un-escape). This is materially richer than a metadata catalog.

## 4. Consumption story & Qnet- alignment
- **In-repo tooling: none.** No validators, no generators, no `package.json`, no CI. `coverage-report.json:4` says "generated" but the generator is not committed. Consumption is entirely the manual README workflow (`README.md:21-28`): read `index.json` → open `<slug>.json` → use `control_interfaces[]` + `protocols[].example_commands` to seed integration code. Low confidence that any automated pipeline exists — it's a Claude-Code-in-the-loop artifact by design (`README.md:3`).
- **Qnet- (`/workspace/qnet-`, the control processor)** has a structurally *parallel but unlinked* driver system: `src/drivers/` holds 64 hand-written TypeScript drivers (`_template.ts`, `biamp-tesira.ts`, `allen-heath.ts`, `birddog-ptz.ts`, `blackmagic-atem.ts`, `bmd-videohub.ts`, `behringer-x32.ts`, `analogway-aquilon.ts`, etc. — vendor names overlap heavily with the DB roster). Each is a `BaseDriver` subclass exposing `capabilities.actions[]`, `poll()`, `execute(cmd)` (`_template.ts:25-66`). The `biamp-tesira.ts` header docstring (`:11-24`) documents Tesira TTP over Telnet 23 with `+OK`/`-ERR` framing — exactly the kind of content the DB's `protocols[].message_format`/`example_commands` would carry, i.e. the DB is the plausible research source that a driver is written *from*.
- **No programmatic link:** `grep` for `manufacturer-database`/`av-protocol-db` across qnet- returns nothing. The DB's JSON is *not* imported or read by qnet at build/run time. Format alignment is conceptual, not literal — DB = descriptive JSON protocol reference; qnet driver = imperative TS class. The closest data-driven bridge is `qnet-/catalog/drivers/httpcmd.mjs`, a generic driver that takes a `spec.commands` map of `"action":"GET /path"` and is "fetched on demand from the catalog to prove dynamic loading" — a spec-shaped consumer pattern the DB *could* feed, but currently doesn't. (Medium confidence on intent; inferred from the one catalog file + driver template comments.)

## 5. Versioning / provenance
- DB version `1.0`, `generated:"2026-06-30"` in both `coverage-report.json:3-4` and `index.json:3-4`. Single git commit; no tags/releases.
- Per-entry provenance is strong: every device carries `sources[]` (official vendor doc/PDF URLs, e.g. NovaStar OSS PDFs with version+date, QSC help portal, Crestron help/SDK + community reverse-eng GitHub) and a `confidence` rating. Firmware entries carry `as_of` ISO dates (e.g. Crestron CP4 `as_of:"2025-07-16"`, `:41`) and `latest_known_version`. Research method described in `README.md:35-36` (dedicated per-manufacturer research pass from official docs/programmer guides).
- **No validation CI**: nothing enforces schema conformance in-repo. `index.json` defines a `status` lifecycle but there's no checker. Confidence tallies in the coverage report are asserted, not verifiably regenerated from source.

## 6. State: complete vs sparse
Substantially complete for a V1. All 80 rostered manufacturers have real files (none missing), 608 devices, 1426 protocol entries, ~61% high-confidence (371/608), only ~4% low (26/608). Scope matches the stated V1 bound: 2016–2026 devices, current-model emphasis (`index.json:5`, `README.md:5-8`); V2 (another decade back) explicitly deferred. Depth is consistent across categories sampled (control/audio/LED all wire-level). 

Gaps/caveats to flag:
- Low-confidence cluster is real and named (`coverage-report.json:581-608`) — fine-pitch LED walls and long-tail residential control are the weak spots; treat those `example_commands` skeptically.
- `example_commands.request` uses string-escaped non-printables (`\x14`, `\0`) — a consumer must un-escape before sending; not raw bytes.
- `default_port` is polymorphic (int|string|null, `schema.json:120`) — consumers must handle all three.
- The "generated" coverage/consumption tooling is absent from the repo; the README's "Claude Code generates integration code" claim is a described workflow, not shipped automation. The qnet- driver layer is the de facto consumer but is manually authored with no import path back to this DB.

