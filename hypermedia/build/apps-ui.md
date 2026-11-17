---
name: Embedding the agents UI
summary: How another web app shows Seed Agents with the same UI the Seed apps use, through the @seed-hypermedia/apps-ui React package and a signer the app controls.
---
`@seed-hypermedia/apps-ui` is the [Seed Agents](../agent.md) interface as one React package. It is the code the [Seed desktop app](../software/desktop.md) and the [Seed web app](../software/web.md) render: the agents list, each agent with its sessions, [triggers](../agent/triggers.md), memory, [tools](../agent/tools.md) and [MCP servers](../agent/mcp.md), system prompt, collaborators and settings, and sessions with their tool calls, [plans](../agent/plan.md), sub-sessions and [runs](../agent/runs.md). An app that embeds it gains each agents feature when it updates the package, instead of re-implementing the UI. <!-- id:fF1qtqqy -->

The package bundles Seed's components, its block editor and the [agents protocol](./signed-api.md) types. Only React 18 or 19 comes from the app. It is browser code, so an app that renders on the server loads it on the client only. <!-- id:vY_NQv2J -->

# What the app provides <!-- id:wLw-0kPx -->

Every request to an app environment is a [signed action](./signed-api.md). The app passes two things in a `SeedAgentsHost`: <!-- id:-DShFun1 -->
  - `serverUrl`, the app environment as the browser reaches it. When the URL ends in the API prefix `/hm/api/apps` or `/hm/api/agents`, the UI appends the endpoint name: `<serverUrl>/message` for actions, `<serverUrl>/ws` for subscriptions and `<serverUrl>/health`. For any other URL it uses the server's older fixed paths, `<serverUrl>/api/message`, `<serverUrl>/agents/ws` and `<serverUrl>/agents/api/health`. An app environment answers both forms. Any path prefix is kept, so the URL can be the app's own reverse proxy of a server it does not expose. <!-- id:Zf-7qugn -->
  - `signer`, an object with the [account](../protocol/identity.md) id and a `sign(bytes)` function that returns the Ed25519 signature over exactly those bytes. The key never has to be in the page: the function may ask a server the app trusts to sign. When the signing key is not the account's own, the signer also names its key and the account's delegating [capability](../protocol/permissions.md). <!-- id:n4_IlMrQ -->

Optional members point names and avatars at a Seed API other than `https://hyper.media` (`hmApiUrl`), choose where settings persist, and replace the editor. <!-- id:a3yNcrq8 -->

```tsx <!-- id:a9qupJNV -->
import {SeedAgentsProvider, SeedAgentsView} from '@seed-hypermedia/apps-ui'
import '@seed-hypermedia/apps-ui/styles.css'

<SeedAgentsProvider host={{serverUrl: 'https://app.example/agents-proxy', signer}}>
  <SeedAgentsView />
</SeedAgentsProvider>
```

# Routes and links <!-- id:FY4W5CCT -->

A `SeedAgentsRoute` is one place in the UI: an agent and one of its tabs, a session, or a run. The routes are the Seed apps' own, and `seedAgentsRouteToPath` writes one as the part of a web URL after `/hm/agents/`, for example `session/<id>?agent=<id>`. An app keeps that path in its own URL and passes the route back in. Links therefore open the same place in the app, in the Seed web app and on the desktop. <!-- id:t88HurUU -->

# Calling the service from code <!-- id:wn6hRGVV -->

`createSeedAgentsClient({serverUrl, signer})` sends any agents action with the same signer, outside the UI. Its types come from the protocol, so `send({_: 'GetSession', sessionId})` resolves to the `GetSessionResponse` shape and an unknown action does not compile. <!-- id:JFmixoIg -->

# Styles <!-- id:ZblWV7KQ -->

The stylesheet holds compiled utilities for the bundled components, Seed's palette and its prose styles. It has no reset and styles nothing outside the agents UI. Dark mode follows a `.dark` class on an ancestor, normally `<html>` so dialogs and menus follow it too. The palette is a set of CSS variables such as `--background`, `--foreground`, `--primary` and `--border`. An app restyles the UI by redefining them. <!-- id:OFbQGFAU -->

# An example: a dashboard that keeps the key on its server

Take a dashboard whose backend holds the account key. The backend signs only agents actions for the page, and serves the app environment and the Seed API behind same-origin proxies that an HttpOnly cookie opens. The page passes those proxy URLs as `serverUrl` and `hmApiUrl`, and a `signer` whose `sign` function calls the backend. The key never reaches the browser, and the app environment is never exposed directly.

The package's [README](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/apps-ui/README.md) is the reference for every option, and its source is in [frontend/packages/apps-ui](https://github.com/seed-hypermedia/seed/tree/main/frontend/packages/apps-ui). <!-- id:5cg7AQ8i -->

# See also

- [Signed API](./signed-api.md), for the actions the UI and the client send.
- [WebSocket subscriptions](./websocket-subscriptions.md), for the live updates the UI listens to.
- [Agents in the Seed app](../agent/in-the-app.md), for what the screens do.
- [Sign in with Seed](./sign-in.md), for a signer that is a delegated browser session key.
- [Package publishing](../contribute/package-publishing.md), for how the package is released.
