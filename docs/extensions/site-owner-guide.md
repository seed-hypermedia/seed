# Site owner guide to extensions

For people who run a Seed site and want to add an extension — a dashboard, a board, a directory — to it. Developers
should read the [developer guide](./developer-guide.md); the exact CLI flags are in [cli.md](./cli.md).

## What installing means

Your site is a space whose **home document** carries the site's settings in its metadata. Installing an extension adds
one record to that metadata under `extensions`, keyed by the path you mount it at, and publishes a new version of the
home document **signed by you**:

```jsonc
{
  "extensions": {
    "board": {
      "ext": "hm://z6MkAuthor.../kanban", // the extension document
      "version": "bafy...", // the exact version you reviewed (pinned)
      "title": "Board", // optional navigation title
      "nav": true, // optional, default true
      "settings": {} // optional, passed to the extension
    }
  }
}
```

Nothing else changes. Because the record is ordinary signed document data, only accounts that can edit your home
document can install, update or remove extensions, and the change syncs to every peer like any other edit. The
extension's own code is a separate document published by its author; your record points at it by URL and version.

## Installing from the desktop app

1. Open your site and go to **Site settings → Extensions**. Only the space owner can manage extensions.
2. Press **Install extension** and paste the extension's `hm://…` URL (the author sends it to you), then **Fetch**. The
   app fetches the document and shows its name, description, manifest version, permissions, homepage and the document
   version it found.
3. Review the permissions (below), choose the **mount path** (pre-filled from the author's `defaultMountPath`; lowercase
   letters, digits and dashes, `/` for nested paths, e.g. `tools/board`) and optionally a **navigation title**.
4. Leave **Pin to this version** checked unless you have a reason not to, and press **Install**. The home document is
   updated and the extension is live at `/<mount path>` on your site right away.

The Extensions tab then lists each install with its mount path, `pinned <version>` or `follows latest`, the manifest
version, the permission badges, an **Open** button, **Update to latest** when the author has published a newer version,
**Remove**, and a **Show in site navigation** switch.

## What each permission means for your readers

The extension asks for permissions in its manifest; the host only lets it call methods covered by them, and every
extension can read public hypermedia data without asking. Reading is done through the viewer's own client, so an
extension can also see private documents the viewer can see.

| Permission | Lets the extension…                                                                                   | What your readers experience                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sign`     | ask the viewer to publish comments, create or change documents, or sign arbitrary bytes as themselves | A native confirmation dialog for **every** request, naming the extension, your site, the account and exactly what is signed; nothing happens without Approve |
| `navigate` | move the viewer to another page on your site or an `hm://` URL, or open an external `http(s)` link    | Page changes and new tabs triggered by the extension's UI                                                                                                    |
| `storage`  | keep small key/value settings in the viewer's own browser, private to this extension on this site     | Preferences that persist between visits; no data leaves the browser through this                                                                             |

An extension with none of these can only read and display. Read [security.md](./security.md) for what the sandbox
guarantees regardless of permissions: the extension never sees a key, cannot touch the app's cookies or storage, and
cannot draw over the app's own dialogs.

## Pinning vs following latest, and updating

**Pinned** (default): the record stores the extension document version you reviewed. Your site runs exactly that code
until you change the record, even if the author publishes updates. When a newer version exists the Extensions tab shows
**Update to latest**; pressing it re-pins the record to the author's current version, signing a new home document
version. Review the updated permissions before you do — the badges reflect the version that will be installed.

**Follows latest** (uncheck "Pin to this version" when installing, or `--latest` on the CLI): the record has no
`version`, and your site runs whatever the author publishes next, without review. Use it for extensions you develop
yourself or authors you fully trust.

Either way the extension's own page (`hm://<author>/<path>`) shows its README and version history, and
`seed-cli extension inspect <url>` prints the manifest of any version.

## Removing

**Remove** on the Extensions tab, or `seed-cli extension uninstall --path <mount>`. The record is deleted from the home
document (the metadata editor leaves a `null` behind, which readers ignore). The extension's code is untouched — it is
the author's document — and any document the extension created on your site (for example a kanban board's data at its
mount path) stays where it is and becomes visible as an ordinary document again.

## Where the extension appears

- **URL:** `https://<your site>/<mount path>` on the web, and the same path inside the desktop app. Sub-paths beneath
  the mount (`/board/card/abc`) belong to the extension for its own routing.
- **Shadowing:** the mount takes over that path and everything under it in the page UI. If a document already exists
  there, readers see the extension instead until you remove it; the document itself is untouched and some extensions
  deliberately use it to store their state.
- **Navigation:** installs with **Show in site navigation** on are listed with their `title` (or the extension's name).
  <!-- TODO(verify): the site header / desktop sidebar integration (`navExtensionMounts`) is in progress on this branch; confirm where mounts render on web and desktop. -->

## CLI equivalent

From [design.md §8](./design.md#8-cli-frontendappsclisrccommandsextensionts); `--key` is the signing key that owns your
site.

```sh
seed-cli extension inspect hm://z6MkAuthor.../kanban                 # manifest, permissions, entry CID, version
seed-cli extension install hm://z6MkAuthor.../kanban --path board --key sitekey
seed-cli extension install hm://z6MkAuthor.../kanban --path board --key sitekey --latest --title "Board" --no-nav
seed-cli extension list                                              # installs on your site
seed-cli extension update --path board --key sitekey                 # re-pin to the author's current version
seed-cli extension uninstall --path board --key sitekey
```

`install` refuses to overwrite an existing mount unless you pass `--force`, and every write command accepts `--dry-run`
to print the record it would publish. See [cli.md](./cli.md) for `--settings`, `--title` and the rest.

## Troubleshooting

| What you see                                                 | Why                                                                                                             | What to do                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Extension unavailable** — "not available on this node yet" | Your node has not synced the extension document, or the pinned version, from the author's peer                  | Wait for sync, open the extension's own `hm://` URL to trigger discovery, or ask the author to keep a peer online |
| **Extension unavailable** — "was deleted" / "was moved"      | The author tombstoned or redirected the extension document                                                      | Remove the install, or re-install from the new location                                                           |
| **Not an extension**                                         | The document at `ext` has no valid `seedExtension` manifest (wrong URL, or the author's publish was incomplete) | Check the URL with `seed-cli extension inspect`; re-install with the right one                                    |
| **Unsupported extension kind**                               | The manifest's `kind` is not `page`                                                                             | Only page extensions can be mounted today                                                                         |
| **Extension needs a newer app**                              | The manifest's `minProtocol` is higher than this app's bridge protocol                                          | Update the desktop app / wait for the web app deploy, or pin an older version                                     |
| **Could not load the extension**                             | The entry file could not be fetched (not synced, or a network error)                                            | Retry; check the node can reach the author's peer                                                                 |
| Blank frame, no error                                        | The extension's code failed on its own (open the browser console) or its `connect()` timed out                  | Report to the author; try a different version                                                                     |
| Dev override banner on your site                             | Someone used `?extdev=` in this browser; it is per browser, not part of your site                               | Click the banner, or open the page with `?extdev=off`                                                             |

## Trust

Installing an extension is like linking a web app into your site with your signature on the link. The sandbox and the
confirmation dialog mean an extension cannot take a key, sign silently, or reach into the app — but it **can** read what
your readers can read (including private documents they have access to), show any UI it likes inside its frame, and send
what it reads to third-party servers. Install extensions from authors you would let read your screen, pin versions, and
review permissions again before updating. The full threat model, guarantees and non-goals are in
[security.md](./security.md).
