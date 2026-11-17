---
name: Deploying an app environment
summary: How the app environment image is built, versioned and pushed, and how a pushed image reaches the hosted servers or your own.
---
The [app environment](../software/app-environment.md) ships as one Docker image built from `apps/Dockerfile`. This page covers what the image holds, how it records its version, the workflows that build and push it, and how a pushed image is rolled out. [Environments](./environments.md) lists where the image runs, and [configuration](./configuration.md) lists its settings.

# The image

Build the deployment image from the repo root: <!-- id:UjHaLIjM -->

```bash <!-- id:-i1uRyfu -->
docker build -t seedhypermedia/apps:dev . -f ./apps/Dockerfile
```

Run the image with persistent state mounted at `/data`: <!-- id:sY0rShW2 -->

```bash <!-- id:jq6Wn7cW -->
docker run --rm -p 3050:3050 -v seed-agents-data:/data seedhypermedia/apps:dev
```

The image sets `SEED_APPS_DB_PATH=/data/agents.sqlite` and `SEED_APPS_DATA_DIR=/data`, declares `/data` as a volume, and listens on port `3050`. Its `HEALTHCHECK` fetches `/api/health` every 30 seconds with a 5 second timeout, three retries and a ten-minute start period, so a stalled server shows as `unhealthy` in `docker ps` and a slow cold boot is not counted against it. See [endpoints and health](./endpoints-and-health.md).

The image is published under two names, `seedhypermedia/apps` and `seedhypermedia/agents`. CI pushes every tag to both. The hosted servers and the [self-hosting](./self-hosting.md) compose files pull `seedhypermedia/agents`.

The microsandbox runtime cannot be bundled (native binding + `msb` + libkrunfw). So `microsandbox` is `external` in the server bundle (`build.ts`), and the Dockerfile stages the package, plus its linux platform package, into `/app/node_modules` next to `main.js` (`scripts/stage-msb-runtime.ts`). This is the same layout `build-binary.ts` ships beside the desktop binary. The image build runs `--exec-selfcheck`, so a staging regression fails the build and never shows up as `codeExec: false` on the servers. Everything else the runtime needs travels inside the bundle, including `mermaid` and the `linkedom` DOM shim behind the mermaid check on document writes (`src/mermaid-parser.ts`, which imports them by literal specifier where the client package deliberately does not); the same selfcheck parses a diagram so a bundling regression fails the build rather than every write that carries one. With `/dev/kvm` plumbed and the msb cache volumes mounted, executions run in-container. `/api/health` reports the probe result either way. See the [code execution backend](./code-execution-backend.md). <!-- id:LLspUN31 -->

# Version metadata

The image records what it was built from and exposes it at runtime. `/api/version` (and `/agents/api/version`) returns: <!-- id:KRJqFMwI -->

```json <!-- id:7QqXMmsN -->
{"version": "<image tag>", "commit": "<sha>", "branch": "<ref>", "date": "<date>"}
```

The `commit`, `branch`, and `date` fields mirror the [daemon](../software/daemon.md) `/debug/version` and [web](../software/web.md) `/hm/api/version` shape. `version` (the image tag) is specific to agents. `/api/health` also includes the `version` field for quick checks. To see what a host is running: <!-- id:YpXAAaEN -->

```bash <!-- id:T46AIml8 -->
curl -s https://hyper.media/hm/api/apps/version
```

The values come from `apps/src/build-info.ts`, populated by Docker build args (`VERSION`, `COMMIT_HASH`, `BRANCH`, `DATE`; the web and daemon images use the same `COMMIT_HASH`, `BRANCH`, and `DATE` names). `apps/Dockerfile` maps them to namespaced `SEED_APPS_*` runtime `ENV`. Without build args (for example local `bun dev` or a plain `docker build`) they fall back to `dev` or `unknown`. <!-- id:3EKhBIqX -->

# CI build and push <!-- id:TT-1OVn2 -->

`apps/Dockerfile` is built and pushed by three GitHub Actions workflows, all of which also accept a manual `workflow_dispatch` run from the Actions tab: <!-- id:9ag8Sj9F -->
  - `.github/workflows/release-docker-images.yml`: on a `*.*.*` release tag push (or manual dispatch), pushes `seedhypermedia/apps:<tag>` and `seedhypermedia/agents:<tag>`. The resolved tag is the version (`latest` for a manual run with no tag). `agents-stable` on the production host tracks `:latest`. <!-- id:dqZxrWX0 -->
  - `.github/workflows/dev-docker-images.yml`: on push to `main` touching `apps/**` (or manual dispatch), pushes the `:dev` tag under both names, which **both** `agents-staging` and `agents-dev` track. While this workflow is red on `main`, `:dev` stops moving, and staging silently keeps validating an older commit than the one you are about to release. `/api/version` on staging is the check that catches it. <!-- id:-c40zu4a -->
  - `.github/workflows/hotfix-agents-image.yml`: manual dispatch only, from `main` only. Runs the app environment test gate and pushes ONLY the `:latest` tag, under both names. Use this to hotfix the production app environment without cutting a full release of every image. <!-- id:i8GnJuWs -->

# Manual build and push from a workstation <!-- id:g7mprK3Z -->

To build and push an image yourself with correct version metadata baked in: <!-- id:t63K_Lee -->

```bash <!-- id:XeudkRfN -->
apps/scripts/build-and-push.sh dev      # or: latest
```

It stamps the current git `HEAD` (commit, branch, date) into the image and pushes `seedhypermedia/apps:<tag>`. It pushes that one name only. A host that pulls `seedhypermedia/agents` does not see the push until the same image is tagged and pushed under that name too. <!-- id:zH3oxaoU -->

# Rolling out on the hosted servers <!-- id:q7ez6eeh -->

The hosted servers are listed in [environments](./environments.md#4-hosted-remotes-production-staging-and-dev). Each host runs `/opt/sae/docker-compose.yml`, and Watchtower pulls new images there.

Staging is the release gate: same code as dev, real mainnet data. Before cutting a release, land on `main`, wait for `:dev` to deploy, exercise `https://staging.hyper.media/hm/api/apps` (served by `staging.apps.seed.hyper.media`), then tag. See [environments](./environments.md) for the full picture, including why each container needs its own data volume. <!-- id:4aRdm50_ -->

Watchtower (`nickfedor/watchtower:1.18.1`, label-enabled, 5-minute interval) auto-pulls the labeled containers. After pushing a new image it deploys within the poll interval, or force it immediately: <!-- id:hwGCsVgy -->

```bash <!-- id:J4Y3ksRe -->
# Force an update now, with compose (the reliable way). Production:
ssh ubuntu@apps.seed.hyper.media \
  'cd /opt/sae && docker compose pull agents-stable && docker compose up -d'

# Staging and dev share a host:
ssh ubuntu@staging.apps.seed.hyper.media \
  'cd /opt/sae && docker compose pull agents-staging agents-dev && docker compose up -d'

# Or a one-shot Watchtower. Note: only works when the resident Watchtower is stopped: it treats a
# second instance as an "excess Watchtower container" and SIGTERMs it mid-run.
ssh ubuntu@apps.seed.hyper.media \
  'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'
```

Watchtower reads `com.centurylinklabs.watchtower.enable` off the **running container**, so editing that label in the compose file changes nothing until `docker compose up -d <service>` recreates the container. That is the knob for temporarily pinning a deployment. It does not stop `bootstrap.sh`, whose `docker compose pull` will still move a pinned container on the next Terraform apply. <!-- id:adholITo -->

Make sure the Watchtower container itself has `restart: unless-stopped`. A crashed auto-updater silently stops all deploys, and so does a _stopped_ one: `docker stop` on a container with that policy stays stopped across reboots.

The compose file and the Caddyfile under `/opt/sae` are rendered by `seed_infra/agentic/sae.tf` in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`) and pushed over SSH by Terraform. Edits made directly on a host survive until the next apply and then vanish. Mirror anything you change there back into the Terraform file.

# Rolling out on your own server

A site installed with the deploy script follows its release channel by cron, and its `seed-agents` container moves with the rest of the node; see [self-hosting](./self-hosting.md#day-to-day). A server started by hand is updated with `docker pull` and a restart, or by Watchtower as on the hosted servers; see [self-hosting an app environment](./self-hosted-app-environment.md).

# See also

- [Environments](./environments.md), where the image runs
- [Configuration](./configuration.md), every setting
- [Endpoints and health](./endpoints-and-health.md), the health and version endpoints a rollout is checked with
- [Releasing](../contribute/releasing.md), how a release tag is cut
- [Testing the app environment](../contribute/testing-the-app-environment.md), the gates that run before an image is pushed
