---
name: "Signed API: running apps"
summary: These signed API actions run an app on an app environment, stop it, call its tools and list the recorded calls, which are not private.
---
These actions of the [signed API](./signed-api.md) run an [app](../app.md) on an [app environment](../software/app-environment.md) and call its [tools](../tool.md). For example, a client sends `RunApp` to start an app, then `CallAppTool` to run one of its tools.

The [signed API](./signed-api.md) page has the envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency.

The server does not check who reads a tool's call records. They include inputs and outputs. See "Calling a tool" and "Reading without a signature" below.

# Running an app

```ts
{_: 'RunApp'; appId: string; privateConfig?: Record<string, unknown>}
{_: 'StopApp'; appId: string}
{_: 'GetAppRun'; appId: string}
  → {_: 'AppRunResponse'; run: AppRunInfo | null}

{_: 'CheckAppRun'; appId: string}
  → {_: 'AppRunCheckResponse'; allowed: boolean; reason?: string; run: AppRunInfo | null}

type AppRunInfo = {
  appId: string
  spaceUid: string
  startedBy: string
  privateConfigKeys: string[] // names only; the values never leave the server
  createdAt: number
  updatedAt: number
}
```

- `RunApp` runs an app [document](../protocol/documents.md) on this server, or updates a running app's private config. The signer must be able to write the app's [space](../protocol/spaces.md).
  - `privateConfig` sets the fields it names and keeps the others. So one secret can change without sending the rest.
  - Omitting `privateConfig` keeps everything.
  - It is a shortcut for `SetHostPrivateConfig` (below), which can also remove a field.
  - The server keeps private config encrypted and never returns it.
- `StopApp` stops the app and forgets its private config. It answers `run: null`.
- `GetAppRun` answers `run: null` when the app does not run here. For an [agent](../agent.md) mounted here it always answers a run, because an agent's tools need no run step.
- `CheckAppRun` asks whether the server would accept `RunApp` from the signer, without running the app. `reason` says why not, in words.

# Host config

Every host, an app or an [agent](../agent.md), has the same two configs. Its public config is part of its document (`publicConfig`, described by `publicConfigSchema`). Its private config is held by the server that runs it (described by `privateConfigSchema`), encrypted, and only the host's own tools use it, as `ctx.privateConfig`.

```ts
{_: 'GetHostConfig'; hostId: string}
{_: 'SetHostPrivateConfig'; hostId: string; privateConfig: Record<string, unknown>}
  → {_: 'HostConfigResponse'; config: HostConfigInfo}

type HostConfigInfo = {
  hostId: string
  privateConfigKeys: string[] // names only; the values never leave the server
  updatedBy?: string // who last changed the private config
  updatedAt?: number
  signingKeys?: Record<string, string> // field -> the account (z6Mk…) a signing-key field names
  agentSigning?: {keys: {account: string; label?: string}[]; primary?: string} // an agent's signing field
}
```

- `SetHostPrivateConfig` changes a host's private config on this server. Each value replaces that field, a `null` removes it, and fields not named keep their values. The result must match the host's `privateConfigSchema`.
  - The host must run on this server: an app that names it, or an agent mounted here. An app does not need to be started first.
  - The signer must be able to write the host's [space](../protocol/spaces.md).
- A field typed [signing key](../signing-key.md) names a key this server holds. Setting one is accepted only when the signer's own account holds that key here (among its server accounts), so a writer cannot attach someone else's key. Any writer may remove one.
- `GetHostConfig` says which fields are set, and which account each signing-key field names. Anyone may ask; it never returns other values.
- An agent's tools get its private config like an app's tools do. An agent needs no run step.
- An agent's signing keys are its built-in `signing` field: `{keys: {<account>: true}, primary: <account>}`, or `null` for none. Only the agent's owner sets it, from keys the owner holds on this server; `GetHostConfig` shows it as `agentSigning`. The agent publishes as `primary` unless a write names another key, and its tools publish through `ctx.seed` the same way.

# Calling a tool

```ts
{_: 'CallAppTool'; appId: string; toolId: string; input: unknown}
{_: 'GetAppToolCall'; callId: string}
  → {_: 'AppToolCallResponse'; call: AppToolCallInfo}

{_: 'ListAppToolCalls'; toolId: string; limit?: number; before?: number} // before: ms since epoch
  → {_: 'ListAppToolCallsResponse'; calls: AppToolCallInfo[]}

type AppToolCallInfo = {
  id: string
  appId: string
  toolId: string
  caller: string // the account that triggered the run
  toolVersion?: string // the document version of the tool that ran
  input: unknown
  output?: unknown // set on success
  error?: string // set on failure
  durationMs?: number
  writes?: {id: string; version: string; as: string; at: number}[] // what the tool published with ctx.seed, and as which account
  createdAt: number
}
```

- `CallAppTool` calls a tool of an app running on this server, with the tool's latest code. Any signed [account](../protocol/identity.md) may call. A failed run is still a response, with `call.error` set.
- `GetAppToolCall` returns one recorded call by id. The server makes no access check: any signed account that knows the call id gets the call.
- `ListAppToolCalls` lists a tool's recorded calls, newest first, 50 at a time unless `limit` says otherwise (at most 200). The server makes no access check: any signed account that knows the tool's id gets the calls.

A running tool reaches its server for [`ctx.seed`](../tool.md#seed-access) at `POST /hm/api/apps/tool-seed`, with a token that only that call holds and that stops working when the call ends. Nothing else uses that route.

Each call record holds the full `input` and `output`. So never pass secrets or private data through a tool. [Tool](../tool.md) has the rules.

# Reading without a signature

The same server answers plain JSON under the API prefix, for programs that are not Seed clients:

- `GET /hm/api/apps` lists the apps running here.
- `GET /hm/api/apps/<space>/<app path>` returns a running app with its tools.
- `GET /hm/api/apps/<space>/<app path>/<tool>` returns the tool and its recent calls. `?limit=` sets how many.

The calls include their inputs and outputs. Nobody is asked to sign in, so anyone who can reach the server can read them.

A `POST` to a tool answers 405. Calling is always a signed `CallAppTool`, so every run names the account that started it.

# See also

- [Signed API](./signed-api.md)
- [App](../app.md)
- [Tool](../tool.md)
- [The signed API for triggers](./signed-api-triggers.md) for `ListHostTriggers` and `RunTriggerNow`
