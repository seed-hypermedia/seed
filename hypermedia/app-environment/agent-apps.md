---
name: How apps work
summary: How an app of the Seed App Environment is a typed page whose tools carry their own code, how a space installs it by publishing a page, how the environment finds the install and proves the space is bound to it, how its tools reach the space's agents, and how an app is created.
---
An **app** gives a space's agents a capability. It is a page typed [app](../app.md) whose attributes declare it and whose body is the skill doc the model reads, with one [app-tool](../app-tool.md) page per tool under its `tools` folder, each carrying the tool's contract and its code. A space installs it by publishing a page typed [app-install](../app-install.md), by convention at `/apps/<slug>`, that links the app's page. The app environment the space is bound to finds that page, reads the app page, and runs the tools' code for the space's agents in its sandbox. The design and the later phases are on the [design page](./plans/app-bundles.md).

There is one kind of tool: a page with code, run on the server for the spaces that installed it. The [Datalab converter](./apps/convert.md) is one, installed server-wide from the operator's space on the hosted server with the operator's key, and its usage on that key is what the Apps dialog shows.

# The model

```
app page (app)                       slug, arguments, permissions, network, usage; body = skill doc
  tools/ (childAttributesSchema)           one app-tool page per tool: tool, summary, runtime,
                                           inputSchema, outputSchema, code as ipfs:// references; body = documentation
install page (app-install)               app link (version pinned), scope, enabled, arguments, usage
```

An install has a **scope**. `space` installs the app for the space the page is published in. `server` installs it for every space the server serves, and is honored only in the operator's space (below). A space install shadows a server install of the same slug, which is the "own key beats the shared key" rule in general form.

The **copy form** is the app page itself published in a space with its `install` attributes set, for an app the space authors itself, with its own `tools` folder. The server treats both forms as "an install of app A in space S".

# Who owns an install

Three parties: a space, the site that serves it on the web, and an app environment. The space's home document names its site (`siteUrl`) and the site's `/hm/api/config` names the space; the app environment is tied the same way.

  - **A space names its app environment** in its home document's `agentServerUrl`, or its site does in `<siteUrl>/hm/api/config`.
  - **A server proves it is that URL.** It fetches `<url>/health` and compares the `serverUid` it gets back with its own identity principal. Only a match makes the URL the server's. Nothing about URLs is configured; a server cannot claim a URL it does not answer at.
  - **The operator's space** is the one registered on the site the server reads through (`hmServerUrl`), when the app environment that site advertises proves to be this one. A `scope: server` install there applies to every space; anywhere else it is ignored.

Each server keeps an identity key beside its secret-encryption key (`server_config`, `server_identity_key_v1`) and publishes its principal as `serverUid` in `/health`. Proofs are remembered in `server_bindings` for a day, ten minutes after a failed probe.

# Detection

`refreshAppInstalls` (`apps/src/app-installs.ts`) runs every five minutes (`app-install-monitor.ts`) and on demand (`RefreshApps`). It asks the daemon for every document typed `app-install`, and every `app` page with a `mount.scope`, with one `QueryDocuments` per form; the type is matched by every spelling a stored `attributesSchema` may use (the library name, the docs space's key, the schema blob's CID, and subtypes). For each candidate it resolves the space's binding (home document, then site), checks that the bound URL proves to be this server (or, for `scope: server`, that the space is the operator's), reads the app page, checks it against its type with `checkDocumentSchema` (strictly: the daemon does not validate on publish), lists and checks the `tools` children, reads each tool's contract and code from its attributes and its body as the instructions, refuses a runtime the host cannot run, checks the mount's argument values against the declarations, and stores a snapshot of the app and its tools, code included, in `app_mounts`. A mount whose document is gone, disabled or no longer bound to this server is removed on the next pass, with its tool documents. A mount pinned with `?v=` stays on that version; one without follows the app page.

An app page that cannot be read or does not hold up keeps a row with `status.error` and offers nothing, so the Apps dialog can say why. An app that holds up with an install whose arguments do not (a missing required secret, a secret written into the page, a wrong kind) keeps the snapshot too, so the dialog shows what to add.

**Legacy keys.** An account that kept a `datalab-api-key` secret before installs existed is served as a space install of `convert` paired with that secret, until it publishes a real one.

# Arguments and secrets

An app declares each argument's kind, whether it is secret and whether it is required. Non-secret values travel in the install page (`arguments`). A secret value never does: the person stores it on the server from the Apps dialog, under `app-<slug>-<arg>` (`SetSecret` with metadata `{kind: 'app-arg', slug, arg}`), and the pass pairs it with the install. A server-scope secret comes from the environment: `SEED_AGENTS_APP_<SLUG>_<ARG>`, with `SEED_AGENTS_DATALAB_API_KEY` as the older spelling of the converter's `apiKey`.

# Code and the sandbox

A tool page's `code` references a lambda (the ABI in [tools](./tools.md)): one file, or a folder whose entry is `index.ts` or `main.py`, fetched into the server's cache by its content id at mount, every file checked against it, and staged into the sandbox at each call. It takes a second argument: `ctx.args`, the mount's argument values, secrets included; `ctx.usage`, the budget of a metered call; `ctx.app`; and `ctx.workspace`. The server runs it in the `execute` sandbox, a microVM with the agent's memory at `/workspace`, and nothing else of the host. What the sandbox gets is what the app declared and the person mounting it saw: the arguments arrive as one environment variable (`SEED_APP_CONTEXT`), never in the program text; egress is limited to the hosts in the app's `network` map (deny by default, DNS allowed, one allow rule per host) or there is no network at all when it names none; the call may run up to the tool page's `timeoutSecs`, capped at thirty minutes where model-written code gets five. The run has a sandbox principal of its own (`app:<slug>:<session>`), so a warm pooled VM never carries a secret into the agent's own code. No `execute` grant is needed: the mount is the consent, and the agent cannot write the code.

The install is where consent happens. The Apps dialog says what an app's code gets before the person publishes the install, and the Install button pins the app page's version, so the code consented to is the code that runs until the person edits the install page.

# Usage

An app with `usage.meter: per-unit` is metered on a server-wide install, whose page sets the `allowance` per space and the `ceiling` for the server per period (`usage` on the install page), in the app's unit. Before the run the server reserves `min(callCap, allowance remaining, ceiling remaining)` units in `app_usage` (`apps/src/app-usage.ts`) and tells the tool its budget as `ctx.usage.reserved`; the tool bounds its spend by it (the converter sends it to Datalab as `max_pages`) and returns `usage.units`; the server settles the reservation to that, releases it on failure, charges the whole reservation to a tool that reports nothing, and rewrites the result's `usage` to `{unit, charged, remainingThisPeriod}`. Reserved rows count as used until settled, so concurrent calls cannot overshoot together. A space's own install is never metered.

# Runtime

The tools of the apps installed for an account join the service callables, and `definition.tools` filters them by name as it always did, so an agent that holds `convert` in its grants gets the converter's tool when the app is installed and nothing when it is not. `syncAppToolDocuments` (`apps/src/tool-documents.ts`) projects one [tool document](./tool-document.md) per tool onto every agent of the account: a lambda whose `source` is the page's code, with the page's input and output schemas, the tool page's instructions followed by the skill doc as the description, and `app: {slug, version, scope}` as provenance. An agent's own lambda of the same name wins and the collision is reported; an MCP projection yields. An app's tool cannot be replaced or deleted by name.

A call reaches the tool through its document (`executeAppTool`, `api-service.ts`): the input is validated against the page's schema, a miss returns the contract, the install is resolved for the account with its argument values and secrets in hand, usage is reserved when the install is metered, and the code runs as described above. The tool's own `summary` is the result's summary.

# Signed actions

Account-scoped, like [MCP servers](./mcp.md). Reference in the [signed API](./signed-api.md).

```
{_: 'ListApps'}                → {_: 'ListAppsResponse'; apps: AppInstallInfo[]; binding: SpaceBinding}
{_: 'RefreshApps'}             → the same, after a pass over the caller's space
{_: 'GetAppUsage'; slug}       → {_: 'GetAppUsageResponse'; usage?: AppUsageInfo}
```

`AppInstallInfo` carries the app page's declaration (arguments with `hasValue` for secrets and `value` for the others), the tools with their runtimes, the hosts, the usage settings and the status; never a secret value. `SpaceBinding` says which server the space is bound to and whether that is this one. `GetAppUsage` answers for a metered server-wide install only. `/health` carries `serverUid`. Changes emit `account-change` with reason `apps-changed`, and `agent-tools-changed` per re-projected agent.

# Desktop and web UI

The **Apps** dialog opens from the Apps button on each environment's row in Settings (beside Accounts and Providers) and from **Manage apps** on an agent's permissions page. It lists the installs the account sees: a server-wide install reads "provided by this server" with its usage line; the account's own installs show their status, their tools with their runtimes, the hosts their code reaches, their argument values, a field per secret argument, and a link to the install page. A space bound to another environment, or to none, is told so. Installing is publishing, and it is consent: the dialog lists the apps the node knows, found by type, each with a line on what its code gets, and **Install** starts the install page as a draft with the app's address and version filled in, so publishing it is all that is left; on the web it opens the app's page.

Installed means granted. An agent's permissions page lists every app installed for the account with a switch: on, its tools are the agent's, each with its contract behind an info button; off, they are not, and the agent's definition records the slug under `disabledApps`. An install that is not working is shown greyed with the reason and a way into the Apps dialog.

**New → App**, from the New menu of any document the person can publish under, asks for a name, a slug and a summary and publishes the app page and its `tools` folder at once, typed so that a document created inside the folder is a tool page: its code is uploaded from the attribute pill, its contracts are created as linked objects. **Publish as app**, in the menu of an agent document, turns the agent's own lambdas into such an app beside the agent, in the copy form that installs it in the space, with one tool page per lambda and the lambda's description as the body; the agent's copies are removed unless kept, since a lambda of the same name keeps shadowing the app's tool. Agents do the same with `write`, following `~/tools/write/apps`.

# Security notes

  - The sandbox is the boundary, the same one the space already trusts with model-written code; an app's run adds only the install's arguments and the declared hosts, and nothing a page says can widen that.
  - Validation is strict on the server (schema, slug and tool patterns, argument kinds, the tool's schemas and code), because the daemon validates nothing on publish and the editor only warns.
  - Secrets never come from a document and never appear in a response; an install that writes one is refused.
  - A mount is acted on only by the server its space is bound to, and the binding is proven, not configured.
  - `SetSecret` accepts any WRITER of the space as the account; whether app secrets should be owner-only is open.

# Tests

`apps/src/app-installs.test.ts` runs detection against a stand-in daemon: both forms, both binding sources, the proof and its cache, the operator policy, the page parser, argument checks, stale removal and the legacy shim. `api-service.test.ts` covers the signed actions and isolation, `app-convert.test.ts` the converter's page run as the sandbox runs it, `app-usage.test.ts` the ledger, `tool-documents.test.ts` the projection, `code-exec.test.ts` the environment, the egress allowlist and the context.

# See also

- [Agent apps design](./plans/app-bundles.md): the whole model and the phases.
- [app](../app.md), [app-tool](../app-tool.md), [app-install](../app-install.md).
- [Datalab converter](./apps/convert.md).
- [Tools](./tools.md), [Grants](./grants.md), [Security](./security.md), [Persistence](./persistence.md).
