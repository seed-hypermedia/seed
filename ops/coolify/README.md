# Seed site on Coolify

`seed-site.yaml` is a Coolify v4 docker-compose service template for one Seed site: `seed-daemon`, `seed-web`, an
internal Caddy (`seed-proxy`) that keeps the `/ipfs/*` → daemon routing of the standard deployment, and a
`seed-updater` that pulls new images automatically. Coolify's own proxy terminates TLS for the domain.

## Deploy

1. In Coolify: **Project → New Resource → Docker Compose Empty**, paste `seed-site.yaml`.
2. On the `seed-proxy` service set the domain, e.g. `https://site.example.com` (one domain, no path).
3. Optional environment variables (defaults in brackets):
   - `SEED_WEB_IMAGE` / `SEED_SITE_IMAGE` [`seedhypermedia/web:latest` / `seedhypermedia/site:latest`]. Use
     `ghcr.io/horacioh/seed-web:main` / `ghcr.io/horacioh/seed-site:main` for this fork's images.
   - `SEED_P2P_PORT` [`56000`]: host TCP+UDP port for P2P. Must be unique per server and open in the firewall.
   - `SEED_UPDATE_INTERVAL` [`600`]: seconds between update checks.
   - `SEED_IS_GATEWAY` [`false`], `SEED_ENABLE_STATISTICS` [`false`], `SEED_LOG_LEVEL` [`info`],
     `SEED_P2P_TESTNET_NAME` [empty = mainnet; `dev` = testnet, also set `SEED_LIGHTNING_URL` to
     `https://ln.testnet.seed.hyper.media`], `SEED_NO_PULL` [`false`].
4. Deploy. `seed-proxy` turns healthy once `https://<domain>/hm/api/config` answers.
5. Link the site from the Seed desktop app with `https://<domain>/hm/register?secret=<SERVICE_PASSWORD_SEEDLINK>`
   (copy the generated value from the stack's **Environment Variables**). The secret is written to the web data volume
   only on first start; it is consumed when the site is registered.

## Auto-update

`seed-updater` runs [nickfedor/watchtower](https://github.com/nicholas-fedor/watchtower) (the maintained fork;
`containrrr/watchtower` is archived and fails against Docker 29). Every `SEED_UPDATE_INTERVAL` seconds it checks the
registry for the image tags of `seed-web` and `seed-daemon` and recreates the container when the digest changed, then
removes the old image. It only manages containers labelled with this stack's generated `SERVICE_PASSWORD_UPDATESCOPE`
scope, so other apps on the server and other Seed stacks are untouched.

Which tag you follow decides what "update" means: `latest` follows upstream stable releases, `dev` follows upstream
`main`, and the fork's `ghcr.io/horacioh/seed-*:main` follows every push to `custom-images`. Pin an exact version tag
to disable updates for a site.

## Data

Named volumes `seed-daemon-data` (keys, database, blobs) and `seed-web-data` (`config.json`). Back up both; the daemon
keys in `seed-daemon-data/keys` are the node identity.
