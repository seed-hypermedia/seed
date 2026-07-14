# Seed Node Deployment

Self-hosted deployment system for Seed nodes. A single script handles first-time setup, configuration, container
orchestration, backups, and automatic updates.

## Quick Start

```sh
curl -fsSL https://deploy.seed.hyper.media | sh
```

The bootstrap script installs Docker and Bun (if missing), downloads the deployment engine, and launches an interactive
wizard to configure your node. After setup you manage everything through the `seed-deploy` CLI.

## Architecture

```
deploy.sh          Minimal bootstrap — installs Docker + Bun, downloads deploy.js
  |
  v
deploy.ts          Main deployment engine (bundled to dist/deploy.js)
  |                  - Interactive wizard (first run)
  |                  - Headless deploy (subsequent runs / cron)
  |                  - Full CLI for node management
  v
docker-compose.yml Container definitions for proxy, web, and daemon
```

### Files

| File                 | Purpose                               |
| -------------------- | ------------------------------------- |
| `deploy.sh`          | One-line bootstrap installer          |
| `deploy.ts`          | Deployment engine source (TypeScript) |
| `deploy.test.ts`     | Test suite                            |
| `docker-compose.yml` | Docker Compose service definitions    |

## Building & Releasing

`deploy.ts` is the source; servers run the bundled `dist/deploy.js`. **`dist/deploy.js` _is_ committed** (unlike a
typical build artifact) so the raw-GitHub fallback URL always resolves.

> **Tool vs. data.** The deploy **script** (the tool) installs once at a fixed path — **`/usr/local/lib/seed/deploy.js`**
> — and self-updates in place. A node's **data/config** lives in its own dir (default `/opt/seed`), selected with
> **`--dir <path>`**. One script manages any node; the wrapper and cron always pass `--dir`. This is what keeps a single
> always-current script instead of a stale copy in every data dir. (Legacy installs that placed the script inside the
> data dir keep working; re-run the bootstrap once to move to the fixed path.)

**How the bundle stays in sync and reaches servers:**

1. **Pre-commit hook** (`.git/hooks/pre-commit`) — whenever `ops/` source is staged, it rebuilds `dist/deploy.js` with
   the pinned **Bun 1.3.10** and re-stages it. So a commit can never ship a stale bundle. (Build manually with
   `bun run build` in `ops/`.)
2. **CI — `.github/workflows/check-deploy-script.yml`** ("Deploy Script - Check & Build") on every PR and `ops/**` push:
   typecheck → test → build → **fail if `dist/deploy.js` is not up to date** → upload a `deploy-script` artifact.
3. **Dev channel publish — `dev-docker-images.yml` › `publish-deploy-script`** (on push to `main`): uploads the built
   `deploy.js` to **S3 `s3://seedappdev/dev/latest/deploy.js`**.
4. **Prod/release — `release-docker-images.yml`** (on a `*.*.*` tag, or manual run): attaches `deploy.js` as a **GitHub
   Release asset**.

**How a node self-updates (`upgrade`, run by cron every 10 min)** — the deploy **script** always tracks `main`,
**independent of `release_channel`** (`getDeployScriptUrl`). The script is the orchestration tool; a bug fix to it must
reach every node automatically. `release_channel` decides only which **images** run, never which script manages them.

| What                    | Source                                    | Updated by                       |
| ----------------------- | ----------------------------------------- | -------------------------------- |
| `deploy.js` (all nodes) | S3 `dev/latest/deploy.js`                 | **every push to `main`** (step 3)|
| `docker-compose.yml`    | raw `main` `ops/docker-compose.yml`       | every push to `main`             |
| images (`web`/`site`)   | `seedhypermedia/*:${release_channel}`     | CI builds per channel/tag        |

So: **push a `deploy.js` fix to `main` → within ~10 min every node's cron `upgrade` pulls it** — no release, no
channel-switch. (A `SEED_DEPLOY_URL`/`SEED_REPO_URL` env override still redirects the source for testing/branch builds.)

## Modes of Operation

### 1. Interactive Wizard (first run)

When no `config.json` exists, the script launches a terminal wizard:

1. **Public hostname** — the `https://` URL for the node (required)
2. **P2P network** — Mainnet or Testnet (devnet). Independent of the image channel.
3. **Release channel** — Stable (`latest`) or Bleeding edge (`dev`). The **Custom tag** option (branch/test builds)
   appears only with `--advanced`.
4. **Log level** — Debug / Info / Warn / Error
5. **Gateway mode** — whether the node serves all known public content
6. **Contact email** — optional, for security update notifications

Add **`--advanced`** to first pick the **node directory** (create/reconfigure/switch a node) and to enter a **custom
image tag** — see [Multiple nodes / branch testing](#multiple-nodes--branch-testing----advanced) below.

### Multiple nodes / branch testing — `--advanced`

You run one node at a time per host (shared container names), but you can keep several **node directories** — each with
its own config, data, and DB — and switch between them. That's what branch testing needs: a branch's forward DB
migration lives in its own dir, isolated from your main node's DB.

**`--advanced` is the single entry point.** Its first step is the **node directory**:

```sh
seed-deploy --advanced
#  → "Node directory": an existing dir → reconfigure it;  a new/empty dir → create a branch node there
#  → then the normal wizard (network, release channel incl. custom image tag)
#  → deploys it and makes it the live node
```

Switching is the same command: run `seed-deploy --advanced`, pick the other dir. If a different node is live it offers
to **stop it and switch** (its data is kept). The cron and the `seed-deploy` wrapper are re-pointed at whichever node
you last brought up, so `seed-deploy <command>` and the automatic updates always follow the live node.

You never type a directory flag in normal use. (Under the hood the wrapper/cron pass `--dir <data-dir>`; you can pass
`--dir <path>` manually to target another node ad-hoc, but `--advanced` is the intended path.)

`seed-deploy doctor` **warns** when the live containers belong to a *different* directory than the one you're inspecting
— the tell-tale of the two-dirs-on-one-host trap.

The wizard also detects legacy installations (from `website_deployment.sh`) and offers a migration path, pre-filling
values from the old config.

### 2. Headless Deploy (subsequent runs)

When `config.json` exists, the script runs without prompts:

1. Fetches `docker-compose.yml` and compares SHA-256 with the stored hash
2. If nothing changed and all containers are healthy, skips redeployment
3. Otherwise: pulls images first (while old containers serve traffic), then recreates containers from cache — minimizes
   downtime
4. Prunes unused Docker images after successful deploy

### 3. Reconfiguration

```sh
seed-deploy deploy --reconfigure
```

Re-runs the wizard with current values shown as placeholders. Press Tab to keep a value, type to change it, or press
Enter to clear optional fields. Changed fields are marked with a pencil icon in the summary.

## CLI Reference

```
seed-deploy [command] [options]
```

| Command          | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `deploy`         | Deploy or update the node (default when no command given) |
| `upgrade`        | Update the deploy script to the latest version            |
| `stop`           | Stop and remove all containers                            |
| `start`          | Start containers without re-deploying                     |
| `restart`        | Restart all containers                                    |
| `doctor`         | Diagnose health, connectivity, disk, and cron status      |
| `secret`         | Print the site registration secret                        |
| `config`         | Print current configuration (secrets redacted)            |
| `logs [service]` | Tail container logs (`daemon`, `web`, or `proxy`)         |
| `cron [remove]`  | Install or remove automatic update cron jobs              |
| `backup [path]`  | Create a portable backup of all node data                 |
| `restore <file>` | Restore node data from a backup archive                   |
| `uninstall`      | Remove all containers, data, and configuration            |

| Option            | Description                                       |
| ----------------- | ------------------------------------------------- |
| `--reconfigure`   | Re-run the setup wizard for the current node      |
| `--advanced`      | Manage nodes: pick the directory (create/reconfigure/switch), custom tag, etc. |
| `-h`, `--help`    | Show help message                                 |
| `-v`, `--version` | Show script version                               |

## Network and Release Channel (independent)

The **P2P network** (mainnet vs testnet/devnet) and the **release channel** (which Docker image tag to run) are
**orthogonal** — the image channel never changes the network. Each is its own wizard question.

| Choice          | `config.json` field | Options                                                 |
| --------------- | ------------------- | ------------------------------------------------------- |
| P2P network     | `testnet`           | Mainnet (`false`) / Testnet-devnet (`true`)             |
| Release channel | `release_channel`   | `latest` (stable) / `dev` (main branch) / custom tag    |

`environment` (`prod`/`dev`) is a **derived label** kept in sync with `testnet` for display and backwards
compatibility — it does **not** independently control the network. Running a `dev` (or custom) image on **mainnet** is a
legitimate, supported combination (bleeding-edge code, production network); the wizard prints a notice so it is never a
surprise.

### Custom image tags (advanced)

The **Custom tag** channel is for testing a branch build. It appears only under `--advanced`:

```sh
seed-deploy deploy --reconfigure --advanced
```

Choose **Custom tag**, then enter the exact image tag that CI pushed, for example `feature-branch`. Automatic cron
updates keep following the saved tag by pulling `seedhypermedia/web:<tag>` and `seedhypermedia/site:<tag>` on each run.
Docker tags cannot contain `/`; if your branch name contains slashes, use the Docker-safe tag produced by CI.

> A branch build usually needs its **own install directory** (via `--advanced`, e.g. `/opt/seed-mybranch`) so its
> forward DB migration stays isolated from the main node's database. Only **one** seed stack can run per host (the
> container names are fixed), so the branch and main nodes take turns — `deploy`/`start` refuse to clobber a stack owned
> by another install directory.

## Configuration

Stored at `<seed-dir>/config.json`. User-facing fields:

| Field         | Required | Description                              |
| ------------- | -------- | ---------------------------------------- |
| `domain`          | Yes      | Public hostname including `https://`                        |
| `email`           | No       | Contact email for security notifications                    |
| `testnet`         | Yes      | P2P network: `false` = mainnet, `true` = testnet/devnet     |
| `release_channel` | Yes      | Image tag: `latest` / `dev` / custom                        |
| `gateway`         | Yes      | Serve all known public content                              |

`environment` (`prod`/`dev`) is a derived label kept in sync with `testnet`. Internal fields (managed by the script):
`compose_url`, `compose_sha`, `compose_env_sha`, `compose_envs`, `link_secret`, `analytics`, `last_script_run`.

## Docker Services

Three core containers, plus optional metrics:

| Container     | Image                 | Ports            | Purpose                         |
| ------------- | --------------------- | ---------------- | ------------------------------- |
| `seed-proxy`  | `caddy:2`             | 80, 443, 443/udp | Reverse proxy + auto TLS        |
| `seed-web`    | `seedhypermedia/web`  | 3000             | Web frontend                    |
| `seed-daemon` | `seedhypermedia/site` | 56000, 56000/udp | P2P daemon + API                |
| `prometheus`  | `prom/prometheus`     | —                | Metrics (profile: `metrics`)    |
| `grafana`     | `grafana/grafana`     | —                | Dashboards (profile: `metrics`) |

All containers run as the host user (`SEED_UID:SEED_GID`) — no root inside containers. All bind mounts use the `:z` flag
for SELinux compatibility.

## Automatic Updates

The cron system installs two jobs:

| Schedule          | Task                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **02:00 daily**   | Run `deploy.js upgrade` then `deploy.js deploy` — explicit script update, then normal deploy |
| **Every 4 hours** | `docker image prune -a -f --filter "until=1h"` — removes unused images older than 1 hour     |

Install with `seed-deploy cron`, remove with `seed-deploy cron remove`.

## Backup & Restore

**Backup** creates a `.tar.gz` containing `config.json`, `docker-compose.yml`, and the `web/`, `daemon/`, and `proxy/`
data directories. Containers are stopped during backup for data consistency and restarted after.

```sh
seed-deploy backup                     # default: <seed-dir>/backups/
seed-deploy backup /tmp/my-backup.tgz  # custom path
```

**Restore** extracts a backup archive, optionally lets you edit the configuration via the wizard, restores cron jobs,
and runs a full deploy.

```sh
seed-deploy restore /path/to/backup.tar.gz
```

## Edge Cases Handled

- **glibc < 2.25** — `deploy.sh` checks glibc version before attempting Bun install. Prints supported OS versions and
  exits cleanly.
- **SELinux** — all Docker bind mounts use `:z` flag. Without it, Fedora/CentOS/RHEL silently block container access to
  host files.
- **Legacy installations** — every deploy first removes any watchtower-style autoupdater container
  (`containrrr/watchtower`, `v2tec/watchtower`) so it can't race the new compose stack by recreating legacy daemons in
  response to image pulls. It then evicts any non-compose container that publishes one of our ports (80, 443, 3000,
  56000) or carries one of our well-known names (`seed-site`, `seed-daemon`, `seed-web`, `seed-proxy`, `autoupdater`,
  `prometheus`, `grafana`). Containers already managed by our compose project are skipped via the
  `com.docker.compose.project` label, so `--reconfigure` and routine cron re-runs remain a true no-op and rely on
  compose's own zero-downtime swap. Legacy `website_deployment.sh` host crontab entries are stripped during migration so
  they can't relaunch the old daemon out-of-band.
- **Non-root operation** — containers run as the host user. Caddy binds ports 80/443 via `CAP_NET_BIND_SERVICE` file
  capability. `sudo` is only used when creating directories outside the user's home.
- **Disk exhaustion** — old Docker images are pruned both inline after deploys and on a 4-hour cron schedule.
- **No-change deploys** — skipped entirely when compose SHA matches and all containers are healthy. Shows a hint for
  `--reconfigure`.
- **Self-update** — in headless mode, the script fetches its own latest version before deploying. Takes effect on the
  next run.
- **rsync non-fatal** — the daemon's monitoring config export uses `rsync -rlt` (no owner/group) and wraps failures as
  warnings to avoid blocking the daemon start.

## Environment Variables

For testing and development:

| Variable          | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `SEED_DIR`        | Override the seed directory (default: dirname of `deploy.js`) |
| `SEED_DEPLOY_URL` | Override the base URL for fetching compose + deploy.js        |
| `SEED_BRANCH`     | GitHub branch for `deploy.sh` to fetch from (default: `main`) |

Example local testing setup:

```sh
# Terminal 1: serve files locally
cd ops && python3 -m http.server 9999

# Terminal 2: run deploy against local server
SEED_DIR=/tmp/seed-test SEED_DEPLOY_URL=http://localhost:9999 sh ops/deploy.sh
```

## Development

```sh
cd ops
bun install          # install dependencies
bun test             # run test suite
bun run build        # bundle to dist/deploy.js (local testing only)
```

The `dist/deploy.js` bundle is **not** committed to the repo. CI builds it automatically and distributes it:

- **Production releases** (tag push): attached as a GitHub Release asset.
- **Dev releases** (main push / daily): uploaded to S3 alongside dev Docker images.
