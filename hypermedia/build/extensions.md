---
name: Extensions
summary: The status of Seed's experimental extension system, in which a Hypermedia document carries a small web app that a site installs as a sandboxed full page, built on an unmerged branch and not part of any release.
---
An extension is a small web app that lives inside a Seed site. It is published as an ordinary Hypermedia document, so it is signed, versioned and synced like everything else, and a site owner installs it by writing one record into the site's home document. When a visitor opens that path, the Seed app or the Seed web app runs the extension in a sandboxed frame and lets it read Hypermedia data and ask the visitor to sign things, without ever handing it a key. <!-- id:qu7HorSA -->

**Status as of September 2026: experimental, not on main, and not in any release.** The work lives on the branch `feat/extensions`, last committed on 2026-08-31. Its draft pull request, [#1020](https://github.com/seed-hypermedia/seed/pull/1020), was closed without merging on 2026-09-01, and the branch has not been rebased since. Nothing on this page works in the released Seed app, on hyper.media, or with the published CLI and SDK. You can run it, but do not depend on it. <!-- id:8atCFa9f -->

# What was built <!-- id:MrltY6J7 -->

The branch implements one kind of extension, the **custom page**: a full app under the site header at a path of the site, on both the web app and the desktop app. The team's list of extensibility types also includes custom blocks, custom attribute editors, custom document views and themes. The manifest reserves the kinds `block`, `attribute` and `theme`, but only `page` has a host. <!-- id:AETXee8O -->

The branch adds these pieces: <!-- id:neOorxeW -->

<!-- id:fjOjX3xo -->
| Piece <!-- col:VQIpqbvp --> | Where on the branch <!-- col:3LM7HJsq --> <!-- id:gWvc03G8 --> |
| --- | --- |
| Manifest and install schemas, mount resolution, bridge message types | `frontend/packages/client/src/extensions.ts` <!-- id:lpOZq5vw --> |
| Host shared by both apps: page, sandboxed frame, bridge server, signing dialog | `frontend/packages/ui/src/extensions/` <!-- id:xoqOZEz_ --> |
| Web and desktop integration | `frontend/apps/web` routes and `frontend/apps/desktop` components, plus a desktop Site settings tab <!-- id:4RO5lt85 --> |
| Iframe-side SDK | `frontend/packages/extension-sdk` (`@seed-hypermedia/extension-sdk`) <!-- id:g_a7z4nj --> |
| CLI | `seed-cli extension publish`, `inspect`, `install`, `uninstall`, `list`, `update` <!-- id:3vavQ8N3 --> |
| Examples | `extensions/examples/hello-signer`, `site-dashboard`, `kanban` <!-- id:WUknPq12 --> |
| Design, developer guide, bridge reference, security notes | `docs/extensions/` <!-- id:1oGrLNp9 --> |

# The data model <!-- id:Q-gKZFzh -->

Everything about an extension is Hypermedia data. There is no extension registry and no server-side install step. <!-- id:zCZIoHfY -->

## The extension document <!-- id:voNLsV7X -->

An extension is a [document](../protocol/documents.md) whose [metadata](../metadata.md) carries a `seedExtension` manifest. The document's `name` is the extension's display name and its body is the README shown on its page. The code is one self-contained HTML file stored as an IPFS [file](../protocol/files.md) and referenced from the manifest. <!-- id:hkN6JxLP -->

```json <!-- id:5fo4oX1n -->
{
  "manifestVersion": 1,
  "kind": "page",
  "version": "0.1.0",
  "entry": "ipfs://bafk…",
  "description": "Kanban board over site documents",
  "permissions": ["sign", "navigate", "storage"],
  "defaultMountPath": "board",
  "homepage": "https://github.com/…"
}
```

<!-- id:oQrRkO5v -->
| Field <!-- col:pF2JckY2 --> | Meaning <!-- col:FWtSizWM --> <!-- id:X9Zrfmsc --> |
| --- | --- |
| `manifestVersion` | `1` <!-- id:8-1IpT9T --> |
| `kind` | `page`; `block`, `attribute` and `theme` are reserved and unimplemented <!-- id:sASyOSH8 --> |
| `version` | an informational semver string; the real version is the document version <!-- id:BA9nORUd --> |
| `entry` | the `ipfs://` CID of the single HTML file <!-- id:mwaN9ctc --> |
| `permissions` | any of `sign`, `navigate`, `storage`; reading is always allowed <!-- id:6AE0uuBp --> |
| `defaultMountPath` | the path an installer suggests <!-- id:1JuuZUmc --> |
| `description`, `homepage` | shown in the install UI <!-- id:2rW9-UX3 --> |

## The install record <!-- id:Ym8A76BA -->

A site installs an extension by adding an entry to `metadata.extensions` on its [home document](../protocol/sites.md), keyed by mount path. <!-- id:_6ejn_7r -->

```json <!-- id:xbHP0_I8 -->
{
  "extensions": {
    "board": {
      "ext": "hm://z6MkAuthor…/kanban",
      "version": "bafy…",
      "title": "Board",
      "nav": true,
      "settings": {"columns": 4}
    }
  }
}
```

`ext` names the extension document. `version` pins the extension document's [version](../protocol/urls.md) at install time, so the code a site runs cannot change when the author publishes an update; omitting it follows the latest version. `title` and `nav` control the entry in the site header, and `settings` is passed to the extension. Because installing is a signed change to the home document, only keys that may write the home document can install; see [Permissions](../protocol/permissions.md). <!-- id:-tun-6U- -->

A request for `/board/card/abc` resolves to the longest installed mount that prefixes the path, here `board`, and hands the rest, `["card", "abc"]`, to the extension for its own routing. A mount hides any document at or beneath its path in the page UI, but the document still exists and stays readable through the API. The kanban example stores its board in the metadata of the document at its own mount path. <!-- id:rLHxFKfa -->

# The bridge <!-- id:PyfYHYaO -->

The host and the extension talk over `postMessage`. The extension imports `@seed-hypermedia/extension-sdk`, calls `connect()`, and receives a context object; the host pushes a new context whenever the viewer signs in or out, the theme changes, or the route changes. <!-- id:Dwv70XGI -->

<!-- id:msgLzGS1 -->
| Method group <!-- col:HiN31Cs3 --> | What it does <!-- col:0_wojFcC --> | Permission <!-- col:YhccG1XX --> <!-- id:B7JfWd8A --> |
| --- | --- | --- |
| `hello`, `getContext` | handshake and the current context: site, mount, sub-path, settings, viewer, theme, granted permissions | none <!-- id:fsQJmu7I --> |
| `api.query` | read through the [Seed API](./web-api.md), limited to read keys such as `Resource`, `Query`, `Search`, `ListComments`, `ListCitations` and `ListEvents`; `PublishBlobs` is excluded | none <!-- id:aPqnTQUp --> |
| `file.url`, `file.read` | load an IPFS file by CID through the host | none <!-- id:KY4piPtd --> |
| `sign.comment`, `sign.document`, `sign.data` | publish a comment, change a document's metadata or body, or sign arbitrary bytes, each after the viewer confirms | `sign` <!-- id:8jYCiXMD --> |
| `navigate`, `openExternal`, `route.set` | move the host app, open a link outside, or update the URL beneath the mount | `navigate` for the first two <!-- id:siDFvAjA --> |
| `storage.get`, `set`, `remove`, `keys` | per-extension key-value storage in the viewer's browser | `storage` <!-- id:ZU-Nbnwq --> |
| `ui.toast`, `ui.setTitle`, `ui.resize` | host UI conveniences | none <!-- id:QoFZwRgW --> |

Errors come back as `{code, message}` with one of `permission_denied`, `user_rejected`, `not_signed_in`, `unknown_method`, `invalid_params`, `not_supported` or `internal`. <!-- id:9PoNQGSG -->

`sign.document` builds and signs a [Change](../change.md) and a Version [Ref](../ref.md) on the host with the viewer's key and publishes them, which is the ordinary write path described in [Documents](../protocol/documents.md). The daemon still decides whether the viewer may write there, so a visitor without a capability gets the daemon's permission error. `sign.data` signs the bytes `seed-extension-signature:v1\n<extension id>\n<data>`, a domain-separated payload that can never be replayed as a protocol blob. <!-- id:27j-sENm -->

# Security guarantees on the branch <!-- id:Ra8T6_ci -->

<!-- id:4zg0Dex- -->
- **Sandboxed frame.** The frame runs with `allow-scripts allow-forms allow-popups allow-modals allow-downloads` and never `allow-same-origin`, so the extension has an opaque origin with no access to the host's cookies, storage or DOM. The entry HTML is loaded as `srcdoc`, never evaluated by the host. <!-- id:D6xFTUVv -->
- **Keys never cross the bridge.** Signing happens in the host: the web app's delegated browser session key, or the desktop daemon. The extension gets back signatures and CIDs only. <!-- id:dcfihUJD -->
- **Every signature is confirmed.** A native dialog names the extension, the account and the effect, and its Approve button ignores clicks for about half a second after opening. A per-session "allow" exists, is never persisted, and never covers changes to install records or manifests. <!-- id:G0zyvgyq -->
- **Messages are checked.** The host accepts messages only from its own frame, and it enforces each method's permission against the manifest. <!-- id:XraoktkF -->
- **Pinned code.** A site runs the version it pinned until its owner updates. <!-- id:iGBtPrXx -->
- **Developer overrides are local.** A `?extdev=` URL parameter can point a frame at a dev server, but it accepts only loopback addresses, and the signing dialog warns while an override is active. <!-- id:T54491lC -->

These are not guaranteed: the frame can still `fetch` any endpoint that allows CORS, there are no resource limits, and there is no signal that an extension's publisher is trustworthy. The branch's own roadmap lists a manifest content-security-policy field and a verified-publisher signal as open questions. <!-- id:iEDO0MGv -->

# Trying it <!-- id:NU5tCL6E -->

You need a working development setup from [Contributing](./contributing.md), and you should do this in a separate worktree, because the branch is well behind main. <!-- id:LtVjbq0D -->

## Check out the branch <!-- id:dJ_JKijv -->

```sh <!-- id:ezaa-pzo -->
git fetch origin feat/extensions
git worktree add ../seed-extensions origin/feat/extensions
cd ../seed-extensions
pnpm install
```

## Open the published examples <!-- id:kpI6ddSE -->

The branch author published the three examples under the account `z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj` and installed them on that site at the mounts `hello`, `dashboard` and `board`. A desktop app built from the branch renders `hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/board` as the kanban extension. The branch's local web app serves the gateway form `http://localhost:3000/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hello`. On released software those paths show ordinary documents. <!-- id:8hO37KjY -->

## Build and publish your own <!-- id:-Ovtd8fb -->

Copy `extensions/examples/hello-signer`, build it to a single HTML file with Vite, and publish it with the branch's CLI. <!-- id:aZNsHwnx -->

```sh <!-- id:Zy0lJi45 -->
seed-cli extension publish ./my-extension --key mykey -p my-extension --dry-run
seed-cli extension publish ./my-extension --key mykey -p my-extension
seed-cli extension install hm://<your account>/my-extension --path board --key sitekey
seed-cli extension list
```

`publish` uploads `dist/index.html`, writes the manifest from `seed-extension.json` into the document's metadata, and uses `README.md` as the body. `install` pins the current version unless you pass `--latest`. On the desktop app built from the branch, the space's settings gain an Extensions tab that does the same with a manifest preview. <!-- id:fvw_Wtfe -->

## Iterate with hot reload <!-- id:vM_fEgog -->

Run the example's Vite dev server and append `?extdev=http://localhost:<port>` to the extension's page URL, or set an override in desktop Settings under Advanced. Append `?extdev=off` to clear it. <!-- id:0avx1c7b -->

# Working with extensions <!-- id:wPcvImLC -->

## In the Seed app <!-- id:1moVp4el -->

Released versions have no extension support. On the branch, a mount renders as a page under the site header, and Site settings has an Extensions tab to install, update and remove. <!-- id:OG5OOzic -->

## CLI <!-- id:7s8fKxsV -->

The `extension` command group exists only in the CLI built from the branch. Released `seed-cli` versions can still read an extension document and its install records as ordinary metadata with `seed-cli document get`. <!-- id:K7YMvcnm -->

## SDK <!-- id:EshiP5JH -->

`@seed-hypermedia/extension-sdk` is the iframe-side client on the branch, and the manifest schemas live in the branch's copy of `@seed-hypermedia/client`. Neither is published. <!-- id:duJHRc7n -->

## Web API <!-- id:dTf38_KC -->

There is no extension endpoint. Reads from an extension go through the host to the same `/api/<Key>` requests described in [Web API](./web-api.md). <!-- id:iij12ZDg -->

## Agents <!-- id:XMvL0ilv -->

Seed Agents and external agents have no extension tooling. An agent can read an extension document or a site's `extensions` metadata with `read hm://<account>/<path>` or `seed-cli document get`, like any other document; see [Building with agents](./agents.md). <!-- id:8S_T1JHq -->

# See also <!-- id:En3ALPyz -->

- [Where this is going](../protocol/roadmap.md), where extensions are listed as in-progress direction. <!-- id:H3H_c_qN -->
- [Documents](../protocol/documents.md), [Sites](../protocol/sites.md) and [Files](../protocol/files.md), the model extensions are built from. <!-- id:URNdwNkE -->
- [Sign in with Seed](./sign-in.md), for how the web app's session key signs. <!-- id:urMU4gog -->
- On the branch: `docs/extensions/design.md` is the normative spec, and `docs/extensions/project-report.md` records what was verified. <!-- id:KNf1wkdd -->
