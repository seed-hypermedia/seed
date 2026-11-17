---
name: URLs
summary: An hm:// URL names a space, a path, and optionally an exact version and a block or text range, and this page gives the full grammar, the view suffixes, comment addresses and how web URLs map to it.
---
A Hypermedia link names a thing by its owner. It does not name the server that holds it. An `hm://` URL starts with the public key of an [account](./identity.md), which names its [space](./spaces.md). Then comes a path that the owner chose. For example, `hm://z6Mkfz…/notes/sushi` is the [document](./documents.md) at `/notes/sushi` in the space `z6Mkfz…`. <!-- id:rfRwLU52 -->

A URL can also pin an exact [version](./documents.md), one paragraph, or a range of words. Any web [site](./sites.md) that runs Seed can serve the same document under an ordinary `https://` URL. The two forms convert into each other exactly.

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

So `hm://z6Mkfz…/notes/sushi?v=bafyreid3…#Zr1kAbQ2[12:40]` means "characters 12 to 40 of block Zr1kAbQ2, in the version whose single head is bafyreid3…, of the document at /notes/sushi in the space z6Mkfz…". <!-- id:Ccp6Y7Wg -->

- Without `v`, the URL means the latest version the reader knows about.
- With `v` alone, it is a reference that never changes.
- With `v` and `l`, it asks for the newest version but records the one the author saw. So the link still works as an exact citation if the document is deleted.

The [daemon](../software/daemon.md) does not enforce the "at least" part. When `l` is present it returns the latest version it knows.

A path must start with `/` and must not end with `/`. It may not contain single or double quotes, backslashes, NUL, tab, CR or LF. The daemon rejects any [Ref](../ref.md) that breaks these rules. Two segment shapes have a special meaning: <!-- id:w3OedhEC -->

- A path that is a single segment decoding as a [TSID](./blobs.md) (14 or 15 base58 characters) is a comment or contact record.
- The apps use a leading `-` for local draft paths. Those are never published.

The `l` flag has no value and follows `v`, so it is always written `?v=<version>&l`.

A reference can name a web domain in place of the uid, as in `hm://hyper.media/agent/guide`. The reader resolves the domain to its registered account before it reads the resource.

- The [SDK](../build/sdk.md) and embed readers use the domain cache first. Then they fall back to the HTTPS `OPTIONS` headers described below.
- The path, the version and the block fragment survive resolution.
- A domain that does not resolve is an error. It is never treated as an account id.
- The stored reference keeps the domain. Reads and discovery use the resolved id.

# Versions, blocks and ranges <!-- id:RQMevPWC -->

A version pins the whole history, because every head [Change](../change.md) links its dependencies by [CID](../cid.md). The same `v=` always replays to the same content on any node that has the blobs. Without `v`, a block reference `#id` follows the block wherever it moves in later versions. Use both when you need a quotation that cannot drift. Ranges count Unicode code points. They do not count UTF-16 units or bytes, so an emoji counts once. <!-- id:kjOBFhbW -->

Links inside documents use the same grammar. A link annotation, an embed block, a button and a mention all carry an `hm://` URL. The daemon indexes each of them as a citation of the target; see [Links and citations](./links-and-citations.md) for backlinks. When you paste the web URL of a Seed site into the editor, the editor converts it to `hm://`. <!-- id:IlSRfmmm -->

# View suffixes <!-- id:KfDzsmvv -->

A path segment that begins with `:` after the document path selects a view of the same document. The apps and the web server understand all of them. The daemon and the [app environment](../software/app-environment.md) understand the ones marked. <!-- id:sC-3_RAs -->

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
| `/:feed`, `/:all-documents`, `/:explore`, `/:settings` | site-level views | app and web only; `/:settings` is site-level on a space, and on an agent document it opens the agent's settings <!-- id:qj1efh9h --> |
| `/:app/<view>`, `/:sessions`, `/:session/<id>`, `/:triggers`, `/:memory`, `/:access`, `/:call/<id>` | the tabs of an [app](../app.md) or a mounted [agent](../agent/mounting.md) | app and web only |

An [agent](../agent.md)'s [`read`](../agent/read.md) verb accepts `/:directory`, `/:attributes`, `/:profile` and `/:comments` on an `hm://` address. The daemon's [discovery](./network.md) request also understands two wildcards: `hm://<uid>/<path>/*` (one level) and `hm://<uid>/<path>/**` (everything beneath). <!-- id:P-bycAsF -->

# Comments and other records <!-- id:MTAqFeRT -->

A [comment](./comments.md)'s identity is `<author uid>/<tsid>`, and its address is `hm://<author uid>/<tsid>`. The record lives in its author's space. The document it is about may be in another space. <!-- id:SGCNi-zq -->

- On the web a comment is usually shown in context as `https://<site>/<doc path>/:comments/<author uid>/<tsid>`. Add `?v=<comment cid>` to pin one edit of the comment.
- Contacts are addressed the same way, by TSID.
- [Capabilities](./permissions.md) have no URL. The API lists them.
- The daemon's link indexer also understands `hm://c/<cid>`, a link to one exact comment blob. The apps never write that form.

Four older forms still parse: `/:comment` and `/:discussions` both mean `/:comments`, `?panel=comment/<uid>/<tsid>` means `?panel=comments/<uid>/<tsid>`, and `?panel=discussions/<block id>` opens the discussion of one block. [Comments](./comments.md) describes threads and replies.

# Web URLs and hm URLs <!-- id:Q6dkury9 -->

Every Seed web server serves documents at two kinds of URL. This is true for `hyper.media` and for a site published at its own domain. <!-- id:n5JI88cM -->

<!-- id:1xcg_dTU -->
| web form <!-- col:302cNEji --> | meaning <!-- col:b3G9iKE3 --> <!-- id:dCeJDlSo --> |
| --- | --- |
| `https://<host>/hm/<uid>[/<path>]` | the gateway form: any document of any space, convertible 1:1 to `hm://<uid>/<path>` <!-- id:1v21okmr --> |
| `https://<host>[/<path>]` | the site form: the document at `path` in the space registered to that host <!-- id:1l0vgKEy --> |

Query parameters and fragments carry over unchanged. So `https://hyper.media/hm/z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` and `hm://z6Mkfz…/notes/sushi?v=…#Zr1kAbQ2+` are the same reference. This makes web links last. If the `hyper.media` server is offline, a reader who knows the rule can keep using the `/hm/` URLs as `hm://` URLs on the peer-to-peer [network](./network.md). See [broken links](../why/broken-links.md). <!-- id:eCbqzq-L -->

A site renders any document this way, including other accounts' documents. It must, because documents link across spaces, and a linked space may have no site at all.

The site form needs one extra fact: which space the host is registered to. There are three ways to learn it: <!-- id:92vvfi31 -->
  1. `GET https://<host>/hm/api/config` returns `{registeredAccountUid, peerId, addrs, …}`. The daemon uses this to resolve any `https://` URL you hand to it. A Seed node also learns this way which peer serves a site; see [Sites](./sites.md). <!-- id:fx9paYGo -->
  2. Any document page answers `OPTIONS` (and `GET`) with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` (`Document` or `Comment`), `X-Hypermedia-Authors` and, for comments, `X-Hypermedia-Target`. The id, title, authors and target are URL-encoded. If the URL does not resolve, the response is 200 with only CORS headers. <!-- id:td6m4z0M -->
  3. The same values are in the HTML as `<meta name="hypermedia_id">`, `hypermedia_version`, `hypermedia_title`, `hypermedia_type`, `hypermedia_authors` and `hypermedia_target`. <!-- id:gdZEaddn -->

Add `.md` or `.json` to the document segment of a site URL to export it: `https://<host>/notes/sushi.md`, `/notes/sushi.json/:directory`, `/hm/<uid>/<path>.md`. The export honours the `v` and `l` parameters. <!-- id:MzL0HPy7 -->

## Reserved first segments <!-- id:mJl-MXsn -->

A site keeps these first segments for itself, so a document path cannot start with them:
  - `/hm/…` is the [gateway](./sites.md) namespace, and `/hm/api/…` holds its services. <!-- id:hhy1aPmM -->
  - `/api/<request name>`, such as `/api/Resource`, is the [Seed API](../build/web-api.md). <!-- id:AB08SQb4 -->
  - `/ipfs/<cid>` serves raw blobs ([Files](./files.md)). The site's reverse proxy sends it to the daemon. <!-- id:NJc-Zih1 -->
  - `/assets/`, `/favicon.ico` and `/robots.txt` belong to the [web app](../software/web.md). <!-- id:tMrg73-4 -->

The apps refuse to create a document whose path is `hm`, `api`, `assets`, `favicon.ico` or `robots.txt`, or whose first segment starts with `-`, `.` or `_`. The last rule keeps `/.well-known/` free. A site keeps working if a document exists at one of these paths.

Under `/hm/`, these segments are pages: `download`, `connect`, `register`, `profile`, `contact`, `agents`, `auth`, `sign-in`, `create-site`, `drafts`, `notifications`, `email-notifications`, `embed`, `inspect` and `page-runner`. None of them is a space. In the `hm://` scheme itself, `hm://connect/<payload>` carries an invitation to connect to a peer, and `hm://inspect/<uid>/<path>` opens the app's blob inspector. Neither is a document address. <!-- id:uTivcFxL -->

# Working with URLs <!-- id:6fOFhA7C -->

- **Seed app.** In the [Seed app](../software/desktop.md), Copy Link on a document, a block or a selection gives the site form when the space has a site, and the gateway form otherwise. Paste an `hm://` URL or a Seed web URL into the editor to make a link.
- **CLI.** Every command that takes an id accepts `hm://` and Seed web URLs alike. See [Seed CLI](../build/cli.md).
- **SDK.** `unpackHmId(url)` parses `hm://` and gateway URLs, `packHmId(id)` writes the `hm://` form, and `resolveHypermediaUrl(url)` resolves any web URL. See [SDK](../build/sdk.md).
- **Seed API.** `GET /api/Resource?id=<url-encoded hm:// URL>` reads a resource by its URL. See [Seed API](../build/web-api.md).
- **Agents.** [`read`](../agent/read.md) and [`write`](../agent/write.md) take an `hm://` URL. See [Using Seed from your own agent](../build/agents.md).

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
