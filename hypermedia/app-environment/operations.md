---
name: Operations
summary: How to build, configure, deploy, observe, and troubleshoot an app environment, including every environment variable, endpoint, and background loop.
---
How to run, inspect, and troubleshoot a [Seed Agents](../agent.md) server. The [app environment](../apps/app-environment.md) page describes the software, and [environments](./environments.md) lists the hosted deployments. <!-- id:nR-WGkJx -->

# Runtime and package boundary <!-- id:unUpYzoN -->

`agents/` is a Bun workspace. Use Bun commands inside it. <!-- id:hnrbpymM -->

From repo root: <!-- id:cvH06CGz -->

```bash <!-- id:QPisRTbW -->
direnv exec . bash -lc 'cd apps && bun install'
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

Validation: <!-- id:AamjsE1v -->

```bash <!-- id:rosEGSrU -->
direnv exec . bash -lc 'cd apps && bun check && bun test'
direnv exec . bash -lc 'cd apps && bun run test:build'
direnv exec . bash -lc 'cd apps && bun run test:docker'
direnv exec . bash -lc 'cd apps && bun run test:trigger'
direnv exec . bash -lc 'cd apps && bun run test:outbox'
```

`test:trigger` boots the real daemon against a local stand-in for hyper.media's `/api/ListEvents`, creates an agent and a user-mention trigger over the [signed API](./signed-api.md), and asserts that a comment mention fires exactly one session. It guards the comment and citation sibling race. See [triggers](./triggers.md). <!-- id:PN41rCE- -->

`test:outbox` boots the real daemon on a real SQLite file with a local OpenAI-compatible stand-in for the model and drives the [effect outbox](./effect-outbox.md) over the wire: a memory write leaves a receipt; `kill -9` while a download is in flight and a restart answer the call as interrupted without repeating the download; on macOS the database moves to a 32 MiB RAM disk to show the disk floor pausing dispatch and a real ENOSPC mid-turn failing the run and recovering into one well-formed transcript. `SEED_AGENTS_SMOKE_REAL_DB=<path>` first boots on a copy of that database so the migration runs against real rows; `SEED_AGENTS_SMOKE_ONLY=restart,floor` selects scenarios by a word in their names.

The [desktop app](../apps/desktop.md): <!-- id:nzMipXzR -->

```bash <!-- id:fQC0BA0- -->
direnv exec . bash -lc './dev run-desktop'
```

Build the deployment image from the repo root: <!-- id:UjHaLIjM -->

```bash <!-- id:-i1uRyfu -->
docker build -t seedhypermedia/apps:dev . -f ./apps/Dockerfile
```

Run the image with persistent state mounted at `/data`: <!-- id:sY0rShW2 -->

```bash <!-- id:jq6Wn7cW -->
docker run --rm -p 3050:3050 -v seed-agents-data:/data seedhypermedia/apps:dev
```

# Versioning, build, and deploy <!-- id:cVmqN7IW -->

The image records what it was built from and exposes it at runtime. `/api/version` (and `/agents/api/version`) returns: <!-- id:KRJqFMwI -->

```json <!-- id:7QqXMmsN -->
{"version": "2026.6.10", "commit": "<sha>", "branch": "<ref>", "date": "<date>"}
```

The `commit`, `branch`, and `date` fields mirror the [daemon](../apps/daemon.md) `/debug/version` and [web](../apps/web.md) `/hm/api/version` shape. `version` (the image tag) is specific to agents. `/api/health` also includes the `version` field for quick checks. To see what a host is running: <!-- id:YpXAAaEN -->

```bash <!-- id:T46AIml8 -->
curl -s https://hyper.media/hm/api/apps/version
```

The values come from `apps/src/build-info.ts`, populated by Docker build args (`VERSION`, `COMMIT_HASH`, `BRANCH`, `DATE`; the web and daemon images use the same `COMMIT_HASH`, `BRANCH`, and `DATE` names). `apps/Dockerfile` maps them to namespaced `SEED_AGENTS_*` runtime `ENV`. Without build args (for example local `bun dev` or a plain `docker build`) they fall back to `dev` or `unknown`. <!-- id:3EKhBIqX -->

## CI build and push <!-- id:TT-1OVn2 -->

`apps/Dockerfile` is built and pushed by three GitHub Actions workflows, all of which also accept a manual `workflow_dispatch` run from the Actions tab: <!-- id:9ag8Sj9F -->
  - `.github/workflows/release-docker-images.yml`: on a `*.*.*` release tag push (or manual dispatch), pushes `seedhypermedia/agents:<tag>`. The resolved tag is the version (`latest` for a manual run with no tag). `agents-stable` on the host tracks `:latest`. <!-- id:dqZxrWX0 -->
  - `.github/workflows/dev-docker-images.yml`: on push to `main` touching `apps/**` (or manual dispatch), pushes `seedhypermedia/apps:dev`, which **both** `agents-staging` and `agents-dev` track. While this workflow is red on `main`, `:dev` stops moving, and staging silently keeps validating an older commit than the one you are about to release. `/api/version` on staging is the check that catches it. <!-- id:-c40zu4a -->
  - `.github/workflows/hotfix-agents-image.yml`: manual dispatch only, from `main` only. Runs the agents test gate and pushes ONLY `seedhypermedia/agents:latest`. Use this to hotfix the production app environment without cutting a full release of every image. <!-- id:i8GnJuWs -->

## Manual build and push from a workstation <!-- id:g7mprK3Z -->

To build and push an image yourself with correct version metadata baked in: <!-- id:t63K_Lee -->

```bash <!-- id:XeudkRfN -->
apps/scripts/build-and-push.sh dev      # or: latest
```

It stamps the current git `HEAD` (commit, branch, date) into the image and pushes `seedhypermedia/agents:<tag>`. <!-- id:zH3oxaoU -->

## Deploy onto the agent host <!-- id:q7ez6eeh -->

One host runs `/opt/agentic/docker-compose.yml` with three agents containers behind Caddy: <!-- id:QMQwk2vp -->

<!-- id:SIM6kqVF -->
| Hostname <!-- col:LqSuj2MH --> | Container <!-- col:69XPEtJw --> | Image tag <!-- col:iCY30j_y --> | Code <!-- col:y0qrOEXZ --> | Data <!-- col:leHGcMht --> <!-- id:Exwz3Qfb --> |
| --- | --- | --- | --- | --- |
| `apps.seed.hyper.media` (on `sae-prod`) | `agents-stable` | `:latest` | newest release | mainnet <!-- id:JGFQErsK --> |
| `staging.apps.seed.hyper.media` (on `sae-dev`) | `agents-staging` | `:dev` | `main` | mainnet, via `staging.hyper.media` <!-- id:rPtV9zjA --> |
| `dev.apps.seed.hyper.media` (on `sae-dev`) | `agents-dev` | `:dev` | `main` | devnet <!-- id:sKgI7CtP --> |

Staging is the release gate: same code as dev, real mainnet data. Before cutting a release, land on `main`, wait for `:dev` to deploy, exercise `https://staging.hyper.media/hm/api/apps` (served by `staging.apps.seed.hyper.media`), then tag. See [environments](./environments.md) for the full picture, including why each container needs its own data volume. <!-- id:4aRdm50_ -->

Watchtower (`nickfedor/watchtower:1.18.1`, label-enabled, 5-minute interval) auto-pulls the labeled containers. After pushing a new image it deploys within the poll interval, or force it immediately: <!-- id:hwGCsVgy -->

```bash <!-- id:J4Y3ksRe -->
# Force an update now, with compose (the reliable way):
ssh ubuntu@agentic.seed.hyper.media \
  'cd /opt/agentic && docker compose pull agents-stable agents-staging agents-dev && docker compose up -d'

# Or a one-shot Watchtower. Note: only works when the resident Watchtower is stopped — it treats a
# second instance as an "excess Watchtower container" and SIGTERMs it mid-run.
ssh ubuntu@agentic.seed.hyper.media \
  'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'
```

Watchtower reads `com.centurylinklabs.watchtower.enable` off the **running container**, so editing that label in the compose file changes nothing until `docker compose up -d <service>` recreates the container. That is the knob for temporarily pinning a deployment. It does not stop `bootstrap.sh`, whose `docker compose pull` will still move a pinned container on the next Terraform apply. <!-- id:adholITo -->
  > `/opt/agentic/docker-compose.yml` and `/opt/agentic/Caddyfile` are rendered by `seed_infra/agentic/main.tf` in the <!-- id:piG1RxCf -->
  > SeedInfra repo and pushed over SSH by the `ssh_resource.files` resource. Edits made directly on the host survive until <!-- id:WlBk_Eum -->
  > the next apply and then vanish. Mirror anything you change there back into `main.tf`. <!-- id:VQyleHww -->

# Configuration <!-- id:07ntysg_ -->

Config source: `apps/src/config.ts`. <!-- id:Woltv7hS -->

<!-- id:IA0NLgts -->
| Environment variable <!-- col:k4r6o34C --> | Default <!-- col:7jsKg_9k --> | Purpose <!-- col:1XR71v9t --> <!-- id:th_kSyA7 --> |
| --- | --- | --- |
| `SEED_AGENTS_HTTP_HOSTNAME` | `0.0.0.0` | HTTP bind hostname. <!-- id:G8sJvW8w --> |
| `SEED_AGENTS_HTTP_PORT` | `3050` | HTTP port. <!-- id:sJW1ZpvU --> |
| `SEED_AGENTS_DB_PATH` | `./data/agents.sqlite` | SQLite DB path. <!-- id:dknRVRGp --> |
| `SEED_AGENTS_DATA_DIR` | `./data` | Data directory. <!-- id:oMgwJJep --> |
| `SEED_AGENTS_HM_SERVER_URL` | `https://hyper.media` | Seed DAG-CBOR `/api/*` endpoint ([Seed API](../build/web-api.md)) used for activity and HM reads and writes. <!-- id:-U_3_rUb --> |
| `SEED_AGENTS_PUBLIC_URL` | _(unset)_ | Where clients reach this server, such as `https://hyper.media/hm/api/apps` when the web host proxies `/hm/api/apps` here. Reported as `publicUrl` in `/api/health`. An app an agent runs here is pointed at it (its `appEnvironmentUrl`). |
| `SEED_AGENTS_IPFS_SERVER_URL` | HM server URL | Direct `/ipfs/*` [gateway](../protocol/files.md) origin for reads when it differs from the typed API endpoint. <!-- id:ltc8JHyj --> |
| `SEED_AGENTS_DEFAULT_PROMPT_URL` | the Agent Guide on hyper.media | The document a new agent's system prompt embeds, the [Agent Guide](./guide.md). Reported as `defaultPromptUrl` in `/api/health`; the create-agent dialog embeds it. <!-- id:ClWokX89 --> |
| `SEED_AGENTS_DOCS_ACCOUNT` | _(unset)_ | The account of the knowledge base space. Reads of `hm://hyper.media/…` go to this account. <!-- id:dAKWdZ8N --> |
| `SEED_AGENTS_DOCS_ACCOUNT_FILE` | _(unset)_ | A file that names the knowledge base account, read on every use. Dev points it at the file `./dev hm-sync` writes. <!-- id:yRzkV4si --> |
| `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` | `5000` | Activity and schedule trigger monitor poll interval. <!-- id:O4k599Ev --> |
| `SEED_AGENTS_ACTIVITY_PAGE_SIZE` | `50` | ActivityFeed page size. <!-- id:72cPVt59 --> |
| `SEED_AGENTS_ACTIVITY_MAX_PAGES` | `5` | Max pages fetched per poll. <!-- id:AMt50Bbp --> |
| `SEED_AGENTS_SEARXNG_URL` | _(unset)_ | Self-hosted SearXNG base URL. Enables the `web_search` tool. <!-- id:r7A0bkD3 --> |
| `SEED_AGENTS_CRAWLER_URL` | _(unset)_ | Self-hosted Crawl4AI base URL. Enables browser-render escalation for web reads. <!-- id:0R7M1OGu --> |
| `SEED_AGENTS_CRAWLER_TOKEN` | _(unset)_ | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9). <!-- id:ABE0a0Tv --> |
| `SEED_AGENTS_SUBSCRIPTION_AUTH` | _(off)_ | Offer provider OAuth sign-in ("Sign in with ChatGPT"). Only `1`/`true`/`yes`/`on` enables it. <!-- id:Sv4pKPqe --> |
| `SEED_AGENTS_SESSION_TITLE_GENERATION` | `true` | Name untitled sessions with a dedicated model call. Set exactly `false` to disable. <!-- id:ED7y2rAF --> |
| `SEED_AGENTS_EXEC_BACKEND` | `microsandbox` | Code-execution backend for `execute` and authored lambda tools. Set empty/`off`/`none` to disable. <!-- id:81BYtsXO --> |
| `SEED_AGENTS_EXEC_IMAGE` | `python` | OCI image used for execution sandboxes. <!-- id:QRvggCQy --> |
| `SEED_AGENTS_EXEC_TS_IMAGE` | `oven/bun` | OCI image for the `ts` runtime (needs bun). Set empty to withhold ts. <!-- id:yQbjzCnq --> |
| `SEED_AGENTS_EXEC_CPUS` | `1` | Virtual CPUs per execution sandbox. <!-- id:QRuJer3f --> |
| `SEED_AGENTS_EXEC_MEMORY_MIB` | `512` | Guest memory per execution sandbox (MiB). <!-- id:AlLSx3oW --> |
| `SEED_AGENTS_EXEC_TIMEOUT_SECS` | `60` | Default per-execution timeout (tool may request up to 300s). <!-- id:lyEYdp2i --> |
| `SEED_AGENTS_EXEC_ALLOW_NETWORK` | `true` | Sandbox internet access. Set `false`/`off`/`0` to isolate sandboxes. <!-- id:YZQgb6sX --> |
| `SEED_AGENTS_EXEC_DNS` | `1.1.1.1,8.8.8.8` | Comma-separated DNS resolvers used inside execution sandboxes. <!-- id:J926ue8T --> |
| `SEED_AGENTS_EXEC_MAX_CONCURRENT` | CPU count minus 2, at least 1 | Host-wide cap on sandboxes in use at once; a call past the cap waits for a slot. <!-- id:8sZw4vce --> |
| `SEED_AGENTS_EXEC_ACQUIRE_WAIT_SECS` | `30` | How long a call waits for a sandbox slot under the host-wide cap before failing with a retryable error. <!-- id:kO3J-GJE --> |
| `SEED_AGENTS_EXEC_MEMORY_ROOT_WAIT_SECS` | `300` | How long a call waits for the agent's memory to be free of other sandboxes (another session, a delegated child, a trigger firing of the same agent) before failing with a retryable error. Long by default so those calls queue behind the agent's own running execution instead of failing. |
| `SEED_AGENTS_EXEC_WARM_POOL` | off | Set `1` to keep microVMs alive between calls instead of booting one per call. Opt-in until it is the proven default. <!-- id:dXJDYAaT --> |
| `SEED_AGENTS_EXEC_MAX_VMS` | `3` | Warm pool only: pooled VMs retained; extra concurrent calls boot transient VMs rather than wait. <!-- id:8tLQhClP --> |
| `SEED_AGENTS_EXEC_POOL_IDLE_TTL_SECS` | `180` | Warm pool only: how long a parked VM may sit idle before it is disposed. <!-- id:pZDEsB5o --> |
| `SEED_AGENTS_EXEC_POOL_MAX_AGE_SECS` | `1800` | Warm pool only: maximum age of a pooled VM, enforced between calls. <!-- id:yTmSdS1y --> |
| `SEED_AGENTS_EXEC_CANARY_SECS` | `0` (off) | How often the exec canary boots a fresh sandbox and runs one command, to prove code execution still works. The hosted servers set `300`. See [Is code execution working](#is-code-execution-working). |
| `SEED_AGENTS_MIN_FREE_DISK_MIB` | `512` | Free space the database's file system must have before the queue starts another run; below it runs stay queued and `/api/health` reports `dispatch.paused`. `0` disables the check. See the [effect outbox](./effect-outbox.md). |
| `SEED_AGENTS_SQLITE_CACHE_MIB` | `256` | SQLite page cache (private memory, counted against the container limit). See [Database size and retention](#database-size-and-retention). |
| `SEED_AGENTS_SQLITE_MMAP_MIB` | `1024` | Memory-mapped reads (reclaimable page cache), capped by SQLite's compiled maximum; the value in effect is logged at startup. |
| `SEED_AGENTS_SQLITE_WAL_LIMIT_MIB` | `64` | Size the WAL file is truncated back to after a checkpoint. |
| `SEED_AGENTS_RETENTION` | `on` | The retention task: `on` removes, `report` only logs what it would remove, `off` never runs. |
| `SEED_AGENTS_RETENTION_DURABLE_IDLE_DAYS` | `14` | A session idle this long loses its durable store, which its next turn rebuilds from the log. `0` disables. |
| `SEED_AGENTS_RETENTION_JOURNAL_DAYS` | `30` | A workflow run finished this long ago has the large payloads in its journal cut to previews. `0` disables. |
| `SEED_AGENTS_RETENTION_MIB_PER_SEC` | `2` | Disk budget for retention work. `0` is unthrottled. |
| `SEED_AGENTS_RETENTION_MAX_STORE_MIB` | `32` | Durable stores larger than this are left for the offline pass (a store is dropped in one transaction). |
| `SEED_AGENTS_RETENTION_INTERVAL_MINS` | `360` | Time between retention passes; the first runs 15 minutes after start. |
| `SEED_AGENTS_TOOL_OUTPUT_STORE_LIMIT_KIB` | `128` | Longest string (in thousands of characters) a stored tool output keeps; longer ones keep their head and a marker. The model never reads more than 32 KiB of a result either way. `0` disables. |
| `SEED_AGENTS_LOG_LEVEL` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`). `debug` re-enables hot-path lines. <!-- id:5TX4N4wb --> |

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

Every environment variable in the table has a matching flag (`--searxng-url`, `--exec-backend`, `--exec-ts-image`, `--subscription-auth`, `--session-title-generation`, …); the full list is the `Flags` type in `config.ts`. An unknown flag or a flag with an empty value is a startup error, so a typo fails loudly and never runs with a default. <!-- id:9OIa8qFe -->

# Database size and retention

The service keeps everything in one SQLite file, and on the hosted server every read that misses the cache is a random read on a slow volume. Three things keep the file from growing without bound (`apps/src/db-retention.ts`):

- **Stored tool output is capped.** A tool result's output is stored for people to inspect; strings past `SEED_AGENTS_TOOL_OUTPUT_STORE_LIMIT_KIB` keep their head and a `[truncated for storage: …]` marker. The model's view is unchanged: it never reads more than 32 KiB of a result. Workflow scripts still receive whole results.
- **Durable stores of idle sessions are dropped.** A session's [durable store](./durable-sessions.md) is a second, model-facing copy of its transcript. Once the session has been idle for `SEED_AGENTS_RETENTION_DURABLE_IDLE_DAYS` and has no live run, the store is deleted in one transaction; the session's next turn rebuilds it from the log, as it does for a lost store. Nothing in the transcript changes.
- **Journals of finished workflow runs are compacted.** A finished run is never replayed, so `SEED_AGENTS_RETENTION_JOURNAL_DAYS` after it finished, journal entries larger than 16 KiB keep their kind, call, tool, status and error, and their inputs and outputs become previews marked `compacted`.

The last two run as a background task every `SEED_AGENTS_RETENTION_INTERVAL_MINS`, in small steps throttled to `SEED_AGENTS_RETENTION_MIB_PER_SEC`, and log a line per day of data they touched plus a summary per pass (`[agents/retention]`). Set `SEED_AGENTS_RETENTION=report` to see what would go without removing anything.

Deleting rows frees pages for reuse but does not shrink the file. Shrinking a database that grew before retention existed is a planned maintenance step: stop the service, run `apps/scripts/db-retention.ts` (one unthrottled pass, with `--report` to preview), then `VACUUM INTO` a new file and swap it in. `apps/scripts/db-size-report.ts` estimates where the bytes are without reading the whole file and is safe on a live server. The full runbook, with sizing and durations, is in [Agents database growth and retention](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/notes/agents-db-growth).

# Web research backends <!-- id:ww1gPvmR -->

Web research is fully self-hosted and uses no third-party API keys. It covers the `web_search` callable tool and the tiered reader behind `read https://…` (MediaWiki, then in-process static Readability+Turndown, then Crawl4AI). See [tools](./tools.md). Both backends are optional. Without configuration, `web_search` errors and web reads fall back to the MediaWiki and static tiers. To enable them, run the backends as sidecar containers on the same internal network and point the app environment at them. <!-- id:6w4jARt9 -->

For local development a ready-to-run compose and SearXNG config live at `apps/dev/web-backends/`. Start the containers, then run the service. `bun run dev` already points at these dev endpoints by default: <!-- id:ylFQ-SIc -->

```bash <!-- id:ObEJf9WQ -->
cd apps/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script defaults `SEED_AGENTS_SEARXNG_URL` (`http://127.0.0.1:8899`), `SEED_AGENTS_CRAWLER_URL` (`http://127.0.0.1:11235`), and `SEED_AGENTS_CRAWLER_TOKEN` (`dev-crawl-token`) to the compose values. Export those env vars to override them. The same script also turns `SEED_AGENTS_SUBSCRIPTION_AUTH` on for local development. The startup log prints `Web tools: search=on reader=static+crawl4ai` when wired. The reader's MediaWiki and static tiers still work if the containers are not running. Only `web_search` and the browser escalation need them. Stop the backends with `docker compose down` in `apps/dev/web-backends/`. <!-- id:sU3Ky-PV -->

For production the same two containers run as internal sidecars: <!-- id:HEFIWVDD -->

```yaml <!-- id:PHv3Gdqr -->
services:
  searxng:
    image: searxng/searxng:latest
    volumes:
      - ./searxng:/etc/searxng:rw # settings.yml must enable the json format
    restart: unless-stopped
    # No published ports: reachable on the internal network as http://searxng:8080

  crawl4ai:
    image: unclecode/crawl4ai:0.9.0 # pin; do NOT use :latest (0.9.0 changed auth defaults)
    shm_size: '1g' # required: headless Chromium crashes without it
    environment:
      - CRAWL4AI_API_TOKEN=${CRAWL4AI_API_TOKEN} # required: 0.9.x is secure-by-default
    restart: unless-stopped
    # Reachable on the internal network as http://crawl4ai:11235
```

Required SearXNG `settings.yml` (the JSON format is off by default and the limiter blocks API calls): <!-- id:VkqeSybu -->

```yaml <!-- id:qV3GeELm -->
use_default_settings: true
server:
  secret_key: '${SEARXNG_SECRET_KEY}'
  limiter: false # safe only on a trusted internal network
  public_instance: false
search:
  formats:
    - html
    - json
```

Then wire the agents container: <!-- id:T9adfXgF -->

```yaml <!-- id:O7DuPU3J -->
environment:
  SEED_AGENTS_SEARXNG_URL: http://searxng:8080
  SEED_AGENTS_CRAWLER_URL: http://crawl4ai:11235
  SEED_AGENTS_CRAWLER_TOKEN: ${CRAWL4AI_API_TOKEN}
```

Capacity note: Crawl4AI runs a headless Chromium and documents a >=4 GB RAM minimum plus 1 GB shared memory. Size the host accordingly. The SearXNG and in-process static reader path is lightweight. Crawl4AI is the heavy escalation tier. <!-- id:U9QXiKwN -->

The health endpoints (`/api/health`, `/agents/api/health`) report what this server can actually do: <!-- id:15g_rrEQ -->

```json <!-- id:dv8IoP83 -->
{
  "status": "ok",
  "uptime": 1234.5,
  "version": "2026.6.10",
  "hmServerUrl": "https://hyper.media",
  "protocol": 3,
  "minClientProtocol": 1,
  "defaultPromptUrl": "hm://hyper.media/app-environment/guide",
  "ipfsServerUrl": "https://hyper.media",
  "webTools": {"search": true, "readBrowser": true},
  "subscriptionAuth": false,
  "codeExec": true,
  "codeExecReason": "…",
  "codeExecReasonCode": "…",
  "codeExecRuntimes": ["ts", "python", "shell"],
  "disk": {"path": "/data", "freeBytes": 123456789, "minFreeBytes": 536870912, "ok": true},
  "dispatch": {"paused": false},
  "bootRecovery": {"state": "done", "ms": 412}
}
```

`ipfsServerUrl` defaults to `hmServerUrl`, which is correct for hosted all-in-one origins. Local desktop environments set them separately because the desktop bridge owns `/api/*` while the daemon owns gateway reads under `/ipfs/*`. IPFS publication itself chunks [UnixFS](../protocol/files.md) blocks and uses `PublishBlobs` on `hmServerUrl`. `webTools` derives from `SEED_AGENTS_SEARXNG_URL` and `SEED_AGENTS_CRAWLER_URL`. `codeExec` derives from the exec backend probe, and `codeExecReason` and `codeExecReasonCode` explain an unavailable sandbox. `codeExecRuntimes` says which runtimes this host offers. `ts` needs an image with bun, so an operator can see at a glance whether TypeScript execution is on here. Clients read these fields to grey out what the server cannot run. `disk` is the free space where the database lives against the floor new runs require (`null` when the check is off), and `dispatch` says whether the queue is claiming runs; `{paused: true, reason}` names what stopped it. See the [effect outbox](./effect-outbox.md). <!-- id:5FIU-ofh -->

The server binds its port before it opens the database. Until it is ready, every health path answers `503` with `{"status": "starting", "phase": "…", "reason": "…"}` and a `Retry-After`, and every other path answers `503`. The phases are opening the database (migrations, planner statistics), starting the run queue (the boot sweeps), and starting monitors. Each step logs `[agents/boot] step finished` with its duration, and `App environment running` carries the total `bootMs`. A step is synchronous on the only thread, so a request that arrives during it is answered when it ends. The parked-run reconcile and receipt pruning run after the server is ready, one run at a time with the event loop given back in between; `bootRecovery` reports them as `pending`, `running`, `done` (with `ms`) or `failed` (with `error`). The container healthcheck allows a ten-minute start period for a cold boot on a large database.

# Code execution backend <!-- id:VLdUUR8z -->

The `execute` tool, and every authored lambda tool (which runs in the same sandbox), uses the embedded `microsandbox` npm runtime: hardware-isolated microVMs with no separate server process. Host requirements: Apple Silicon on macOS, KVM on Linux, WHP (Windows Hypervisor Platform) on Windows. The runtime and native binaries install with the package. The first execution pulls the configured OCI image (default `python`), which takes tens of seconds. After that, sandboxes boot in well under a second. The `ts` runtime comes from a second image (`SEED_AGENTS_EXEC_TS_IMAGE`, default `oven/bun`); Setting it empty leaves TypeScript unavailable, and `codeExecRuntimes` reports that. <!-- id:pQ4E3B90 -->

On a host that cannot run sandboxes, the tool is withheld so it never fails at call time. `enabledCallableTools` drops `execute` from the agent's callable set when the availability probe says no, so the model never sees a tool that can only error. `SEED_AGENTS_EXEC_BACKEND=off` disables the backend outright. <!-- id:EmHP7rkO -->

When the app environment runs inside a container, the container needs access to the host virtualization device (on Linux, `--device /dev/kvm`). Without it, executions fail with the backend-unavailable error, and the rest of the service keeps working. <!-- id:1nsXcwQ3 -->

Sandbox networking is **on by default** so agents can install packages and fetch data. The runtime gives each sandbox an explicit DNS resolver (`SEED_AGENTS_EXEC_DNS`, default `1.1.1.1,8.8.8.8`; a guest has no resolver otherwise) and a non-local egress policy. The sandbox reaches the public internet but not the host's private network or cloud-metadata endpoints (for example `169.254.169.254`). Set `SEED_AGENTS_EXEC_ALLOW_NETWORK=false` to cut the sandbox off entirely. Installed packages do not survive between calls, because each call runs in a fresh microVM. The tool prompt tells agents to `pip install --target /workspace/pylibs <pkg>` so packages persist in memory and can be re-imported later. <!-- id:OYeHVeib -->

Production deployment of these sidecars on the hosted app environment is handled in the `mintterteam/infrastructure` repo (the `seed_infra/agentic` Terraform stack adds the `searxng` and `crawl4ai` containers and wires the env vars). It is not in this repo. [Security](./security.md) covers the sandbox threat model. <!-- id:mmGE05vJ -->

# Local files <!-- id:cXgkgXPk -->

Default local files: <!-- id:4jlD-xvi -->

```text <!-- id:mvRKXMGP -->
agents/data/agents.sqlite
agents/data/agents.sqlite-shm
agents/data/agents.sqlite-wal
agents/data/agents/<agentId>/
```

SQLite is authoritative for everything except bytes on disk. An agent's state directory is created with the agent and holds its `memory/` filesystem (the `~/memory/` half of its [Space](./space.md)) plus session-private [attachments](./attachment.md). It is removed with the agent. Each session's [durable store](./durable-sessions.md) is in the database, not in this directory. See [persistence](./persistence.md). Staged chunked uploads live under the data dir until they are committed or expire. <!-- id:dWWK_HDM -->

# HTTP endpoints <!-- id:oTx-eqES -->

Every endpoint lives under the canonical prefix `/hm/api/agents`, so the service can sit on its own host or on a site's own origin with one reverse-proxy rule. The older paths (`/api/*`, `/agents/api/*`, `/agents/ws`) stay registered: the standalone production host, released clients and webhook URLs already handed out use them. <!-- id:tYSO6ajj -->

<!-- id:WyyD8vqE -->
| Endpoint <!-- col:QqHnNcMC --> | Method <!-- col:0cPxyrJj --> | Purpose <!-- col:oVN2t9-G --> <!-- id:p8d1Mrxo --> |
| --- | --- | --- |
| `/hm/api/agents/message` | `POST` | Signed CBOR action API (canonical). <!-- id:zX6SdlMV --> |
| `/hm/api/agents/ws` | WebSocket | Signed live subscriptions (canonical). <!-- id:8py3ZRIE --> |
| `/hm/api/agents/health`, `/version`, `/perf`, `/perf/sessions/<sessionId>`, `/metrics` | `GET` | Health, build metadata, timing counters, Prometheus metrics (canonical). <!-- id:546OlRfm --> |
| `/hm/api/agents/webhooks/<triggerId>[/<secret>]` | `POST` | Webhook trigger delivery (canonical). <!-- id:MExnSG43 --> |
| `/api/message` | `POST` | Signed CBOR action API. <!-- id:D634v2_4 --> |
| `/agents/api/message` | `POST` | Same action API under `/agents`. <!-- id:0MOz3jtf --> |
| `/api/health` | `GET` | JSON health and capabilities (no account data). <!-- id:A68cofS7 --> |
| `/agents/api/health` | `GET` | JSON health under `/agents`. <!-- id:b1WZL61v --> |
| `/api/version` | `GET` | Build metadata of the deployed image. <!-- id:2Y7ZWDiX --> |
| `/agents/api/version` | `GET` | Build metadata under `/agents`. <!-- id:UrIALpko --> |
| `/agents/ws` | WebSocket | Signed live subscriptions. <!-- id:Em_QCmeP --> |

`GET /api/perf` and `/agents/api/perf` (and `/api/perf/sessions/<sessionId>`) return per-stage timing counters and are unauthenticated like health. `GET /api/metrics` (and `/agents/api/metrics`) serves the same aggregates and the exec canary in Prometheus text format, for the metrics collector and alert rules; see [Is code execution working](#is-code-execution-working). `/api/health` answers 503 with `reason: 'loop-lag'` while the server's event loop is stalled; see [Is the server stalled](#is-the-server-stalled). `POST /agents/api/webhooks/<triggerId>` and `/<triggerId>/<secret>` deliver webhook triggers (see [triggers](./triggers.md)); a trigger's `endpointPath` names the canonical form. Everything else is a 404. The server has no browser UI and no unauthenticated data routes. Account-owned state (agents, triggers, sessions, events, memory) is reachable only through signed envelopes on the message endpoint and the WebSocket. Use the desktop app, or the signed API (`ListAgents`, `ListSessions`, `GetSession`, `GetAgentTrigger`, `ListRuns`), to inspect a server. <!-- id:cJBkT6iS -->

# Where the service lives <!-- id:CJWNG9gR -->

A client holds one base URL per app environment and picks the endpoint paths from its shape (`agentServerEndpoint()` in `frontend/packages/ui/src/agents/client.ts`): <!-- id:_3fqlgq8 -->
  - **Canonical**: the path ends in `/hm/api/agents`, for example `https://site.example/hm/api/agents`. The client calls `<base>/message`, `<base>/ws`, `<base>/health` and `<base>/webhooks/…`. <!-- id:p4SQmeaZ -->
  - **Legacy**: an origin only, for example `https://agentic.seed.hyper.media` (a trailing `/agents` is stripped). The client calls `/api/message`, `/agents/ws` and `/agents/api/*` under it. <!-- id:hS7cHZfj -->

Production stays standalone at `https://agentic.seed.hyper.media`, and the desktop, web and mobile defaults keep its legacy form; `https://agentic.seed.hyper.media/hm/api/agents` reaches the same server. A site may instead serve agents on its own origin: the reverse proxy routes `/hm/api/agents/*` (API and WebSocket) to the agents container, and the site advertises `<site>/hm/api/agents` as its app environment URL (`SEED_AGENT_SERVER_URL`, surfaced as `agentServerUrl` in `/hm/api/config`). The web app never proxies agents traffic. Pointing a client at a bare site origin does not work: `<origin>/api/message` is the site's own API, not the app environment. <!-- id:6Hg8hKZ9 -->

On an Enterprise (members-only) site, `/hm/api/agents/*` sits behind the same sign-in gate as the rest of the site, except `POST /hm/api/agents/webhooks/*`, which outside services call with the trigger secret and which stays open. The app environment reads its members-only site with the deployment's service secret (`SEED_AGENTS_HM_SERVER_SECRET`, sent as `X-Seed-Service-Secret` only to that site's origin; `apps/src/hm-server-auth.ts`), so mention triggers keep firing behind the gate. <!-- id:oNdAu6c9 -->

# Trigger monitors <!-- id:KlGKY3Ne -->

The server starts a background ActivityFeed monitor for enabled HM activity [triggers](./triggers.md). It polls on `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` (default 5 seconds) and does not contact the HM activity feed unless an account has at least one enabled non-schedule trigger. <!-- id:vygOfZs- -->

Each polled event is offered to two consumers: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account (`#deliverActivityToRunWaits`). A wait belongs to one run, and a trigger is the agent's standing configuration, but both use the same feed. An account with **no** enabled activity trigger is never polled, so an activity-shaped wait on such an account only resolves by timeout. Signal-shaped waits do not depend on polling at all. The first poll for an account establishes a baseline watermark and only processes activity observed after the earliest enabled trigger was created. Later polls process new ActivityFeed events through trigger matching. If a persisted watermark is older because the server was down, the monitor backfills unseen events for up to 1 hour and then advances the watermark. <!-- id:Z8YvKpdU -->

The server also starts a background schedule monitor. It evaluates enabled `schedule` triggers on the same poll interval, records durable `trigger_firings` rows with `schedule:<triggerId>:<scheduledAt>` idempotency keys, creates sessions for due occurrences, and disables one-time triggers after a successful run. <!-- id:As3XFW0a -->

# Run queue and workflow engine <!-- id:jIKj9Ovy -->

Every agent execution is a durable row in the `runs` table, which is also the dispatch queue (`apps/src/runs.ts`). See [Runs](./runs.md): <!-- id:Cdw3Ljyi -->
  - **Queues**: interactive user turns are claimed inline by `MessageSession` (unchanged latency). Everything else (trigger firings, agent-started sessions, delegated model children, script children) dispatches on the `background` queue. Agent runs are capped at `SEED_AGENTS_MAX_CONCURRENT_MODEL_RUNS` (default 8, flag `--max-concurrent-model-runs`) concurrent provider streams. Script runs get their own pool, `SEED_AGENTS_MAX_CONCURRENT_WORKFLOWS` (default 32, `--max-concurrent-workflows`; they hold no provider stream). `SEED_AGENTS_WORKFLOW_WORKER=1` runs scripts in the isolated worker process described in the [worker plan](./plans/worker-isolated-execution.md); `SEED_AGENTS_STANDALONE` is injected into the desktop's bundled binary at build time, so a script awaiting its children can never starve them. <!-- id:db3BA2As -->
  - **One live agent run per session** is enforced at claim time (lease-based). This replaced the old racy status-column 409. <!-- id:ST5DHKVV -->
  - **Boot sweep**: on service construction, runs a dead process left `claimed` or `running` are requeued, and any queued backlog resumes. Agent runs resume by replaying their durable session events. A crash between a persisted `tool_call` and its `tool_result` is answered from the [effect outbox](./effect-outbox.md): the receipt when the effect finished, an interrupted result naming the effect when it did not, so the provider request is well-formed and the model knows what to check. The same sweep marks every effect the dead process left running as interrupted. Script runs resume by [journal](./journal.md) replay. <!-- id:fGRoe2ad -->
  - **Retry classification**: provider 5xx and network failures are retryable with exponential backoff (base 5s, cap 5min). Validation and config errors fail immediately. `maxAttempts` is 3 (`AGENT_RUN_MAX_ATTEMPTS`) for background agent runs: trigger firings, agent-started sessions, delegated model children. It is 1 for interactive turns, which have a person waiting, and for script runs, which resume from their journal and never restart. <!-- id:it4z5p55 -->
  - **Parking**: a run [parks](./park.md) for one of four reasons: its children; a timer (`ctx.sleep` of 60s or more parks with `not_before`, and the dispatcher's 1-second interval wakes due timers); an event (`ctx.waitForEvent`, woken by a `SignalRun`, a trigger `wake` continuation, an activity event, or its timeout); or a budget pause a person resumes. Parked runs hold no resources. <!-- id:wYXSdipo -->
  - **Planner statistics**: every open runs `ANALYZE` on the small planner tables and sets the WAL, cache, and mmap pragmas; see [persistence](./persistence.md). Nothing runs `VACUUM`. <!-- id:bGD8yhPc -->
  - **Leases** are recorded for 60 seconds on claim but not enforced: with one service process, the boot sweep requeues every run the previous process left claimed or running. <!-- id:YD2c9GyO -->
  - Tests and shutdown wait for the queue via `Service.drainTriggerSessions()`. `awaitQueueIdle()` is an alias for it under the name the runs feature documents. <!-- id:TebiC9QK -->

[Script](./script.md) execution bounds (see `apps/src/workflow-host.ts`): QuickJS-WASM realm per run, 64 MiB memory cap, 2s pure-compute fuel between awaits, 256 KiB source cap, and journal caps of 5,000 entries / 8 MiB per run (`WORKFLOW_JOURNAL_MAX_ENTRIES` / `WORKFLOW_JOURNAL_MAX_BYTES` in `api-service.ts`). A long-lived loop escapes the journal cap with [`ctx.continueAsNew`](./continue-as-new.md), which ends the run and starts a successor carrying only the declared state. <!-- id:4CrPGBii -->

# Model-gate harness (record and replay) <!-- id:igk3vJ3Z -->

<!-- id:KG9dahM9 -->
> **The cassettes are stale and the replay gate is currently skipping.** `apps/e2e/recordings/STALE.md` records why: <!-- id:wGkVe2-l -->
> every cassette was recorded against the pre-harness tool surface (`sub_session`, `run_workflow`, `update_plan`, <!-- id:-ODKf326 -->
> `memory_*`, `execute_code`), and the verb collapse changed both the tool names and the system prompt, so every replay <!-- id:Oaw4aeTS -->
> fingerprint is invalid. While that file exists, `bun e2e/run.ts` prints `recordings are STALE … skipping replay`, <!-- id:x9OWGhJO -->
> reports `0 pass, 0 fail (skipped)`, and exits 0. That keeps `src/e2e-replay.test.ts` green **without pretending** <!-- id:9PoXBYXl -->
> coverage exists**. Do not read a passing `bun test` as evidence that these gates ran. Restoring them means** <!-- id:2DGOlIWz -->
> re-recording (below), verifying every scenario, then deleting `STALE.md` and any cassette the re-record did not <!-- id:4bl5Ybnn -->
> overwrite. <!-- id:JHraQnEw -->

`apps/e2e/run.ts` drives the real Service through six behavioral gates. By default it **replays** recorded gpt-5-mini responses from `apps/e2e/recordings/`: full service and tool loop, no network, no API key. `apps/src/e2e-replay.test.ts` runs that replay as part of the regular `bun test` suite. Pass `--record` to hit the live OpenAI API and refresh the cassettes. That spends real tokens, so run it manually and never in CI: <!-- id:PaO3tHE2 -->

```bash <!-- id:uOMnss2O -->
cd apps && bun e2e/run.ts all              # replay all scenarios from recordings (offline)
bun e2e/run.ts wf-hello --record             # re-record one scenario live (needs OPENAI_API_KEY)
```

Recording proxies provider traffic through a local server that captures each response keyed by a request fingerprint (model + system-prompt head + last user message + tool names + tool-result count). Replay matches the same fingerprints, so cassettes survive tool-description edits but need re-recording when system prompts or conversation flow change. Only a passing run overwrites a scenario's cassette. The live key comes from `OPENAI_API_KEY` or the repo-root `.keys` file (never committed). Every scenario asserts on durable state (runs, journals, session events) and dumps full transcripts to `apps/e2e-artifacts/<timestamp>/` for prompt autopsies. Scenarios: `chat-smoke`, `sub-basic`, `sub-typed`, `sub-restraint`, `wf-hello`, `todo-adoption`. <!-- id:sqsL6jBF -->

Status: the cassettes on disk were last recorded from live gpt-5-mini before the verb collapse and are now stale (see the note at the top of this section). The scenario code itself still exercises the current Service. The last live recording pass found and fixed three real-model defects: top-level-array output schemas now rejected at spawn time with a self-correctable message, `functions.`-prefixed tool names normalized in scripts' `ctx.call`, and the standard `minItems`/`maxItems`/`maxLength`/`maximum` keywords added to the schema subset. <!-- id:iuku-qNG -->

# Live gate (real server, real model) <!-- id:W2IDueL_ -->

`apps/e2e/live-gate.ts` is the other half. It is a pure client that signs envelopes with the desktop daemon's key over grpc-web, exactly as the desktop app does, and talks CBOR to an already-running server. So it gates the server an operator actually uses, and not an in-process Service. It creates a throwaway `NightGate` agent mirroring an existing agent's provider/model/tools, runs the scenarios, writes full transcripts to an artifact directory, and deletes the agent again. <!-- id:09iIG175 -->

```bash <!-- id:JWUffEVV -->
cd apps
bun e2e/live-gate.ts                                  # every scenario against http://localhost:3051
bun e2e/live-gate.ts trivial memory                   # a subset
bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
```

Flags: `--base` (app environment), `--daemon` (Seed daemon grpc-web, default `http://localhost:56001`), `--account` (uid to sign as), `--provider` / `--model`, `--like` (agent id to mirror), `--out`, `--timeout` (per-scenario ms, default 600000), `--keep` (leave the NightGate agent behind). <!-- id:2tWMRgpD -->

Scenarios: `trivial` (restraint plus self-naming: arithmetic must be answered directly, with no delegation, and the session still ends up model-titled), `memory` (a fact written to `~/memory` in one session, read back by a second), `parallel-delegate`, `script-parallel`, `script-narration`. Enforced checks are deterministic properties. Model behavior is reported and not asserted. <!-- id:rTsrR0qu -->

This gate spends real tokens and needs a running server with a working provider. It is never part of `bun test`. <!-- id:oBoXgxg8 -->

Two focused companions live beside it. Both are model-free, so they gate a mechanism and not a model: <!-- id:9vBifZNZ -->
  - `e2e/narration-check.ts` drives the script VM directly (no model, no server, no credentials) and asserts that a `ctx.call(tool, input, {description})` label reaches both the durable journal entry and the tool-call adapter. The UI reads the first, and the run transcript reads the second. <!-- id:UOu6RNcR -->
  - `e2e/obligations-live-check.ts` drives a real server over HTTP with a scripted provider (`e2e/scripted-provider.ts`) through the whole unified-obligations loop: a plan-shaped task, a step left open at turn end, the continuation the runtime hands itself, and the settled checklist afterwards. <!-- id:OTtMuLHc -->

## Simulated-model gates (no API key required) <!-- id:kdX10tm6 -->

When a live gate cannot run, and as a repeatable practice for iterating tool prompts, validation uses **blind simulated-model agents**. A fresh LLM session (a Claude Code subagent) gets ONLY what the runtime model sees (the system prompt plus the registry `description`/`inputSchema` of the tools under test, read from `apps/protocol/src/tool-registry.ts`) and asked to produce its exact assistant turns for scripted scenarios. Its tool calls are then validated mechanically: delegation choices checked against intent, declared output schemas run through `validateJsonSchemaShape`, and authored script source run through `lintWorkflowSource` and executed in the real engine (`runWorkflowVM`) against scripted adapters. The 2026-08-03 pass (against the pre-verb tool names) validated delegation choice (parallel typed fan-out, detached spawning only for fire-and-forget work, no tools at all for trivial input) and script authoring: a \~100-line module that lint-passed and ran correctly, unmodified, first try. The simulators' lists of guessed-at contracts drove the ctx-contract tightening in the tool descriptions and the bare-string `ctx.plan` fix. The simulator must be **blind** for this to be honest: no access to implementation, docs, or tests, only the model-facing prompt surface. <!-- id:fYBpj9CH -->

# Startup behavior <!-- id:AzD4c8yi -->

On startup: <!-- id:UERmMWWo -->
  1. `config.create(config.parseArgs())` builds config. <!-- id:karVPX4S -->
  2. `sqlite.open(cfg.dbPath)` validates or initializes the DB. <!-- id:0WgOMLsF -->
  3. If schema is valid, `Service` (which boot-sweeps the run queue), the activity trigger monitor, and the schedule trigger monitor are created, and the Bun server starts. <!-- id:bldAXA78 -->
  4. If the schema is mismatched, the server starts in schema-mismatch mode and returns a JSON error. <!-- id:gQtOx1bh -->

The schema mismatch log includes the stored and expected version. For local throwaway data, delete the SQLite files and restart. <!-- id:_J_gv5T9 -->

# Shutdown behavior <!-- id:6sqQiSsC -->

The service handles `SIGINT` and `SIGTERM`: <!-- id:27DpYHG3 -->
  1. stop repeated shutdown handling; <!-- id:DJIfQ3v4 -->
  2. stop the activity trigger monitor and the schedule monitor; <!-- id:ZjI-8tpm -->
  3. close WebSocket clients with code `1001`; <!-- id:J6207Axe -->
  4. clear client set; <!-- id:sCNZyrwv -->
  5. stop Bun server; <!-- id:aDJ3JZvP -->
  6. drain in-flight background runs, bounded at 5 seconds so one stuck session cannot block shutdown (the HTTP server's own stop is bounded at 3 seconds before it is forced), then stop the run-queue timers; <!-- id:X8QzoNFd -->
  7. close SQLite DB; <!-- id:PpbedZlo -->
  8. exit. <!-- id:bAUcIud1 -->

# CORS <!-- id:zUgG1bJ7 -->

Health and CBOR API routes return permissive CORS headers. Security comes from [signatures](../signature.md) and account authorization. Browser origin plays no part. <!-- id:zx4dahLP -->

# Diagnostics and logs <!-- id:DR_9rULX -->

Logs include IDs, counts, statuses, sizes, timings, trigger sources, and compact activity metadata, on purpose. They never include secrets or full message or session content. <!-- id:sRtUySO2 -->

Logging is leveled (`apps/src/log.ts`, `SEED_AGENTS_LOG_LEVEL` or `--log-level`, default `info`). The per-event hot paths log at `debug` and are silent by default: every WebSocket partial (`publish partial`, `send partial`, `skip partial`) and every no-op activity poll (`Polling feed`, `Feed page received`, `Processing feed events` with nothing new). Measured in production, they were \~90% of \~440k lines/hour. Set the level to `debug` when tracing streaming or trigger delivery. <!-- id:OS2CBsMW -->

Activity trigger diagnostics use: <!-- id:LZjDOFOi -->
  - `[Agents Activity] Polling feed` <!-- id:CzKZDYrP -->
  - `[Agents Activity] Feed page received` <!-- id:mYmN01Cf -->
  - `[Agents Activity] First poll processing events` <!-- id:ovKIXloc -->
  - `[Agents Activity] Processing feed events` <!-- id:Jsb-sz4Q -->
  - `[Agents Activity] Poll failed` <!-- id:gJhHYcPM -->
  - `[Agents Trigger] Skipping activity without stable key` <!-- id:YB8_h-7L -->
  - `[Agents Trigger] Checked activity against trigger` <!-- id:hvBJi4x9 -->
  - `[Agents Trigger] Skipping duplicate trigger firing` <!-- id:eTxjrti2 -->
  - `[Agents Trigger] Skipping run-completed trigger already in this chain` <!-- id:jESnWMeT -->
  - `[Agents Trigger] Fired trigger and created session` <!-- id:rQ4EBAB_ -->
  - `[Agents Trigger] Trigger session run enqueued` <!-- id:x6tcJogd -->
  - `[Agents Trigger] Trigger session dispatch failed` <!-- id:f5n1P8TH -->
  - `[Agents Trigger] Trigger woke a parked run` <!-- id:N6Eb9Kio -->
  - `[Agents Trigger] Trigger fired with no run listening` <!-- id:PRUZg7PL -->
  - `[Agents Trigger] Trigger firing failed` <!-- id:oeFTB4Kf -->

Run, runtime, and script diagnostics: <!-- id:0OVrLoWY -->
  - `[agents/runs] boot sweep requeued interrupted runs` <!-- id:eh_YCZuP -->
  - `[agents/outbox] boot sweep settled effects a dead process left running`
  - `[agents/runs] dispatch paused` / `[agents/runs] dispatch resumed`
  - `[agents/runtime] tool call answered from its receipt` / `tool call answered as interrupted` / `recording a tool effect failed`
  - `[agents/runs] boot reconcile: replaying finished child into parked parent` <!-- id:_RsqNClX -->
  - `[agents/boot] step finished` / `[agents/boot] recovery finished` / `[agents/boot] recovery failed`
  - `[agents/runs] activity woke a waiting run` <!-- id:tpFxLg1i -->
  - `[agents/runtime] sending provider request` <!-- id:C2_CfkIS -->
  - `[agents/runtime] ending turn after tool batch` <!-- id:qZT_X9Yq -->
  - `[agents/runtime] sub-session spawned` / `[agents/runtime] sub-session resolved` <!-- id:rrfbE_Wv -->
  - `[agents/runtime] plan step settled from children` <!-- id:dCijbIeI -->
  - `[agents/runtime] agent started session` / `[agents/runtime] agent-started session run failed` <!-- id:gIm1siw2 -->
  - `[agents/runtime] session titled by model` / `[agents/runtime] session title generation failed` <!-- id:dBx3vxUA -->
  - `[agents/workflow] workflow spawned from chat` <!-- id:vnIHKeTj -->
  - `[agents/workflow] continued as new run` <!-- id:fH-VDeMa -->
  - `[agents/workflow] run paused on its time budget` <!-- id:u0b-olQJ -->

Server model execution goes through pi-ai and Pi Durable. Use durable session events (via `GetSession` or the desktop session page), the `[agents/runtime]` run lines, WebSocket partial logs, and mocked tests for runtime diagnosis. A run that picked up a turn left by an earlier process logs `resuming the durable turn an earlier process left unfinished`, and its `agent run finished` line carries `resumed: true`. A session's durable store is plain JSONL inside the `session_durable_files` table: `SELECT CAST(data AS TEXT) FROM session_durable_files WHERE session_id = ? AND file = 'main.jsonl' ORDER BY seq` prints its main file. <!-- id:KNt6k5MM -->

Server WebSocket logs: <!-- id:LFKybXaZ -->
  - `[agents/ws] open` <!-- id:J0oO3TLG -->
  - `[agents/ws] subscribed` <!-- id:0KGebWeE -->
  - `[agents/ws] publish partial` <!-- id:B6N9i06j -->
  - `[agents/ws] send partial` <!-- id:5PXSkCYU -->
  - `[agents/ws] skip partial; no subscription` <!-- id:7eqwzaLy -->
  - `[agents/ws] close` <!-- id:gAExGHP- -->

Desktop WebSocket and UI logs: <!-- id:Fmgbj2nL -->
  - `[agents/ws] connecting` <!-- id:gGhsKMZy -->
  - `[agents/ws] open; signing subscribe` <!-- id:rrl_HVjS -->
  - `[agents/ws] subscribe sent` <!-- id:-01o8fj- -->
  - `[agents/ws] subscribed event` <!-- id:clsDqaZw -->
  - `[agents/ws] partial event` <!-- id:mGlEgw9h -->
  - `[agents/ws] partial state updated` <!-- id:jPWPhKjw -->
  - `[agents/ws] partial marked done; keeping visible until durable append` <!-- id:qJve8KM3 -->
  - `[agents/ui] sending session message` <!-- id:kDAKLiRi -->
  - `[agents/ui] rendering streaming assistant partial` <!-- id:LA86XvUl -->

## Is the server stalled

Everything on this server runs on one thread: HTTP, WebSockets, every SQLite statement, trigger evaluation and the agent runs themselves. When that thread is busy, `/api/health` is late or never answers, Caddy logs dial timeouts, and the provider and tool spans in `/api/perf` look normal because nothing reaches them. Three things make that visible without a profiler:

  - **`loop.lag` in `GET /api/perf`** — a 100 ms timer records how late it fires. `p50`, `p95` and `max` cover the last minute (`windowMs`); `maxSinceStart` keeps the worst stall since boot so a spike that already passed is still visible. A healthy server shows single-digit milliseconds. The same snapshot carries `api.<ActionName>` (wall time of every signed action, by name), `sql.<keyword>` (time inside every prepared statement, by its first keyword) and the `sql.slow` counter, so "slow, and where" is one curl: `curl -s http://127.0.0.1:3050/api/perf | jq '.loop, (.metrics | with_entries(select(.key | startswith("api.") or startswith("sql."))))'`.
  - **`GET /api/health` is 503** with `{status: 'unhealthy', reason: 'loop-lag', p95}` while the p95 lag over the last minute exceeds 250 ms (`LOOP_LAG_UNHEALTHY_P95_MS` in `apps/src/perf.ts`); a healthy answer still carries `loop.lag` with the current numbers. The image's `HEALTHCHECK` fetches it every 30 s with a 5 s timeout and three retries, so a stalled server shows as `unhealthy` in `docker ps` and to Watchtower instead of "Up".
  - **`[agents/sql] slow statement`** at `warn`: any prepared-statement call over 20 ms logs its duration, first keyword and the first 200 characters of the SQL (never the bindings), at most three lines per statement per minute, with the number of suppressed repeats on the next line.

When the lag is high and nothing above names the cause, sample the thread with the inspector. The container must have been started with the inspector listening on its own port (override the command to `bun --inspect=127.0.0.1:9230 run --no-install main.js`; the inspector is unauthenticated, so never bind it to a public interface), and the session id is in the startup log: `docker logs agents-stable | grep ws://`. The protocol is WebKit's: `ScriptProfiler.startTracking {includeSamples: true}`, wait, `ScriptProfiler.stopTracking`; the samples arrive in the `ScriptProfiler.trackingComplete` event as `samples.stackTraces[].stackFrames` with `sourceID`, `line` and `column`. A \~40-line script that opens the WebSocket, sends those two commands, and counts the top frame of every sample is enough: `docker exec agents-stable bun /tmp/prof2.js ws://127.0.0.1:9230/<id> 15` samples for 15 s and prints the hottest frames. The bundle is minified, so map each `line:column` back into `/app/main.js` (`sed -n '<line>p' /app/main.js | cut -c<column-40>-<column+80>`) to read the function that was running; the 2026-11-03 outage was found this way in under a minute once the recipe existed.

## Is code execution working

Code execution can break while everything else stays green. From 2026-11-07 to 2026-11-09 every new sandbox on `agents-stable` aborted at boot (msb 0.6.8 crashed once its sandbox id passed 65,535), so every `execute` and lambda tool failed for 55 hours while `/api/health` answered 200: health does not boot a sandbox, and the warm pool kept serving VMs that were already running.

  - **The exec canary** (`SEED_AGENTS_EXEC_CANARY_SECS`, `300` on the hosted servers) boots a brand-new sandbox on that interval, runs `echo` in it and tears it down. It never takes a warm VM and it skips the host-wide concurrency cap, so neither the pool nor a busy host can hide a broken runtime. Its scratch workspace is a fresh directory under `<data dir>/exec-probe`, never an agent's memory. The first failure and the recovery are logged as `[Exec Canary] Sandbox probe failed` and `recovered`.
  - **`/api/health`** carries `execCanary: {ok, lastRunAt, consecutiveFailures}` (null when the canary is off). It never turns health 503, since a restart does not fix a broken sandbox runtime.
  - **`GET /api/metrics`** exposes `seed_agents_exec_canary_up`, `seed_agents_exec_canary_consecutive_failures`, `seed_agents_exec_canary_last_run_timestamp_seconds` and `_last_success_timestamp_seconds`, next to `seed_agents_events_total{event}` (every `/api/perf` counter, including `exec.boot_failed` and the run outcomes `run.succeeded`, `run.failed`, `run.canceled`), `seed_agents_span_total{span}`, `seed_agents_span_p95_milliseconds{span}` and the loop-lag gauges.

On the hosted servers, Grafana Alloy on the agents host scrapes `/api/metrics` for stable, staging and dev every minute, and Grafana alert rules page the ops Discord channel. Both live in SeedInfra: the scrape in `seed_infra/agentic/config/monitoring/agents.alloy`, the rules in `seed_infra/monitoring` (sandbox canary failing, canary not running, metrics missing, sandbox boots failing, run failure rate, event loop stalled, and the agents host's own liveness, disk and memory).

When the canary fails, `docker logs agents-stable 2>&1 | grep -A3 'Exec Canary'` has the boot error, and `msb logs --source system <sandbox>` inside the container has the runtime's side.

# Troubleshooting <!-- id:QDNGqfkn -->

## Desktop says server offline <!-- id:kZ2mzvXq -->

Check (`3051` in the dev shell, `3050` for a release or packaged build): <!-- id:sSDnBlHJ -->

```bash <!-- id:IQWdeZq8 -->
curl http://localhost:3051/agents/api/health
```

Start the server: <!-- id:5MRKd6bI -->

```bash <!-- id:OEloZ6RG -->
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

## WebSocket subscription says `Invalid signature` <!-- id:ivCBxbZ- -->

Likely causes: <!-- id:3kFIP4ug -->
  - desktop and server protocol mismatch; <!-- id:_A9gV4bK -->
  - the signed action contains values that encode differently before and after decode; <!-- id:wSv7HCO_ -->
  - explicit `undefined` fields were sent. <!-- id:cGvB3HF1 -->

Desktop signing omits `undefined` recursively before signing. If the error comes back, inspect `signAgentAction()` in `frontend/packages/ui/src/agents/client.ts` and server `auth.verifyEnvelope()`. <!-- id:nS1GjGqf -->

## No live streaming appears <!-- id:3rMq20wP -->

Follow the log chain: <!-- id:y_nHvnuv -->
  1. Desktop should show `[agents/ws] subscribed event` for `sessions/<sessionId>`. <!-- id:D8kYyYQL -->
  2. The session should be set to `streaming` after `MessageSession`. <!-- id:TdzBvw7L -->
  3. Server should then show `[agents/ws] publish partial` and `[agents/ws] send partial` when the harness commits streamed text. <!-- id:_ipbPc0H -->
  4. Desktop should show `[agents/ws] partial event` and `[agents/ui] rendering streaming assistant partial`. <!-- id:NzvqNL8D -->
  5. The final assistant message should appear as a durable event in the desktop session page after refresh. <!-- id:CT2Cuh_P -->

If the server shows `skip partial; no subscription`, the desktop subscribed too late or to a different key or account. See [troubleshooting](./troubleshooting.md) for more cases. <!-- id:2mhtmv0Z -->

## API key save fails <!-- id:IvcjRCR4 -->

The desktop refuses to send API keys to non-local plain HTTP servers. Use HTTPS for remote servers or local loopback for development. <!-- id:ojyB0F90 -->

## Schema mismatch <!-- id:JK1aCBM5 -->

For local reset: <!-- id:_OOGhGRY -->

```bash <!-- id:oFthHqMs -->
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Do not do this for persistent or shared data. <!-- id:ratUv9Ve -->

# Logging safety <!-- id:m2vIrzlQ -->

Do not add logs that include: <!-- id:ltN5wXmx -->
  - plaintext secrets; <!-- id:y5ZHGjET -->
  - decrypted API keys; <!-- id:c_eEjEjn -->
  - signed request bodies; <!-- id:m0iuHrnW -->
  - full model request or response bodies; <!-- id:PqYvNucC -->
  - full session messages; <!-- id:w74VDOkI -->
  - large tool outputs. <!-- id:uNVtqLqH -->

Prefer logging IDs, lengths, counts, timings, statuses, and booleans. <!-- id:xoQNhH3- -->

# See also <!-- id:85Xsnm2p -->

- [Environments](./environments.md) <!-- id:k6WXAFXI -->
- [Troubleshooting](./troubleshooting.md) <!-- id:YQRv7sXK -->
- [Model providers](./model-providers.md) <!-- id:eNyxr7eP -->
- [Persistence](./persistence.md) <!-- id:8R5_7G8N -->
- [Security](./security.md) <!-- id:0j_VOCY5 -->
- [App environment](../apps/app-environment.md) <!-- id:LI0oZSsG -->
- [Self-hosting](../build/self-hosting.md) <!-- id:RFwTlWLB -->
