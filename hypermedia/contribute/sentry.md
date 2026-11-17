---
name: Sentry
summary: Which Sentry project each Seed program reports errors to, where each Sentry setting lives in the code and the build workflows, and how to find and read an error.
---
Seed reports errors and crashes to [Sentry](https://sentry.io). The [web app](../software/web.md), the [notification service](../software/notify.md) and the [desktop app](../software/desktop.md) each initialise a Sentry SDK when a DSN is set, and the build workflows upload source maps and daemon debug symbols so stack traces are readable. This page is for a contributor who needs to find an error or change what is sent. It does not cover the settings a Sentry administrator configures in the Sentry web UI.

# Projects <!-- id:xTI15CmB -->

All projects are in the Sentry organisation whose slug is `mintter`. The code names that slug and the project slugs, so they must match.

<!-- id:xKokoIk4 -->
| Project slug <!-- col:U5rYKGzT --> | What sends events <!-- col:GZMFY-n8 --> | Enabled by <!-- col:PNgp3Tbk --> <!-- id:5yTlwQmj --> |
| --- | --- | --- |
| `seed-site` | the web app, both the server and the browser, through `@sentry/remix` | `SITE_SENTRY_DSN` <!-- id:MDxSCIgc --> |
| `seed-notify` | the notification service, through `@sentry/bun` | `NOTIFY_SENTRY_DSN` <!-- id:mAQPVlCb --> |
| `seed-electron` | the desktop app: main process, renderers, preload and native crashes | `VITE_DESKTOP_SENTRY_DSN` at build time <!-- id:N4bQp7En --> |

The Go [daemon](../software/daemon.md) has no project of its own. Native crashes of the desktop app and its daemon go to `seed-electron`, which is where the daemon's debug symbols are uploaded. <!-- id:t0wdrutx -->

Without a DSN an SDK does nothing, so a local build reports nothing unless you set one.

# Environments and releases <!-- id:dDW_GqD3 -->

Filter by environment and release to find the build an error came from.

- The web image sets `SITE_SENTRY_ENVIRONMENT=production` in its `Dockerfile`. The server and the browser read that variable, then `SENTRY_ENVIRONMENT`.
- The notification service reads `NOTIFY_SENTRY_ENVIRONMENT`, then `SENTRY_ENVIRONMENT`, then `NODE_ENV`, and falls back to `production`.
- The desktop main process reads `SENTRY_ENVIRONMENT`. Without it a packaged app reports as `production` and an unpackaged one as `development`. The renderer reads `VITE_SENTRY_ENVIRONMENT`, then the Vite mode.

The release name of a web or notify event is the commit hash the image was built from. The release name of a desktop event is the app version, which CI sets from the git tag.

# Reading an error

1. Open the issue in its project and pick the environment and release.
2. Click **View Source** on a stack frame. You should see the original TypeScript. If you see minified JavaScript, the release name in the SDK init does not match the release name of the uploaded source maps. Both come from the same variable: `SITE_SENTRY_RELEASE` for the web app, which is the commit hash, and `VITE_VERSION` for the desktop app, which is the git tag. Confirm both are set in the logs of the CI run that built it. <!-- id:hL3GJxGa -->
3. For a native daemon crash in `seed-electron`, the Go stack should show function names and file paths. If it shows raw addresses, check `Settings → Projects → seed-electron → Debug Files` for a `seed-daemon-<arch>` entry with the build id of that release. <!-- id:QrhJP8Q_ -->

Source maps and releases are uploaded by `@sentry/vite-plugin` and `sentry-cli` during the CI build, and both need the `SENTRY_AUTH_TOKEN` repository secret. When that token expires, events still arrive but source maps stop uploading, so traces turn minified. <!-- id:_x_pa6Sh -->

# Where each setting lives in code <!-- id:ezix6BP1 -->

<!-- id:bYh45P7w -->
| Sentry setting <!-- col:EJKZh34q --> | Code location <!-- col:M3Zi98cc --> <!-- id:z6Hh7-Gn --> |
| --- | --- |
| Project slug | `frontend/apps/web/vite.config.mts` (`project: 'seed-site'`); `frontend/apps/desktop/vite.{main,renderer,preload,renderer.find-in-page}.config.mts` (`project: 'seed-electron'`); `scripts/upload-daemon-symbols.mjs` (`SENTRY_PROJECT` default). <!-- id:LYUvjdqG --> |
| Organisation slug | The same files (`org: 'mintter'`), and `SENTRY_ORG` in the desktop workflows. <!-- id:Dwv9FvKm --> |
| SDK init (web) | `frontend/apps/web/app/entry.client.tsx` for the browser, `frontend/apps/web/instrumentation.server.mjs` for the server. |
| SDK init (notify) | `frontend/apps/notify/app/sentry.ts`. |
| SDK init (desktop) | `frontend/apps/desktop/src/main.ts` and `frontend/apps/desktop/src/renderer.ts`. |
| Release name (web, notify) | `SITE_SENTRY_RELEASE` and `NOTIFY_SENTRY_RELEASE`, set from the `COMMIT_HASH` build argument in each app's `Dockerfile`. <!-- id:zHmzuQWS --> |
| Release name (desktop) | the `VERSION` constant from `@shm/shared/constants`, from the `VITE_VERSION` variable that CI sets from the git tag. <!-- id:aB36astE --> |
| Environment | `SITE_SENTRY_ENVIRONMENT` (web), `NOTIFY_SENTRY_ENVIRONMENT` (notify), `SENTRY_ENVIRONMENT` and `VITE_SENTRY_ENVIRONMENT` (desktop). <!-- id:X2CSzo-T --> |
| Sampling rates | in the SDK init files above. <!-- id:bZs45qBB --> |
| What gets stripped after upload | `sourcemaps.filesToDeleteAfterUpload` in the web `vite.config.mts`. <!-- id:BeDECB8J --> |
| Secrets passed to builds | `.github/workflows/release-desktop.yml`, `dev-desktop.yml`, `release-docker-images.yml`, `dev-docker-images.yml` (`SENTRY_AUTH_TOKEN` and the DSN secrets). <!-- id:fhXy3CWe --> |
| Daemon symbol upload | `scripts/upload-daemon-symbols.mjs`, called from the release and dev desktop workflows on macOS and Linux. It skips with a warning when `SENTRY_AUTH_TOKEN` is unset. <!-- id:IfWk7NiC --> |

# See also

- [Releasing](./releasing.md), which produces the tagged builds.
- [Operations](../operate/operations.md), for the logs and metrics of a running app environment.
- [Working on Seed](../contribute.md), the list of contributor guides.
