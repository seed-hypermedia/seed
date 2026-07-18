# Custom Docker Web Deploy Runbook

Operator notes for running the Horacio fork deployment while tracking upstream Seed.

## Model

Two branches keep the fork clean while still shipping custom images:

- `main`: a clean mirror of `seed-hypermedia/seed:main` plus a single sync workflow commit. It carries no product
  customizations, so pulling upstream stays trivial.
- `custom-images`: rebased on top of `main`, it holds every fork customization (custom web/site images, the
  fork-hosted `deploy.js` updater, and the query-block filters). The GHCR image build runs from this branch.

Other pointers:

- Fork remote: `origin` = `horacioh/seed`.
- Deployment branch: `origin/custom-images`.
- Upstream: `seed-hypermedia/seed:main`.
- Server deploy source: `https://raw.githubusercontent.com/horacioh/seed/custom-images/ops`.
- Custom images:
  - Web: `ghcr.io/horacioh/seed-web:main` and `ghcr.io/horacioh/seed-web:sha-<sha>`.
  - Daemon/site: `ghcr.io/horacioh/seed-site:main` and `ghcr.io/horacioh/seed-site:sha-<sha>`.

The `main` image tag is the moving deployment channel (built from `custom-images`); `sha-<sha>` tags are immutable
rollback targets.

## Upstream sync (automated)

The `Custom - Sync Fork From Upstream` workflow (`.github/workflows/custom-rebase-main.yml`) runs every 6 hours (and on
demand) from `main`. It:

1. Rebases `main` onto `seed-hypermedia/seed:main` and force-with-lease pushes `main`.
2. Rebases `custom-images` onto the freshly synced `main` and force-with-lease pushes `custom-images`.
3. Dispatches the GHCR image build for `custom-images`.

If either rebase hits a conflict, the workflow opens (or comments on) a tracking issue and stops so it can be resolved
manually.

To reproduce it locally:

```sh
git fetch upstream main
git switch main
git rebase upstream/main
git push --force-with-lease origin main

git switch custom-images
git rebase origin/main
git push --force-with-lease origin custom-images
```

If rebase conflicts occur, stop and resolve them manually. Do not push a conflicted or unverified rebase. After the push,
confirm the image build workflow publishes fresh `main` and SHA tags before expecting servers to update.

Caveat: branch protection that blocks force pushes is incompatible with this rebase model. Allow the actions bot to
force-with-lease push `main` and `custom-images`.

## Server bootstrap or migration

Use the Horacio fork as the deploy source, not the upstream hosted installer:

```sh
curl -fsSL https://raw.githubusercontent.com/horacioh/seed/custom-images/ops/deploy.sh | \
  SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/custom-images/ops sh
```

For an existing install, first take a backup, then re-run the fork bootstrap. The deploy script stores state under the
seed directory, installs/updates `/usr/local/bin/seed-deploy` when allowed, detects legacy installs, writes
`config.json`, and runs the deploy wizard when configuration is missing or `--reconfigure` is requested.
The persisted `deploy_url` also controls `deploy.js` self-updates, so cron keeps the fork-specific custom image support
instead of replacing it with upstream's S3 build.

```sh
seed-deploy backup
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/custom-images/ops seed-deploy deploy --reconfigure
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
  "deploy_url": "https://raw.githubusercontent.com/horacioh/seed/custom-images/ops",
  "compose_url": "https://raw.githubusercontent.com/horacioh/seed/custom-images/ops/docker-compose.yml",
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
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/custom-images/ops seed-deploy deploy
```

Reconfigure deploy settings:

```sh
SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/custom-images/ops seed-deploy deploy --reconfigure
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
   SEED_DEPLOY_URL=https://raw.githubusercontent.com/horacioh/seed/custom-images/ops seed-deploy deploy --reconfigure
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
