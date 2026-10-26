---
name: Sentry Setup
summary: "Everything that must be configured inside the Sentry web UI for Seed error reporting to work end to end: projects, the auth token, the GitHub integration, environments, release health, alerts, filters, scrubbing, spend caps and sampling."
---
This document covers everything that must be configured **inside the Sentry web UI** for our codebase setup to work end-to-end. The code-side setup (SDK init, source-map upload, release lifecycle in CI) is already done; this is the human checklist that complements it. <!-- id:Qb3WNowA -->

Org: `mintter` (URL: `https://mintter.sentry.io`) <!-- id:g6VuoJ-J -->

\--- <!-- id:7Z14nbTZ -->

# 1. Projects to create <!-- id:xTI15CmB -->

Create one Sentry project per runtime. The "platform" you pick during project creation only affects defaults (suggested integrations, onboarding text), it does **not** change what the SDK can send. Pick the closest match. <!-- id:yVpc8fHb -->

<!-- id:xKokoIk4 -->
| Project slug <!-- col:U5rYKGzT --> | What sends events <!-- col:GZMFY-n8 --> | Sentry "platform" to pick <!-- col:PNgp3Tbk --> | Notes <!-- col:HvICCEqe --> <!-- id:5yTlwQmj --> |
| --- | --- | --- | --- |
| `seed-site` | Remix web app (`@shm/web`), both server and browser via `@sentry/remix` | **JavaScript → Remix** | Single project for SSR + client. Sentry's Remix tile covers both. <!-- id:MDxSCIgc --> |
| `seed-notify` | Remix notify app (`@shm/notify`) | **JavaScript → Remix** | Same as above. <!-- id:mAQPVlCb --> |
| `seed-electron` | Desktop app, main process, all renderers, preload, native crashes, daemon symbols | **JavaScript → Electron** | One project, three SDKs (`@sentry/electron/main`, `/renderer`, `/preload`) all post here. Native daemon debug files also upload here so crash dumps symbolicate. <!-- id:N4bQp7En --> |

If `seed-site`, `seed-notify`, or `seed-electron` already exist with a different platform value (e.g. "Browser" or "Node"), don't recreate, the platform is mostly cosmetic. Just verify the slug matches what the code sends to (`vite.config.mts`, `vite.main.config.mts`, etc. all hard-code these slugs). <!-- id:u0Kt4q-C -->
  > **No separate project for the Go daemon.** Native (Electron + Go) crashes route through `seed-electron` because that's where the Electron main process is initialised and where `sentry-cli debug-files upload` pushes daemon symbols. If we ever ship a standalone server-side Go service that should report independently, create a `seed-daemon` project with platform **Go** at that point. <!-- id:t0wdrutx -->

## How to create a project <!-- id:RjTzFgiL -->

`Settings → Projects → Create Project` → <!-- id:tFEaCvQf -->
  1. Pick the platform from the table above. <!-- id:9Q8YLpil -->
  2. Set "Default alerts" → at minimum keep "When Sentry detects a new issue". <!-- id:VWoJSxJ8 -->
  3. Project slug: type the exact value from the table (must match the code). <!-- id:MZu-XuTo -->
  4. Team: assign to your team. <!-- id:uQN4K-Wq -->

\--- <!-- id:LiR8tRv8 -->

# 2. Auth token (required for CI sourcemap + release uploads) <!-- id:2CrCUZb3 -->

Our CI uploads sourcemaps and creates releases via `sentry-cli` and `@sentry/vite-plugin`. Both require `SENTRY_AUTH_TOKEN`. <!-- id:_x_pa6Sh -->

`Settings → Account → User Auth Tokens → Create New Token` <!-- id:hnIwvjgz -->
  - **Scopes (minimum):** <!-- id:d4lSH7A7 -->
    - `project:read` <!-- id:KgrsKSpS -->
    - `project:releases` <!-- id:jNjvbXGn -->
    - `org:read` <!-- id:dkmY3Up- -->
    - `project:write` (only if you want CI to be able to mutate project settings, usually skip) <!-- id:9mnOU7RE -->
  - **Name:** `ci-mintter-seed` (or similar so it's identifiable later). <!-- id:WpOF-rhU -->
  - Copy the value once, it's not shown again. <!-- id:nUYTENMj -->

Save the token to GitHub repo secrets as `SENTRY_AUTH_TOKEN` (likely already done; verify under `Settings → Secrets and variables → Actions`). <!-- id:FbQ-w1Rp -->
  > **Rotate every 6 months.** Old tokens stop working silently, releases keep getting created locally but sourcemaps fail to upload. Add a calendar reminder. <!-- id:KdGJfEVS -->

\--- <!-- id:meYv0Sf6 -->

# 3. GitHub integration (required for blame/Suspect Commits) <!-- id:RzfykuEn -->

Without this, our CI runs `sentry-cli releases set-commits --auto` but Sentry has no way to map commit SHAs back to authors/files, so Suspect Commits stays empty. <!-- id:6mqFACo1 -->

`Settings → Integrations → GitHub → Install` <!-- id:_0WmM5e_ -->
  - Authorise the GitHub app on the `mintterteam/mintter` (or repo owner) org. <!-- id:GlqyDkEl -->
  - After install, go to `Settings → Integrations → GitHub → Configure` and tick the repository (`seed` / `mintter` or whatever the repo is currently called). <!-- id:joJnRLkk -->
  - In each project (`seed-site`, `seed-notify`, `seed-electron`): `Settings → Projects → <project> → Source Maps & Repositories → Add Repository → GitHub → <repo>`. <!-- id:lJ8w0qo1 -->

After this is set, push a commit and watch the next release: `Releases → <release> → Commits` should show the commit list and `Suspected Commit` should appear on issues. <!-- id:yCixMmqc -->

\--- <!-- id:9a_F-tva -->

# 4. Environments <!-- id:dDW_GqD3 -->

Each project needs explicit environments so we can filter and alert per env. <!-- id:GP6n_ypU -->

In each project: `Settings → Projects → <project> → Environments` <!-- id:CgITaJZX -->

Create: <!-- id:sXnb3dEA -->

<!-- id:CqurpNpw -->
| Environment <!-- col:C1v2w42n --> | Used by <!-- col:vF5getmP --> <!-- id:PkWCXsFe --> |
| --- | --- |
| `production` | Web prod docker image; tagged desktop releases <!-- id:W8VfLM-a --> |
| `dev` | Web `:dev` docker image; daily desktop builds <!-- id:2uQOULFM --> |
| `development` | Local dev (only if you want to see local events; usually keep it but mute alerts) <!-- id:-9SPpZ7t --> |
| `staging` | Reserve the slug; not used yet <!-- id:k3PHkejS --> |

<!-- id:y28fnOVA -->
- Mark `development` as "Hidden" if you want to ignore local-dev noise. <!-- id:QcoJ25jv -->
- Set retention rules per env if you want shorter history for `dev`. <!-- id:xHGhjHdn -->

\--- <!-- id:ajuIPBdQ -->

# 5. Release Health <!-- id:DivL7bJE -->

Crash-free sessions / users only work if Release Health is on. <!-- id:ik2_smM2 -->

For each project: `Settings → Projects → <project> → Releases → Release Health` → enable. <!-- id:BLUamiQm -->
  - Specifically required for `seed-electron` if you want crash-rate-per-release alerts (a common one for desktop apps). <!-- id:ndFXlnPv -->
  - For Remix projects it's still useful but lower-priority. <!-- id:pLKyWIUU -->

\--- <!-- id:uIf9jjLG -->

# 6. Alerts <!-- id:qsI0Ql0d -->

Bare-minimum alert set per project. Create under `Alerts → Create Alert`. <!-- id:f-g1qt6d -->

## `seed-electron` <!-- id:nt50SExn -->

- **Issue alert:** new issue affecting > 25 users in 1 hour, in env `production` → email/Slack the team. <!-- id:guNPpMEd -->
- **Metric alert (Crash-Free Session Rate):** crash-free-session-rate \< 99% for 5m on env `production` → page on-call. <!-- id:UFWjDb3q -->
- **Issue alert:** any new fatal-level issue in env `production` → page immediately. <!-- id:IyhoAxaY -->

## `seed-site` / `seed-notify` <!-- id:iejPWWTZ -->

<!-- id:rhH7wIWw -->
- **Issue alert:** new issue with > 100 events in 1h on env `production` → Slack. <!-- id:kd5krSwR -->
- **Metric alert (Failure Rate):** transaction failure rate > 5% on env `production` for 10m → Slack. <!-- id:Pk9gI9XE -->
- **Performance alert:** `p75(transaction.duration)` regression on the top 5 routes (compare-week-over-week) → Slack. <!-- id:1w5Qu17d -->

Pick channels via `Settings → Integrations → Slack` (install the Sentry Slack app first if missing). <!-- id:28Vn805O -->

\--- <!-- id:oi768Cye -->

# 7. Inbound filters (cut noise immediately) <!-- id:VvxIESYk -->

Per project: `Settings → Projects → <project> → Inbound Filters` <!-- id:yl8gBzf2 -->

Toggle on: <!-- id:Pjm-lx36 -->
  - ✅ **Browser Extensions** (huge noise source for `seed-site` and `seed-electron` renderer) <!-- id:G21SYjVu -->
  - ✅ **Web crawlers** (for `seed-site`) <!-- id:j3BaTDXv -->
  - ✅ **Localhost** (skip on `seed-electron`, since the renderer reports `localhost` URLs in normal use) <!-- id:eXvrN7xg -->
  - ✅ **Filter out errors known to be caused by old browsers** (for `seed-site`) <!-- id:ziIuX5zC -->

You can also add custom URL filters, e.g. to ignore errors from preview/staging hostnames. <!-- id:9Yhlq1vv -->

\--- <!-- id:RvL85hkw -->

# 8. Data scrubbing <!-- id:qai2dIhA -->

`Settings → Security & Privacy → Data Scrubbing` (org-level) **and** also per-project. <!-- id:75zMDNU- -->
  - ✅ Keep "Use default scrubbers" on (passwords, credit cards, SSNs, common token patterns). <!-- id:-s0bEFi3 -->
  - Add custom scrubber fields if you have known sensitive cookie/header names. At minimum: <!-- id:lNTuUPrQ -->
    - `Authorization` (header) <!-- id:LIbXPCha -->
    - any cookie names used for auth in the web app <!-- id:OeRhLNyC -->
    - `dsn`, `apiKey` (if either ever ends up in extras) <!-- id:Eknoi_TG -->
  - ✅ "Prevent storing of IP addresses", leave off only if you actually need GeoIP per event. Our SDKs send `sendDefaultPii: false`, so IPs already aren't sent. <!-- id:WNMd-pBU -->

\--- <!-- id:cH1n9KRf -->

# 9. Spend caps (do this BEFORE turning everything on) <!-- id:3nA_q20g -->

Profiling + replays + tracing-at-100% can spike costs surprisingly fast. Set caps now. <!-- id:jUtoQUNX -->

`Settings → Subscription → Spend Allocation` <!-- id:Bdhuy5Ta -->
  - Set a monthly cap on: <!-- id:JW6Q0g2m -->
    - **Transactions** (tracing), start low, watch a week, raise. <!-- id:GQwytScm -->
    - **Profiles**, usually correlated with transactions; cap at the same ratio. <!-- id:grv2IPCl -->
    - **Replays**, replay-on-error is 100% sample, so spikes during incidents. <!-- id:GVI6j5fJ -->
    - **Attachments**, only matters if minidumps get large. <!-- id:6q1OOLcb -->

Recommended starting allocation (rough; tune after week 1): <!-- id:RmdAP2j8 -->
  - `seed-electron`: 50% of transaction budget, 80% of profile budget, 60% of replay budget. <!-- id:DHU_Z_D5 -->
  - `seed-site`: 40% / 15% / 30%. <!-- id:znfdrx04 -->
  - `seed-notify`: 10% / 5% / 10%. <!-- id:g-amBpIA -->

\--- <!-- id:Vp2GJoZa -->

# 10. Dynamic Sampling <!-- id:zHil3bj- -->

`Settings → Performance → Dynamic Sampling` <!-- id:TFUKzmck -->

Turn this on per project. It applies a server-side throttle on top of our in-app `tracesSampler`, prioritising: <!-- id:LcqyU575 -->
  - Slow transactions <!-- id:CLO0N4yv -->
  - Transactions with errors <!-- id:NALfmnQZ -->
  - Rare endpoints (preserves coverage on the long tail) <!-- id:CAW3VdHD -->

Without it, our 0.1–0.2 client sample rates can produce a flat distribution; with it, you keep the interesting events at the same volume. <!-- id:dYH9hT8p -->

\--- <!-- id:sUWp4BFt -->

# 11. Source maps & debug files, verification steps <!-- id:ueZ6GG0I -->

After the first production deploy with the new setup, confirm the pipeline actually works: <!-- id:-0xtllsm -->

## Source maps (web + electron renderer/main/preload) <!-- id:JPVbKqkp -->

1. `Releases → <release sha or version>`, should list "Artifacts" with files like `app/entry.client-XXX.js` and matching `.map`. <!-- id:lxBK91rP -->
2. Open any issue in `seed-site` or `seed-electron`. Click **View Source** on a frame. You should see original TypeScript. If you see minified JS, the release name in the SDK init doesn't match the release name in the upload. <!-- id:hL3GJxGa -->
3. If broken: check that `release` in the SDK init equals `release.name` in `sentryVitePlugin`. They both come from the same env var (`SITE_SENTRY_RELEASE` for web → commit SHA; `VITE_VERSION` for desktop → git tag). Confirm both are set in the failing CI run's logs. <!-- id:Ugrbg4OV -->

## Native daemon symbols (electron only) <!-- id:a3mwSdzu -->

<!-- id:PbKJHi8M -->
1. `Settings → Projects → seed-electron → Debug Files`. <!-- id:ghvNlsS4 -->
2. After the first release-desktop CI run, you should see entries with the `seed-daemon-<arch>` filename and a build ID. One row per arch (x86_64-apple-darwin, aarch64-apple-darwin, x86_64-unknown-linux-gnu, x86_64-pc-windows-gnu)._ <!-- id:QrhJP8Q_ -->
3. Trigger a fake daemon panic and check the resulting issue: the Go stack should be symbolicated (function names, file paths) instead of raw addresses. <!-- id:37nc5WjI -->

\--- <!-- id:EupnwKDS -->

# 12. Replays <!-- id:U6qK-U50 -->

`Settings → Projects → <project> → Replays` <!-- id:xds0qpzr -->
  - ✅ Confirm replay capture is enabled. <!-- id:fCInZee5 -->
  - Set "Block media" + "Mask all text" defaults (we already pass these in code; this is a belt-and-suspenders). <!-- id:LL8qO4RE -->
  - Privacy: confirm sampling won't capture PII inputs, our `replayIntegration({ maskAllText: true, blockAllMedia: true })` covers the common cases, but verify by watching one captured replay. <!-- id:V-kUNq1- -->

\--- <!-- id:iEvXwDqQ -->

# 13. Web Vitals (seed-site only) <!-- id:KS1UxQiM -->

`Insights → Web Vitals`, this auto-populates with `browserTracingIntegration` from v8. After 24h of prod traffic, you should see LCP/FCP/CLS/INP per route. No config needed; just confirm it's filling. <!-- id:vABZv1H9 -->

If empty after a day: <!-- id:metq2Ihq -->
  - Check that the SDK is initialised (open prod site → DevTools → Network → filter for `ingest.sentry.io` → should see `/envelope/` POSTs). <!-- id:RHXyQkKo -->
  - Check that you're not in `dev` env, Web Vitals filter defaults to `production`. <!-- id:O3i6-_d6 -->

\--- <!-- id:tDrVKaIe -->

# 14. Per-project ownership rules (optional but recommended) <!-- id:dS7YbGZF -->

`Settings → Projects → <project> → Ownership Rules` <!-- id:LX3L8kmk -->

Map paths to GitHub teams so issues auto-assign: <!-- id:DJYkSH7- -->

``` <!-- id:hng6T2T2 -->
path:frontend/apps/web/**           #web-team
path:frontend/apps/desktop/src/**   #desktop-team
path:frontend/apps/notify/**        #web-team
path:backend/**                     #backend-team
```

Combined with the GitHub integration, this means a new issue from `entry.client.tsx` auto-assigns to the web team without anyone routing it manually. <!-- id:R_zZ50Le -->

\--- <!-- id:9TvZuWpX -->

# 15. Quick verification checklist <!-- id:PMfl3ATS -->

Run through this once after deploying with the new setup: <!-- id:DK-K3YXG -->
  - \[ \] All three projects exist with correct slugs. <!-- id:fgpKHP67 -->
  - \[ \] `SENTRY_AUTH_TOKEN` set in GitHub Actions secrets, valid scopes. <!-- id:tqmTBBim -->
  - \[ \] GitHub integration installed and repo linked to all three projects. <!-- id:spgVmh2o -->
  - \[ \] Environments `production` and `dev` exist per project. <!-- id:_OyLoJVI -->
  - \[ \] First release after merge appears under `Releases` with commits attached. <!-- id:fLwItOZI -->
  - \[ \] Open any issue → `View Source` shows original TypeScript. <!-- id:Rz0ihkqO -->
  - \[ \] `Settings → Debug Files` for `seed-electron` lists Go binaries with build IDs. <!-- id:FKRfB7PZ -->
  - \[ \] Inbound filters: browser extensions enabled. <!-- id:PPzG5gmo -->
  - \[ \] Spend caps set for all three projects. <!-- id:xScIm505 -->
  - \[ \] Dynamic Sampling enabled per project. <!-- id:xHe8sF1u -->
  - \[ \] At least the "new issue affecting > N users" alert exists per project, routed to Slack. <!-- id:yd5zNiIw -->
  - \[ \] Replay quota covers expected daily volume. <!-- id:ABO8jEFY -->
  - \[ \] (Web only) After 24h of traffic, `Insights → Web Vitals` populated. <!-- id:-vRyDg3H -->

\--- <!-- id:HAOatrdD -->

# 16. Where each setting lives in code (for reference) <!-- id:ezix6BP1 -->

So you know what to change in code if a Sentry-side change requires a code change: <!-- id:S0dAarHu -->

<!-- id:bYh45P7w -->
| Sentry setting <!-- col:EJKZh34q --> | Code location <!-- col:M3Zi98cc --> <!-- id:z6Hh7-Gn --> |
| --- | --- |
| Project slug | `frontend/apps/web/vite.config.mts` (`project: 'seed-site'`); `frontend/apps/notify/vite.config.ts` (`project: 'seed-notify'`); `frontend/apps/desktop/vite.{main,renderer,preload,renderer.find-in-page}.config.mts` (`project: 'seed-electron'`); `scripts/upload-daemon-symbols.mjs` (`SENTRY_PROJECT` default). <!-- id:LYUvjdqG --> |
| Org slug | Same files (`org: 'mintter'`). <!-- id:Dwv9FvKm --> |
| Release name (web) | `process.env.SITE_SENTRY_RELEASE`, set from `COMMIT_HASH` build arg in `frontend/apps/web/Dockerfile`. <!-- id:zHmzuQWS --> |
| Release name (desktop) | `VERSION` constant from `@shm/shared/constants` → `VITE_VERSION` env var → CI sets it from git tag (`needs.build-info.outputs.version`). <!-- id:aB36astE --> |
| Environment | `SITE_SENTRY_ENVIRONMENT` (web) / `SENTRY_ENVIRONMENT` (desktop). <!-- id:X2CSzo-T --> |
| Sampling rates | `frontend/apps/web/app/entry.client.tsx`, `frontend/apps/web/instrumentation.server.mjs`, `frontend/apps/desktop/src/main.ts`, `frontend/apps/desktop/src/renderer.ts`. <!-- id:bZs45qBB --> |
| What gets stripped post-upload | `sourcemaps.filesToDeleteAfterUpload` in each `vite*.config.mts`. <!-- id:BeDECB8J --> |
| CI release lifecycle | `.github/workflows/release-desktop.yml`, `dev-desktop.yml`, `release-docker-images.yml`, `dev-docker-images.yml` (look for `finalize-sentry-*` jobs). <!-- id:fhXy3CWe --> |
| Daemon symbol upload | `scripts/upload-daemon-symbols.mjs`, called from the release/dev desktop workflows. <!-- id:IfWk7NiC --> |

\--- <!-- id:x3BtA-bP -->

If a setting in this doc is missing in the dashboard but the code expects it, errors will silently drop or events will appear unsymbolicated. Run through section 15 once and you're done. <!-- id:NLHCbmsP -->
