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
  - To remove a field, stop the app and run it again.
  - The server keeps private config encrypted and never returns it.
  - The server checks the fields the app's own `privateConfigSchema` declares. Other fields are kept for the app's tools, each of which declares the ones it needs.
  - With the id of a tool in no app or agent, `RunApp` only stores the private config its writers run it with. Such a tool is never open to other callers.
- `StopApp` stops the app and forgets its private config. It answers `run: null`.
- `GetAppRun` answers `run: null` when the app does not run here. For an [agent](../agent.md) mounted here it always answers a run, because an agent's tools need no run step.
- `CheckAppRun` asks whether the server would accept `RunApp` from the signer, without running the app. `reason` says why not, in words.

# Calling a tool

```ts
{_: 'CallAppTool'; appId: string; toolId: string; input: unknown}
{_: 'GetAppToolCall'; callId: string}
  → {_: 'AppToolCallResponse'; call: AppToolCallInfo}

{_: 'TestAppTool'; appId?: string; toolId: string; source: string; publicConfig?: unknown; input: unknown}
  → {_: 'AppToolTestResponse'; test: {output?: unknown; error?: string; durationMs: number; logs?: string}}

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

- `CallAppTool` calls a tool running on this server, with the tool's latest code. `appId` names the tool's host: the app or agent that lists it as its own or [references it](../tool.md#using-someone-elses-tool). A referenced tool runs at the version the host's embed pins. Any signed [account](../protocol/identity.md) may call a host's tool. For a tool in no app or agent, `appId` is the tool's own id, nothing needs to be running, the tool names no server, and only an account that can write the tool's space may call. A failed run is still a response, with `call.error` set.
- `TestAppTool` runs `source`, the text of an `index.ts` that is not published, once as the tool at `toolId` would run it. Only an account that can write the host's space may send it, because the code runs with the host's private config. The host must name this server but need not be running; a tool in no app or agent names no server and runs where it is sent. Nothing is recorded, and the schemas are not checked. A failed run is still a response, with `test.error` set. `logs` is what the code printed. `publicConfig` replaces the host's published one for this run. Without `appId` the server works the host out.
- `GetAppToolCall` returns one recorded call by id. The server makes no access check: any signed account that knows the call id gets the call.
- `ListAppToolCalls` lists a tool's recorded calls, newest first, 50 at a time unless `limit` says otherwise (at most 200). The server makes no access check: any signed account that knows the tool's id gets the calls.

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
