# Seed Extensions — CLI

The Seed CLI (`seed-cli`, `frontend/apps/cli`) publishes extensions and installs them on sites. Everything it writes is
ordinary signed hypermedia data, so the same results can be inspected with `document get` and are visible to the desktop
and web apps as soon as they sync.

```
seed-cli extension publish <dir>       publish an extension package as a document
seed-cli extension inspect <hm-url>    show an extension document's manifest
seed-cli extension install <hm-url>    install an extension on your site
seed-cli extension uninstall           remove an install record
seed-cli extension list [<site>]       list a site's installed extensions
seed-cli extension update              re-pin an install to the extension's current version
```

All commands accept the global flags: `--server <url>` (default `https://hyper.media`), `--dev` (dev network + dev
keyring), `--json` / `--yaml` for structured output, `-q, --quiet`, and `--vault <path>`. `-k, --key <name>` selects the
signing key (name or account id) from the vault / keyring, see `seed-cli key list`.

The examples below use the starlight account `hm://z6MkstarLight...` as the extension author and `hm://z6MkmySite...` as
the site.

## Data written

- **Extension document** (`extension publish`): `hm://<author>/<path>` with metadata
  `{name, summary: manifest.description, seedExtension: <manifest>}` and the README as body. The manifest is stored as
  nested metadata attributes (`seedExtension.kind`, `seedExtension.permissions`, …); `permissions` is a real array. The
  entry HTML is uploaded as a UnixFS file and referenced as `seedExtension.entry = "ipfs://<cid>"`.
- **Install record** (`extension install`): `extensions.<mount>` on the site's home document —
  `{ext, version?, title?, nav?, settings?}`, one attribute per leaf. `uninstall` writes `null` to every leaf of the
  record (the same op shape the desktop metadata editor uses), which removes it from the metadata entirely.

Schemas live in `frontend/packages/client/src/extensions.ts`; see [design.md](./design.md) §3.

## `extension publish <dir>`

Publishes the extension package in `<dir>` under the signing key's account.

```
seed-cli extension publish ./extensions/examples/kanban -k starlight
seed-cli extension publish ./ -k starlight -p tools/kanban --name "Kanban Board"
seed-cli extension publish ./ --entry build/app.html --manifest ext.json --readme docs/README.md --dry-run
```

| Option              | Default                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `-p, --path <path>` | manifest `defaultMountPath`, else a slug of the name                                 |
| `-k, --key <name>`  | default key                                                                          |
| `--entry <file>`    | `<dir>/dist/index.html`                                                              |
| `--manifest <file>` | `<dir>/seed-extension.json`                                                          |
| `--readme <file>`   | `<dir>/README.md` (document body; optional)                                          |
| `--name <name>`     | first `# Heading` of the README, else `package.json` `name`, else the directory name |
| `--dry-run`         | validate, compute the entry CID, print what would be published                       |

What it does:

1. Reads `seed-extension.json` (the manifest **without** `entry`; a `$schema` key is ignored), the entry HTML and the
   README.
2. Refuses entries over 4 MiB and warns when the HTML references relative `src=`/`href=` paths (`./`, `../`, `/`): the
   entry is loaded through `srcdoc` in a sandboxed iframe, so nothing relative resolves — bundle to one file (e.g.
   `vite-plugin-singlefile`).
3. Chunks the entry into IPFS blocks, sets `manifest.entry = ipfs://<root cid>` and validates the manifest with
   `ExtensionManifestSchema`.
4. Creates the document at `hm://<account>/<path>` if it does not exist, or updates it in place if it does (metadata
   diff + body replace, same as `document update -f`), so republishing keeps the document's history and lets pinned
   installs be updated. A README whose first line is `# <name>` has that heading dropped from the body since the name is
   already the page title.
5. Prints the id, the new version, the entry CID (plus its `/hm/api/file/<cid>` URL) and a copy-pasteable install
   command:

```
✓ Extension created: https://hyper.media/hm/z6MkstarLight.../kanban
  id:       hm://z6MkstarLight.../kanban
  version:  bafy2bzacecwx...
  entry:    ipfs://bafkreicu...
            https://hyper.media/hm/api/file/bafkreicu...
Install on a site (run with that site's key):
  seed-cli extension install hm://z6MkstarLight.../kanban --path board -k <sitekey>
```

With `--json` the same fields come back as `{id, version, name, entry, entryUrl, web, action, install}`.

The signing key's own account is always the publishing space. To publish under another space, publish the document with
`document create -a <space>` using a capability and add the `seedExtension` metadata there — the `extension` commands do
not take `--account`.

## `extension inspect <hm-url>`

Fetches an extension document and prints its manifest. A `?v=<version>` on the URL inspects that exact version (what a
pinned install runs). Non-documents and documents without a `seedExtension` manifest exit 1.

```
seed-cli extension inspect hm://z6MkstarLight.../kanban
seed-cli extension inspect "hm://z6MkstarLight.../kanban?v=bafy2bzacecwx..." --json
seed-cli extension inspect https://hyper.media/hm/z6MkstarLight.../kanban
```

```
Name:           Kanban
Id:             hm://z6MkstarLight.../kanban
Version:        bafy2bzacecwx... (latest)
Kind:           page
Code version:   0.1.0
Description:    Kanban board over site documents
Permissions:    sign, navigate, storage
Default mount:  board
Homepage:       https://github.com/...
Min protocol:
Entry:          ipfs://bafkreicu...
                https://hyper.media/hm/api/file/bafkreicu...
Authors:        z6MkstarLight...

Install with:
  seed-cli extension install hm://z6MkstarLight.../kanban --path board -k <sitekey>

README:
A kanban board that stores its columns and cards …
```

`--json` returns
`{id, name, version, requestedVersion, manifest, permissions, entry: {cid, url}, authors, readme, install}`.

## `extension install <hm-url>`

Writes an install record into the home document of the signing key's account (the site).

```
seed-cli extension install hm://z6MkstarLight.../kanban -k mysite
seed-cli extension install hm://z6MkstarLight.../kanban --path tools/board --title Board --no-nav -k mysite
seed-cli extension install hm://z6MkstarLight.../kanban --settings '{"columns": 4}' -k mysite
seed-cli extension install hm://z6MkstarLight.../kanban --latest --force -k mysite
```

| Option              | Meaning                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--path <mount>`    | mount path; default manifest `defaultMountPath` (required when the manifest has none) |
| `-k, --key <name>`  | the site's key — the site is this key's own account                                   |
| `--latest`          | follow the latest extension version instead of pinning                                |
| `--title <title>`   | navigation title (the mount path is shown when no title is set)                       |
| `--no-nav`          | hide the mount from site navigation                                                   |
| `--settings <json>` | JSON object passed to the extension as `context.settings`                             |
| `--force`           | replace an existing record at that mount (fields the new record lacks are removed)    |
| `--dry-run`         | print the record and the attribute ops without publishing                             |

Behaviour:

- Fetches the extension first and validates its manifest; a non-extension is refused. A `?v=` on the URL pins that
  version; otherwise the current version is pinned. **Pinning is the default** — the site keeps running exactly the code
  it approved until `extension update` (or the desktop's "update") re-pins it.
- Validates the mount with `EXTENSION_MOUNT_PATH_RE` (`board`, `tools/board`; lowercase letters, digits, dashes).
- Warns when a document (or redirect) already exists at `hm://<site>/<mount>`: the extension page shadows it in the site
  UI, the document stays readable through the API (extensions often use that document as their data store).
- Warns when the mount overlaps another install (`board` vs `board/x`); the longest match wins per request path.
- Refuses to overwrite an existing record without `--force` (even an identical one); with `--force`, re-installing an
  identical record publishes nothing (no-op).

```
✓ Installed "Kanban" at hm://z6MkmySite.../board (pinned bafy2bzacecwx..., settings {"columns":4})
  record:      {"ext":"hm://z6MkstarLight.../kanban","version":"bafy2bzacecwx...","settings":{"columns":4}}
  permissions: sign, navigate, storage
  served at:   https://hyper.media/hm/z6MkmySite.../board
  home doc:    bafy2bzacedn...
```

On a site with its own domain the extension is served at `https://<domain>/board`.

Verify with `seed-cli document get hm://z6MkmySite... --json` → `document.metadata.extensions.board`.

## `extension uninstall --path <mount>`

```
seed-cli extension uninstall --path board -k mysite
seed-cli extension uninstall --path board -k mysite --dry-run
```

Removes the record at `extensions.<mount>` by writing `null` to each of its leaves. Errors when nothing is installed
there.

## `extension list [<site>]`

```
seed-cli extension list -k mysite
seed-cli extension list hm://z6MkmySite...
seed-cli extension list https://mysite.example --json
```

Without a site argument it lists the signing key's own site. For every mount it fetches the extension document (at the
pinned version when there is one) to show its name and permissions, and reports when a newer version is available.

```
Extensions installed on hm://z6MkmySite...:
  /board  Kanban — "Board"
      hm://z6MkstarLight.../kanban
      pinned bafy2bzacecwx... (update available: bafy2bzaceh7...); permissions: sign, navigate, storage
  /hello  Hello Signer
      hm://z6MkstarLight.../hello-signer
      latest; permissions: sign; hidden from nav
```

`--json`:
`{site, extensions: [{mount, ext, version, pinned, title, nav, settings, name, permissions, latestVersion, error}]}`. An
extension that cannot be fetched is listed with `error` set instead of failing the whole command.

## `extension update --path <mount>`

```
seed-cli extension update --path board -k mysite
seed-cli extension update --path board -k mysite --dry-run
```

Re-pins the install at `<mount>` to the extension document's current version by writing `extensions.<mount>.version`.
Prints a no-op message (exit 0) when the pin is already current, and when the install follows latest (there is nothing
to pin; use `install --force` to pin one). The new version's permissions are printed so a site owner sees what changed.

## Typical workflow

```
# author
cd extensions/examples/kanban && pnpm build
seed-cli extension publish ./ -k starlight

# site owner
seed-cli extension inspect hm://z6MkstarLight.../kanban
seed-cli extension install hm://z6MkstarLight.../kanban --path board -k mysite
seed-cli extension list -k mysite

# later, after the author publishes again
seed-cli extension list -k mysite          # shows "update available"
seed-cli extension update --path board -k mysite
```

## Limitations

- The `extension` commands publish under the signing key's own account only (no `--account`/capability flow yet).
- `settings` values are written as nested attributes; arrays inside settings are stored whole (the daemon accepts any
  CBOR value) but the desktop metadata editor cannot author arrays.
- The CLI does not run the extension; use `?extdev=` on the web app or the desktop dev override to iterate, see
  [design.md](./design.md) §7.
