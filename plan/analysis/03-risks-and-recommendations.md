# 03 — Risks & Recommendations (prioritized)

> Ordered by **what unblocks integration work fastest**, not by severity alone. Each item states
> the evidence (see `01-per-repo-findings.md` for full citations), the blast radius, and the
> action. "P0" = do before any integration session is scheduled.

## P0 — Stop-the-bleeding (days)

1. **Rotate the committed credentials in `ryte-live-translation`.**
   `API_KEYS.rtf` is git-tracked at the repo root and contains live-looking keys for Deepgram,
   DeepL, ElevenLabs, and LiveKit (plus Fly IP allocations). `.gitignore` covers `API_KEYS.md`
   but not the `.rtf`. Treat all four as compromised: rotate at the providers, purge the file
   (and history, e.g. `git filter-repo`), move secrets to Fly/Vercel env. Until rotated, anyone
   with repo read access can bill your accounts.
2. **Decide the canonical org per repo (`Trivency` vs `rytepro1`) and archive the other copy.**
   `webinar-stack` and `liveSalesEngine` both self-identify as `rytepro1/…` in their own docs while
   Trivency copies exist and were used for this analysis. Two writable copies of an actively
   developed repo is how an agency team silently forks itself in week one. One decision, one
   archived mirror, done. (Business input needed — see 04.)
   *Live evidence of this risk class*: on 2026-07-08 `Trivency/DAW` 404'd from git and the GitHub
   API and dropped out of the account's repo list for a period spanning Tony's push, then
   reappeared — a rename/transfer/visibility flip happening mid-collaboration, unannounced.
3. **Get the QNet Portal codebase into git.** The dashboard serving a production customer (S7)
   exists only in Lovable; this repo set contains specs and SQL seeds for it, and the integration
   brief warns the live Supabase is already ahead of the last reviewed snapshot. Export/sync the
   TanStack Start app into a `Trivency/qnet-portal` repo and make Lovable a deploy target, not the
   source of truth. Until then, every Phase-1 claim about the Portal is reconstruction, and no
   agency developer can safely touch the QNet family's cloud half.
4. **Scrub customer-specific data out of `Qnet-`.** Already self-flagged (PROJECT_STATUS P4):
   AdventHealth config dumps in `docs/reference/`, Studio-7 room names inside
   `discovery/scanner.ts` (`guessRoom()`), the full S7 site as `examples/studio7/`. Move to a
   private site-configs repo before more people get access.

## P1 — Foundations that unblock integration (first 2–3 weeks)

5. **Create `suite-contracts` and freeze the two contracts that already work.**
   (a) The webinar bus envelope + message registry (`@webinar-stack/contracts`, lifted as-is);
   (b) the QNet ingest/telemetry contract, today defined only by Python agent source
   (`qnet_agent.py` payload builders) and a stale brief — write it down as zod + generated JSON
   Schema. Everything in 02 §C consumes one of these. This is the single fastest unblocker:
   integration sessions can then be specced against a package version instead of against another
   team's source tree.
6. **Fix the state-recovery gaps in the two apps that run live shows.**
   - `liveSalesEngine`: no boot-time rehydration of `RoundState` from Postgres — a server restart
     mid-show drops the live board (slots/winners survive as rows, but no code re-seeds memory).
     The data is already persisted; write the rehydrate path.
   - `ryte-live-translation`: everything (events, channels, listeners, transcripts, usage) is
     in-process Maps — a Fly restart mid-event loses the event itself. Minimum: persist
     events/channels; transcripts at least append to disk/R2.
   These are the two products pointed at paying/live audiences; integration multiplies restart
   frequency (deploys), so this debt gets worse the moment teams start shipping together.
7. **Pin the toolchain suite-wide**: Node 22 floor, TS 5.8, npm, zod v4 in shared code, plus a
   CI check per repo asserting them (02 §A). Cheap insurance against multi-developer drift.
8. **Give `ryte-live-translation` an auth gate.** Operator routes and event CRUD are completely
   open (`operatorId: "default" // TODO`), CORS `*`, and it is deployed on a public Fly URL.
   Reuse the aggregator/webinar cookie-session pattern (the planned `suite-auth` extraction —
   02 §C) rather than inventing a fourth variant.

## P2 — Pre-integration refactors (do before the specific integration that needs them)

9. **Before aggregator ⇄ webinar-stack integration:**
   - Add an outbound bus-client module to `zoom-chat-aggregator` emitting `chat.message` in the
     contracts shape (additive; its Socket.IO UI path is untouched).
   - Start TypeScript adoption in the aggregator at that boundary (`checkJs` + JSDoc types or a
     TS sidecar module) — the hub of the webinar domain cannot stay unable to consume the
     contract package. Full conversion can be incremental; the bus module should be TS from day 1.
   - Resolve the "two chat products" question (04) before anyone builds UI on top.
10. **Before Qnet- device-state fan-out:** align device `tag` assignment between Qnet- control
    and the monitor agent per site (today configured independently in `devices.json` vs
    `AGENT_DATA`); a shared site inventory file is enough. Then add the retained `device.state`
    bus publisher (02 §B).
11. **Before any webinar-stack AV milestone is scheduled against**: run the S0.2 capture spike on
    real hardware. Every engine plan (compositor, switcher, egress) is downstream of R1, which is
    explicitly unmeasured; the Crestron CIP bridge in Qnet- is similarly "protocol-audited, not
    hardware-verified." Both suites' hardware claims currently rest on unexecuted code paths —
    schedule bench time, not more code.
12. **Manufacturer-Database hygiene**: add schema-validation CI (a 20-line script — the schema is
    draft-07); replace the vendored copy in `qnet-monitor` with a pinned tag reference; then wire
    the promised authoring loop (DB entry → Qnet- driver scaffold from `_template.ts`) so the two
    driver knowledge bases stop diverging.

## P3 — Structural debt (schedule, don't firefight)

13. **Test coverage is inverted relative to risk.** The hardware-facing repos are best-tested
    (Qnet- 23 test files; monitor has a CI-gated selftest); the audience-facing live products are
    worst (translation: zero tests; liveSalesEngine: smokes only, Vitest "locked" in docs but not
    installed; DAW: zero test files — though its 2026-07-08 update added a runtime
    `engine.selfTest()` that renders each insert through `OfflineAudioContext` and asserts audible
    behavior, a good seed for a real test suite). Minimum bar: contract tests against
    `suite-contracts` in every consumer, plus restart/rehydration tests for the two live-show apps.
14. **Single-replica in-memory state is a suite-wide pattern** (aggregator ring buffers +
    unevicted `OrgState`, ShowEngine module-level Maps, translation Maps, bus retained map,
    Qnet- DeviceManager). It is the right pattern for appliance/studio boxes; it is a scaling
    ceiling for the SaaS products (aggregator, translation, webinar cloud). Document it as a
    deliberate constraint per app now; revisit only when a second replica is actually needed.
15. **Contract-doc drift is already happening inside single repos** (ShowEngine's WS doc omits 5
    implemented events; monitor's VERSIONS vs CLOUD_HANDOFF disagree on discovery-ingest status;
    Qnet- MIGRATION claims no `dmwebster` remnants while docker-compose still points at
    `ghcr.io/dmwebster/qnet`; and as of the 2026-07-08 DAW push, DAW's `PROGRESS.md` — its
    self-declared ground truth — still marks SC.2 "not started" and describes the deleted
    `Track.effects` path as current, while the code ships both). The doc-driven method needs its
    "docs are memory" rule enforced by review checklists once multiple builders are active —
    stale docs are worse than no docs for an agency team that trusts them.
16. **Gaps — capabilities the suite needs that no repo provides today:**
    - **Show-control glue**: OSC/timeline control is planned in webinar-stack (Plane 5) and absent
      everywhere else; nothing today can cue "start game / play video / change scene / recall
      device preset" across apps. This is the heart of an AV suite competing with Crestron and it
      is currently vapor. The bus + a `show.cue` message family is the natural first artifact.
    - **Shared identity / SSO** (02 §C — deliberate deferral, but it is a gap).
    - **Media asset service** (each app rolls its own storage: R2, local uploads, none).
    - **Fleet/licensing story** for QNet at multi-site scale (stubs exist: `fleet/*`, `license`
      endpoints; Portal is per-deployment).
    - **Billing exists only in the aggregator**; webinar-stack's business model assumes SaaS
      billing it hasn't built — decide whether Stripe integration is extracted or rebuilt.

## Blunt summary

The suite's biggest integration risk is not technical incompatibility — the stacks are close and
the patterns are already convergent. It is **provenance and ground truth**: two GitHub orgs, one
production app not in git, one repo with live keys committed, customer data in product repos, and
live deployments running versions behind their repos. An agency team building against this today
would be building on sand in exactly four places, all fixable in days (P0). After that, one
contracts package (P1 #5) converts every "bolt-on" from a negotiation between codebases into a
dependency on a versioned artifact.
