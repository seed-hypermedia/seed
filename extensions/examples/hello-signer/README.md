# Hello Signer

The smallest useful Seed extension. It connects to the host, prints the live extension context, and has one button per
bridge capability so you can watch requests and responses go by:

- **Sign data** — `seed.sign.data` on the text you type; shows the signer and the signature.
- **Comment** — `seed.sign.comment` posts markdown on the site's home document.
- **Storage** — a counter persisted with `seed.storage`.
- **UI** — `seed.toast` and `seed.setTitle`.
- **Navigation** — `seed.navigate` to the site home, `seed.openExternal` to hyper.media, and `seed.setRoute` to change
  the path beneath the mount.

Every call is logged on the page with its request, response, and any error.

Use it to check that a host implements the bridge correctly, or copy it as the starting point for your own extension.

Permissions: `sign`, `navigate`, `storage`.
