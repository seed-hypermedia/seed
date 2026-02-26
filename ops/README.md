# Seed Node Deployment

Self-hosted deployment system for Seed nodes. A single script handles
first-time setup, configuration, container orchestration, backups,
and automatic updates.

## Quick Start

```sh
curl -fsSL https://raw.githubusercontent.com/seed-hypermedia/seed/main/ops/deploy.sh | sh
```

The bootstrap script installs Docker and Bun (if missing), downloads the
deployment engine, and launches an interactive wizard to configure your
node. After setup you manage everything through the `seed-deploy` CLI.

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

| File                 | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `deploy.sh`          | One-line bootstrap installer             |
| `deploy.ts`          | Deployment engine source (TypeScript)    |
| `deploy.test.ts`     | Test suite (115 tests, 257 assertions)   |
| `dist/deploy.js`     | Committed production bundle (Bun target) |
| `docker-compose.yml` | Docker Compose service definitions       |

## Modes of Operation

### 1. Interactive Wizard (first run)

When no `config.json` exists, the script launches a terminal wizard:

1. **Public hostname** — the `https://` URL for the node (required)
2. **Environment** — Production / Staging / Development
3. **Log level** — Debug / Info / Warn / Error
4. **Gateway mode** — whether the node serves all known public content
5. **Analytics** — enable Plausible.io traffic dashboard
6. **Contact email** — optional, for security update notifications

The wizard also detects legacy installations (from `website_deployment.sh`)
and offers a migration path, pre-filling values from the old config.

### 2. Headless Deploy (subsequent runs)

When `config.json` exists, the script runs without prompts:

1. Self-updates `deploy.js` from the upstream repo (cron only)
2. Fetches `docker-compose.yml` and compares SHA-256 with the stored hash
3. If nothing changed and all containers are healthy, skips redeployment
4. Otherwise: pulls images first (while old containers serve traffic),
   then recreates containers from cache — minimizes downtime
5. Prunes unused Docker images after successful deploy

### 3. Reconfiguration

```sh
seed-deploy deploy --reconfigure
```

Re-runs the wizard with current values shown as placeholders. Press Tab
to keep a value, type to change it, or press Enter to clear optional
fields. Changed fields are marked with a pencil icon in the summary.

## CLI Reference

```
seed-deploy [command] [options]
```

| Command          | Description                                                |
| ---------------- | ---------------------------------------------------------- |
| `deploy`         | Deploy or update the node (default when no command given)  |
| `stop`           | Stop and remove all containers                             |
| `start`          | Start containers without re-deploying                      |
| `restart`        | Restart all containers                                     |
| `status`         | Show health, versions, connectivity, disk, and cron status |
| `config`         | Print current configuration (secrets redacted)             |
| `logs [service]` | Tail container logs (`daemon`, `web`, or `proxy`)          |
| `cron [remove]`  | Install or remove automatic update cron jobs               |
| `backup [path]`  | Create a portable backup of all node data                  |
| `restore <file>` | Restore node data from a backup archive                    |
| `uninstall`      | Remove all containers, data, and configuration             |

| Option            | Description                                     |
| ----------------- | ----------------------------------------------- |
| `--reconfigure`   | Re-run the setup wizard to change configuration |
| `-h`, `--help`    | Show help message                               |
| `-v`, `--version` | Show script version                             |

## Environment Presets

A single "Environment" choice controls multiple settings:

| Environment     | Image Tag | Network | Use Case                                    |
| --------------- | --------- | ------- | ------------------------------------------- |
| **Production**  | `latest`  | Mainnet | Stable releases (recommended)               |
| **Staging**     | `dev`     | Mainnet | Testing development builds on real network  |
| **Development** | `dev`     | Testnet | Development builds on isolated test network |

## Configuration

Stored at `<seed-dir>/config.json`. User-facing fields:

| Field         | Required | Description                              |
| ------------- | -------- | ---------------------------------------- |
| `domain`      | Yes      | Public hostname including `https://`     |
| `email`       | No       | Contact email for security notifications |
| `environment` | Yes      | `prod`, `staging`, or `dev`              |
| `gateway`     | Yes      | Serve all known public content           |
| `analytics`   | Yes      | Enable Plausible.io web analytics        |

Internal fields (managed by the script): `compose_url`, `compose_sha`,
`compose_envs`, `release_channel`, `testnet`, `link_secret`,
`last_script_run`.

## Docker Services

Three core containers, plus optional metrics:

| Container     | Image                 | Ports            | Purpose                         |
| ------------- | --------------------- | ---------------- | ------------------------------- |
| `seed-proxy`  | `caddy:2`             | 80, 443, 443/udp | Reverse proxy + auto TLS        |
| `seed-web`    | `seedhypermedia/web`  | 3000             | Web frontend                    |
| `seed-daemon` | `seedhypermedia/site` | 56000, 56000/udp | P2P daemon + API                |
| `prometheus`  | `prom/prometheus`     | —                | Metrics (profile: `metrics`)    |
| `grafana`     | `grafana/grafana`     | —                | Dashboards (profile: `metrics`) |

All containers run as the host user (`SEED_UID:SEED_GID`) — no root inside
containers. All bind mounts use the `:z` flag for SELinux compatibility.

## Automatic Updates

The cron system installs two jobs:

| Schedule          | Task                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **02:00 daily**   | Run `deploy.js` — self-updates the script, pulls new images, recreates containers if changed |
| **Every 4 hours** | `docker image prune -a -f --filter "until=1h"` — removes unused images older than 1 hour     |

Install with `seed-deploy cron`, remove with `seed-deploy cron remove`.

## Backup & Restore

**Backup** creates a `.tar.gz` containing `config.json`, `docker-compose.yml`,
and the `web/`, `daemon/`, and `proxy/` data directories. Containers are
stopped during backup for data consistency and restarted after.

```sh
seed-deploy backup                     # default: <seed-dir>/backups/
seed-deploy backup /tmp/my-backup.tgz  # custom path
```

**Restore** extracts a backup archive, optionally lets you edit the
configuration via the wizard, restores cron jobs, and runs a full deploy.

```sh
seed-deploy restore /path/to/backup.tar.gz
```

## Edge Cases Handled

- **glibc < 2.25** — `deploy.sh` checks glibc version before attempting
  Bun install. Prints supported OS versions and exits cleanly.
- **SELinux** — all Docker bind mounts use `:z` flag. Without it,
  Fedora/CentOS/RHEL silently block container access to host files.
- **Legacy installations** — detects old `website_deployment.sh` containers
  (`docker run`-based). Stops and removes them before first
  `docker compose up` to avoid name conflicts.
- **Non-root operation** — containers run as the host user. Caddy binds
  ports 80/443 via `CAP_NET_BIND_SERVICE` file capability. `sudo` is
  only used when creating directories outside the user's home.
- **Disk exhaustion** — old Docker images are pruned both inline after
  deploys and on a 4-hour cron schedule.
- **No-change deploys** — skipped entirely when compose SHA matches and
  all containers are healthy. Shows a hint for `--reconfigure`.
- **Self-update** — in headless mode, the script fetches its own latest
  version before deploying. Takes effect on the next run.
- **rsync non-fatal** — the daemon's monitoring config export uses
  `rsync -rlt` (no owner/group) and wraps failures as warnings to avoid
  blocking the daemon start.

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
bun run build        # bundle to dist/deploy.js
```

The `dist/deploy.js` bundle is committed to the repo. A CI workflow
verifies the bundle matches the source on every push to `ops/`.
