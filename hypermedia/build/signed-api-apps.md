---
name: "Signed API: running apps"
summary: The signed API actions that run an app on an app environment, stop it, call its tools and list the recorded calls.
---
These are the actions of the [signed API](./signed-api.md) that run an [app](../app.md) on an app environment and call its [tools](../tool.md). The envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency are on the [signed API](./signed-api.md) page.

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

- `RunApp` runs an app document on this server, or updates a running app's private config. The signer must be able to write the app's space. `privateConfig` replaces the stored values, and omitting it keeps them. Private config is kept encrypted and never returned.
- `StopApp` stops the app and forgets its private config. It answers `run: null`.
- `GetAppRun` answers `run: null` when the app does not run here.
- `CheckAppRun` asks whether `RunApp` would be accepted from the signer, without running the app. `reason` says why not, in words.

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
  createdAt: number
}
```

- `CallAppTool` calls a tool of an app running on this server with its latest code. Any signed account may call. A failed run is still a response, with `call.error` set.
- `GetAppToolCall` returns one recorded call by id.
- `ListAppToolCalls` lists a tool's recorded calls, newest first.

# Reading without a signature

The same server answers plain JSON under the API prefix for anything that is not a Seed client. `GET /hm/api/apps` lists the apps running here. `GET /hm/api/apps/<space>/<app path>` returns a running app with its tools, and a tool's path returns the tool and its recent calls. A `POST` to a tool answers 405: calling is always a signed `CallAppTool`, so every run names the account that triggered it.

# See also

- [Signed API](./signed-api.md)
- [App](../app.md)
- [Tool](../tool.md)
- [Triggers](./signed-api-triggers.md) for `ListHostTriggers` and `RunTriggerNow`
