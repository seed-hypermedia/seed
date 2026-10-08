# Seed on Railway

New to Railway? Follow the step-by-step [tutorial](TUTORIAL.md).

This template deploys one Seed site as two Railway services: **Seed Daemon** and **Seed Web**. Each service has one
volume mounted at `/data` and one replica. The web service is the only HTTP entrypoint; it proxies `GET /ipfs/*` to its
own daemon over Railway private networking. Uploads use the Seed client and do not require a public daemon HTTP
endpoint.

The daemon exposes TCP P2P through a Railway TCP proxy. Railway does not provide public UDP, so this template is
TCP-only and does not support QUIC.

## Deploy the template

Open `TEMPLATE_URL` in a browser and deploy it to your Railway workspace. The generated template is private to the
workspace until it is published; the project creation script below does not publish it.

The template generates a public Railway domain for Seed Web, targets port `3000`, and uses HTTPS. The web service's
`DAEMON_HTTP_URL` references only the **Seed Daemon** service in the same project. No Railway healthcheck is configured
for Seed Web. `/` returns 404 until registration, and Railway kept the service in `DEPLOYING` with `/hm/register`
configured even though the process initialized and listened on port `3000`.

## Create or rebuild the workspace template

Install the Railway CLI and `curl`/`jq`, then provide a Railway workspace API token and workspace ID:

```sh
WORKSPACE_ID=<workspace-id> \
RAILWAY_API_TOKEN=<workspace-api-token> \
REGION=us-west2 \
./ops/railway/create-template-project.sh seed-railway-template
```

The script creates a project with the two services, volumes, generated web domain, and daemon TCP proxy, requests the
initial deployments, then generates an unpublished workspace template. It prints the project and template IDs plus the
template URL. It refuses to modify a project with the same name. To resume an interrupted run, pass the exact
`PROJECT_ID`; the script verifies that it matches the project, contains only the expected services, and reuses existing
services, volumes, the web domain, and the daemon TCP proxy.

## Registration

No `SEED_LINK_SECRET` variable is included by default. On the first Seed Web start, the service uses a manually supplied
`SEED_LINK_SECRET` if present; otherwise it generates a 48-character hexadecimal secret and writes it to
`/data/config.json`. It prints the registration link once to the **Seed Web** service logs:

```text
Seed registration link: https://<public-domain>/hm/register?secret=<secret>
```

Find the link in Railway's Seed Web deployment logs and save it securely. The logs are visible to project owners. When
`/data/config.json` already exists, restarts and redeploys do not print the link or replace the secret.

## Custom domains

Railway documents `RAILWAY_PUBLIC_DOMAIN` as the public service or customer domain. The template uses it for
`SEED_BASE_URL` and `SEED_ASSET_HOST`. After adding a custom domain, verify the value used by the service. If the
generated `*.up.railway.app` hostname remains in use, set both variables to `https://<your-custom-domain>` in the Seed
Web service variables.

## Networking and limits

The daemon announces `/dns4/<tcp-proxy-domain>/tcp/<external-port>` and listens on TCP port `56000` on IPv4 and IPv6.
Railway assigns the external proxy port; the `RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_TCP_PROXY_PORT` variables are
required at startup. The daemon HTTP listener remains private at port `56001`; the web service connects to
`${{Seed Daemon.RAILWAY_PRIVATE_DOMAIN}}`.

Each service runs one replica because Railway volumes attach to a single service instance. There is no UDP/QUIC listener
and no multi-replica deployment.

## Costs, backups, and updates

The project uses two services and two volumes on the Railway Hobby plan. Check Railway's current plan, resource, and
storage pricing for the workspace and selected region.

Use Railway volume backups for recovery. Keep `/data/keys` on the daemon volume private; it contains the daemon's
private keys and must not be copied into public storage or shared logs.

Railway's CLI `autoupdate` command updates the local CLI, and the service auto-update schedule API changes only the
maintenance window; neither tracks `:latest` image changes. Redeploy **each** service to pull its updated image.
