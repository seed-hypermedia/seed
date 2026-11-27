---
name: Configuration
summary: This page lists every environment variable and command-line flag the app environment reads, with the default of each and what it changes.
---
You configure the [app environment](../software/app-environment.md) with environment variables and command-line flags. This page lists all of them. For example, `SEED_APPS_HTTP_PORT=3051` makes the server listen on port 3051, and so does the flag `--server-port 3051`.

The first thing to check: `/api/health` reports several of the values in use, so you can see what a running server was started with. The code reads every setting in one file, `apps/src/config.ts`. [Environments](./environments.md) says which settings each setup uses, and [operations](./operations.md) sends you to the task pages.

# Names

Each setting is an environment variable named `SEED_APPS_<NAME>`. The server also reads the older spelling `SEED_AGENTS_<NAME>` for every setting. When both are set, the `SEED_APPS_` name wins. The [self-hosting](./self-hosting.md) compose files and the hosted Seed servers set the older spelling. These pages write the `SEED_APPS_` form.

# Environment variables

<!-- id:IA0NLgts -->
| Environment variable <!-- col:k4r6o34C --> | Default <!-- col:7jsKg_9k --> | Purpose <!-- col:1XR71v9t --> <!-- id:th_kSyA7 --> |
| --- | --- | --- |
| `SEED_APPS_HTTP_HOSTNAME` | `0.0.0.0` | HTTP bind hostname. <!-- id:G8sJvW8w --> |
| `SEED_APPS_HTTP_PORT` | `3050` | HTTP port. <!-- id:sJW1ZpvU --> |
| `SEED_APPS_DB_PATH` | `./data/agents.sqlite` | SQLite DB path. <!-- id:dknRVRGp --> |
| `SEED_APPS_DATA_DIR` | `./data` | Data directory. <!-- id:oMgwJJep --> |
| `SEED_APPS_HM_SERVER_URL` | `https://hyper.media` | The [Seed API](../build/web-api.md) the server reads and writes through: the `/api/*` endpoint that speaks [DAG-CBOR](../schema/dag-cbor.md). The server uses it for the activity feed and for every HM read and write. <!-- id:-U_3_rUb --> |
| `SEED_APPS_HM_SERVER_SECRET` | _(unset)_ | The service secret of a members-only [site](../protocol/sites.md). It is sent as `X-Seed-Service-Secret` on requests to the HM server and IPFS origins only, in place of a session cookie. See the [enterprise node](./enterprise-node.md). It has no flag. |
| `SEED_APPS_PUBLIC_URL` | _(unset)_ | Where clients reach this server, such as `https://hyper.media/hm/api/apps` when the web host proxies `/hm/api/apps` here. Reported as `publicUrl` in `/api/health`. An app an [agent](../agent.md) runs here is pointed at it (its `appEnvironmentUrl`). |
| `SEED_APPS_IPFS_SERVER_URL` | HM server URL | The origin for direct `/ipfs/*` [file](../protocol/files.md) reads, when it differs from the typed API endpoint. <!-- id:ltc8JHyj --> |
| `SEED_APPS_DEFAULT_PROMPT_URL` | the Agent Guide on hyper.media | The [document](../protocol/documents.md) a new agent's system prompt embeds, the [Agent Guide](../agent/guide.md). Reported as `defaultPromptUrl` in `/api/health`; the create-agent dialog embeds it. <!-- id:ClWokX89 --> |
| `SEED_APPS_DOCS_ACCOUNT` | _(unset)_ | The [account](../protocol/identity.md) of the knowledge base [space](../protocol/spaces.md). Reads of `hm://hyper.media/…` go to this account. The system prompt names the knowledge base by it. A link an agent writes to `hm://hyper.media/…`, in a reply, a document or a [comment](../protocol/comments.md), is published with it. A client resolves the `hyper.media` domain to the production docs, so without this setting the links of a dev or staging agent would open another space. <!-- id:dAKWdZ8N --> |
| `SEED_APPS_DOCS_ACCOUNT_FILE` | _(unset)_ | A file that names the knowledge base account, read on every use. Dev points it at the file `./dev hm-sync` writes. <!-- id:yRzkV4si --> |
| `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS` | `5000` | How often the activity monitor and the schedule monitor look for work. These are the tasks that fire [triggers](../trigger.md). <!-- id:O4k599Ev --> |
| `SEED_APPS_ACTIVITY_PAGE_SIZE` | `50` | ActivityFeed page size. <!-- id:72cPVt59 --> |
| `SEED_APPS_ACTIVITY_MAX_PAGES` | `5` | Max pages fetched per poll. <!-- id:AMt50Bbp --> |
| `SEED_APPS_SEARXNG_URL` | _(unset)_ | Self-hosted SearXNG base URL. It makes `web_search` work. Without it the tool is still offered, and a call fails. See [web research backends](./web-research-backends.md). <!-- id:r7A0bkD3 --> |
| `SEED_APPS_CRAWLER_URL` | _(unset)_ | Self-hosted Crawl4AI base URL. With it, a web read can fall back to a real browser for pages that need one. <!-- id:0R7M1OGu --> |
| `SEED_APPS_CRAWLER_TOKEN` | _(unset)_ | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9). <!-- id:ABE0a0Tv --> |
| `SEED_APPS_SUBSCRIPTION_AUTH` | _(off)_ | Offer provider OAuth sign-in ("Sign in with ChatGPT"). Only `1`/`true`/`yes`/`on` enables it. <!-- id:Sv4pKPqe --> |
| `SEED_APPS_EXEC_WARM_UP` | _(off)_ | Start one sandbox when the server starts, so the first [tool](../tool.md) run does not wait for the sandbox's slow first start. Only `1`/`true`/`yes`/`on` enables it. The desktop app turns it on for its own server. |
| `SEED_APPS_FEATURES` | `tools,apps,agents` | What the server runs: `tools` (a tool in no app or agent, for its writers), `apps` and `agents`. A name left out is refused by the server. An unknown name stops the server at startup. The [desktop app](../software/desktop.md) sets it for its own server, to `tools` by default. |
| `SEED_APPS_SESSION_TITLE_GENERATION` | `true` | Name untitled sessions with a dedicated model call. Set exactly `false` to disable. Use the environment variable to turn it off; the flag form does not. <!-- id:ED7y2rAF --> |
| `SEED_APPS_EXEC_BACKEND` | `microsandbox` | [Code-execution backend](./code-execution-backend.md) for `execute`. Set empty/`off`/`none` to disable. When it is off, or the host cannot run sandboxes, agents are not offered `execute`. <!-- id:81BYtsXO --> |
| `SEED_APPS_EXEC_IMAGE` | `python` | OCI image used for execution sandboxes. <!-- id:QRvggCQy --> |
| `SEED_APPS_EXEC_TS_IMAGE` | `oven/bun` | OCI image for the `ts` runtime (needs bun). Set empty to withhold ts. <!-- id:yQbjzCnq --> |
| `SEED_APPS_EXEC_CPUS` | `1` | Virtual CPUs per execution sandbox. <!-- id:QRuJer3f --> |
| `SEED_APPS_EXEC_MEMORY_MIB` | `512` | Guest memory per execution sandbox (MiB). <!-- id:AlLSx3oW --> |
| `SEED_APPS_EXEC_TIMEOUT_SECS` | `60` | Default per-execution timeout (tool may request up to 300s). <!-- id:lyEYdp2i --> |
| `SEED_APPS_EXEC_ALLOW_NETWORK` | `true` | Sandbox internet access. Set `false`/`off`/`0` to isolate sandboxes. <!-- id:YZQgb6sX --> |
| `SEED_APPS_EXEC_DNS` | `1.1.1.1,8.8.8.8` | Comma-separated DNS resolvers used inside execution sandboxes. <!-- id:J926ue8T --> |
| `SEED_APPS_EXEC_MAX_CONCURRENT` | CPU count minus 2, at least 1 | Host-wide cap on sandboxes in use at once; a call past the cap waits for a slot. <!-- id:8sZw4vce --> |
| `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` | `30` | How long a call waits for a sandbox slot under the host-wide cap before failing with a retryable error. <!-- id:kO3J-GJE --> |
| `SEED_APPS_EXEC_MEMORY_ROOT_WAIT_SECS` | `300` | How long a call waits for the agent's memory to be free of other sandboxes (another session, a delegated child, a trigger firing of the same agent) before failing with a retryable error. Long by default so those calls queue behind the agent's own running execution instead of failing. |
| `SEED_APPS_EXEC_WARM_POOL` | off | Set `1` to keep microVMs alive between calls instead of booting one per call. <!-- id:dXJDYAaT --> |
| `SEED_APPS_EXEC_MAX_VMS` | `3` | Warm pool only: pooled VMs retained; extra concurrent calls boot transient VMs rather than wait. <!-- id:8tLQhClP --> |
| `SEED_APPS_EXEC_POOL_IDLE_TTL_SECS` | `180` | Warm pool only: how long a parked VM may sit idle before it is disposed. <!-- id:pZDEsB5o --> |
| `SEED_APPS_EXEC_POOL_MAX_AGE_SECS` | `1800` | Warm pool only: maximum age of a pooled VM, enforced between calls. <!-- id:yTmSdS1y --> |
| `SEED_APPS_EXEC_CANARY_SECS` | `0` (off) | How often the exec canary boots a fresh sandbox and runs one command, to prove code execution still works. The hosted production and staging servers set `300`. See the [code execution backend](./code-execution-backend.md#is-code-execution-working). |
| `SEED_APPS_MIN_FREE_DISK_MIB` | `512` | Free space the database's file system must have before the queue starts another run; below it runs stay queued and `/api/health` reports `dispatch.paused`. `0` disables the check. See the [effect outbox](../agent/effect-outbox.md). |
| `SEED_APPS_MAX_CONCURRENT_MODEL_RUNS` | `8` | Agent runs that hold a provider stream at once. See the [run queue](./run-queue.md). |
| `SEED_APPS_MAX_CONCURRENT_WORKFLOWS` | `32` | Script runs executed at once. They hold no provider stream. |
| `SEED_APPS_WORKFLOW_WORKER` | off | Set `1` to run scripts on a worker thread instead of on the server's main thread. It has no flag. |
| `SEED_APPS_SQLITE_CACHE_MIB` | `256` | SQLite page cache (private memory, counted against the container limit). See [persistence](./persistence.md#open-settings-and-planner-statistics). |
| `SEED_APPS_SQLITE_MMAP_MIB` | `1024` | Memory-mapped reads (reclaimable page cache), capped by SQLite's compiled maximum; the value in effect is logged at startup. |
| `SEED_APPS_SQLITE_WAL_LIMIT_MIB` | `64` | Size the WAL file is truncated back to after a checkpoint. |
| `SEED_APPS_RETENTION` | `on` | The retention task: `on` removes, `report` only logs what it would remove, `off` never runs. |
| `SEED_APPS_RETENTION_DURABLE_IDLE_DAYS` | `14` | A session idle this long loses its durable store, which its next turn rebuilds from the log. `0` disables. |
| `SEED_APPS_RETENTION_JOURNAL_DAYS` | `30` | A workflow run finished this long ago has the large payloads in its journal cut to previews. `0` disables. |
| `SEED_APPS_RETENTION_MIB_PER_SEC` | `2` | Disk budget for retention work. `0` is unthrottled. |
| `SEED_APPS_RETENTION_MAX_STORE_MIB` | `32` | Durable stores larger than this are left for the offline pass (a store is dropped in one transaction). |
| `SEED_APPS_RETENTION_INTERVAL_MINS` | `360` | Time between retention passes; the first runs 15 minutes after start. |
| `SEED_APPS_TOOL_OUTPUT_STORE_LIMIT_KIB` | `128` | Longest string (in thousands of characters) a stored tool output keeps; longer ones keep their head and a marker. The model never reads more than 32 KiB of a result either way. `0` disables. |
| `SEED_APPS_LOG_LEVEL` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`). `debug` re-enables hot-path lines. <!-- id:5TX4N4wb --> |

Five more variables are set by the build, not by an operator. The image build writes `SEED_APPS_VERSION`, `SEED_APPS_COMMIT`, `SEED_APPS_BRANCH` and `SEED_APPS_DATE`, which the version endpoint reports (see [deploying](./deploying.md#version-metadata)). The desktop build puts `SEED_APPS_STANDALONE` into the bundled binary so that it starts as a server.

Where a row says what the hosted Seed servers set, it describes how those servers are run. That can change, and this repository cannot confirm it.

# Command-line flags

A flag wins over the environment variable, and both win over the default: <!-- id:ZtCaYR7h -->

```bash <!-- id:VLKHNkHQ -->
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media \
  --ipfs-server-url https://hyper.media
```

Every environment variable in the table has a matching flag, unless its row says it has none. Examples are `--searxng-url`, `--exec-backend`, `--exec-ts-image`, `--subscription-auth`, `--session-title-generation` and `--max-concurrent-model-runs`. The full list is the `Flags` type in `config.ts`. <!-- id:9OIa8qFe -->

An unknown flag, or a flag with an empty value, stops the server at startup. So a typing mistake fails at once, and the server never runs with a default you did not choose.

# See also

- [Operations](./operations.md), the overview of running an app environment
- [Environments](./environments.md), the settings each deployment turns on
- [Endpoints and health](./endpoints-and-health.md), where the server reports the values in effect
- [Web research backends](./web-research-backends.md) and the [code execution backend](./code-execution-backend.md), the two optional subsystems
- [Database retention](./database-retention.md), what the retention settings remove
- [App environment](../software/app-environment.md), the program map
