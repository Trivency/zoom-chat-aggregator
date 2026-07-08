# 00 — Repo Inventory (Phase 0, confirmed)

> Confirmed by Theo on 2026-07-08: this list is complete; no additions, no exclusions.
> `Trivency/audio-tutor` and `Trivency/ryte-hyperframes` exist in the account but were
> deliberately left out of scope.

## Agency context repo

- **`byteSaberDev/Agency-Startup`** — UNREACHABLE from this analysis session (private repo under a
  different owner; the session's git layer rejects cross-owner adds). Decision: Theo will mirror it
  into the `Trivency` org; not yet available at time of writing. Partial substitute: the agency
  process docs vendored inside `liveSalesEngine` (`framework-kickoff-prompt.md`,
  `agency-starter-kit.md`, `team-onboarding-deck.md`) describe the doc-driven session-split method,
  the Tech-Lead / Builder / QA-Breaker role model, and the GitHub + Linear + Railway toolchain.

## Product repos (10)

| # | Repo | Language(s) | Purpose | Domain | State |
|---|------|-------------|---------|--------|-------|
| 1 | `zoom-chat-aggregator` | JS (Node/Express/Socket.IO), React 18 | Multi-room Zoom chat aggregation SaaS ("ZoomChat"): Recall.ai bot capture, moderation, outbound reply/broadcast, AI auto-responder, Stripe billing | Webinar | Production (multi-tenant, paying tiers) |
| 2 | `webinar-stack` | TS (Node 22 workspaces) + C++20/Obj-C++ (Metal, Zoom SDK) | "Webinar AI Studio" — remote-operated Zoom broadcast studio on a Mac Studio; contracts/bus/cloud/console + native engine | Webinar | Phase-0 foundation real; AV engine is a build-ready spike; rest planned |
| 3 | `liveSalesEngine` | TS (shared/server/web), Svelte 5, Drizzle/Postgres | "ShowEngine" — real-time live-selling game engine; operator/tv/obs surfaces, one authoritative server state | Show management | V1 live with a paying beta customer; v1.1 in progress |
| 4 | `ryte-live-translation` | TS (Fastify API, Next.js 14 web, shared pkg) | Live event translation: Deepgram STT → DeepL → Claude improve → ElevenLabs TTS → attendee phones over WS (LiveKit dormant) | Show management | Advanced prototype; no auth, no DB, no tests; **live secrets committed** |
| 5 | `DAW` | TS (React 18 + Vite, client-only) | Web-first digital audio workstation (Mix/Build/Run); Wave 2 = Tauri + VST3 | Show management (audio tooling) — standalone today | Prototype; no persistence/tests; zero suite references |
| 6 | `Qnet-` (`qnet-control`) | TS (Node 22, no framework), JSON-file store | QNet — software replacement for a Crestron control processor: 57 drivers, discovery, CIP bridge, role-aware web touch panels, portal bridge | Integrated AV control | Beta; protocol-audited but largely not hardware-verified |
| 7 | `qnet-monitor` | Python 3.12 (stdlib agent) + SQL seeds + specs | QNet Portal — read-only AV facility monitoring; ~20 protocol readers; dashboard lives in a separate Lovable/Supabase app (not in git here) | Integrated AV control | **In production** (AdventHealth Studio 7, ~216 devices); live agent 1.1.0 vs repo 1.4.0 |
| 8 | `Manufacturer-Database` | JSON + JSON Schema (data only) | AV device protocol DB: 80 manufacturers, 608 devices, 1,426 protocol entries with wire-level example commands | Integrated AV control (shared asset) | V1 substantially complete; no validation CI; no programmatic consumer |
| 9 | `qnet-dist-` | none (README only) | QNet installer/release distribution channel (public download page; updater default `QNET_DIST_REPO`) | Integrated AV control | Shell only |
| 10 | `agency-agents` | Markdown | Fork of msitarzewski/agency-agents (community AI-agent roster) — team tooling context, not a product | — (process) | Upstream fork |

## Intake flags (carried into the risk register)

1. **Ownership split — `Trivency` vs `rytepro1`.** `webinar-stack`'s README/PROGRESS say it is hosted
   at private GitHub `rytepro1/webinar-stack`; `liveSalesEngine`'s PROGRESS names
   `github.com/rytepro1/liveSalesEngine`. Both were cloned here from `Trivency/…` copies. Which org
   is canonical per repo is unresolved (see 04-open-questions).
2. **Production code outside git**: the QNet Portal dashboard (TanStack Start + Supabase) lives in
   Lovable, not in any repo in this set; `qnet-monitor` holds only specs/SQL for it.
3. **Vendored duplicate**: `qnet-monitor/Manufacturer-Database-main/` is an unsynced snapshot of
   repo #8 (confirmed inert to the running agent; drift risk).
4. **Committed live secrets** in `ryte-live-translation` (`API_KEYS.rtf`, git-tracked): Deepgram,
   DeepL, ElevenLabs, LiveKit credentials. Rotate immediately.
5. **Customer data in product repos**: `Qnet-` carries AdventHealth site dumps
   (`docs/reference/`), Studio-7 room names hardcoded in discovery heuristics, and the full S7
   deployment as `examples/studio7/`; `qnet-monitor` is the real S7 deployment transferred as-is.
6. **No submodules anywhere**; cross-repo reuse is by convention or copy-paste only.
7. `zoom-chat-aggregator` is the "chat aggregator" that `webinar-stack` plans to fold in — webinar-stack
   references it only as `~/Dev/chat-aggregator` (path on Theo's machine), and the aggregator itself
   contains zero references back.
