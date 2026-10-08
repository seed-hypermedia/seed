# Seed site on Dokploy

New to Dokploy? Follow the step-by-step [tutorial](TUTORIAL.md).

This Dokploy Compose template runs one Seed site with `seed-daemon`, `seed-web`, a one-shot initializer for the web
registration secret, and a scoped Watchtower updater. Dokploy domains route web traffic to the web app and `/ipfs/` to
the daemon; no Caddy proxy is needed.

## Deploy

1. Create a **Compose** service in Dokploy, open **Advanced → Import**, and paste the base64 template below. Run it from
   the Seed repository root:

   ```sh
   python3 -c 'import base64,json,pathlib; p=pathlib.Path("ops/dokploy/seed"); print(base64.b64encode(json.dumps({"compose":(p/"docker-compose.yml").read_text(),"config":(p/"template.toml").read_text()},indent=2,ensure_ascii=False).encode()).decode())'
   ```

2. HTTPS (Let's Encrypt) is enabled by default. Before the first deploy, point an A/AAAA record for your own domain at
   the Dokploy server. Replace the generated `*.traefik.me` domain with your domain everywhere it appears: both domain
   entries, `SEED_DOMAIN`, and `SEED_BASE_URL`.
3. Open `SEED_P2P_PORT` (default `56000`) on the host firewall for both TCP and UDP. Use a unique P2P port for every
   Seed site on the same server.
4. Link the site from Seed desktop with `https://<domain>/hm/register?secret=<SEED_LINK_SECRET>`. `seed-init` writes the
   generated secret to `config.json` only on the first start; preserve the web data volume after registration.

## Environment

| Variable                 | Default                           | Purpose                                                                                          |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SEED_DOMAIN`            | Generated Dokploy domain          | Public site hostname, also used in daemon announce addresses.                                    |
| `SEED_BASE_URL`          | `https://${SEED_DOMAIN}`          | Public web URL; HTTPS is enabled by default.                                                     |
| `SEED_ASSET_HOST`        | `${SEED_BASE_URL}`                | Public base URL used for file and image URLs.                                                    |
| `SEED_LINK_SECRET`       | Generated 32-character secret     | Registration secret written on first start.                                                      |
| `SEED_UPDATE_SCOPE`      | Generated `seed-<hash>`           | Isolates this stack's Watchtower updates from other stacks.                                      |
| `SEED_P2P_PORT`          | `56000`                           | Published libp2p TCP and QUIC/UDP host port.                                                     |
| `SEED_UPDATE_INTERVAL`   | `600`                             | Watchtower poll interval in seconds.                                                             |
| `SEED_WEB_IMAGE`         | `seedhypermedia/web:latest`       | Web image. For the fork, use `ghcr.io/horacioh/seed-web:main`.                                   |
| `SEED_SITE_IMAGE`        | `seedhypermedia/site:latest`      | Daemon image. For the fork, use `ghcr.io/horacioh/seed-site:main`.                               |
| `SEED_P2P_TESTNET_NAME`  | Empty (mainnet)                   | Set to `dev` for testnet; also set `LIGHTNING_API_URL` to `https://ln.testnet.seed.hyper.media`. |
| `SEED_LOG_LEVEL`         | `info`                            | Daemon log level.                                                                                |
| `LIGHTNING_API_URL`      | `https://ln.seed.hyper.media`     | Lightning API endpoint.                                                                          |
| `SENTRY_DSN`             | Seed's default DSN                | Daemon error reporting DSN.                                                                      |
| `NOTIFY_SERVICE_HOST`    | `https://notify.seed.hyper.media` | Notification service endpoint.                                                                   |
| `SEED_IS_GATEWAY`        | `false`                           | Run the web app as a gateway.                                                                    |
| `SEED_ENABLE_STATISTICS` | `false`                           | Enable web statistics.                                                                           |
| `SEED_NO_PULL`           | `false`                           | Disable daemon pull requests.                                                                    |

## Auto-update

`seed-updater` runs the maintained `nickfedor/watchtower:1.22.3` release every `SEED_UPDATE_INTERVAL` seconds. It checks
only containers carrying this stack's generated scope and updates the labeled daemon and web containers. Tags determine
what updates mean: `latest` follows upstream stable releases, `dev` follows upstream `main`, and the fork's
`ghcr.io/horacioh/seed-*:main` tags follow pushes to `custom-images`. Pin an exact image version tag to stop following
moving tags.

## Data and backups

Back up both named volumes: `seed-daemon-data` stores the database, blobs, and node keys, while `seed-web-data` stores
`config.json`. The daemon keys in `seed-daemon-data/keys` are the node identity.
