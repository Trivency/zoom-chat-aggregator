# 04 — Open Questions (require a human / business decision)

> Framed as specific questions. Where analysis suggests a default, it is stated — but each of
> these shapes the suite and should not be decided silently by a build session.

## Ownership & provenance

1. **Which GitHub org is canonical for each repo — `Trivency` or `rytepro1`?**
   `webinar-stack` and `liveSalesEngine` self-identify as `rytepro1/…`; Trivency copies exist and
   are what agency sessions can reach. Are the Trivency copies mirrors, forks, or the new home?
   (Also affects: `qnet-monitor` docs assume a transfer *to* Trivency; the Qnet- updater defaults
   to `Trivency/qnet-dist-`.) Suggested default: consolidate everything the agency will build on
   under Trivency; archive rytepro1 copies read-only.
2. **What is the brand/entity structure — Trivency vs RYTE Productions vs QSE?**
   Code and docs use all three (RYTE branding in webinar/translation/ShowEngine/aggregator,
   Trivency as license owner of QNet, QSE for the Portal domain and QRM). This decides package
   scopes (`@trivency/*`?), portal domains, and which entity owns the shared identity provider.
3. **Will `byteSaberDev/Agency-Startup` be mirrored into Trivency?** Confirmed intent during this
   session, not yet done. Until then, agency process context comes only from the copies inside
   `liveSalesEngine`.

## Product scope

4. **Are zoom-chat-aggregator ("ZoomChat") and webinar-stack's chat plane one product or two?**
   webinar-stack's plan folds "a chat aggregator" into the studio and lists chat-moderation SaaS
   as a revenue layer; ZoomChat is already a shipping multi-tenant SaaS with billing. Options:
   (a) ZoomChat remains standalone and *feeds* the studio over the bus (lowest risk, recommended
   default); (b) ZoomChat is absorbed as the studio's chat plane (kills a shipping product's
   independence); (c) both, with ZoomChat's capture/moderation core extracted as a library
   (highest cost). This decision gates all webinar-domain integration work.
5. **Is DAW part of the suite or a separate venture?** Zero code/doc references in either
   direction, re-verified after Tony's 2026-07-08 update. The update makes the question sharper,
   not moot: DAW now models an Avantis live console, treats Dante as an input device, and has a
   cue-stack Show page — i.e. it is converging on live-event audio territory adjacent to
   ShowEngine and the webinar studio, while remaining architecturally standalone. If it is
   intended as suite show-audio tooling, that changes its Wave-2 (Tauri) priorities and it should
   join the `suite-contracts` conversation early; if not, exclude it from suite architecture and
   let it evolve freely.
   Related: DAW's 13-commit update came from a single author (Tony Camposeo) with the repo's own
   PROGRESS ground-truth left stale — worth clarifying whether DAW is inside the agency's
   doc-driven process or a solo track.
6. **Is ryte-live-translation a product or an event-services tool?** It has production polish in
   the operator console but no auth, no persistence, and committed keys. Productizing it means
   P1 work (auth, DB, multi-tenant); keeping it as an internal tool means locking it behind a
   VPN/allowlist instead. Which?
7. **`audio-tutor` and `ryte-hyperframes` were excluded from this analysis** (confirmed). Should
   they stay out of suite planning permanently, or be re-examined once the suite architecture
   settles?

## Architecture decisions needing sign-off

8. **Approve `suite-contracts` as a new repo?** (02 §B, 03 #5.) Includes: lifting
   `@webinar-stack/contracts` out of webinar-stack, freezing the QNet ingest contract, and the
   Node 22 / TS 5.8 / zod v4 toolchain pin. Also: private npm via GitHub Packages, or git
   dependencies?
9. **Who owns cloud identity long-term?** Recommended default (02 §C): webinar cloud becomes the
   IdP for RYTE SaaS products when aggregator integration starts; Qnet local PINs and Portal
   Supabase Auth stay separate. Sign-off needed because it implies aggregator org/user migration
   later.
10. **Does the QNet family join the studio bus?** The retained `device.state` fan-out (02 §B) is
    additive, but it couples a Crestron-replacement appliance to a webinar product's contract
    package. Alternative: QNet stays contract-isolated (Portal ingest only) until a concrete
    cross-domain deployment (a studio that runs both) exists. Which posture?
11. **ShowEngine "player" entity**: winners are free-text handles today; TikTok auto-capture is
    deferred. If cross-suite CRM (webinar-stack's Contact moat) is real, should ShowEngine's
    winners/players eventually resolve to suite-wide Contacts, or stay app-local? Affects the
    canonical-entity set in 02 §B.

## Operational

12. **When is the S7 rename cutover (monitor agent 1.1.0 → 1.4.0) scheduled?** Repo is three
    versions ahead of the production VM; several Portal features (serial/model identity,
    unknown-device detection) are blocked on it.
13. **Who is authorized to rotate the translation-service keys and purge `API_KEYS.rtf` history?**
    (P0 #1 — needs provider-account access, likely Theo.)
14. **Hardware bench time**: who/when for (a) webinar-stack S0.2 capture spike on the Mac Studio,
    and (b) Qnet- driver + CIP verification against real gear? Both suites' hardware claims are
    currently unverified by execution (03 #11).
