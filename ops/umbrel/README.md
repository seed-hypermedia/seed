# Seed Site on Umbrel

Seed Site runs a daemon and web app on an Umbrel home server. The web app is the public HTTP entrypoint; the daemon's
HTTP API is private to the Docker network, and its P2P TCP/UDP port is optional to expose through the router.

## Install

See the [home-server store publishing guide](../home-server-stores.md).

In Umbrel, open **App Store → ⋯ → Community App Stores → Add URL**, enter the store repository URL, then install **Seed
Site**.

## Register and expose the site

The registration link uses the password shown by Umbrel:

```text
<SEED_BASE_URL>/hm/register?secret=<the password Umbrel shows>
```

Set `SEED_BASE_URL` in the app settings to the final public HTTPS URL before registering. The site is LAN-only by
default; expose it through Cloudflare Tunnel or a similar reverse proxy and point that URL at the Umbrel app. The root
page returns 404 until registration. The app proxy deliberately adds no Umbrel login gate because the Seed desktop app
must reach `/hm/api/register`.

## P2P and data

The daemon uses libp2p relay fallback and hole punching for home networks. Optionally forward host port **56000** for
both TCP and UDP to improve direct peer connectivity. The daemon HTTP API on port 56001 is not published publicly, but
is reachable by other apps on Umbrel's shared Docker network.

Umbrel backups include the app's `data` directory. Keep `data/daemon/keys` private: it contains the daemon's identity
keys.

## Updates and limitations

Update the app by bumping both pinned image digests in `seed-site/docker-compose.yml` and the Seed version in
`seed-site/umbrel-app.yml`. The images are amd64-only, so this app is not ready for the official Umbrel store until
arm64 Seed images are available.
