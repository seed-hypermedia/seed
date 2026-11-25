---
name: Embedding the agents UI
summary: This guide shows how another web app displays Seed Agents with the same interface the Seed apps use, through the @seed-hypermedia/apps-ui React package and a signer the app controls.
---
`@seed-hypermedia/apps-ui` is a React package that puts the [Seed Agents](../agent.md) interface inside your own web app. It is the same code that the [Seed desktop app](../software/desktop.md) and the [Seed web app](../software/web.md) show. When you update the package, your app gets each new agents feature without building the interface again. <!-- id:fF1qtqqy -->

The interface covers:

- the list of agents;
- each agent with its sessions, [triggers](../trigger.md), memory, [tools](../agent/tools.md), [MCP servers](../agent/mcp.md), system prompt, collaborators and settings;
- each session with its tool calls, [plans](../agent/plan.md), sub-sessions and [runs](../agent/runs.md).

The package includes Seed's components, its editor for [blocks](../protocol/blocks.md) and the types of the [agents protocol](./signed-api.md). Your app brings only React 18 or 19. The package is browser code. If your app renders pages on the server, load the package only in the browser. <!-- id:vY_NQv2J -->

# What your app provides <!-- id:wLw-0kPx -->

Every request to an [app environment](../software/app-environment.md), the server that runs the agents, is a [signed action](./signed-api.md). So your app passes two things, in an object called `SeedAgentsHost`: <!-- id:-DShFun1 -->
  - `serverUrl`, the address of the app environment as the browser reaches it. The table under this list shows which paths the interface calls. Any path before them is kept, so the URL can be your app's own reverse proxy in front of a server you do not expose. <!-- id:Zf-7qugn -->
  - `signer`, an object with the [account](../protocol/identity.md) id and a `sign(bytes)` function. The function returns the Ed25519 signature over exactly those bytes. The key does not have to be in the page: the function may ask a server your app trusts to sign. When the signing key is not the account's own key, the signer also names its key and the [capability](../protocol/permissions.md) the account gave it. <!-- id:n4_IlMrQ -->

| `serverUrl` | Actions | Subscriptions | Health |
| --- | --- | --- | --- |
| ends in `/hm/api/apps` or `/hm/api/agents` | `<serverUrl>/message` | `<serverUrl>/ws` | `<serverUrl>/health` |
| any other URL | `<serverUrl>/api/message` | `<serverUrl>/agents/ws` | `<serverUrl>/agents/api/health` |

An app environment answers both forms. The second row is the older set of paths.

Three optional members do more. `hmApiUrl` reads names and avatars from a [Seed API](./web-api.md) other than `https://hyper.media`. The others choose where settings are saved and replace the editor. <!-- id:a3yNcrq8 -->

```tsx <!-- id:a9qupJNV -->
import {SeedAgentsProvider, SeedAgentsView} from '@seed-hypermedia/apps-ui'
import '@seed-hypermedia/apps-ui/styles.css'

<SeedAgentsProvider host={{serverUrl: 'https://app.example/agents-proxy', signer}}>
  <SeedAgentsView />
</SeedAgentsProvider>
```

# Routes and links <!-- id:FY4W5CCT -->

A `SeedAgentsRoute` is one place in the interface: an agent and one of its tabs, a session, or a run. The routes are the same ones the Seed apps use. <!-- id:t88HurUU -->

`seedAgentsRouteToPath` writes a route as text. The text is the part of a web URL after `/hm/agents/`, for example `session/<id>?agent=<id>`. Your app keeps that text in its own URL and passes the route back in. So one link opens the same place in your app, in the Seed web app and in the desktop app.

# Calling the service from code <!-- id:wn6hRGVV -->

`createSeedAgentsClient({serverUrl, signer})` sends any agents action with the same signer, without the interface. Its types come from the protocol. So `send({_: 'GetSession', sessionId})` returns the `GetSessionResponse` shape, and an action that does not exist does not compile. <!-- id:JFmixoIg -->

# Styles <!-- id:ZblWV7KQ -->

The stylesheet holds the styles of the included components, Seed's colors and its text styles. <!-- id:OFbQGFAU -->

- It has no reset, and it styles nothing outside the agents interface.
- Dark mode follows a `.dark` class on a parent element. Put it on `<html>` so that dialogs and menus follow it too.
- The colors are CSS variables such as `--background`, `--foreground`, `--primary` and `--border`. Set them again in your own CSS to change the look.

# An example: a dashboard that keeps the key on its server

Take a dashboard whose backend holds the account key.

1. The backend signs agents actions for the page, and nothing else.
2. The backend serves the app environment and the Seed API through proxies on the dashboard's own origin. An HttpOnly cookie opens them.
3. The page passes those proxy URLs as `serverUrl` and `hmApiUrl`.
4. The page passes a `signer` whose `sign` function calls the backend.

The key never reaches the browser, and nobody reaches the app environment directly.

The package's [README](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/apps-ui/README.md) describes the options. Its source is in [frontend/packages/apps-ui](https://github.com/seed-hypermedia/seed/tree/main/frontend/packages/apps-ui). <!-- id:5cg7AQ8i -->

# See also

- [Signed API](./signed-api.md), for the actions the interface and the client send.
- [WebSocket subscriptions](./websocket-subscriptions.md), for the live updates the interface listens to.
- [Agents in the Seed app](../agent/in-the-app.md), for what the screens do.
- [Sign in with Seed](./sign-in.md), for a signer that is a browser session key with a capability.
- [Package publishing](../contribute/package-publishing.md), for how the package is released.
