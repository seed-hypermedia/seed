# @seed-hypermedia/agents-ui

Seed's agents UI as one React package for any app: the agents list, each agent with its sessions, triggers, memory,
tools and MCP servers, system prompt, collaborators and settings, sessions with their tool calls, plans, sub-sessions
and runs, and the compact assistant panel. It is the same code the Seed desktop and web apps render, so an app that
embeds it gets every agents feature Seed ships.

The package bundles everything it needs except React (18 or 19). The host supplies only an agents server URL and a
signer. It is browser code: an app that renders on the server imports it on the client only (for example with
`React.lazy`).

## Use

```tsx
import {SeedAgentsProvider, SeedAgentsView, type SeedAgentsHost} from '@seed-hypermedia/agents-ui'
import '@seed-hypermedia/agents-ui/styles.css'

const host: SeedAgentsHost = {
  serverUrl: 'https://agents.example',
  signer: {accountUid: 'z6Mk…', sign: (bytes) => myKey.sign(bytes)},
}

export function Agents() {
  return (
    <div style={{height: '100vh'}}>
      <SeedAgentsProvider host={host}>
        <SeedAgentsView />
      </SeedAgentsProvider>
    </div>
  )
}
```

`SeedAgentsView` fills its container, so give the container a height. Render one provider per page.

### The host

`SeedAgentsHost` (all types are exported):

- `serverUrl`: the agents server as the browser can reach it. The UI calls `<serverUrl>/api/message`,
  `<serverUrl>/agents/ws` and `<serverUrl>/agents/api/*`, so this can be the host's own reverse proxy mounted under a
  path.
- `signer`: `{accountUid, sign}`, or `null` to show a sign-in notice. Every request is a signed `AgentsAction` envelope;
  `sign` receives its exact bytes and returns the 64-byte Ed25519 signature. The key may live anywhere, including a
  server that signs on the page's behalf. When the signing key is not the account's own, also pass `signerUid` and the
  account's `delegation` Capability.
- `hmApiUrl`: the Seed HTTP API used for account names, avatars and linked documents (default: `gatewayUrl`). Point it
  at the server the agents server publishes to when it is not public.
- `gatewayUrl`: public web origin for `hm://` links (default `https://hyper.media`).
- `settings`: where small UI settings persist (default: `localStorage`).
- `openUrl`, `signIn`, `openServerSettings`: host affordances.
- `Editor`, `MessageViewer`: replace Seed's block editor and message viewer, which otherwise load on first use. A
  replacement editor must round-trip every block it is given; prompts may hold embeds.

### Routes

`SeedAgentsRoute` is a place in the UI (`agents`, `agent-server`, `agent` with a tab, `agent-session`, `agent-run`),
identical to Seed's own routes. Keep it in the host URL:

```tsx
<SeedAgentsProvider
  host={host}
  route={seedAgentsRouteFromPath(params.get('r') ?? '')}
  onRouteChange={(route, mode) => setParam('r', seedAgentsRouteToPath(route), mode === 'replace')}
  openRouteInNewWindow={(route) => window.open(`#/agents?r=${encodeURIComponent(seedAgentsRouteToPath(route))}`)}
>
```

The path is the part after `/hm/agents/` in Seed's web URLs (`session/<id>?agent=<id>`), so links are interchangeable
with the Seed apps (`seedAgentsRouteToWebUrl`). Reported routes leave out `serverUrl` when it is the host's own server.
Use `useSeedAgentsNavigate()` to navigate from host code.

### Assistant panel

`<SeedAgentsAssistant />` is the narrow chat column Seed's apps show beside documents: pick an agent, chat, switch
between recent sessions.

### Calling the agents service directly

`createSeedAgentsClient({serverUrl, signer}).send(action)` signs and sends any agents action with the same signer, typed
end to end: `send({_: 'GetSession', sessionId})` resolves to `GetSessionResponse`. Every wire type is exported under the
`AgentsProtocol` namespace. Server errors throw `AgentServerError` (`status`, `code`); a retired protocol version throws
`AgentProtocolError`.

### Styles

`styles.css` contains Tailwind utilities for exactly the bundled components, Seed's palette and prose styles, and base
rules scoped to the agents UI and its dialogs. It has no reset and no rules on `body`, so the host page keeps its own
look. Load it before the host's styles.

Dark mode follows a `.dark` ancestor. Dialogs, menus and toasts render in portals on `<body>`, so a dark host puts
`.dark` on `<html>`. Seed styles everything through CSS variables (`--background`, `--foreground`, `--primary`,
`--border`, `--muted`, …); redefine them on `html.dark` (or `:root`) to restyle the UI in the host's colours.

## Build and test

From the Seed repository:

```sh
direnv exec . pnpm --filter @seed-hypermedia/agents-ui typecheck
direnv exec . pnpm --filter @seed-hypermedia/agents-ui test
direnv exec . pnpm --filter @seed-hypermedia/agents-ui build
```

The build writes `dist/`: native ESM (Seed's editor, Mermaid and KaTeX in lazy chunks), declarations for the public API
plus the agents protocol's types, and `styles.css` with fonts as separate files. It fails if a declaration refers to a
private workspace package, so the published types always resolve. The source package is private; publish `dist/`.
