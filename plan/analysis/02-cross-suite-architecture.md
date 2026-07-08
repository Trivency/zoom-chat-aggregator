# 02 — Cross-Suite Architecture Analysis (Phase 2)

> Everything in this document distinguishes **[today]** (what the code does, cited in
> `01-per-repo-findings.md`) from **[recommendation]** (what I propose). Where a judgment call
> would shape the whole suite, it is also raised as a question in `04-open-questions.md` rather
> than silently decided.

## A. Language & Runtime Cohesion

### Where the suite aligns [today]

- **TypeScript + Node is the center of gravity.** 5 of 8 substantive repos are TS ESM with
  `strict: true` and ES2022 targets: `webinar-stack`, `liveSalesEngine`, `ryte-live-translation`,
  `DAW`, `Qnet-`. All use npm (lockfiles committed) — no pnpm/yarn drift, no Bazel/Turbo.
- **The same architectural idiom recurs independently**: a single authoritative server holding
  in-memory live state, fanning out over WebSocket with periodic full-state resync, persistence
  off the hot path. Seen in `zoom-chat-aggregator` (100 ms batched Socket.IO emits), `liveSalesEngine`
  (`RoundState` + `state:full`), `webinar-stack` (bus retained events, ~100 ms batches — explicitly
  copied from the chat aggregator, `plan/01-ARCHITECTURE.md:29-32`), and `Qnet-`
  (`DeviceManager` snapshot over SSE). This is a de facto house pattern and a strong foundation
  for a shared contract layer.
- **The same auth idiom recurs**: bcrypt(cost 12) + opaque server-side session token in an
  HTTP-only `sameSite:lax` cookie, hand-rolled, in `zoom-chat-aggregator` (`src/auth/sessions.js`)
  and `webinar-stack` (`cloud/src/auth.ts`, which cites the aggregator as its source). `Qnet-` uses
  the same shape with scrypt'd PINs for its offline context.

### Where it clashes [today]

| Axis | Values in the wild | Repos |
|------|--------------------|-------|
| Node engine | `>=18` / `>=20` / `>=22` | zoom-chat-aggregator (18, CI on 22) / liveSalesEngine, ryte-live-translation (20) / webinar-stack, Qnet-, DAW (22) |
| TypeScript | none (plain JS) / 5.3 / 5.6 / 5.7 / 5.8 | zoom-chat-aggregator is the only untyped codebase |
| Validation lib | zod v4 / zod v3 / none | webinar-stack contracts (`zod ^4.4.3`) vs Qnet- (`zod ^3.24.2`); everything else validates by hand |
| Realtime lib | Socket.IO 4.x / raw `ws` / SSE | zoom-chat-aggregator + liveSalesEngine vs webinar-stack bus + ryte-live-translation + Qnet- (SSE for panel, `ws` for drivers) |
| Frontend | React 18 / React 19 / Svelte 5 / Next.js 14 / vanilla JS PWA | client, DAW / webinar console / liveSalesEngine web / translation web / Qnet- panel (`app.js`, ~3.7k lines, no framework) |
| DB | Postgres (pg, inline SQL) / Postgres (Drizzle) / SQLite (better-sqlite3, swap-point to pg) / Supabase Postgres / JSON files / none | zoom-chat-aggregator / liveSalesEngine / webinar-stack cloud / QNet Portal / Qnet- / translation, DAW |
| `moduleResolution` | Bundler / NodeNext | mixed even inside webinar-stack (base is Bundler, `cloud/tsconfig.json` overrides to NodeNext) |
| Other runtimes | Python 3.12 stdlib (qnet-monitor agent), C++20/Obj-C++ (webinar engine), Swift (aggregator launcher, webinar bridge) | justified outliers: single-file exe, real-time media, thin macOS shells |

None of these are fatal individually. The two that will actually hurt a multi-developer agency
team are (1) **zoom-chat-aggregator being plain JS** — it is the most production-hardened service
in the webinar domain and the one webinar-stack intends to bolt onto, yet it cannot consume or
enforce a typed contract package; and (2) **Socket.IO vs raw-ws split** — the two webinar-domain
apps that must talk to each other use different wire layers with different reconnect/rooms/auth
semantics.

### Shared code feasibility [recommendation]

Shared TS packages are feasible **today** between webinar-stack, liveSalesEngine,
ryte-live-translation, and Qnet- (all strict TS/ESM/npm). The embryo already exists:
`@webinar-stack/contracts` (zod schemas, versioned envelope, `CONTRACTS_VERSION`,
`BUS_PROTOCOL_VERSION`). Both liveSalesEngine (`shared/src/events.ts` as single WS authority) and
ryte-live-translation (`packages/shared/src/types.ts`) prove the team already works
contract-first inside each repo; the missing piece is a home **across** repos.

- **Where a shared package should live**: a new repo (working name `Trivency/suite-contracts`),
  published as a private npm package (GitHub Packages) or consumed as a git dependency —
  **not** inside webinar-stack, because Qnet-/Portal must not depend on a webinar product repo,
  and not npm-public. Start by lifting `contracts/` out of webinar-stack mostly unchanged.
- **Version pinning [recommendation]**: adopt one `.nvmrc`-style floor of **Node 22** suite-wide
  (everything already runs on 22 in CI, including zoom-chat-aggregator), one TypeScript minor
  (5.8), and **zod v4** in the shared package. Qnet- keeps zod v3 internally until it upgrades;
  the shared package should avoid zod-version-specific type re-exports at its public boundary
  (export inferred TS types + JSON Schema, not zod internals) so v3 consumers aren't blocked.
- **Drift control**: a repo-spanning CI check (one small workflow per repo) that asserts
  engines/TS/contract-package versions against a manifest in the contracts repo. Cheap, and it is
  the only structural defense once multiple agency developers are building in parallel.

## B. Inter-App Data Structures & Contracts

### Canonical approach [recommendation]: protocol-first (typed events over a message contract)

Three options were considered against what the repos do today:

1. **Shared schema package (types only)** — necessary but not sufficient; types without an
   envelope/versioning story reproduce the drift already visible (liveSalesEngine's
   `plan/04-WS-CONTRACT.md` omits 5 events its own code implements).
2. **API-gateway pattern** — wrong fit: the latency-sensitive paths (show control, device state,
   chat fan-out) are event streams on a LAN or single box, not request/response through a cloud
   gateway. A gateway adds a hop and a single point of failure exactly where the suite is
   local-first.
3. **Protocol-first: a versioned event envelope + registered, zod-validated message types** —
   this is already implemented and proven in `webinar-stack` (`contracts/src/envelope.ts`:
   `BusEvent {ch, type, seq, ts, data}`, retained slots, `hello/sub/pub` frames;
   `contracts/src/messages.ts`: `MESSAGE_SCHEMAS` with pass-through for unregistered types).
   It matches the house pattern every app already uses. **Adopt it suite-wide.**

Concretely: `suite-contracts` owns (a) the envelope (as-is from webinar-stack), (b) a namespaced
message registry (`chat.*`, `participant.*`, `scene.*`, `device.*`, `show.*`, `engine.*`),
(c) channel naming conventions (`studio.<id>.…` today; extend with `site.<id>.…` for QNet and
`show.<id>.…` for ShowEngine), and (d) semver + a `CONTRACTS_VERSION` handshake.

### Serialization & validation [recommendation]

- **JSON on the wire + zod at the boundary** — justified by what exists: zod already validates
  the webinar bus; every transport in the suite is JSON-over-WS/HTTP except device wire protocols.
  Protobuf appears exactly once (Qnet- Android TV driver, a vendor requirement) and there is no
  cross-app throughput problem that would justify a protobuf/IDL migration now.
- **Generate JSON Schema from the zod registry** for non-TS consumers: the Python monitor agent,
  Supabase/Postgres functions in the QNet Portal, and the C++ engine (which can validate against
  JSON Schema or simply emit envelope-shaped JSON via its Swift bridge). zod v4 has native JSON
  Schema export; this is the cheapest bridge across the three runtimes and mirrors the pattern
  Manufacturer-Database already uses (draft-07 schema as source of truth).
- **Do not standardize on Socket.IO for cross-app links.** The bus's raw-ws + JSON envelope is the
  interop layer (native clients: Swift `URLSessionWebSocketTask` already works; Python stdlib can
  join). Socket.IO stays an internal detail of zoom-chat-aggregator and liveSalesEngine UIs.

### Core shared entities and proposed canonical shapes [recommendation]

What exists today (cited in 01): four unrelated "user/org" models, three "event/show/campaign"
models, two device models, and a chat message shape that webinar-stack already lifted from the
aggregator. Proposed canonical shapes (names bikesheddable; fields are the union of what code
already stores):

- **Organization** `{orgId, name, plan?, createdAt}` — exists in zoom-chat-aggregator
  (`organizations`), planned in webinar-stack (`Organization/Tenant`), absent elsewhere. QNet
  Portal deliberately separates tenants per deployment instead — keep that, but give deployments
  an `orgId` so QRM/CRM can join across products.
- **User** `{userId, orgId, email, role, createdAt}` with **per-app role vocabularies mapped to a
  shared base** (`admin | operator | viewer` base; apps extend: webinar adds
  moderator/presenter, Qnet adds super/guest/kiosk). Today: three cookie-session models +
  PIN profiles + Supabase Auth.
- **Show / Session** — the worst naming collision in the suite ("session" = auth row, Zoom
  meeting, ShowEngine live round, webinar campaign occurrence). Canonical:
  **Campaign** (planned container, webinar-stack `campaigns` table shape) →
  **Show** `{showId, campaignId?, orgId, startAt, status}` (one live occurrence; ShowEngine's
  armed/live/complete state machine is the best model) → app-specific run state hangs off `showId`.
- **Room / Meeting** `{roomId, showId, provider: 'zoom'|'local', providerMeetingId?, name}` —
  today: aggregator `meetingId`, webinar `roomId` (already aligned in `ParticipantState`).
- **Participant** — adopt webinar-stack's `ParticipantState`
  (`participantId, roomId, displayName, role, videoOn, audioOn, handRaised, isSpeaking, resolution`)
  as canonical; it is the only participant model in code.
- **ChatMessage** — adopt webinar-stack's `chat.message`
  (`id, roomId, sender, senderParticipantId?, content, ts, kind: chat|reply|broadcast|ai_reply`),
  which was explicitly authored as "the aggregator contract" (`contracts/src/messages.ts:33`).
  zoom-chat-aggregator should emit this shape onto the bus unchanged.
- **Device** — adopt Qnet-'s `DeviceState`
  (`tag, name, kind, model, capabilities[], health, metrics{}, updatedAt`, `src/types.ts:66-76`)
  as the canonical software representation, with the monitor's identity discipline: **`tag` is the
  stable key** (`AV-<vlan>-<octet>` convention), `ip` is an attribute. Health enum is already
  identical across Qnet- and qnet-monitor (`ok|warn|critical|unknown|offline`).
- **TelemetrySample** `{deviceTag, metric, value, unit?, ts, agentId}` — the monitor's tall format
  (`/ingest/telemetry`), already shared verbatim by Qnet-'s `PortalBridge`
  (`src/bridge/portal-telemetry.ts`). This is the suite's one **already-working cross-repo
  contract** — freeze it into `suite-contracts` first, since two shipping products depend on it.
- **MediaAsset** `{assetId, orgId, kind, storageKey, mime, bytes, createdAt}` — today: R2 keys in
  liveSalesEngine, planned in webinar-stack, ad-hoc uploads in Qnet- panels. Low urgency; define
  the shape, don't build a service yet.

### Hardware state representation & sync [recommendation]

Today: Qnet- holds live device state in memory (`DeviceManager`), exposes it as SSE snapshots to
its panel, pushes telemetry/hardware batches to the Portal over HTTPS (`x-agent-key`), and pulls
commands via `CommandPoller` (NAT-friendly). The monitor agent pushes the same ingest contract
read-only. Nothing else in the suite can see device state.

Recommended model, building only on proven pieces:

1. **Device identity**: stable `tag` (Qnet convention), asserted once in Qnet-'s `devices.json` /
   adoption flow; monitor and control MUST agree on tags per site (today they are configured
   independently — an integration risk, flagged in 03).
2. **State sync to the software suite**: Qnet- publishes `device.state` (full `DeviceState`) as a
   **retained** event per tag, plus `device.telemetry` samples, onto the studio's webinar-stack
   bus when co-deployed (the bus's retained-slot design is exactly a device-state cache; a late
   subscriber gets the whole rack's state on `sub`). This is additive — a second sink next to the
   existing `PortalBridge`, not a replacement.
3. **Commands stay out of the bus** [today's design is right]: control mutations go through
   Qnet-'s authed HTTP (`/api/command`, `/api/ext/*` tokens, role/room enforcement) or its
   existing portal command-pull. A show-control event (`show.cue`) may *request* an action, but
   the authority and audit trail stay in Qnet-. Read-fanout ≠ write-path.
4. **The monitor stays one-way read-only** — its whole safety story
   (per-protocol egress guards, verb allowlists) depends on it. Do not merge monitor and control
   agents.

## C. Integration Topology

### Which apps genuinely bolt together [today's evidence]

- **webinar-stack ⇄ zoom-chat-aggregator** — the only *declared* bolt-on: webinar-stack's
  contracts already define the aggregator's chat shape, its architecture cites the aggregator as
  the bus's design source, and its master plan folds "a chat aggregator" into the studio. The
  aggregator itself references nothing (one-way intent). **Real integration work required.**
- **Qnet- ⇄ QNet Portal ⇄ qnet-monitor** — already integrated by a shared ingest contract
  (`/api/public/ingest/*`, `x-agent-key`) and shared branding, with zero shared code. This family
  is internally coherent; keep evolving the contract deliberately (it is currently defined only by
  agent source + a stale integration brief).
- **Manufacturer-Database → Qnet- / qnet-monitor** — dev-time authoring source, no runtime link.
  Correct as-is; add schema-validation CI and make the vendored copy in qnet-monitor a pinned
  reference instead of a fork.
- **liveSalesEngine** — standalone by design (its OBS surface composits into any video chain,
  including the webinar studio, with zero code coupling — that is a feature, keep it).
- **ryte-live-translation** — standalone today; natural future feed into webinar-stack
  (translated audio as a studio source), but nothing in code assumes it.
- **DAW** — fully standalone; no reference in either direction (re-verified after the 2026-07-08
  update: grep for suite names still returns zero hits). The update strengthens its *conceptual*
  adjacency to the AV domain — it now models an Allen & Heath **Avantis** console strip and treats
  **Dante** as a normal multichannel input device (via DVS) — but that is hardware modeling, not
  integration intent. Its new `plan/03-BUILD-CONTRACT.md` also locks a strict UI → state-store →
  engine layering ("a control never changes its own state"; "swapping to a native backend later =
  zero UI changes"), which is the same single-authoritative-state house pattern the rest of the
  suite converged on — good news for any future integration, but still: treat as out of the
  integration plan until a concrete use (e.g. show audio playback for ShowEngine) is decided
  (04-open-questions).

### Recommended communication pattern per connection [recommendation]

| Connection | Pattern | Why |
|---|---|---|
| aggregator → webinar studio | **Bus events** (`chat.message`, retained participant state) over the webinar bus; aggregator adds one outbound bus-client module | Contract already written on the webinar side; keeps aggregator's SaaS deployment independent |
| webinar cloud ⇄ studio engine | Bus (existing design: cloud brokers short-TTL HMAC bus tokens) | Already built and verified |
| Qnet- → suite apps | Retained `device.*` events on the bus (co-located deployments only) | See §B hardware state |
| Qnet-/monitor → Portal | Existing HTTPS ingest push + command pull | Shipping in production; NAT-friendly; don't disturb |
| ShowEngine ⇄ anything | None now. If the webinar studio ever runs a ShowEngine game, integrate at the **video layer** (OBS/browser-source) first, events later | Cheapest real integration; zero contract risk |
| translation → webinar studio | Later: publish translated program audio as a studio source; control via `/api`-style REST | Not scheduled; translation needs auth/persistence first |
| Anything ⇄ anything via shared DB | **Never.** | See below |

**Shared-DB call-out**: nothing currently shares a database across apps — preserve that. The two
near-misses to watch: (1) webinar-stack's planned CRM and zoom-chat-aggregator's org/user tables
will be tempting to merge — integrate via API/events instead, or explicitly decide a merger of the
two products (04-open-questions); (2) QNet Portal's Supabase is effectively a shared DB between
Lovable UI, Postgres triggers, and QRM — acceptable inside one product boundary, but QRM should
stay on the `qrm/feed` API, not direct table reads (the service-role read path in the integration
brief is the one to retire).

### Auth / identity strategy [recommendation]

Today there are five identity systems (aggregator cookie-sessions, webinar cloud cookie-sessions,
ShowEngine shared password + phase-2 accounts, Qnet PIN profiles + kiosk tokens, Supabase Auth in
the Portal) and one app with none (translation).

- **Short term (pre-integration)**: do not build a shared IdP. Freeze the *pattern* instead — the
  bcrypt/opaque-token/HTTP-only-cookie implementation already duplicated in aggregator and
  webinar cloud becomes a tiny shared package (`suite-auth`) so the third copy isn't hand-rolled
  again (translation needs exactly this).
- **Medium term (when webinar-stack + aggregator actually join)**: one cloud identity for the
  RYTE SaaS products — webinar cloud is the natural owner (it already models the richest role set
  and is designed as the multi-tenant control plane). Aggregator orgs/users migrate to it or
  federate via signed tokens, mirroring the existing cloud→bus HMAC-token broker design.
- **Keep local/offline identity local**: Qnet- PINs and kiosk tokens must work with no internet —
  correct today, don't cloudify. Portal (Supabase Auth) stays per-deployment until the QNet fleet
  story demands central identity.

## D. Suite-level assessment

The suite is **three internally coherent islands plus three satellites**, connected today by
copied patterns rather than shared artifacts. The single highest-leverage artifact is a
`suite-contracts` package seeded from webinar-stack's contracts plus the QNet ingest contract —
both already exist in code, both are proven, and every recommended integration above consumes one
of them. Risks, ordered remediation, and open business decisions are in
`03-risks-and-recommendations.md` and `04-open-questions.md`.
