/**
 * Loopback catcher for provider subscription sign-ins ("Sign in with ChatGPT").
 *
 * The OpenAI Codex OAuth client's registered redirect URI is fixed at
 * `http://localhost:1455/auth/callback` — localhost of the machine running the
 * user's browser, which is this machine. The agent server (possibly remote)
 * never binds this port; while a sign-in is pending, the desktop main process
 * listens here, serves a Seed-branded success/error page, and stores the
 * redirect URL for the renderer to pick up and submit to the agent server via
 * the signed `SubmitProviderOAuthCode` action.
 */
import http from 'http'
import z from 'zod'
import {t} from './app-trpc'
import * as log from './logger'

const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'

type CallbackState = {
  server: http.Server
  /** OAuth `state` from the authorization URL; callbacks for other logins are rejected. */
  expectedState: string | null
  capturedUrl: string | null
}

let current: CallbackState | null = null

const SEED_LOGO_SVG = `<svg width="19" height="26" viewBox="0 0 19 26" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:48px;height:auto"><path d="M18.5833 13.4542C18.6541 11.4159 18.4457 7.91181 16.7832 4.8019C16.0289 3.39085 14.8629 2.14789 13.5096 1.28385C12.4723 0.62152 11.3249 0.181837 10.1685 0.059749C10.1672 0.0596091 10.166 0.0606033 10.1659 0.0619411C10.1658 0.0632832 10.1646 0.064278 10.1633 0.0641323C8.70673 -0.0955052 7.23475 0.247787 5.94945 1.28385C2.12484 4.36684 3.56093 10.0698 6.78907 12.6265C6.79055 12.6277 6.79233 12.6284 6.79421 12.6285C6.79603 12.6286 6.79761 12.6292 6.79906 12.6303C7.08564 12.8485 8.12318 13.6502 9.17449 14.6094C9.17864 14.6131 9.18533 14.6105 9.18572 14.6048C9.18611 14.5992 9.19275 14.5965 9.1969 14.6003C9.8433 15.1896 10.4956 15.8387 10.9825 16.4487C11.6182 17.2452 12.1051 18.731 11.9915 20.0411C11.8623 21.5322 10.9553 22.7958 8.60501 22.5573C8.60375 22.5572 8.60253 22.5581 8.60244 22.5594C8.60236 22.5607 8.60124 22.5616 8.59998 22.5615C8.40886 22.5429 8.20812 22.5143 7.99741 22.4751C2.9495 21.5343 1.91332 15.499 1.64171 13.193C1.41042 11.2294 1.56321 9.96839 1.64409 9.30091C1.82932 7.77221 2.5587 5.84002 3.15362 4.44651C3.41881 3.82532 3.09277 3.61077 2.71576 4.17039C1.06998 6.61333 0.0880503 9.90002 0.0116986 12.0995C-0.059063 14.1378 0.149308 17.6419 1.8118 20.7518C2.56612 22.1629 3.73213 23.4058 5.08542 24.2699C6.12278 24.9322 7.27017 25.3719 8.42653 25.494C8.42786 25.4941 8.42903 25.4931 8.42913 25.4918C8.42922 25.4904 8.4304 25.4894 8.43173 25.4896C9.88832 25.6492 11.3603 25.3059 12.6456 24.2699C16.4702 21.1869 15.0341 15.4839 11.806 12.9272C11.8045 12.926 11.8027 12.9253 11.8008 12.9252C11.799 12.9251 11.7974 12.9245 11.796 12.9234C11.5094 12.7053 10.4719 11.9035 9.42055 10.9444C9.4164 10.9406 9.40971 10.9432 9.40932 10.9489C9.40893 10.9545 9.40229 10.9572 9.39814 10.9534C8.75174 10.3641 8.09942 9.71498 7.61257 9.10501C6.93334 8.25403 6.42401 6.61621 6.6354 5.24637C6.84703 3.875 7.78101 2.77222 9.99003 2.99639C9.99129 2.99652 9.99251 2.99558 9.9926 2.9943C9.99268 2.99303 9.9938 2.99208 9.99506 2.9922C10.1862 3.01079 10.3869 3.03938 10.5976 3.07865C15.6455 4.01944 16.6817 10.0547 16.9533 12.3607C17.1846 14.3243 17.0318 15.5853 16.9509 16.2528L16.9509 16.2529L16.9508 16.2537C16.8522 17.6726 16.0837 19.6719 15.4549 21.1138C15.1849 21.7329 15.5023 21.943 15.8793 21.3833C17.5251 18.9404 18.507 15.6537 18.5833 13.4542Z" fill="currentColor"/></svg>`

function renderPage(options: {title: string; message: string; detail?: string}): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(options.title)} — Seed</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f6f4ef; color: #1a1a1a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #161512; color: #fafafa; } }
  main { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; max-width: 480px; }
  h1 { font-size: 20px; margin: 0; }
  p { margin: 0; opacity: 0.7; font-size: 14px; line-height: 1.5; }
  .logo { color: #6ba36b; }
</style>
</head>
<body>
<main>
  <div class="logo">${SEED_LOGO_SVG}</div>
  <h1>${escape(options.title)}</h1>
  <p>${escape(options.message)}</p>
  ${options.detail ? `<p>${escape(options.detail)}</p>` : ''}
</main>
</body>
</html>`
}

function respond(res: http.ServerResponse, status: number, html: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
}

/**
 * Binds the loopback callback listener. Resolves `{listening: false}` when the
 * port is taken (another app, or a second sign-in attempt elsewhere) — the
 * sign-in still works through the manual paste fallback.
 */
function startCallbackServer(expectedState: string | null): Promise<{listening: boolean; reason?: string}> {
  stopCallbackServer()
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const state = current
      const url = new URL(req.url || '', `http://localhost:${CALLBACK_PORT}`)
      if (!state || url.pathname !== CALLBACK_PATH) {
        respond(res, 404, renderPage({title: 'Not found', message: 'This page only handles provider sign-ins.'}))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        respond(
          res,
          400,
          renderPage({
            title: 'Sign-in failed',
            message: 'The provider reported an error. You can close this window and try again in Seed.',
            detail: url.searchParams.get('error_description') || error,
          }),
        )
        return
      }
      if (
        !url.searchParams.get('code') ||
        (state.expectedState && url.searchParams.get('state') !== state.expectedState)
      ) {
        respond(
          res,
          400,
          renderPage({
            title: 'Sign-in failed',
            message:
              'This sign-in response does not match the one Seed is waiting for. Close this window and try again.',
          }),
        )
        return
      }
      state.capturedUrl = url.toString()
      log.info('Provider OAuth callback captured')
      respond(
        res,
        200,
        renderPage({
          title: 'Sign-in complete',
          message: 'Your account is connected. You can close this window and return to Seed.',
        }),
      )
    })
    server.once('error', (error: NodeJS.ErrnoException) => {
      log.warn('Provider OAuth callback listener failed to bind; falling back to manual paste', {
        code: error.code,
      })
      if (current?.server === server) current = null
      resolve({listening: false, reason: error.code || error.message})
    })
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      resolve({listening: true})
    })
    current = {server, expectedState, capturedUrl: null}
  })
}

function stopCallbackServer(): void {
  if (!current) return
  try {
    current.server.close()
  } catch {
    // already closed
  }
  current = null
}

export const providerOAuthApi = t.router({
  /** Starts listening for the browser redirect of a pending sign-in. */
  startCallback: t.procedure
    .input(z.object({state: z.string().nullable()}))
    .mutation(({input}) => startCallbackServer(input.state)),
  /** The captured redirect URL, once the browser has come back. */
  capturedCallback: t.procedure.query(() => ({url: current?.capturedUrl ?? null})),
  /** Stops listening (sign-in finished, canceled, or abandoned). */
  stopCallback: t.procedure.mutation(() => {
    stopCallbackServer()
  }),
})
