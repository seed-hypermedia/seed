# Sentry Dashboard Setup — Required Configuration

This document covers everything that must be configured **inside the Sentry web UI** for our codebase setup to work end-to-end. The code-side setup (SDK init, source-map upload, release lifecycle in CI) is already done; this is the human checklist that complements it.

Org: `mintter` (URL: `https://mintter.sentry.io`)

---

## 1. Projects to create

Create one Sentry project per runtime. The "platform" you pick during project creation only affects defaults (suggested integrations, onboarding text) — it does **not** change what the SDK can send. Pick the closest match.

| Project slug | What sends events | Sentry "platform" to pick | Notes |
| --- | --- | --- | --- |
| `seed-site` | Remix web app (`@shm/web`) — both server and browser via `@sentry/remix` | **JavaScript → Remix** | Single project for SSR + client. Sentry's Remix tile covers both. |
| `seed-notify` | Remix notify app (`@shm/notify`) | **JavaScript → Remix** | Same as above. |
| `seed-electron` | Desktop app — main process, all renderers, preload, native crashes, daemon symbols | **JavaScript → Electron** | One project, three SDKs (`@sentry/electron/main`, `/renderer`, `/preload`) all post here. Native daemon debug files also upload here so crash dumps symbolicate. |

If `seed-site`, `seed-notify`, or `seed-electron` already exist with a different platform value (e.g. "Browser" or "Node"), don't recreate — the platform is mostly cosmetic. Just verify the slug matches what the code sends to (`vite.config.mts`, `vite.main.config.mts`, etc. all hard-code these slugs).

> **No separate project for the Go daemon.** Native (Electron + Go) crashes route through `seed-electron` because that's where the Electron main process is initialised and where `sentry-cli debug-files upload` pushes daemon symbols. If we ever ship a standalone server-side Go service that should report independently, create a `seed-daemon` project with platform **Go** at that point.

### How to create a project

`Settings → Projects → Create Project` →
1. Pick the platform from the table above.
2. Set "Default alerts" → at minimum keep "When Sentry detects a new issue".
3. Project slug: type the exact value from the table (must match the code).
4. Team: assign to your team.

---

## 2. Auth token (required for CI sourcemap + release uploads)

Our CI uploads sourcemaps and creates releases via `sentry-cli` and `@sentry/vite-plugin`. Both require `SENTRY_AUTH_TOKEN`.

`Settings → Account → User Auth Tokens → Create New Token`

- **Scopes (minimum):**
  - `project:read`
  - `project:releases`
  - `org:read`
  - `project:write` (only if you want CI to be able to mutate project settings — usually skip)
- **Name:** `ci-mintter-seed` (or similar so it's identifiable later).
- Copy the value once — it's not shown again.

Save the token to GitHub repo secrets as `SENTRY_AUTH_TOKEN` (likely already done; verify under `Settings → Secrets and variables → Actions`).

> **Rotate every 6 months.** Old tokens stop working silently — releases keep getting created locally but sourcemaps fail to upload. Add a calendar reminder.

---

## 3. GitHub integration (required for blame/Suspect Commits)

Without this, our CI runs `sentry-cli releases set-commits --auto` but Sentry has no way to map commit SHAs back to authors/files, so Suspect Commits stays empty.

`Settings → Integrations → GitHub → Install`

- Authorise the GitHub app on the `mintterteam/mintter` (or repo owner) org.
- After install, go to `Settings → Integrations → GitHub → Configure` and tick the repository (`seed` / `mintter` or whatever the repo is currently called).
- In each project (`seed-site`, `seed-notify`, `seed-electron`):
  `Settings → Projects → <project> → Source Maps & Repositories → Add Repository → GitHub → <repo>`.

After this is set, push a commit and watch the next release: `Releases → <release> → Commits` should show the commit list and `Suspected Commit` should appear on issues.

---

## 4. Environments

Each project needs explicit environments so we can filter and alert per env.

In each project: `Settings → Projects → <project> → Environments`

Create:

| Environment | Used by |
| --- | --- |
| `production` | Web prod docker image; tagged desktop releases |
| `dev` | Web `:dev` docker image; daily desktop builds |
| `development` | Local dev (only if you want to see local events; usually keep it but mute alerts) |
| `staging` | Reserve the slug; not used yet |

- Mark `development` as "Hidden" if you want to ignore local-dev noise.
- Set retention rules per env if you want shorter history for `dev`.

---

## 5. Release Health

Crash-free sessions / users only work if Release Health is on.

For each project: `Settings → Projects → <project> → Releases → Release Health` → enable.

- Specifically required for `seed-electron` if you want crash-rate-per-release alerts (a common one for desktop apps).
- For Remix projects it's still useful but lower-priority.

---

## 6. Alerts

Bare-minimum alert set per project. Create under `Alerts → Create Alert`.

### `seed-electron`

- **Issue alert:** new issue affecting > 25 users in 1 hour, in env `production` → email/Slack the team.
- **Metric alert (Crash-Free Session Rate):** crash-free-session-rate < 99% for 5m on env `production` → page on-call.
- **Issue alert:** any new fatal-level issue in env `production` → page immediately.

### `seed-site` / `seed-notify`

- **Issue alert:** new issue with > 100 events in 1h on env `production` → Slack.
- **Metric alert (Failure Rate):** transaction failure rate > 5% on env `production` for 10m → Slack.
- **Performance alert:** `p75(transaction.duration)` regression on the top 5 routes (compare-week-over-week) → Slack.

Pick channels via `Settings → Integrations → Slack` (install the Sentry Slack app first if missing).

---

## 7. Inbound filters (cut noise immediately)

Per project: `Settings → Projects → <project> → Inbound Filters`

Toggle on:
- ✅ **Browser Extensions** (huge noise source for `seed-site` and `seed-electron` renderer)
- ✅ **Web crawlers** (for `seed-site`)
- ✅ **Localhost** (skip on `seed-electron`, since the renderer reports `localhost` URLs in normal use)
- ✅ **Filter out errors known to be caused by old browsers** (for `seed-site`)

You can also add custom URL filters — e.g. to ignore errors from preview/staging hostnames.

---

## 8. Data scrubbing

`Settings → Security & Privacy → Data Scrubbing` (org-level) **and** also per-project.

- ✅ Keep "Use default scrubbers" on (passwords, credit cards, SSNs, common token patterns).
- Add custom scrubber fields if you have known sensitive cookie/header names. At minimum:
  - `Authorization` (header)
  - any cookie names used for auth in the web app
  - `dsn`, `apiKey` (if either ever ends up in extras)
- ✅ "Prevent storing of IP addresses" — leave off only if you actually need GeoIP per event. Our SDKs send `sendDefaultPii: false`, so IPs already aren't sent.

---

## 9. Spend caps (do this BEFORE turning everything on)

Profiling + replays + tracing-at-100% can spike costs surprisingly fast. Set caps now.

`Settings → Subscription → Spend Allocation`

- Set a monthly cap on:
  - **Transactions** (tracing) — start low, watch a week, raise.
  - **Profiles** — usually correlated with transactions; cap at the same ratio.
  - **Replays** — replay-on-error is 100% sample, so spikes during incidents.
  - **Attachments** — only matters if minidumps get large.

Recommended starting allocation (rough; tune after week 1):
- `seed-electron`: 50% of transaction budget, 80% of profile budget, 60% of replay budget.
- `seed-site`: 40% / 15% / 30%.
- `seed-notify`: 10% / 5% / 10%.

---

## 10. Dynamic Sampling

`Settings → Performance → Dynamic Sampling`

Turn this on per project. It applies a server-side throttle on top of our in-app `tracesSampler`, prioritising:
- Slow transactions
- Transactions with errors
- Rare endpoints (preserves coverage on the long tail)

Without it, our 0.1–0.2 client sample rates can produce a flat distribution; with it, you keep the interesting events at the same volume.

---

## 11. Source maps & debug files — verification steps

After the first production deploy with the new setup, confirm the pipeline actually works:

### Source maps (web + electron renderer/main/preload)

1. `Releases → <release sha or version>` — should list "Artifacts" with files like `app/entry.client-XXX.js` and matching `.map`.
2. Open any issue in `seed-site` or `seed-electron`. Click **View Source** on a frame. You should see original TypeScript. If you see minified JS, the release name in the SDK init doesn't match the release name in the upload.
3. If broken: check that `release` in the SDK init equals `release.name` in `sentryVitePlugin`. They both come from the same env var (`SITE_SENTRY_RELEASE` for web → commit SHA; `VITE_VERSION` for desktop → git tag). Confirm both are set in the failing CI run's logs.

### Native daemon symbols (electron only)

1. `Settings → Projects → seed-electron → Debug Files`.
2. After the first release-desktop CI run, you should see entries with the `seed-daemon-<arch>` filename and a build ID. One row per arch (x86_64-apple-darwin, aarch64-apple-darwin, x86_64-unknown-linux-gnu, x86_64-pc-windows-gnu).
3. Trigger a fake daemon panic and check the resulting issue: the Go stack should be symbolicated (function names, file paths) instead of raw addresses.

---

## 12. Replays

`Settings → Projects → <project> → Replays`

- ✅ Confirm replay capture is enabled.
- Set "Block media" + "Mask all text" defaults (we already pass these in code; this is a belt-and-suspenders).
- Privacy: confirm sampling won't capture PII inputs — our `replayIntegration({ maskAllText: true, blockAllMedia: true })` covers the common cases, but verify by watching one captured replay.

---

## 13. Web Vitals (seed-site only)

`Insights → Web Vitals` — this auto-populates with `browserTracingIntegration` from v8. After 24h of prod traffic, you should see LCP/FCP/CLS/INP per route. No config needed; just confirm it's filling.

If empty after a day:
- Check that the SDK is initialised (open prod site → DevTools → Network → filter for `ingest.sentry.io` → should see `/envelope/` POSTs).
- Check that you're not in `dev` env — Web Vitals filter defaults to `production`.

---

## 14. Per-project ownership rules (optional but recommended)

`Settings → Projects → <project> → Ownership Rules`

Map paths to GitHub teams so issues auto-assign:

```
path:frontend/apps/web/**           #web-team
path:frontend/apps/desktop/src/**   #desktop-team
path:frontend/apps/notify/**        #web-team
path:backend/**                     #backend-team
```

Combined with the GitHub integration, this means a new issue from `entry.client.tsx` auto-assigns to the web team without anyone routing it manually.

---

## 15. Quick verification checklist

Run through this once after deploying with the new setup:

- [ ] All three projects exist with correct slugs.
- [ ] `SENTRY_AUTH_TOKEN` set in GitHub Actions secrets, valid scopes.
- [ ] GitHub integration installed and repo linked to all three projects.
- [ ] Environments `production` and `dev` exist per project.
- [ ] First release after merge appears under `Releases` with commits attached.
- [ ] Open any issue → `View Source` shows original TypeScript.
- [ ] `Settings → Debug Files` for `seed-electron` lists Go binaries with build IDs.
- [ ] Inbound filters: browser extensions enabled.
- [ ] Spend caps set for all three projects.
- [ ] Dynamic Sampling enabled per project.
- [ ] At least the "new issue affecting > N users" alert exists per project, routed to Slack.
- [ ] Replay quota covers expected daily volume.
- [ ] (Web only) After 24h of traffic, `Insights → Web Vitals` populated.

---

## 16. Where each setting lives in code (for reference)

So you know what to change in code if a Sentry-side change requires a code change:

| Sentry setting | Code location |
| --- | --- |
| Project slug | `frontend/apps/web/vite.config.mts` (`project: 'seed-site'`); `frontend/apps/notify/vite.config.ts` (`project: 'seed-notify'`); `frontend/apps/desktop/vite.{main,renderer,preload,renderer.find-in-page}.config.mts` (`project: 'seed-electron'`); `scripts/upload-daemon-symbols.mjs` (`SENTRY_PROJECT` default). |
| Org slug | Same files (`org: 'mintter'`). |
| Release name (web) | `process.env.SITE_SENTRY_RELEASE` — set from `COMMIT_HASH` build arg in `frontend/apps/web/Dockerfile`. |
| Release name (desktop) | `VERSION` constant from `@shm/shared/constants` → `VITE_VERSION` env var → CI sets it from git tag (`needs.build-info.outputs.version`). |
| Environment | `SITE_SENTRY_ENVIRONMENT` (web) / `SENTRY_ENVIRONMENT` (desktop). |
| Sampling rates | `frontend/apps/web/app/entry.client.tsx`, `frontend/apps/web/instrumentation.server.mjs`, `frontend/apps/desktop/src/main.ts`, `frontend/apps/desktop/src/renderer.ts`. |
| What gets stripped post-upload | `sourcemaps.filesToDeleteAfterUpload` in each `vite*.config.mts`. |
| CI release lifecycle | `.github/workflows/release-desktop.yml`, `dev-desktop.yml`, `release-docker-images.yml`, `dev-docker-images.yml` (look for `finalize-sentry-*` jobs). |
| Daemon symbol upload | `scripts/upload-daemon-symbols.mjs`, called from the release/dev desktop workflows. |

---

If a setting in this doc is missing in the dashboard but the code expects it, errors will silently drop or events will appear unsymbolicated. Run through section 15 once and you're done.
