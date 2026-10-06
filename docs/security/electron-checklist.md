# Electron security checklist, desktop app

Status of `frontend/apps/desktop` against Electron's security recommendations
(https://www.electronjs.org/docs/latest/tutorial/security), as of 2026-10-05. Update this page when any row changes.

| #   | Recommendation                                       | Status | Where                                                                                                                                                                |
| --- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Only load secure content                             | Yes    | App pages come from the local renderer server; the web pane upgrades http where it can                                                                               |
| 2   | Do not enable Node integration for remote content    | Yes    | App window: `nodeIntegration: false`; web pane preferences are a fixed allowlist with it off                                                                         |
| 3   | Enable context isolation                             | Yes    | App window and web pane                                                                                                                                              |
| 4   | Enable process sandboxing                            | Yes    | Default on; the web pane sets `sandbox: true` explicitly                                                                                                             |
| 5   | Handle session permission requests                   | Yes    | App session: deny by default (`app-window-security.ts`); web pane: deny all                                                                                          |
| 6   | Do not disable webSecurity                           | Yes    | Never set; the web pane sets it true explicitly                                                                                                                      |
| 7   | Define a Content Security Policy                     | Yes    | App, loading and find pages (`app-window-policy.ts`); report-only in development                                                                                     |
| 8   | Do not enable allowRunningInsecureContent            | Yes    | Never set; the web pane sets it false explicitly                                                                                                                     |
| 9   | Do not enable experimental features                  | Yes    | Never set                                                                                                                                                            |
| 10  | Do not use enableBlinkFeatures                       | Yes    | Never set; the web pane allowlist drops any supplied value                                                                                                           |
| 11  | `<webview>`: do not use allowpopups                  | Yes    | The `<webview>` tag is no longer used; `webviewTag` is off in every window                                                                                           |
| 12  | `<webview>`: verify options and params               | n/a    | Replaced by a main-process `WebContentsView`                                                                                                                         |
| 13  | Disable or limit navigation                          | Yes    | `installWindowGuards`: app frame stays on its origin; frames use an allowlist                                                                                        |
| 14  | Disable or limit creation of new windows             | Yes    | `setWindowOpenHandler` denies; child windows are closed                                                                                                              |
| 15  | Do not use shell.openExternal with untrusted content | Yes    | Only http(s)/mailto from the app's main frame with live user activation                                                                                              |
| 16  | Use a current version of Electron                    | Yes    | 44.5.1; `check-electron-support.yml` fails when the major leaves the supported line                                                                                  |
| 17  | Validate the sender of all IPC messages              | Partly | Browser IPC checks `event.sender` and `senderFrame`; the generic bridge has a channel allowlist; the older handlers still need per-handler sender checks (follow-up) |
| 18  | Avoid usage of the file:// protocol                  | Yes    | The file:// fallback for the app page is gone                                                                                                                        |
| 19  | Check which fuses you can change                     | Yes    | Six fuses set in `forge.config.ts`, read back after packaging                                                                                                        |
| 20  | Do not expose Electron APIs to untrusted content     | Yes    | The web pane has no preload; the app preload exposes named methods only                                                                                              |

Related: `frontend/apps/desktop/SECURITY.md` (runtime, fuses, entitlements), `docs/security/audit-log.md`.
