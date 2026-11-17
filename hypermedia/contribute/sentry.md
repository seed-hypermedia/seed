---
name: Sentry
summary: This page says which Sentry project each Seed program reports errors to, where each Sentry setting is in the code and the build workflows, and how to find and read an error.
---
Seed reports errors and crashes to [Sentry](https://sentry.io), a service that collects errors from running programs. This page is for a contributor who needs to find an error or to change what is sent. It does not cover the settings that a Sentry administrator changes in the Sentry web UI.

Three programs report: the [web app](../software/web.md), the [notification service](../software/notify.md) and the [desktop app](../software/desktop.md). Each one starts Sentry's client library when a DSN is set. A DSN is the address of a Sentry project. The build workflows upload source maps and the debug symbols of the daemon, so that stack traces are readable.

# Projects <!-- id:xTI15CmB -->

All projects are in the Sentry organisation with the slug `mintter`. A slug is the short name in a Sentry URL. The code names that slug and the project slugs, so they must match.

<!-- id:xKokoIk4 -->
| Project slug <!-- col:U5rYKGzT --> | What sends events <!-- col:GZMFY-n8 --> | Enabled by <!-- col:PNgp3Tbk --> <!-- id:5yTlwQmj --> |
| --- | --- | --- |
| `seed-site` | the web app, both the server and the browser, through `@sentry/remix` | `SITE_SENTRY_DSN` <!-- id:MDxSCIgc --> |
| `seed-notify` | the notification service, through `@sentry/bun` | `NOTIFY_SENTRY_DSN` <!-- id:mAQPVlCb --> |
| `seed-electron` | the desktop app: main process, renderers, preload and native crashes | `VITE_DESKTOP_SENTRY_DSN` at build time <!-- id:N4bQp7En --> |

The Go [daemon](../software/daemon.md) has no project of its own. Native crashes of the desktop app and its daemon go to `seed-electron`, which is where the daemon's debug symbols are uploaded. <!-- id:t0wdrutx -->

Without a DSN the Sentry library does nothing. So a local build reports nothing unless you set one.

# Environments and releases <!-- id:dDW_GqD3 -->

Filter by environment and by release to find the build that an error came from.

- The web image sets `SITE_SENTRY_ENVIRONMENT=production` in its `Dockerfile`. The server and the browser read that variable, then `SENTRY_ENVIRONMENT`.
- The notification service reads `NOTIFY_SENTRY_ENVIRONMENT`, then `SENTRY_ENVIRONMENT`, then `NODE_ENV`, and falls back to `production`.
- The main process of the desktop app reads `SENTRY_ENVIRONMENT`. Without it, a packaged app reports as `production` and an app run from source reports as `development`. The renderer reads `VITE_SENTRY_ENVIRONMENT`, then the Vite mode.

The release name of a web or notify event is the commit hash the image was built from. The release name of a desktop event is the app version, which CI sets from the git tag.

# Reading an error

1. Open the issue in its project and pick the environment and release.
2. Click **View Source** on a stack frame. You should see the original TypeScript. If you see minified JavaScript, the release name that the program sends does not match the release name of the uploaded source maps. Both come from the same variable: `SITE_SENTRY_RELEASE` for the web app, which is the commit hash, and `VITE_VERSION` for the desktop app, which is the git tag. Check in the logs of the CI run that built it that both are set. <!-- id:hL3GJxGa -->
3. For a crash of the daemon in `seed-electron`, the Go stack should show function names and file paths. If it shows raw addresses, look in `Settings → Projects → seed-electron → Debug Files` for a `seed-daemon-<arch>` entry with the build id of that release. <!-- id:QrhJP8Q_ -->

`@sentry/vite-plugin` and `sentry-cli` upload the source maps and the releases during the CI build. Both need the repository secret `SENTRY_AUTH_TOKEN`. When that token expires, events still arrive, but the upload of source maps stops, so traces show minified code. <!-- id:_x_pa6Sh -->

# Where each setting lives in code <!-- id:ezix6BP1 -->

<!-- id:bYh45P7w -->
| Sentry setting <!-- col:EJKZh34q --> | Code location <!-- col:M3Zi98cc --> <!-- id:z6Hh7-Gn --> |
| --- | --- |
| Project slug | `frontend/apps/web/vite.config.mts` (`project: 'seed-site'`); `frontend/apps/desktop/vite.{main,renderer,preload,renderer.find-in-page}.config.mts` (`project: 'seed-electron'`); `scripts/upload-daemon-symbols.mjs` (`SENTRY_PROJECT` default). <!-- id:LYUvjdqG --> |
| Organisation slug | The same files (`org: 'mintter'`), and `SENTRY_ORG` in the desktop workflows. <!-- id:Dwv9FvKm --> |
| Sentry start (web) | `frontend/apps/web/app/entry.client.tsx` for the browser, `frontend/apps/web/instrumentation.server.mjs` for the server. |
| Sentry start (notify) | `frontend/apps/notify/app/sentry.ts`. |
| Sentry start (desktop) | `frontend/apps/desktop/src/main.ts` and `frontend/apps/desktop/src/renderer.ts`. |
| Release name (web, notify) | `SITE_SENTRY_RELEASE` and `NOTIFY_SENTRY_RELEASE`, set from the `COMMIT_HASH` build argument in each app's `Dockerfile`. <!-- id:zHmzuQWS --> |
| Release name (desktop) | the `VERSION` constant from `@shm/shared/constants`, from the `VITE_VERSION` variable that CI sets from the git tag. <!-- id:aB36astE --> |
| Environment | `SITE_SENTRY_ENVIRONMENT` (web), `NOTIFY_SENTRY_ENVIRONMENT` (notify), `SENTRY_ENVIRONMENT` and `VITE_SENTRY_ENVIRONMENT` (desktop). <!-- id:X2CSzo-T --> |
| Sampling rates | in the Sentry start files above. <!-- id:bZs45qBB --> |
| What gets stripped after upload | `sourcemaps.filesToDeleteAfterUpload` in the web `vite.config.mts`. <!-- id:BeDECB8J --> |
| Secrets passed to builds | `.github/workflows/release-desktop.yml`, `dev-desktop.yml`, `release-docker-images.yml`, `dev-docker-images.yml` (`SENTRY_AUTH_TOKEN` and the DSN secrets). <!-- id:fhXy3CWe --> |
| Daemon symbol upload | `scripts/upload-daemon-symbols.mjs`, called from the release and dev desktop workflows on macOS and Linux. It skips with a warning when `SENTRY_AUTH_TOKEN` is unset. <!-- id:IfWk7NiC --> |

# See also

- [Releasing](./releasing.md), which produces the tagged builds.
- [Logs](../operate/logs.md) and [endpoints and health](../operate/endpoints-and-health.md), for the logs and metrics of a running [app environment](../software/app-environment.md).
- [Working on Seed](../contribute.md), the list of contributor guides.
