# Custom Docker Web Deploy Runbook

Operator notes for running the Horacio fork deployment while tracking upstream Seed.

## Model

- Fork remote: `origin` = `horacioh/seed`.
- Deployment branch: `origin/main`.
- Upstream: `seed-hypermedia/seed:main`.
- Server deploy source: `https://raw.githubusercontent.com/horacioh/seed/main/ops`.
- Custom images:
  - Web: `ghcr.io/horacioh/seed-web:main` and `ghcr.io/horacioh/seed-web:sha-<sha>`.
  - Daemon/site: `ghcr.io/horacioh/seed-site:main` and `ghcr.io/horacioh/seed-site:sha-<sha>`.

`main` is the moving deployment channel. `sha-<sha>` tags are immutable rollback targets.

## Daily upstream rebase

Run from a clean local checkout of the fork:

```sh
git fetch upstream main
git fetch origin main
git switch main
git rebase upstream/main
git push --force-with-lease origin main
```

If rebase conflicts occur, stop and resolve them manually. Do not push a conflicted or unverified rebase. After the push,
confirm the image build workflow publishes fresh `main` and SHA tags before expecting servers to update.

Caveat: branch protection that blocks force pushes is incompatible with this exact rebase model. Either allow
administrator/maintainer force-with-lease pushes for `main`, or use a separate deployment branch with matching build and
server configuration.

## Server bootstrap or migration

Use the Horacio fork as the deploy source, not the upstream hosted installer:

```sh
curl -fsSL https://raw.githubusercontent.com/horacioh/seed/main/ops/deploy.sh | \
  SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/main/ops sh
```

For an existing install, first take a backup, then re-run the fork bootstrap. The deploy script stores state under the
seed directory, installs/updates `/usr/local/bin/seed-deploy` when allowed, detects legacy installs, writes
`config.json`, and runs the deploy wizard when configuration is missing or `--reconfigure` is requested.

```sh
seed-deploy backup
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/main/ops seed-deploy deploy --reconfigure
```

When prompted for a custom Docker image tag, use `main` for the normal moving channel. Full GHCR image refs are
stored in `config.json` as shown below.

## Custom image references

The server compose file must run the GHCR images, not the upstream defaults. Using the fork deploy source alone is not
enough if that branch's `ops/docker-compose.yml` still references `seedhypermedia/*`; verify the raw compose file before
rollout.

Required image refs:

```text
ghcr.io/horacioh/seed-web:main
ghcr.io/horacioh/seed-site:main
```

For rollback or pinned deploys, use matching SHA tags:

```text
ghcr.io/horacioh/seed-web:sha-<sha>
ghcr.io/horacioh/seed-site:sha-<sha>
```

Persist these refs in the server config. After bootstrap or reconfigure, inspect and edit `config.json` if needed:

```sh
seed-deploy config
sudo ${EDITOR:-vi} /opt/seed/config.json
```

The relevant fields should be:

```json
{
  "deploy_url": "https://raw.githubusercontent.com/horacioh/seed/main/ops",
  "compose_url": "https://raw.githubusercontent.com/horacioh/seed/main/ops/docker-compose.yml",
  "release_channel": "main",
  "web_image": "ghcr.io/horacioh/seed-web:main",
  "site_image": "ghcr.io/horacioh/seed-site:main"
}
```

Keep web and site on the same tag. Mixing SHAs can produce API or data compatibility surprises.

Private registry caveat: if the GHCR packages are private, the server must authenticate before pulling:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u horacioh --password-stdin
```

Use a token with package read permission. Public GHCR packages do not need this step.

## Automatic and manual deploys

Install cron after bootstrap if it is not already present:

```sh
seed-deploy cron
```

Current deploy tooling installs a `# seed-deploy` cron entry that runs `upgrade` and `deploy` every 10 minutes, plus a
`# seed-cleanup` entry that prunes old Docker images hourly. Check the exact schedule on the server with:

```sh
crontab -l | grep 'seed-'
```

Manual deploy:

```sh
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/main/ops seed-deploy deploy
```

Reconfigure deploy settings:

```sh
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/main/ops seed-deploy deploy --reconfigure
```

Start, stop, restart, and logs:

```sh
seed-deploy start
seed-deploy stop
seed-deploy restart
seed-deploy logs web
seed-deploy logs daemon
seed-deploy logs proxy
```

## Rollback to a SHA tag

1. Pick a known-good image SHA tag that exists for both images.
2. Reconfigure the server to that tag:

   ```sh
   SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/main/ops seed-deploy deploy --reconfigure
   ```

3. Edit `/opt/seed/config.json` so `web_image` and `site_image` point at matching `sha-<sha>` tags.
4. Deploy and verify:

   ```sh
   seed-deploy deploy
   seed-deploy doctor
   docker inspect seed-web --format '{{.Config.Image}}'
   docker inspect seed-daemon --format '{{.Config.Image}}'
   ```

Return to the moving channel by reconfiguring back to `main`.

## Verification

After bootstrap, rebase, deploy, or rollback:

```sh
seed-deploy doctor
seed-deploy config
docker inspect seed-web --format '{{.State.Status}} {{.Config.Image}} {{.State.StartedAt}}'
docker inspect seed-daemon --format '{{.State.Status}} {{.Config.Image}} {{.State.StartedAt}}'
docker inspect seed-proxy --format '{{.State.Status}} {{.Config.Image}} {{.State.StartedAt}}'
seed-deploy logs web
seed-deploy logs daemon
seed-deploy logs proxy
```

Expected:

- `seed-web`, `seed-daemon`, and `seed-proxy` are `running`.
- `seed-web` uses `ghcr.io/horacioh/seed-web:<tag>`.
- `seed-daemon` uses `ghcr.io/horacioh/seed-site:<tag>`.
- `seed-deploy doctor` has no unexpected env, disk, network, image, or cron failures.
- Logs show normal startup and no repeated crash/restart loop.

If `docker inspect` reports upstream `seedhypermedia/*` images, the server is not using the intended custom image refs;
fix the deploy source/configuration and redeploy before considering the rollout complete.
