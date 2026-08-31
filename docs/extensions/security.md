# Extensions — Security Model

This page states what the extension system guarantees, what it deliberately does not, and the reasoning. Read it before
installing an extension on a site you own, and before adding a bridge method.

## Trust boundaries

```
┌────────────────────────── host app (web / desktop) ──────────────────────────┐
│  keys (WebCrypto non-extractable / daemon keyring)   universal client        │
│  confirmation dialog   permission check   id unpacking   result sanitising    │
│         ▲ postMessage (JSON, opaque origin, source-checked)                   │
│  ┌──────┴───────────────── sandboxed iframe ───────────────────────────────┐  │
│  │  extension code (HTML/JS from IPFS or a dev server)   extension SDK      │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Three parties: the **extension author** (publishes the extension document), the **site owner** (installs it on their
site), and the **viewer** (runs it, and is asked to sign). None of them has to trust the others more than the list
below.

## Guarantees

1. **Keys never cross the bridge.** Signing happens in the host with the same `HMSigner` the apps use for their own
   comments and edits (web: non-extractable WebCrypto device key holding a vault delegation; desktop: daemon
   `SignData`). The bridge returns signatures, never key material, and there is no method that exports, derives or
   delegates keys.
2. **Every signature is confirmed by the viewer** in a native dialog that names the extension, the site, the account,
   and the effect (comment text, document + metadata changes, or the purpose string and byte length for raw data). When
   a developer override is active the dialog also shows a warning with the override URL, so the viewer can tell the
   request is not coming from the published entry. The **Approve** button is inert for about 500 ms after the dialog
   opens (the same hardening browsers apply to permission prompts), so a click already in flight — the second half of a
   double-click on a decoy the extension drew where the button lands — cannot approve a signature the viewer never read.
   "Allow for this session" is in-memory only and scoped to `(extension, site, account, code source)`: a grant given
   while the published entry was running does not carry over to a dev override, or vice versa. Even with a session
   grant, a `sign.document` that touches the metadata keys `extensions` (install records) or `seedExtension` (an
   extension manifest) is always confirmed, so a session grant can never turn into persistent control over which code a
   site runs.
3. **Raw signatures are domain-separated.** `sign.data` signs
   `"seed-extension-signature:v1\n" + extensionId + "\n" + bytes`. A signature obtained this way can never be presented
   as a Seed protocol blob (comments, changes, refs, capabilities all sign CBOR structures with different leading
   bytes).
4. **Origin isolation.** The iframe has `sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"`
   and never `allow-same-origin`, so it runs at an opaque origin: no host cookies, no host localStorage or IndexedDB
   (where the web session lives), no DOM access to the host, no same-origin fetches to the site API. `file.url`
   responses are served with permissive CORS on purpose — they are public content-addressed bytes.
5. **Only the frame's own window is trusted.** The host accepts bridge messages only when
   `event.source === iframe.contentWindow`. Messages from other frames, extensions, or the host page itself are ignored.
6. **Permissions are declared and enforced.** The manifest lists `sign`, `navigate`, `storage`. The bridge rejects
   methods outside the granted set with `permission_denied` before touching any handler. Install UIs show the list.
   Reading public hypermedia data needs no permission — it is public.
7. **What runs is pinned.** An install record stores the extension document version; hosts load that version's manifest
   and entry CID. Content addressing makes "the same code as when I installed it" a property, not a promise. Updates are
   an explicit site-owner action. The only way to run different code is a per-browser developer override, and `?extdev=`
   in a page URL only accepts loopback URLs (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`); any other value is
   ignored, so a link cannot make a viewer's browser run remote code under an installed extension's name. Overrides
   pointing at other hosts can only be entered by hand in the desktop Settings editor, and an active override is
   announced by the dev banner and in every sign dialog.
8. **Installing is signed data.** Only holders of write capability on the site home document can add, change or remove
   an install record.
9. **Reads are read-only.** `api.query` is restricted to `EXTENSION_READ_QUERY_KEYS`; `PublishBlobs` and
   `PrepareDocumentChange` are unreachable through it. Results are converted to plain JSON before crossing the bridge.

## Non-goals (v1)

- **Network egress.** The iframe may `fetch` any CORS-enabled endpoint. An extension can therefore exfiltrate what it
  reads (public data plus the viewer's account id and name). Treat an extension like a web page you visit.
- **Private data.** Extensions read through the viewer's client, so they can read private documents the viewer can read.
  The confirmation dialog does not cover reads. Do not install extensions you would not let read your screen.
- **Resource limits.** No CPU/memory caps beyond the browser's per-frame ones.
- **Phishing inside the frame.** The frame can draw anything, including fake "sign in" UI. Mitigation: the host's real
  dialogs are outside the frame; the frame cannot draw over host chrome. Sign-in never happens inside the frame.
- **Supply chain of the entry.** The entry is addressed by the CID in the manifest and fetched from the host's own
  daemon (desktop: `<daemon>/ipfs/<cid>`; web: the site's `/hm/api/file/<cid>` proxy, which validates the CID before
  forwarding). The host does not re-hash the bytes it receives, so "the same code as when I installed it" is only as
  strong as the trust in that fetch path — the pin protects against the author republishing, not against a tampered
  daemon or proxy. The host does not audit the code either.

## Reviewer checklist for new bridge methods

- Does it need a permission? Add it to `EXTENSION_METHOD_PERMISSIONS`.
- Can the result leak anything a read query could not? If yes, gate it.
- Does it write? It must go through a confirmation dialog and `HMSigner`.
- Are params validated with a zod schema in `bridge-schemas.ts`?
- Is the result postMessage-cloneable and free of BigInt/Uint8Array surprises?
