# Design baseline capture

Run from the repository root with the `direnv` environment loaded:

```sh
pnpm design:capture
pnpm design:capture -- --only=storybook,emails
pnpm design:capture -- --only=web,vault --out=/path/to/captures --skip-build
pnpm design:capture -- --clips
```

By default, images are written to `design-captures/<short-commit>/`, which is ignored by Git. Each run writes a
`manifest.json` with the full commit, creation time, screenshot URL, and any failed views. A view failure is recorded
without stopping the remaining captures; the process exits non-zero if the manifest contains failures.

Screenshots use `surface/view--theme--viewport.png`. Themes are light and dark. Desktop images use a 1440×900 CSS
viewport and mobile images use 390×844; device scale is 1, locale is `en-US`, timezone is UTC, and normal capture
contexts request reduced motion. Before each screenshot the runner waits for network idle and `document.fonts.ready`,
waits two animation frames, and hides carets. `.relative-time`, `[data-relative-time]`, and `time[data-relative]`
elements are masked where present.

The manifest records the computed web body font family and resolved rendered face. On Linux, the system stack falls back
to DejaVu Sans when Inter is unavailable, so pre-Inter baselines do not show the typography macOS users see.

When Desktop is selected, `setupTestEnv` starts the shared fixture daemon on HTTP, gRPC, and P2P ports `58101`, `58102`,
and `58100`, allowing the renderer origin `http://localhost:5173`. The desktop app skips spawning another daemon and
seeds its design inventory into the fixture daemon. Its API, agents, and local-server ports are `58104`, `58105`, and
`58106`. Web and Vault-only runs use a separate disposable fixture daemon on ports `59101`–`59103` and a web fixture on
port `59100`. The desktop sidebar still subscribes to the default joined site whenever no identity is selected; the app
has no environment switch to disable that subscription, so network-provided sidebar content can remain nondeterministic.

## Surfaces

| Surface      | What is captured                                                                                                                                                         | Build and runtime notes                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storybook`  | Every `story` entry in the `@shm/ui` Storybook index, in both themes at desktop size.                                                                                    | Builds `storybook-static/` with `pnpm --filter @shm/ui storybook:build`, then serves it locally.                                                                                                                                                                                                                                                                                                    |
| `playground` | Each composition under `#compositions`, individually, in both themes at desktop and mobile sizes.                                                                        | Built with `pnpm --filter @shm/design-playground build`; theme is set through the playground hash state.                                                                                                                                                                                                                                                                                            |
| `emails`     | Every rendered email preview, light theme, desktop and mobile.                                                                                                           | Runs `render-all-previews.tsx` from a disposable working directory so generated HTML stays out of the source tree.                                                                                                                                                                                                                                                                                  |
| `web`        | Home, design article, discussion panel with two comments and a reply, notes collection in Table/List/Cards, and 404.                                                     | Uses `setupTestEnv` on isolated ports, building the web app unless `--skip-build` is set. Desktop runs share that fixture daemon on `58100`–`58102`; otherwise it uses `59101`–`59103`. Discussion comments are published with the local fixture key. The web app has no global search command or dialog; its only search input is for editing query blocks, so no search-command view is captured. |
| `vault`      | First screen, verification code, auth choice, password setup, recovery words, signed-in profile, and password sign-in, in both themes and viewport sizes.                | Uses the web fixture daemon and `startVaultServer`; a disposable email and password are used. Chromium is launched with experimental web-platform features for Ed25519 support.                                                                                                                                                                                                                     |
| `desktop`    | Library/home, article, draft slash menu, activity/feed, comments, General/Appearance settings, site settings, account menu, quick switcher, and first-screen onboarding. | Starts the Linux dev app with a disposable data directory and ports 58100–58107. Playwright launches the built Electron entry from the desktop package directory and uses the shared fixture daemon, then stops owned processes in `finally`.                                                                                                                                                       |

The manual full run may take several minutes; Storybook is the largest surface because each indexed story is captured
twice. `--skip-build` reuses the existing Storybook, playground, and web outputs but still seeds and starts runtime
services. The web route is read-only after fixture seeding. No production gateway is used.

With `--clips`, the runner records short light-theme Storybook interactions in `clips/`: menu, dialog, popover, tooltip,
toast, mobile drawer/sheet, button press, and sidebar collapse where a matching story exists. Clip contexts do not
request reduced motion. Missing interaction stories are skipped; failed interactions are reported in the manifest.
