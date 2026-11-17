---
name: Configuration
summary: Every environment variable and command-line flag the app environment reads, with its default and what it changes.
---
The [app environment](../software/app-environment.md) takes its configuration from environment variables and command-line flags. All of it is read in one place, `apps/src/config.ts`. This page is the reference. [Environments](./environments.md) says which settings each kind of deployment uses, and [operations](./operations.md) routes to the task pages.

# Names

Each setting is an environment variable named `SEED_APPS_<NAME>`. The earlier spelling `SEED_AGENTS_<NAME>` is still read for every setting, and the `SEED_APPS_` name wins when both are set. The [self-hosting](./self-hosting.md) compose files and the hosted deployments set the earlier spelling. This site writes the `SEED_APPS_` form.

# Environment variables

<!-- id:IA0NLgts -->
| Environment variable <!-- col:k4r6o34C --> | Default <!-- col:7jsKg_9k --> | Purpose <!-- col:1XR71v9t --> <!-- id:th_kSyA7 --> |
| --- | --- | --- |
| `SEED_APPS_HTTP_HOSTNAME` | `0.0.0.0` | HTTP bind hostname. <!-- id:G8sJvW8w --> |
| `SEED_APPS_HTTP_PORT` | `3050` | HTTP port. <!-- id:sJW1ZpvU --> |
| `SEED_APPS_DB_PATH` | `./data/agents.sqlite` | SQLite DB path. <!-- id:dknRVRGp --> |
| `SEED_APPS_DATA_DIR` | `./data` | Data directory. <!-- id:oMgwJJep --> |
| `SEED_APPS_HM_SERVER_URL` | `https://hyper.media` | Seed DAG-CBOR `/api/*` endpoint ([Seed API](../build/web-api.md)) used for activity and HM reads and writes. <!-- id:-U_3_rUb --> |
| `SEED_APPS_HM_SERVER_SECRET` | _(unset)_ | The service secret of a members-only site. It is sent as `X-Seed-Service-Secret` on requests to the HM server and IPFS origins only, in place of a session cookie. See the [enterprise node](./enterprise-node.md). It has no flag. |
| `SEED_APPS_PUBLIC_URL` | _(unset)_ | Where clients reach this server, such as `https://hyper.media/hm/api/apps` when the web host proxies `/hm/api/apps` here. Reported as `publicUrl` in `/api/health`. An app an agent runs here is pointed at it (its `appEnvironmentUrl`). |
| `SEED_APPS_IPFS_SERVER_URL` | HM server URL | Direct `/ipfs/*` [gateway](../protocol/files.md) origin for reads when it differs from the typed API endpoint. <!-- id:ltc8JHyj --> |
| `SEED_APPS_DEFAULT_PROMPT_URL` | the Agent Guide on hyper.media | The document a new agent's system prompt embeds, the [Agent Guide](../agent/guide.md). Reported as `defaultPromptUrl` in `/api/health`; the create-agent dialog embeds it. <!-- id:ClWokX89 --> |
| `SEED_APPS_DOCS_ACCOUNT` | _(unset)_ | The account of the knowledge base space. Reads of `hm://hyper.media/…` go to this account, the system prompt names the knowledge base by it, and a link an agent writes to `hm://hyper.media/…` (in a reply, a document or a comment) is published with it. A client resolves the `hyper.media` domain to the production docs, so a dev or staging agent's links would otherwise open another space. <!-- id:dAKWdZ8N --> |
| `SEED_APPS_DOCS_ACCOUNT_FILE` | _(unset)_ | A file that names the knowledge base account, read on every use. Dev points it at the file `./dev hm-sync` writes. <!-- id:yRzkV4si --> |
| `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS` | `5000` | Activity and schedule trigger monitor poll interval. <!-- id:O4k599Ev --> |
| `SEED_APPS_ACTIVITY_PAGE_SIZE` | `50` | ActivityFeed page size. <!-- id:72cPVt59 --> |
| `SEED_APPS_ACTIVITY_MAX_PAGES` | `5` | Max pages fetched per poll. <!-- id:AMt50Bbp --> |
| `SEED_APPS_SEARXNG_URL` | _(unset)_ | Self-hosted SearXNG base URL. Enables the `web_search` tool. <!-- id:r7A0bkD3 --> |
| `SEED_APPS_CRAWLER_URL` | _(unset)_ | Self-hosted Crawl4AI base URL. Enables browser-render escalation for web reads. <!-- id:0R7M1OGu --> |
| `SEED_APPS_CRAWLER_TOKEN` | _(unset)_ | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9). <!-- id:ABE0a0Tv --> |
| `SEED_APPS_SUBSCRIPTION_AUTH` | _(off)_ | Offer provider OAuth sign-in ("Sign in with ChatGPT"). Only `1`/`true`/`yes`/`on` enables it. <!-- id:Sv4pKPqe --> |
| `SEED_APPS_SESSION_TITLE_GENERATION` | `true` | Name untitled sessions with a dedicated model call. Set exactly `false` to disable. <!-- id:ED7y2rAF --> |
| `SEED_APPS_EXEC_BACKEND` | `microsandbox` | [Code-execution backend](./code-execution-backend.md) for `execute`. Set empty/`off`/`none` to disable. <!-- id:81BYtsXO --> |
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
| `SEED_APPS_WORKFLOW_WORKER` | off | Set `1` to run scripts in a separate worker process instead of on the server's thread. It has no flag. |
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

Two more variables are set by the build and not by an operator. The image build writes `SEED_APPS_VERSION`, `SEED_APPS_COMMIT`, `SEED_APPS_BRANCH` and `SEED_APPS_DATE`, which the version endpoint reports (see [deploying](./deploying.md#version-metadata)). The desktop build injects `SEED_APPS_STANDALONE` into the bundled binary so that it starts as a server.

# Command-line flags

CLI flags override env vars and defaults: <!-- id:ZtCaYR7h -->

```bash <!-- id:VLKHNkHQ -->
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media \
  --ipfs-server-url https://hyper.media
```

Every environment variable in the table has a matching flag unless its row says otherwise (`--searxng-url`, `--exec-backend`, `--exec-ts-image`, `--subscription-auth`, `--session-title-generation`, `--max-concurrent-model-runs`, …); the full list is the `Flags` type in `config.ts`. An unknown flag or a flag with an empty value is a startup error, so a typo fails loudly and never runs with a default. <!-- id:9OIa8qFe -->

# See also

- [Operations](./operations.md), the overview of running an app environment
- [Environments](./environments.md), the settings each deployment turns on
- [Endpoints and health](./endpoints-and-health.md), where the server reports the values in effect
- [Web research backends](./web-research-backends.md) and the [code execution backend](./code-execution-backend.md), the two optional subsystems
- [Database retention](./database-retention.md), what the retention settings remove
- [App environment](../software/app-environment.md), the program map
