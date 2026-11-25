---
name: Deploying an app environment
summary: This page explains how the app environment's Docker image is built, how it records its version, which workflows push it, and how a pushed image reaches the hosted Seed servers or your own server.
---
The [app environment](../software/app-environment.md) is delivered as one Docker image, built from `apps/Dockerfile`. This page covers what the image holds, how it records its version, the workflows that build and push it, and how a pushed image gets onto a server.

The first thing to check after any rollout is the version the server runs: `curl -s <server>/api/version`. If it shows the commit you pushed, the rollout worked.

[Environments](./environments.md) lists where the image runs, and [configuration](./configuration.md) lists its settings.

# The image

Build the deployment image from the repo root: <!-- id:UjHaLIjM -->

```bash <!-- id:-i1uRyfu -->
docker build -t seedhypermedia/apps:dev . -f ./apps/Dockerfile
```

Run the image with persistent state mounted at `/data`: <!-- id:sY0rShW2 -->

```bash <!-- id:jq6Wn7cW -->
docker run --rm -p 3050:3050 -v seed-agents-data:/data seedhypermedia/apps:dev
```

The image sets `SEED_APPS_DB_PATH=/data/agents.sqlite` and `SEED_APPS_DATA_DIR=/data`, declares `/data` as a volume, and listens on port `3050`.

Its `HEALTHCHECK` calls `/api/health` every 30 seconds, with a timeout of 5 seconds, three retries and a start period of ten minutes. So a stalled server shows as `unhealthy` in `docker ps`, and a slow first start does not count against it. See [endpoints and health](./endpoints-and-health.md).

The image is published under two names, `seedhypermedia/apps` and `seedhypermedia/agents`. CI pushes every tag to both. The hosted Seed servers and the [self-hosting](./self-hosting.md) compose files pull `seedhypermedia/agents`.

**What is beside the bundle.** The server's code is one bundled file, `main.js`. The microsandbox runtime cannot go inside it, because it has a native binding, the `msb` helper and libkrunfw. So `microsandbox` is marked `external` in the bundle (`build.ts`). The Dockerfile copies the package, and its Linux platform package, into `/app/node_modules` next to `main.js` (`scripts/stage-msb-runtime.ts`). `build-binary.ts` puts the same layout beside the desktop binary. <!-- id:LLspUN31 -->

**What the image build checks.** The build runs `--exec-selfcheck`. It checks two things, so a mistake fails the build and never reaches a server:

- The sandbox runtime loads. Without this check, a mistake in the copy step would show up only as `codeExec: false` on the servers.
- A mermaid diagram parses. Everything else the server needs is inside the bundle, including `mermaid` and the `linkedom` DOM stand-in that the server uses to check diagrams in [documents](../protocol/documents.md) it writes (`src/mermaid-parser.ts`). Without this check, a bundling mistake would fail every write that carries a diagram.

**What you need at runtime.** With `/dev/kvm` passed to the container and the msb volumes mounted, code runs inside the container. `/api/health` reports whether it can. See the [code execution backend](./code-execution-backend.md).

# Version metadata

The image records what it was built from, and a running server reports it. `/api/version` (and `/agents/api/version`) returns: <!-- id:KRJqFMwI -->

```json <!-- id:7QqXMmsN -->
{"version": "<image tag>", "commit": "<sha>", "branch": "<ref>", "date": "<date>"}
```

`commit`, `branch` and `date` have the same shape as the [daemon](../software/daemon.md)'s `/debug/version` and the [web app](../software/web.md)'s `/hm/api/version`. `version`, the image tag, is only on the app environment. `/api/health` carries the `version` field too. To see what a host runs: <!-- id:YpXAAaEN -->

```bash <!-- id:T46AIml8 -->
curl -s https://hyper.media/hm/api/apps/version
```

The values come from `apps/src/build-info.ts`. Docker build arguments fill them: `VERSION`, `COMMIT_HASH`, `BRANCH` and `DATE`. The web and daemon images use the same names `COMMIT_HASH`, `BRANCH` and `DATE`. `apps/Dockerfile` turns them into `SEED_APPS_*` environment variables. Without build arguments, for example with local `bun dev` or a plain `docker build`, the values are `dev` or `unknown`. <!-- id:3EKhBIqX -->

# CI build and push <!-- id:TT-1OVn2 -->

Three GitHub Actions workflows build and push `apps/Dockerfile`. You can also start each one by hand, with `workflow_dispatch` from the Actions tab: <!-- id:9ag8Sj9F -->
  - `.github/workflows/release-docker-images.yml` runs when a release tag of the form `*.*.*` is pushed. It pushes `seedhypermedia/apps:<tag>` and `seedhypermedia/agents:<tag>`. The tag is the version, or `latest` for a run by hand with no tag. `agents-stable` on the production host follows `:latest`. <!-- id:dqZxrWX0 -->
  - `.github/workflows/dev-docker-images.yml` runs on a push to `main` that touches `apps/**`. It pushes the `:dev` tag under both names. **Both** `agents-staging` and `agents-dev` follow `:dev`. While this workflow fails on `main`, `:dev` stops moving. Staging then keeps testing an older commit than the one you are about to release, and nothing warns you. Check `/api/version` on staging to catch this. <!-- id:-c40zu4a -->
  - `.github/workflows/hotfix-agents-image.yml` runs only by hand, and only from `main`. It runs the app environment's tests and pushes only the `:latest` tag, under both names. Use it to fix the production app environment without a full release of every image. <!-- id:i8GnJuWs -->

# Manual build and push from a workstation <!-- id:g7mprK3Z -->

To build and push an image yourself, with the right version metadata inside: <!-- id:t63K_Lee -->

```bash <!-- id:XeudkRfN -->
apps/scripts/build-and-push.sh dev      # or: latest
```

The script writes the commit, branch and date of the current git `HEAD` into the image and pushes `seedhypermedia/apps:<tag>`. It pushes that one name only. A host that pulls `seedhypermedia/agents` does not see the push until you also tag and push the same image under that name. <!-- id:zH3oxaoU -->

# Rolling out on the hosted servers <!-- id:q7ez6eeh -->

This section describes the servers Seed hosts. Their setup lives in another repository, so this repository cannot confirm it, and it can change. The servers are listed in [environments](./environments.md#4-hosted-remotes-production-staging-and-dev). Each host runs `/opt/sae/docker-compose.yml`, and Watchtower pulls new images there.

Staging is the last check before a release: the same code as dev, on real mainnet data. Before you make a release: <!-- id:4aRdm50_ -->

1. Merge the change to `main`.
2. Wait until `:dev` is deployed. `/api/version` on staging shows the commit.
3. Try the change on `https://staging.hyper.media/hm/api/apps`, which `staging.apps.seed.hyper.media` serves.
4. Push the release tag.

[Environments](./environments.md) has the full picture, including why each container needs its own data volume.

Watchtower (`nickfedor/watchtower:1.18.1`) pulls new images for the containers that carry its label, every 5 minutes. So a pushed image is deployed within 5 minutes. To deploy it at once: <!-- id:hwGCsVgy -->

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

Three things to know about this setup:

- **Holding a deployment at one version.** Watchtower reads the label `com.centurylinklabs.watchtower.enable` from the **running container**. If you change the label in the compose file, nothing happens until `docker compose up -d <service>` makes the container again. Changing the label and making the container again is how you hold a deployment at its version for a while. It does not stop `bootstrap.sh`: its `docker compose pull` still moves a held container on the next Terraform apply. <!-- id:adholITo -->
- **Keeping Watchtower alive.** The Watchtower container itself must have `restart: unless-stopped`. If the updater crashes, every deploy stops and nothing warns you. The same is true when someone stops it: a container with that policy that was stopped with `docker stop` stays stopped after a reboot.
- **Changing the configuration.** `seed_infra/agentic/sae.tf` in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`) produces the compose file and the Caddyfile under `/opt/sae`, and Terraform pushes them over SSH. A change you make on a host lasts until the next apply and is then gone. Copy every change you make there into the Terraform file.

# Rolling out on your own server

- **A [site](../protocol/sites.md) installed with the deploy script** follows its release channel with a cron job. Its `seed-agents` container is updated with the rest of the node; see [self-hosting](./self-hosting.md#day-to-day).
- **A server you started by hand** is updated with `docker pull` and a restart, or by Watchtower; see [self-hosting an app environment](./self-hosted-app-environment.md).

# See also

- [Environments](./environments.md), where the image runs
- [Configuration](./configuration.md), every setting
- [Endpoints and health](./endpoints-and-health.md), the health and version endpoints a rollout is checked with
- [Releasing](../contribute/releasing.md), how a release tag is cut
- [Testing the app environment](../contribute/testing-the-app-environment.md), the gates that run before an image is pushed
