---
name: URLs
summary: The hm:// URL names a space, a path, optionally an exact version and a block or text range, and this page gives the full grammar, the view suffixes, comment addresses, and how web URLs map to it.
---
A Hypermedia link names a thing by its owner. The server that holds it does not appear. An `hm://` URL starts with an [account](./identity.md)'s public key, which names its [space](./spaces.md), and continues with a path the owner chose. It can pin an exact [version](./documents.md), and even a single paragraph or a range of words inside it. Any web [site](./sites.md) that runs Seed can serve the same [document](./documents.md) under an ordinary `https://` URL, and the two forms convert into each other exactly. <!-- id:rfRwLU52 -->

# The grammar <!-- id:JuiXbcTE -->

``` <!-- id:Ib7Sw1pA -->
hm://<uid>[/<path>][?v=<version>[&l]][#<block>[+|[<start>:<end>]]]
```

<!-- id:FLoWEDnb -->
| part <!-- col:ug_RNDrs --> | meaning <!-- col:yTDgo6kN --> | example <!-- col:nbb7UT6K --> <!-- id:_eS1u3xo --> |
| --- | --- | --- |
| `uid` | the [principal](../principal.md) of the space, in its string form | `z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB` <!-- id:cz8g2Ncw --> |
| `path` | zero or more `/`-separated segments; none means the home document | `/notes/sushi` <!-- id:1ZrVsBoa --> |
| `v=` | an exact [version](./documents.md): the head Change CIDs, sorted, joined with `.` | `?v=bafyreid3…` or `?v=bafyreia….bafyreib…` <!-- id:XW3ciLKD --> |
| `l` | present with `v`: "the latest version, and at least this one" | `?v=bafyreid3…&l` <!-- id:iJE6jW76 --> |
| `#block` | a [block](./blocks.md) id inside the document | `#Zr1kAbQ2` <!-- id:sBO4XR6j --> |
| `#block+` | the block and all of its children | `#Zr1kAbQ2+` <!-- id:6MZIgv-a --> |
| `#block[start:end]` | a range of text inside the block, in Unicode code points | `#Zr1kAbQ2[12:40]` <!-- id:BUdBcK3j --> |

So `hm://z6Mkfz…/notes/sushi?v=bafyreid3…#Zr1kAbQ2[12:40]` means "characters 12 to 40 of block Zr1kAbQ2, in the version whose single head is bafyreid3…, of the document at /notes/sushi in the space z6Mkfz…". Without `v` the URL means the latest version the reader knows about. With `v` alone it is an immutable reference. With `v` and `l` it asks for the newest version but records the one the author saw, so the link still works as an exact citation if the document is deleted. The daemon does not enforce the "at least" part: when `l` is present it returns the latest version it knows. <!-- id:Ccp6Y7Wg -->

Paths must start with `/`, must not end with `/`, and may not contain single or double quotes, backslashes, NUL, tab, CR or LF. The daemon rejects any [Ref](../ref.md) that breaks these rules. Two segment shapes have a special meaning. A path that is a single segment decoding as a [TSID](./blobs.md) (14 or 15 base58 characters) is a comment or contact record. The apps use a leading `-` for local draft paths that are never published. <!-- id:w3OedhEC -->

The `l` flag has no value and follows `v`, so it is always written `?v=<version>&l`.

A reference can name a web domain in place of the uid, as in `hm://hyper.media/agent/guide`. The reader resolves the domain to its registered account before reading the resource. The [SDK](../build/sdk.md) and embed readers use the domain cache first and fall back to the HTTPS `OPTIONS` headers described below. The path, version and block fragment survive resolution. An unresolved domain is an error and is never treated as an account id. The stored reference keeps the domain, while reads and discovery use the resolved id.

# Versions, blocks and ranges <!-- id:RQMevPWC -->

A version pins the whole history, because every head [Change](../change.md) links its dependencies by [CID](../cid.md). The same `v=` always replays to the same content on any node that has the blobs. Without `v`, a block reference `#id` follows the block wherever it moves in later versions. Combine both when you need a quotation that cannot drift. Ranges count Unicode code points. They do not count UTF-16 units or bytes, so an emoji counts once. <!-- id:kjOBFhbW -->

Links inside documents use the same grammar. A link annotation, an embed block, a button, and a mention all carry an `hm://` URL. The daemon indexes each of them as a citation of the target; see [Links and citations](./links-and-citations.md) for backlinks. Web URLs of Seed sites are converted to `hm://` when pasted into the editor. <!-- id:IlSRfmmm -->

# View suffixes <!-- id:KfDzsmvv -->

A path segment beginning with `:` after the document path selects a view of the same document. The apps and the web server understand all of them. The daemon and the agents runtime understand the ones marked. <!-- id:sC-3_RAs -->

<!-- id:BtVPKkn9 -->
| suffix <!-- col:zvOkSMbZ --> | shows <!-- col:EN9M9UTm --> | notes <!-- col:yPWuXlns --> <!-- id:hHX1Vr6g --> |
| --- | --- | --- |
| `/:directory` | the documents under this path | listing via [`Query`](../query.md); daemon discovery does not accept this suffix <!-- id:_XZPpsw7 --> |
| `/:comments` | the discussion | `/:comments/<uid>/<tsid>` opens one comment; `?panel=comments/<uid>/<tsid>` opens it in the side panel instead <!-- id:JBzA6ClQ --> |
| `/:activity` | the activity feed | `/:activity/comments`, `/versions`, `/citations` filter it <!-- id:H0vhpJEl --> |
| `/:collaborators` | who may [write](./permissions.md) here | <!-- id:3LQrMFfp --> |
| `/:attributes` | the metadata as attributes | `/:metadata` is accepted for old links <!-- id:Yg_h-f9E --> |
| `/:schema` | the [schema](../schema.md) this document defines | <!-- id:OV2cqeHD --> |
| `/:profile` | the account's [profile](../profile.md) | also accepted by daemon discovery <!-- id:bToA9-Py --> |
| `/:membership`, `/:followers`, `/:following` | [contact](./contacts.md) views of a space | optionally `/:followers/<uid>` <!-- id:kZTvciM8 --> |
| `/:feed`, `/:all-documents`, `/:explore`, `/:settings` | site-level views | app and web only <!-- id:qj1efh9h --> |

The [agents runtime](../agent.md)'s [`read`](../agent/read.md) verb accepts `/:directory`, `/:attributes`, `/:profile` and `/:comments` on an `hm://` address. The daemon's [discovery](./network.md) request also understands the wildcards `hm://<uid>/<path>/*` (one level) and `hm://<uid>/<path>/**` (everything beneath). <!-- id:P-bycAsF -->

# Comments and other records <!-- id:MTAqFeRT -->

A [comment](./comments.md)'s identity is `<author uid>/<tsid>`, and its address is `hm://<author uid>/<tsid>`. The record lives in its author's space. The document it is about may be in another space. On the web it is usually shown in context as `https://<site>/<doc path>/:comments/<author uid>/<tsid>`, with `?v=<comment cid>` pinning one edit of the comment. Contacts are addressed the same way by TSID. [Capabilities](./permissions.md) have no URL, and the API lists them. The daemon's link indexer also understands `hm://c/<cid>`, a link to one exact comment blob. The apps never write that form. <!-- id:SGCNi-zq -->

Three older forms still parse: `/:discussions` means `/:comments`, `?panel=comment/<uid>/<tsid>` means `?panel=comments/<uid>/<tsid>`, and `?panel=discussions/<block id>` opens the discussion of one block. [Comments](./comments.md) describes threads and replies.

# Web URLs and hm URLs <!-- id:Q6dkury9 -->

Every Seed web server, whether it is `hyper.media` or a site published at its own domain, serves documents at two kinds of URL: <!-- id:n5JI88cM -->

<!-- id:1xcg_dTU -->
| web form <!-- col:302cNEji --> | meaning <!-- col:b3G9iKE3 --> <!-- id:dCeJDlSo --> |
| --- | --- |
| `https://<host>/hm/<uid>[/<path>]` | the gateway form: any document of any space, convertible 1:1 to `hm://<uid>/<path>` <!-- id:1v21okmr --> |
| `https://<host>[/<path>]` | the site form: the document at `path` in the space registered to that host <!-- id:1l0vgKEy --> |

Query parameters and fragments carry over unchanged, so `https://hyper.media/hm/z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` and `hm://z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` are the same reference. This keeps web links durable. If the `hyper.media` server is offline, a reader who knows the rule can keep using the `/hm/` URLs as `hm://` URLs on the peer-to-peer [network](./network.md). See [broken links](../why/broken-links.md). A site renders any document this way, including other accounts' documents, because documents link across spaces and a linked space may have no site at all. <!-- id:eCbqzq-L -->

The site form needs one extra fact: which space the host is registered to. Three mechanisms provide it: <!-- id:92vvfi31 -->
  1. `GET https://<host>/hm/api/config` returns `{registeredAccountUid, peerId, addrs, …}`. The daemon uses this to resolve any `https://` URL you hand to it. One Seed node also learns this way which peer serves a site; see [Sites](./sites.md). <!-- id:fx9paYGo -->
  2. Any document page answers `OPTIONS` (and `GET`) with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` (`Document` or `Comment`), `X-Hypermedia-Authors` and, for comments, `X-Hypermedia-Target`. The id, title, authors and target are URL-encoded. The response is 200 with only CORS headers if the URL does not resolve. <!-- id:td6m4z0M -->
  3. The same values are in the HTML as `<meta name="hypermedia_id">`, `hypermedia_version`, `hypermedia_title`, `hypermedia_type`, `hypermedia_authors` and `hypermedia_target`. <!-- id:gdZEaddn -->

Add `.md` or `.json` to the document segment of a site URL to export it: `https://<host>/notes/sushi.md`, `/notes/sushi.json/:directory`, `/hm/<uid>/<path>.md`, with the `v` and `l` parameters honoured. <!-- id:MzL0HPy7 -->

## Reserved first segments <!-- id:mJl-MXsn -->

A site keeps these first segments for itself, so a document path cannot start with them:
  - `/hm/…` is the [gateway](./sites.md) namespace, and `/hm/api/…` holds its services. <!-- id:hhy1aPmM -->
  - `/api/<Key>` is the [Seed API](../build/web-api.md). <!-- id:AB08SQb4 -->
  - `/ipfs/<cid>` serves raw blobs ([Files](./files.md)). The site's reverse proxy sends it to the daemon. <!-- id:NJc-Zih1 -->
  - `/assets/`, `/favicon.ico` and `/robots.txt` belong to the web app. <!-- id:tMrg73-4 -->

The apps refuse to create a document whose path is `hm`, `api`, `assets`, `favicon.ico` or `robots.txt`, or whose first segment starts with `-`, `.` or `_`. The last rule keeps `/.well-known/` free. A site keeps working if a document exists at one of these paths.

Under `/hm/`, the segments `download`, `connect`, `register`, `profile`, `contact`, `agents`, `auth`, `create-site`, `notifications`, `embed` and `inspect` are pages. None of them is a space. In the `hm://` scheme itself, `hm://connect/<payload>` carries a peer-connection invitation and `hm://inspect/<uid>/<path>` opens the app's blob inspector. Neither is a document address. <!-- id:uTivcFxL -->

# Working with URLs <!-- id:6fOFhA7C -->

- **Seed app.** Copy Link on a document, a block or a selection produces the site form when the space has a site, and the gateway form otherwise. Pasting an `hm://` or a Seed web URL into the editor makes a link.
- **CLI.** Every command that takes an id accepts `hm://` and Seed web URLs alike. See the [CLI reference](../build/cli.md).
- **SDK.** `unpackHmId(url)` parses `hm://` and gateway URLs, `packHmId(id)` writes the `hm://` form, and `resolveHypermediaUrl(url)` resolves any web URL. See the [SDK guide](../build/sdk.md).
- **Web API.** `GET /api/Resource?id=<url-encoded hm:// URL>` reads a resource by its URL. See the [Seed API guide](../build/web-api.md).
- **Agents.** [`read`](../agent/read.md) and [`write`](../agent/write.md) take an `hm://` URL. See [using Seed from your own agent](../build/agents.md).

To turn an unknown web URL into an `hm://` one from a shell:

```sh <!-- id:GNZ3b7P5 -->
curl -s -X OPTIONS -I https://example.org/some/page | grep -i x-hypermedia
```

# See also <!-- id:zi3pWi3V -->

- [Documents](./documents.md) for what a version is. <!-- id:84OVp_oO -->
- [Blocks](./blocks.md) for block ids and ranges. <!-- id:Lvw4oYNf -->
- [Spaces](./spaces.md) for paths and the home document.
- [Sites](./sites.md) for registration and `/hm/api/config`. <!-- id:lvPrUoZm -->
- [Comments](./comments.md) for comment ids. <!-- id:xZAg6Qsx -->
- [Links and citations](./links-and-citations.md) for how the links in content are indexed.
- [Network](./network.md) for how an `hm://` address is discovered. <!-- id:8N3XnLBb -->
- Schema pages: [hm-url](../hm-url.md) (the value type used in schemas), [ipfs-url](../ipfs-url.md), [principal](../principal.md). <!-- id:_3qmjREW -->
