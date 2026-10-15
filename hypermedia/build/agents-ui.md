---
name: Embedding the agents UI
summary: How another web app shows Seed Agents with the same UI the Seed apps use, through the @seed-hypermedia/agents-ui React package and a signer the app controls.
---
`@seed-hypermedia/agents-ui` is the [Seed Agents](../agent.md) interface as one React package. It is the code the [Seed desktop app](../apps/desktop.md) and the [Seed web app](../apps/web.md) render: the agents list, each agent with its sessions, [triggers](../agent/triggers.md), memory, [tools](../agent/tools.md) and [MCP servers](../agent/mcp.md), system prompt, collaborators and settings, and sessions with their tool calls, [plans](../agent/plan.md), sub-sessions and [runs](../agent/runs.md). An app that embeds it gains each agents feature when it updates the package, instead of re-implementing the UI.

The package bundles Seed's components, its block editor and the [agents protocol](../agent/signed-api.md) types. Only React 18 or 19 comes from the app. It is browser code, so an app that renders on the server loads it on the client only.

# What the app provides

Every request to an agents server is a [signed action](../agent/signed-api.md). The app passes two things in a `SeedAgentsHost`:

- `serverUrl`, the agents server as the browser reaches it. The UI posts actions to `<serverUrl>/api/message`, subscribes on `<serverUrl>/agents/ws` and reads `<serverUrl>/agents/api/health`. Any path prefix is kept, so the URL can be the app's own reverse proxy of a server it does not expose.
- `signer`, an object with the [account](../protocol/identity.md) id and a `sign(bytes)` function that returns the Ed25519 signature over exactly those bytes. The key never has to be in the page: the function may ask a server the app trusts to sign. When the signing key is not the account's own, the signer also names its key and the account's delegating [capability](../protocol/permissions.md).

Optional members point names and avatars at a Seed API other than `https://hyper.media` (`hmApiUrl`), choose where settings persist, and replace the editor.

```tsx
import {SeedAgentsProvider, SeedAgentsView} from '@seed-hypermedia/agents-ui'
import '@seed-hypermedia/agents-ui/styles.css'

<SeedAgentsProvider host={{serverUrl: '/agents-proxy', signer}}>
  <SeedAgentsView />
</SeedAgentsProvider>
```

# Routes and links

A `SeedAgentsRoute` is one place in the UI: the agents list, a server, an agent and one of its tabs, a session, or a run. The routes are the Seed apps' own, and `seedAgentsRouteToPath` writes one as the part of a web URL after `/hm/agents/`, for example `session/<id>?agent=<id>`. An app keeps that path in its own URL and passes the route back in. Links therefore open the same place in the app, in the Seed web app and on the desktop.

# Calling the service from code

`createSeedAgentsClient({serverUrl, signer})` sends any agents action with the same signer, outside the UI. Its types come from the protocol, so `send({_: 'GetSession', sessionId})` resolves to the `GetSessionResponse` shape and an unknown action does not compile.

# Styles

The stylesheet holds compiled utilities for the bundled components, Seed's palette and its prose styles. It has no reset and styles nothing outside the agents UI. Dark mode follows a `.dark` class on an ancestor, normally `<html>` so dialogs and menus follow it too. The palette is a set of CSS variables such as `--background`, `--foreground`, `--primary` and `--border`. An app restyles the UI by redefining them.

# An example: Cyberdeck

[Cyberdeck](https://github.com/ericvicenti/cyberdeck), a dashboard for a fleet of machines, embeds the package. Its daemon keeps the account key and signs only agents actions for the page. It serves the agents server and the Seed API behind same-origin proxies, opened by an HttpOnly cookie. The page passes those URLs and a signer that calls the daemon.

The package's [README](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/agents-ui/README.md) is the reference for every option, and its source is in [frontend/packages/agents-ui](https://github.com/seed-hypermedia/seed/tree/main/frontend/packages/agents-ui).


# Publishing updates

The `Agents UI package` GitHub Actions workflow validates pull requests and automatically publishes `@seed-hypermedia/agents-ui` when relevant changes land on `main`. It watches the package and its bundled UI, shared code, client, editor and protocol dependencies. Like the client and CLI releases, it uses the checked-in version when that is newer than npm; otherwise it increments the latest published patch version. The version is selected before building, and publishing uses the exact tarball tested in a clean npm consumer. A manual run on `main` uses the same release process.

Publishing uses npm trusted publishing (OIDC). An npm scope owner must bootstrap the new package and configure `seed-hypermedia/seed` with workflow `agents-ui.yml` as its trusted publisher once. Subsequent releases need no manual publish step or npm token in GitHub.
