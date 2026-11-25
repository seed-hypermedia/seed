# Seed Site on CasaOS

This Compose app runs a Seed daemon and web service with persistent data. The web app is the only public HTTP
entrypoint; the daemon's HTTP API stays on the private Compose network.

## Install

CasaOS's **Custom Install → Import** imports only the first container, so install Seed from a third-party store. See the
[home-server store publishing guide](../home-server-stores.md).

In CasaOS, open **App Store**, then the **app source settings**, and choose **Add**. Enter
`https://github.com/<owner>/<repo>/archive/refs/heads/main.zip`, then install **Seed Hypermedia**. A locally served ZIP
with this `Apps/Seed/docker-compose.yml` layout was tested on CasaOS 0.4.15; a GitHub archive URL was not.

## Register and expose the site

On first start, Seed Web creates the registration secret and prints this link once in its service logs:

```text
Seed registration link: <SEED_BASE_URL>/hm/register?secret=<secret>
```

Use the link in the Seed desktop app. The config and secret persist in `/DATA/AppData/<AppID>/web`; restarts do not
generate or print another secret. The root page returns 404 until registration.

Before registering, change both `SEED_BASE_URL` and `SEED_ASSET_HOST` in the app's settings to the same public HTTPS
URL. The default is `http://casaos.local:3567`; the settings edit was verified through CasaOS's `PUT /compose/{id}` API.

The site is reachable on port **3567** on the CasaOS host. For access outside your LAN, expose it with a Cloudflare
Tunnel or similar reverse proxy. The proxy must allow the desktop app to reach `/hm/api/register` without CasaOS login
authentication.

Libp2p relay fallback and hole punching support home networks. Optionally forward host port **56000** for TCP and UDP to
improve direct peer connectivity. The daemon HTTP API on port 56001 is not published.

## Updates and backups

The Compose images use `latest`. CasaOS's app update action was not verified, and the update behavior is unconfirmed.
Back up `/DATA/AppData/<AppID>/daemon` and `/DATA/AppData/<AppID>/web`. Keep `daemon/keys` private because it contains
the daemon identity.

## CasaOS 0.4.15 note

`webui_port: 3000` selects explicit WebUI-port mode. Dynamic mode rewrites the daemon's TCP and UDP 56000 mappings into
duplicate `expose` entries, causing installation to fail.

This app supports amd64 only.
