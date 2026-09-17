---
name: URLs
summary: The hm:// URL names a space, a path, optionally an exact version and a block or text range, and this page gives the full grammar, the view suffixes, comment addresses, and how web URLs map to it.
---
A Hypermedia link names a thing by who owns it rather than by which server holds it. An `hm://` URL starts with an account's public key, continues with a path the owner chose, and can pin an exact version and even a single paragraph or a range of words inside it. Any web site that runs Seed can serve the same document under an ordinary `https://` URL, and the two forms convert into each other exactly.

# The grammar

```
hm://<uid>[/<path>][?v=<version>[&l]][#<block>[+|[<start>:<end>]]]
```

| part | meaning | example |
| --- | --- | --- |
| `uid` | the [principal](../principal.md) of the space, in its string form | `z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB` |
| `path` | zero or more `/`-separated segments; none means the home document | `/notes/sushi` |
| `v=` | an exact [version](./documents.md): the head Change CIDs, sorted, joined with `.` | `?v=bafyreid3…` or `?v=bafyreia….bafyreib…` |
| `l` | present with `v`: "the latest version, and at least this one" | `?v=bafyreid3…&l` |
| `#block` | a block id inside the document | `#Zr1kAbQ2` |
| `#block+` | the block and all of its children | `#Zr1kAbQ2+` |
| `#block[start:end]` | a range of text inside the block, in Unicode code points | `#Zr1kAbQ2[12:40]` |

So `hm://z6Mkfz…/notes/sushi?v=bafyreid3…#Zr1kAbQ2[12:40]` means "characters 12 to 40 of block Zr1kAbQ2, in the version whose single head is bafyreid3…, of the document at /notes/sushi in the space z6Mkfz…". Without `v` the URL means the latest version the reader knows about. With `v` alone it is an immutable reference; with `v` and `l` it asks for the newest version but records the one the author saw, so the link degrades gracefully to an exact citation if the document is deleted. The daemon today simply returns the latest version when `l` is present.

Paths must start with `/`, must not end with `/`, and may not contain quotes, backslashes or control characters; the daemon rejects any Ref that says otherwise. Two segment shapes have a special meaning: a first segment that parses as a TSID (14 or 15 base58 characters) is a comment or contact record, and the apps use a leading `-` for local draft paths that are never published.

# Versions, blocks and ranges

A version pins the whole history, because every head Change links its dependencies by CID: the same `v=` will always replay to the same content on any node that has the blobs. A block reference `#id` follows the block wherever it moves in later versions if `v` is absent; combine both when you need a quotation that cannot drift. Ranges count Unicode code points, not UTF-16 units or bytes, so an emoji counts once.

Links inside documents use the same grammar: a link annotation, an embed block, a button, and a mention all carry an `hm://` URL, and the daemon indexes each of them as a citation of the target; see [Comments](./comments.md) for backlinks. Web URLs of Seed sites are converted to `hm://` when pasted into the editor.

# View suffixes

A path segment beginning with `:` after the document path selects a view of the document rather than a different document. These are understood by the apps, the web server and, for the ones marked, the daemon and the agents runtime.

| suffix | shows | notes |
| --- | --- | --- |
| `/:directory` | the documents under this path | listing via `Query`; reserved but unimplemented in daemon discovery |
| `/:comments` | the discussion | `/:comments/<uid>/<tsid>` opens one comment |
| `/:activity` | the activity feed | `/:activity/comments`, `/versions`, `/citations` filter it |
| `/:collaborators` | who may write here | |
| `/:attributes` | the metadata as attributes | `/:metadata` is accepted for old links |
| `/:schema` | the schema this document defines | |
| `/:profile` | the account's profile | also accepted by daemon discovery |
| `/:membership`, `/:followers`, `/:following` | contact views of a space | optionally `/:followers/<uid>` |
| `/:feed`, `/:all-documents`, `/:explore`, `/:settings` | site-level views | app and web only |

The agents runtime's `read` verb accepts `/:directory`, `/:attributes`, `/:profile` and `/:comments` on an `hm://` address. The daemon's discovery request additionally understands the wildcards `hm://<uid>/<path>/*` (one level) and `hm://<uid>/<path>/**` (everything beneath).

# Comments and other records

A comment's identity is `<author uid>/<tsid>`, and its address is `hm://<author uid>/<tsid>`: the record lives in its author's space, not in the space of the document it is about. On the web it is usually shown in context as `https://<site>/<doc path>/:comments/<author uid>/<tsid>`, with `?v=<comment cid>` pinning one edit of the comment. Contacts are addressed the same way by TSID; capabilities are listed through the API rather than addressed by URL. The daemon's link indexer also understands `hm://c/<cid>`, a link to one exact comment blob, though the apps do not produce that form today.

# Web URLs and hm URLs

Every Seed web server, whether it is `hyper.media` or a site published at its own domain, serves documents at two kinds of URL:

| web form | meaning |
| --- | --- |
| `https://<host>/hm/<uid>[/<path>]` | the gateway form: any document of any space, convertible 1:1 to `hm://<uid>/<path>` |
| `https://<host>[/<path>]` | the site form: the document at `path` in the space registered to that host |

Query parameters and fragments carry over unchanged, so `https://hyper.media/hm/z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` and `hm://z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` are the same reference. This is what makes web links durable: if the `hyper.media` server is offline, a reader who knows the rule can keep using the `/hm/` URLs as `hm://` URLs on the peer-to-peer network.

The site form needs one extra fact, which space the host is registered to. Three mechanisms provide it:

1. `GET https://<host>/hm/api/config` returns `{registeredAccountUid, peerId, addrs, …}`. The daemon uses this to resolve any `https://` URL you hand to it, and it is how one Seed node learns which peer serves a site; see [Sites](./sites.md).
2. Any document page answers `OPTIONS` (and `GET`) with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` (`Document` or `Comment`), `X-Hypermedia-Authors` and, for comments, `X-Hypermedia-Target`, all URL-encoded. The response is 200 with only CORS headers if the URL does not resolve.
3. The same values are in the HTML as `<meta name="hypermedia_id">`, `hypermedia_version`, `hypermedia_title`, `hypermedia_type`, `hypermedia_authors` and `hypermedia_target`.

Add `.md` or `.json` to the document segment of a site URL to export it: `https://<host>/notes/sushi.md`, `/notes/sushi.json/:directory`, `/hm/<uid>/<path>.md`, with `?v=` and `?l` honoured.

## Reserved first segments

On a web host, `/hm/…` is the gateway namespace and `/hm/api/…` its services; `/api/<Key>` is the Seed API; `/ipfs/<cid>` serves raw blobs; `/robots.txt` and `/.well-known/` are the usual web reservations. Under `/hm/`, the segments `download`, `connect`, `register`, `profile`, `contact`, `agents`, `auth`, `create-site`, `notifications`, `embed` and `inspect` are pages, not spaces. In the `hm://` scheme itself, `hm://connect/<payload>` carries a peer-connection invitation and `hm://inspect/<uid>/<path>` opens the app's blob inspector; neither is a document address.

# Working with URLs

## In the Seed app

Copy Link on a document, a block or a selection produces the site form when the space has a site and the gateway form otherwise, with `#block+` for a whole block and `#block[start:end]` for a selection; the version graph's "Exact version" link adds `v=`. Pasting either an `hm://` or a Seed web URL into the editor makes a link; the app registers `hm://` as an operating-system scheme, so such links open the desktop app.

## CLI

Every command that takes an id accepts `hm://` and Seed web URLs alike: `seed-cli document get https://hyper.media/hm/<uid>/<path>` and `seed-cli document get hm://<uid>/<path>?v=<version>` both work, and `document get <url>/:directory` lists children. To turn an unknown web URL into an `hm://` one from a shell:

```sh
curl -s -X OPTIONS -I https://example.org/some/page | grep -i x-hypermedia
```

## SDK

`unpackHmId(url)` parses both forms into `{uid, path, version, latest, blockRef, blockRange, hostname}`, `packHmId(id)` writes the `hm://` form, and `parseFragment` / `serializeBlockRange` handle the `#` part. `resolveHypermediaUrl(url)` resolves an arbitrary web URL through `/hm/api/config` and then the `OPTIONS` headers, and `createWebHMUrl` / `createSiteUrl` build web forms. All of these are in `@seed-hypermedia/client`; see [the SDK guide](../build/sdk.md).

## Web API

The `Resource` request takes the packed id as its `id` parameter: `GET /api/Resource?id=hm://<uid>/<path>?v=…` (URL-encoded). The daemon's `GetResource` accepts `hm://`, `http://` and `https://` and does the `/hm/api/config` resolution itself. `GET /api/DiscoveryStatus?uid=&path=&v=` reports whether a node has fetched a document it did not have. See [the Seed API guide](../build/web-api.md).

## Agents

Seed Agents address everything by URL: `read hm://<uid>/<path>` (with `?v=`, `/:directory`, `/:attributes`, `/:profile`, `/:comments`, or a comment id `hm://<uid>/<tsid>`), `read https://…` (tried as Hypermedia first, then as a web page), and `write hm://<uid>/<path>`. An external agent should convert web URLs with the `OPTIONS` trick above before calling the CLI. See [Agents](../build/agents.md).

# See also

- [Documents](./documents.md) for what a version is; [Blocks](./blocks.md) for block ids and ranges.
- [Sites](./sites.md) for registration and `/hm/api/config`; [Comments](./comments.md) for comment ids.
- Schema pages: [hm-url](../hm-url.md) (the value type used in schemas), [ipfs-url](../ipfs-url.md), [principal](../principal.md).
