---
name: Glossary
summary: This page defines every term the Hypermedia and Seed pages use, in one or two plain sentences each, with a link to the page that explains it.
---
This page defines the words that the rest of the site uses. Each entry is short and links to the page that explains the term in full. So you can use it as a dictionary and as a map. The terms are in groups, from identity first to running Seed last. <!-- id:3OiP0-xD -->

Hypermedia is the protocol, and Seed is the software that runs it. When an entry says "the daemon", it means the Seed daemon. <!-- id:rRU2ox4F -->

# Identity and keys <!-- id:T_8Q8IGa -->

- **Account.** A key pair used as an identity. Its public key is its name, and no other record of the account exists. See [Identity](./protocol/identity.md). <!-- id:Eq4EScpl -->
- **Space.** All the documents one account owns, addressed as `hm://<account>/<path>`. Account and space are one key seen from two sides: the identity that signs, and the place where its documents live. See [Spaces](./protocol/spaces.md). For the agent meaning see [the agents glossary](./agent/glossary.md). <!-- id:t-7AMQ1Y -->
- **Principal.** A public key as it is written inside data: a short code for the kind of key, then the key bytes. As text it starts with `z6Mk` for Ed25519 keys and `zDn` for P-256 keys. See [Principal](./principal.md). <!-- id:nPBRgL2N -->
- **Account ID, uid.** The text form of an account's principal, as it appears in URLs, for example `z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS`. See [Identity](./protocol/identity.md). <!-- id:m6GkTW-R -->
- **Key name.** A local name under which the daemon or the CLI stores a key, such as `main`. It is not the principal, and it means nothing to other people. See [Keys](./build/keys.md). <!-- id:YYW7wBy9 -->
- **Mnemonic.** A list of 12, 15, 18, 21 or 24 words (BIP-39), with an optional passphrase, from which an Ed25519 account key is made on the path `m/44'/104109'/0'`. One mnemonic and passphrase give exactly one account. See [Identity](./protocol/identity.md). <!-- id:3dJyziCz -->
- **Key file.** An exported `.hmkey.json` file that holds one key, with an optional password. The CLI and CI jobs use it. See [Keys](./build/keys.md). <!-- id:PWw0yDWc -->
- **Vault.** The encrypted key store behind sign-in on the web and in the Seed app. The server that holds a vault cannot read the keys in it. See [The identity vault](./software/vault.md) and [Sign in with Seed](./build/sign-in.md). <!-- id:On4tmukn -->
- **Local vault file.** `vault.json` in the daemon's data directory. It is the encrypted store for account keys on one machine. It is not the vault service, but it can sync with it. See [The Seed daemon](./software/daemon.md).
- **Session key.** A key that a browser holds. A vault account gives it an AGENT capability, so a site can sign for you and never receives your account key. See [Sign in with Seed](./build/sign-in.md). <!-- id:HdEIPBwG -->
- **Sign in with Seed.** A way for a website to act as a person's account without holding the account key. The browser makes a session key, and the person's vault signs a capability for it. See [Sign in with Seed](./build/sign-in.md).
- **Device key.** The Ed25519 key that names one running daemon as a peer on the network. It secures connections and never signs content. See [Network](./protocol/network.md). <!-- id:eBS-9s56 -->
- **Profile.** A small signed blob that gives an account a name, an avatar and a description. The daemon merges all the profile blobs of an account field by field. See [Profile](./profile.md). <!-- id:V2quF0dS -->
- **Alias.** A profile whose only field points at another account. It means "this key is really that account". The daemon accepts it only if that account gave the key an AGENT capability. See [Identity](./protocol/identity.md). <!-- id:J90CYDNz -->
- **Key linking.** Joining several keys into one identity. The main account gives the other key an AGENT capability, and the other key publishes an alias profile. This is how your desktop, phone and browser keys show up as one person. See [Identity](./protocol/identity.md). <!-- id:8XQHVpoa -->
- **Bearer token.** A token that the daemon gives a caller who shows a signed, short-lived capability. The Seed web app sends it along so that a site's daemon can serve you private content you may read. It never allows a write. See [Identity](./protocol/identity.md) and [Privacy](./protocol/privacy.md). <!-- id:g2T0h5UN -->

# Blobs and encoding <!-- id:NUGiiJeD -->

- **Blob.** A piece of data that never changes, named by the hash of its bytes. A structured blob is a signed DAG-CBOR map. A file chunk is unsigned IPFS data. See [Signed Blobs](./protocol/blobs.md). <!-- id:uZTgXmyY -->
- **CID.** A content identifier: a hash that names a blob and says how to read it. Hypermedia uses CIDv1 with the `dag-cbor` codec for structured blobs, and `dag-pb` and `raw` for files. See [CID](./cid.md). <!-- id:gkdzPdiY -->
- **DAG-CBOR.** The binary encoding of every structured blob: CBOR with sorted keys, shortest integers and built-in CID links. One value always encodes to the same bytes, so it always has one CID. See [DAG-CBOR](./schema/dag-cbor.md). <!-- id:9vQFpLmN -->
- **DAG-JSON.** The same data written as JSON. A link is written `{"/": "<cid>"}` and bytes are written `{"/": {"bytes": "…"}}`. The CLI prints blobs in this form. See [DAG-JSON](./schema/dag-json.md). <!-- id:y3XRlTZV -->
- **IPLD.** InterPlanetary Linked Data, the data model of IPFS. Its nine kinds of value are the ones Hypermedia uses. See [IPLD](./schema/ipld.md).
- **Signed envelope.** The four fields that every structured blob carries: `type`, `signer`, `sig` and `ts`. The signed API wraps its requests in a different envelope of its own. See [Blob](./blob.md) and [Signed API](./build/signed-api.md). <!-- id:iaM6m4wS -->
- **Envelope.** In DAG-JSON, the small object with the reserved `/` key that writes a link or bytes. It is not the signed envelope of a blob. See [Envelope](./schema/envelope.md).
- **Signature.** 64 bytes that prove the signer made the blob. The signer signs the blob's canonical encoding with the `sig` field set to 64 zero bytes. The field is always present. See [Signature](./signature.md). <!-- id:KGVtgLSC -->
- **Timestamp (`ts`).** The time the signer claims, in Unix milliseconds. Nothing checks it against real time when a blob arrives. See [Timestamp](./timestamp.md) and [Integrity](./protocol/integrity.md). <!-- id:BWO1r4Z9 -->
- **Snapshot blob.** A blob that carries the whole value of a record. An edit replaces it whole. Comments, contacts and profiles are snapshot blobs. Documents are the other kind, built from small changes. See [Signed Blobs](./protocol/blobs.md). <!-- id:BwhZWs55 -->
- **TSID.** A timestamped id: 10 bytes made of a 48-bit millisecond timestamp and the first 4 bytes of a SHA-256 hash, written as 14 or 15 base58 characters. It gives a snapshot record one identity across edits. See [Signed Blobs](./protocol/blobs.md). <!-- id:6EixjmEI -->
- **Stash.** Where the daemon keeps a blob that it stored but cannot read yet, because a blob it depends on has not arrived or the signer is not yet authorized. The daemon tries again when the missing piece arrives. See [Signed Blobs](./protocol/blobs.md). <!-- id:U86WqFrM -->
- **BLAKE2b and SHA-256 CIDs.** The daemon hashes the blobs it creates with BLAKE2b. The SDK and the apps use SHA-256. Both are valid names for the same bytes. When one blob points at another, upload the second under the exact CID the first one used. See [Signed Blobs](./protocol/blobs.md). <!-- id:dA5bUsiH -->

# Documents and resources <!-- id:TfdNYAw0 -->

- **Resource.** Anything that can change and is rebuilt from blobs that cannot: a document, a comment, a contact or a profile. The Seed API uses this word. See [The Hypermedia protocol](./protocol.md). <!-- id:EQ1YtOiK -->
- **IRI.** The daemon's internal name for a resource: an `hm://<account>/<path>` string with no version and no fragment. The daemon files sync scopes and subscriptions under it. See [Network](./protocol/network.md). <!-- id:pIQ8RxYJ -->
- **Document.** A resource built from changes: a graph of signed Changes, replayed into metadata and a tree of blocks, and placed at an address by a Ref. See [Documents](./protocol/documents.md) for the idea and [Document](./document.md) for the fields. <!-- id:KTSq9f-8 -->
- **Change.** One signed edit to a document: a list of operations, plus links to the changes it builds on. See [Change](./change.md). <!-- id:v_HHROc9 -->
- **Genesis.** The first Change of a document. It is the document's identity. Two Refs that name the same genesis are about the same document, wherever they place it. See [Documents](./protocol/documents.md). <!-- id:2KxUlfPD -->
- **Home document.** The document at the empty path of a space, `hm://<account>`. Its genesis is a fixed empty Change with `ts` 0, so every device of the account computes the same one. See [Spaces](./protocol/spaces.md). <!-- id:Dri6S3_G -->
- **Deps and depth.** The `deps` of a Change are the heads its author saw, sorted by CID. Its `depth` is one more than the deepest dep. Together they put the history in order. See [Change](./change.md). <!-- id:ihtU17b5 -->
- **Operation (op).** One edit inside a Change: `SetAttributes`, `ReplaceBlock`, `MoveBlocks`, `DeleteBlocks`, or the deprecated `SetKey`. Each has an id made of a timestamp, a position and an actor. The id decides which of two edits made at the same time wins. See [Operations](./change/op.md). <!-- id:qZKqO48U -->
- **CRDT.** A conflict-free replicated data type: a merge rule that brings every copy to the same state, in whatever order the edits arrive. For metadata, the newest write to a key wins. For blocks, each parent keeps an ordered list of children, and the newest move of a block wins. See [Documents](./protocol/documents.md). <!-- id:dy5OI6oD -->
- **Head.** A Change that no other Change builds on. A document with two heads has two edits made at the same time that nobody has merged. See [Documents](./protocol/documents.md). <!-- id:6xy8H4Ag -->
- **Version.** One exact state of a document: the CIDs of its heads, sorted and joined with `.`, written after `?v=` in a URL. A version always replays to the same content. See [Documents](./protocol/documents.md). <!-- id:BjQ5iozl -->
- **Latest (`l`).** A URL flag that means "the newest version, and at least this one". The daemon returns the newest version it knows. See [URLs](./protocol/urls.md). <!-- id:rs_XaEuE -->
- **Ref.** A signed claim about an address: it shows a given version, or it is deleted, or it redirects to another address. A document appears at an address only through a Ref from a signer who may write there. See [Ref](./ref.md). <!-- id:lPdSM9oW -->
- **Generation.** One life of an address, numbered by the writer. The highest generation wins. A Ref with a higher generation replaces whatever lived at the path. See [Documents](./protocol/documents.md). <!-- id:8rckapbW -->
- **Tombstone.** A Ref with a genesis and no heads. It marks the document as deleted. The history stays on every node that holds it. A deleted comment or contact also leaves a tombstone: a blob that marks the record as deleted. See [Documents](./protocol/documents.md) and [Signed Blobs](./protocol/blobs.md). <!-- id:0YElj_oJ -->
- **Redirect.** A Ref with no heads and a `redirect` target. Readers of the old address are sent to the new one. See [Redirect target](./ref/redirect-target.md). <!-- id:6FsTfeiy -->
- **Republish.** A redirect with `republish` set. The old address keeps showing the target's content under its own URL. See [Documents](./protocol/documents.md). <!-- id:bb6pz4zK -->
- **Fork (branch).** Your own Ref, in your own space, that points at another document's genesis and heads. You get an address you control, with the whole history kept. See [Documents](./protocol/documents.md). <!-- id:xDAYgRjP -->
- **Path.** The name of a document inside a space, with parts separated by `/`, such as `/notes/sushi`. A path is a plain string. Owning a parent path gives no power over the paths under it, except through capabilities. See [Spaces](./protocol/spaces.md). <!-- id:7nXURVOs -->
- **Directory.** The documents whose paths sit under a given path. The daemon stores no tree: it finds them by searching for paths that start the same way. See [Spaces](./protocol/spaces.md). <!-- id:nO-Pbybk -->
- **Draft.** Edits that a client keeps and has not published. The Seed app, the CLI and Seed Agents each keep their own drafts, and the daemon has none. To publish is to sign a Change and a Ref. See [Documents](./protocol/documents.md). <!-- id:ZIyfQ3Sb -->
- **Metadata (attributes).** The named values of a document, such as `name`, `summary`, `icon` and `siteUrl`. `SetAttributes` writes them, and the newest write to a key wins. See [Document Metadata](./metadata.md). <!-- id:4o5TMHkl -->
- **Value.** One simple thing that a document attribute can hold: a string, an integer, a boolean or `null`. A list or a map is not a value. See [Value](./value.md).
- **Key/value.** One attribute assignment in a `SetAttributes` operation: a key path and the value to store under it. See [Key/Value](./key-value.md).

# Content <!-- id:Hcelf4Wj -->

- **Block.** One piece of a document or of a comment, such as a paragraph, a heading, an image or a table row. Each block has an id that never changes, so a link can point at it. See [Blocks](./protocol/blocks.md) for the idea and [Block](./block.md) for the fields. <!-- id:3aE-TUts -->
- **Block node.** A block plus the list of its child block nodes. The body of a document is an ordered list of block nodes. See [Block node](./block/node.md). <!-- id:kBlwwc-r -->
- **Children type.** The `childrenType` attribute, which lays out the children of a block: `Group`, `Ordered`, `Unordered`, `Blockquote` or `Grid`. A list is a property of the parent block, and its items carry no list type. See [Children type](./block/children-type.md). <!-- id:XwP-bbE0 -->
- **Annotation.** A layer over a range of a block's text: a style, a link, a highlight or an inline embed. Positions count Unicode code points. See [Annotation](./block/annotation.md). <!-- id:xJ8aMYAC -->
- **Mention.** A link inside text that names an account or a document and shows the target's current name. The daemon indexes it as a link, which is how "mentions of me" works. A document attribute set to an account, such as `owner`, counts as a mention too. See [Links and citations](./protocol/links-and-citations.md) and [Metadata](./metadata.md). <!-- id:mJHyWqJ3 -->
- **Embed.** A block that shows another resource in place: a document, a block, a block with its children, a range of text or a discussion. It can show one fixed version or follow the latest. See [Embed](./block/embed.md). <!-- id:y00RsMBd -->
- **Card embed.** An embed whose `view` is `Card`. It shows the target's title, summary and cover. An app lists its tools, pages and triggers with card embeds, and a parent page on this site lists its child pages the same way. See [Embed view](./block/embed-view.md).
- **Query block.** A block that stores a query (which spaces and paths, the sort, the limit) and shows the live result as cards, a list or a table. See [Query block](./block/query.md) for the block and [Query](./query.md) for the fields of the query. <!-- id:2NMccQyT -->
- **Collection.** A document whose content is one top-level query block that lists its own children. No attribute declares it: the indexer works it out from the content and reports it as `isCollection`. It is a display convention of the Seed app, and the protocol has no such concept. See [Blocks](./protocol/blocks.md). <!-- id:_s9jhb51 -->
- **Detached block.** A block that has content but no position in the tree. The daemon returns it separately. The Seed app keeps the menu of a site in a detached block named `navigation`. See [Blocks](./protocol/blocks.md) and [Navigation item](./metadata/navigation-item.md). <!-- id:KjxBIpYZ -->
- **Revision.** The CID of the Change that last replaced a block. The daemon reports it on every block it serves. A citation records it, so a reader can tell whether the cited text has changed. See [Blocks](./protocol/blocks.md). <!-- id:pgtQLeP3 -->
- **Text fragment.** The part of a URL after `#`. It names a block (`#id`), a block with its children (`#id+`) or a range of its text (`#id[start:end]`). See [Blocks](./protocol/blocks.md#text-fragments-and-revisions) and [URLs](./protocol/urls.md). <!-- id:3gJJuJ0J -->
- **Comment.** A signed snapshot blob in its author's space. It targets one version of a document and carries a body of blocks. Anyone can comment on any document. See [Comments](./protocol/comments.md) for the idea and [Comment](./comment.md) for the fields. <!-- id:1s6kwmwZ -->
- **Discussion (thread).** A comment with no `threadRoot`, together with every reply that names it as root. See [Comments](./protocol/comments.md). <!-- id:O25dPmCW -->
- **Citation (backlink).** A record that says "this source links to that target". The daemon makes one for every `hm://` link in a document or a comment, and for every account or document that a document attribute names. `ListCitations` returns the backlinks of a target. See [Links and citations](./protocol/links-and-citations.md). <!-- id:tBYWHeTC -->
- **File.** An image, a video or an attachment, stored as unsigned IPFS data and linked from a block as `ipfs://<cid>`. It becomes public when a public blob links to it. See [Files](./protocol/files.md). <!-- id:G-R_nzmf -->
- **Markdown dialect.** The markdown form of a document that loses nothing. Plain markdown says most of a document, and the dialect adds the rest, such as block ids. See [Markdown dialect](./build/markdown-dialect.md).

# Permissions and relationships <!-- id:CH5VsOuR -->

- **Capability.** A signed grant from the owner of a space to another key, with a role and an optional path. It never expires, and the owner cannot take it back. See [Permissions](./protocol/permissions.md) for the idea and [Capability](./capability.md) for the fields. <!-- id:WDijUUnT -->
- **Role.** The kind of capability. `WRITER` may publish Refs at a path and under it. `AGENT` may do everything the issuer's key may do, and its path must be empty. No other role exists in data. See [Role](./role.md). <!-- id:vZUo05tD -->
- **Delegate.** The key that a capability gives power to. It is not the agent verb `delegate`. See [Capability](./capability.md). <!-- id:jkkT27v0 -->
- **Path scope.** The path a capability covers. It matches whole path parts and always includes everything under it: `/team` covers `/team/notes` but not `/teammates`. See [Permissions](./protocol/permissions.md). <!-- id:jq6U9atk -->
- **Collaborator.** A key that may write in a space through a capability. The `/:collaborators` view and the `ListDocumentCollaborators` request list collaborators together with the members who joined the site. See [Permissions](./protocol/permissions.md) and [Contacts](./protocol/contacts.md). An agent has collaborators of its own kind: see [the agents glossary](./agent/glossary.md). <!-- id:jZjJi7pv -->
- **Contact.** A public, signed address-book entry in which one account names another. The daemon never uses a contact to decide access. See [Contacts](./protocol/contacts.md) for the idea and [Contact](./contact.md) for the fields. <!-- id:PZMycmxi -->
- **Join.** To publish a contact for a site's account with `subscribe.site` set. The list of a site's members comes from these contacts. See [Contacts](./protocol/contacts.md) and [Contact subscription](./contact/subscribe.md). <!-- id:2fnCKAdy -->
- **Follow.** To publish a contact for a person with `subscribe.profile` set. See [Contacts](./protocol/contacts.md) and [Contact subscription](./contact/subscribe.md). <!-- id:N71IoYZ4 -->
- **Member.** An account that joined a site. A member who also holds a capability is shown with its role. Being a member gives no permissions. See [Contacts](./protocol/contacts.md). <!-- id:J7WoeHrk -->
- **Visibility.** Whether a Ref or a comment is public (the empty string) or `Private`. A Change or a file takes its visibility from whatever links to it. See [Visibility](./visibility.md). <!-- id:0lIDEN5A -->
- **Private document.** A document published with a private Ref. Over HTTP, the owner can read it, and so can keys that hold a grant on the whole space. Over peer sync, it also reaches the site server and any writer of the space. The Seed apps cannot create one. See [Privacy](./protocol/privacy.md). <!-- id:xn5JE30b -->
- **Web of trust.** The idea that trust between accounts filters what you see. Hypermedia has none: only capabilities, aliases and contacts exist, and none of them passes trust on to a third account. See [Permissions](./protocol/permissions.md). <!-- id:7msLlJ6z -->

# Network and sites <!-- id:-FTAZYn0 -->

- **Peer.** One running daemon on the network. Its peer id, such as `12D3KooW…`, comes from its device key. See [Network](./protocol/network.md). <!-- id:_WTYm6i- -->
- **Sync.** How two peers bring their copies in line: they compare what they hold for a space or a document, and each fetches the blobs it lacks. See [Network](./protocol/network.md).
- **Protocol id.** The text every peer announces, `/hypermedia/0.9.2`, with `-<name>` added on a test network. Peers with different texts do not talk to each other. See [Network](./protocol/network.md). <!-- id:oNgkQsrR -->
- **Bootstrap gateway.** One of the Seed servers whose addresses are built into every daemon, such as `hyper.media`. They hold nearly all public content, and every discovery asks them first. See [Sites](./protocol/sites.md). <!-- id:xaGvIO0Z -->
- **Gateway.** A word with three meanings: a bootstrap gateway, a web app run with the gateway flag that serves any account at `/hm/<account>/…`, and the daemon's `/ipfs/<cid>` file route. See [Sites](./protocol/sites.md). <!-- id:xX8L_voH -->
- **Discovery.** The daemon's search for content at an address when it does not hold all of it. It asks the site server of the space and the gateways, then the peers it is connected to, then the peers it remembers. `DiscoverEntity` starts it. See [Network](./protocol/network.md). <!-- id:K7UFt5dU -->
- **RBSR, range-based set reconciliation.** How two peers find what each lacks without sending the whole list. They compare short hashes of ordered ranges of blobs, and split a range only where they differ. The cost grows with the number of differences, not with the size of the set. See [Network](./protocol/network.md). <!-- id:lI8D6JN3 -->
- **Bitswap.** The IPFS protocol that fetches blobs by CID, after reconciliation has named the missing ones. Seed filters each request, so private blobs reach only peers that may have them. See [Network](./protocol/network.md). <!-- id:JHq-G_ZK -->
- **Subscription.** In the network, a discovery for one address that the daemon repeats on a timer, with or without everything under the address. The Seed app subscribes to the spaces you join or follow, and a site server subscribes to its own account. See [Network](./protocol/network.md). <!-- id:MCWB9inm -->
- **Push.** To tell one peer, usually a site server, about a set of blobs, so it fetches them at once and does not wait for its subscription. See [Network](./protocol/network.md). <!-- id:23OhVJdo -->
- **Peer exchange.** To ask a connected peer for its list of recent peers. This is how a node finds peers beyond the built-in list. There is no DHT. See [Network](./protocol/network.md). <!-- id:s91IwmGD -->
- **Relay.** A server that passes connections on for peers that cannot be reached directly. The daemon uses two fixed Seed relays and never relays for others. See [Daemon network reference](./operate/daemon-network.md). <!-- id:42O6serL -->
- **Site.** A space published at a web domain, by a server that holds its content and shows it as web pages. See [Sites](./protocol/sites.md). <!-- id:Z2JlW0jf -->
- **`siteUrl`.** The attribute of a home document that names the site of the space. Nodes ask the server behind it first about that space, and let it receive the private blobs of the space. See [Sites](./protocol/sites.md). <!-- id:V7lmLuE6 -->
- **Site registration.** The steps that bind one account to one site: the owner's app shows a one-time secret to `/hm/api/register`, pushes the space, and sets `siteUrl`. See [Sites](./protocol/sites.md). <!-- id:uXOObTck -->
- **`/hm/api/config`.** What a site says about itself in public: its registered account, peer id, addresses and protocol id. A client that has only a web URL starts here. See [Sites](./protocol/sites.md). <!-- id:4S5TlLKU -->
- **Custom domain.** A domain you own that points at a hosted `<name>.hyper.media` site or at a server you run. See [Sites](./protocol/sites.md). <!-- id:qZQN2e1f -->
- **Server mode.** A way to run the daemon, turned on with `-server-mode` or `SEED_SERVER_MODE=true`, that hosted sites and gateways use. The daemon then trusts the network it is deployed in. It hides private content from anonymous readers and serves it to callers with a valid bearer token. Keep the daemon's API ports private, and proxy only the public `/ipfs/*` routes. See [The Seed daemon](./software/daemon.md), [Integrity](./protocol/integrity.md) and [Privacy](./protocol/privacy.md). <!-- id:9P4NLgPE -->
- **Hot task, cold task.** The two kinds of discovery task. A hot task comes from something on screen, and it runs again every ten seconds while you look at it. A cold task is a subscription, and it runs again every minute. See [Network](./protocol/network.md) and [Daemon network reference](./operate/daemon-network.md). <!-- id:c3XzLhjO -->

# URLs and APIs <!-- id:H_i4c7kQ -->

- **hm:// URL.** `hm://<account>/<path>?v=<version>#<block>`, an address that names a space and a path, and can also name an exact version and a block or a range of text. See [URLs](./protocol/urls.md). <!-- id:ecKbxVg2 -->
- **Authority.** The key that owns an `hm://` URL and signs what is published under it. This site writes the authority of its own types as the domain `hyper.media`. The SDK and the docs sync know which key that stands for, and the peer-to-peer network does not look up domain names. The network pages also call the site server of a space its authority, meaning the first peer asked about that space. See [Authority](./authority.md) and [Network](./protocol/network.md). <!-- id:SyuFCHXP -->
- **View suffix.** A path part that starts with `:` and picks a view of the same document, such as `/:comments`, `/:directory` or `/:attributes`. Links also accept the older `/:metadata` for `/:attributes`. See [URLs](./protocol/urls.md). <!-- id:B4xPxZED -->
- **Seed API.** The HTTP API that every Seed site serves at `/api/<Key>`, such as `/api/Resource?id=…`. You read with it, and you publish signed blobs through it. See [Seed API](./build/web-api.md). <!-- id:obPcUTpG -->
- **Site services.** The fixed routes that every Seed site serves beside the Seed API, under `/hm/api/*`: config, sign-in, files, register, discover and others. See [Site services](./build/site-services.md). <!-- id:OsCXuvoY -->
- **Signed API, signed action.** How a program talks to an app environment. Each request is one signed action, such as `CreateSession`, packed as DAG-CBOR and signed with an account key or a key the account authorized. See [Signed API](./build/signed-api.md).
- **Daemon gRPC API.** The gRPC services of the Seed daemon, for programs that need more than the Seed API. By default the daemon accepts only callers on the same computer, and it trusts them. See [Daemon gRPC](./build/grpc.md). <!-- id:k9WnQ-6c -->
- **SDK.** `@seed-hypermedia/client`, the TypeScript library. It reads through the Seed API, and it builds, signs and publishes blobs. See [SDK](./build/sdk.md). <!-- id:Hrd2ZG5N -->
- **Seed CLI, CLI.** `seed-cli`, the command-line tool for keys, documents, comments, blobs and schemas. Agents outside Seed use it through the seed-cli skill. See [Seed CLI](./build/cli.md) for the commands and [The Seed CLI](./software/cli.md) for the program. <!-- id:VZp3FlMd -->
- **Query grammar.** One short language for finding documents by their attributes, such as `status="Done" AND priority>=3`. Explore in the Seed app, the CLI, the SDK and Seed Agents all read it the same way. See [Query grammar](./build/query-grammar.md).

# Hypermedia Schemas <!-- id:xGn-faz7 -->

- **Hypermedia Schemas.** The type system for content-addressed data. A schema is published as a DAG-CBOR blob, and a document names the schema it follows. Some code and file names call the system Onyx. See [Schema](./schema.md) and [Why Schemas](./schema/why.md). <!-- id:0s5lTCFA -->
- **Meta-schema.** The schema of schemas: a union of every shape a schema can take. It is itself a valid instance of that union. See [Schema](./schema.md) and [Self-description](./schema/self-description.md). <!-- id:Gm3K0OFt -->
- **Self-description.** The meta-schema is a schema too, so it must pass its own check, and it does. See [Self-Description](./schema/self-description.md).
- **Schema language.** The set of keys you use to write a schema. A schema is a map built from thirteen keys, and every key is optional. See [Schema Language](./schema/schema-language.md).
- **Typed document.** A document whose metadata says which schema its attributes follow. See [Typed Documents](./schema/typed-documents.md). <!-- id:xerPJRf7 -->
- **`schemaDefinition`.** A metadata key that holds the `ipfs://` CID of the schema a document defines. See [Typed Documents](./schema/typed-documents.md). <!-- id:rwrMM4FI -->
- **`attributesSchema`.** A metadata key that names the schema the document's own attributes must follow. See [Typed Documents](./schema/typed-documents.md). <!-- id:-cQc8P7k -->
- **`childAttributesSchema`.** A metadata key that names the schema the documents under this path must follow. See [Typed Documents](./schema/typed-documents.md). <!-- id:DwXMFGZK -->
- **Effective schema.** The one schema a document's attributes are checked against: its own `attributesSchema`, or else its parent's `childAttributesSchema`. See [Typed Documents](./schema/typed-documents.md#the-effective-schema).
- **Typed blob.** A raw DAG-CBOR object that names the schema that describes it, in a top-level `schema` field. See [Typing a Blob](./schema/typing-a-blob.md).
- **IPLD data model.** The rule that every value is one of nine kinds. See [Data Model](./schema/data-model.md). <!-- id:SO32xew_ -->
- **Kind.** One of the nine basic sorts of value: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map` and `link`. See [Kind](./schema/kind.md).
- **Ready-made value types.** The types the library gives you for one value: [string](./string.md), [integer](./integer.md), [float](./float.md), [boolean](./boolean.md), [bytes](./bytes.md), [null](./null.md), [list](./list.md), [map](./map.md), [link](./link.md), [date](./date.md), [date-time](./date-time.md), [URL](./url.md), [Hypermedia URL](./hm-url.md), [IPFS URL](./ipfs-url.md), [account](./account.md), [any](./any.md) and [none](./none.md). See [Catalogue of Types](./schema/types.md).
- **Variant.** One member of the meta-schema union: a struct, map, list, scalar, link, include, union, intersection, variable or literal schema. A bare string, integer, boolean or null is a literal too. See [Variant](./schema/variant.md). <!-- id:Ti9w96Q9 -->
- **Scalar schema.** A schema for one single value that is not a collection: null, boolean, integer, float, string or bytes. Limits such as `minLength` can narrow what it accepts. See [Scalar schema](./schema/scalar-schema.md).
- **Struct.** A map whose keys are known in advance, such as a person with the fields `name` and `age`. It is not a tenth kind: when stored, a struct is a map. See [Struct](./struct.md).
- **Struct schema.** A schema for a map with known fields. Each field is a property. See [Struct schema](./schema/struct-schema.md) and [Property](./schema/property.md). <!-- id:RbR5twB1 -->
- **Property.** One field of a struct: the schema of its value, whether it is required, and a description. See [Property](./schema/property.md).
- **Closed map.** A struct schema with `properties` and no `values`. It rejects every key it does not list. See [Closed Map](./schema/closed-map.md).
- **Map schema.** A schema for a map with any keys, whose values all follow one schema. See [Map schema](./schema/map-schema.md) and [Closed map](./schema/closed-map.md). <!-- id:AS8ovaOI -->
- **List schema.** A schema for a list whose items all follow one schema. See [List schema](./schema/list-schema.md). <!-- id:TKRNLE7O -->
- **Literal.** A schema that accepts exactly one value. A fixed set of choices is a union of literals. See [Literal schema](./schema/literal-schema.md). <!-- id:GPfun5BC -->
- **Union.** A schema that matches any one of several alternatives. When the alternatives are tagged, a field called the discriminant tells them apart. See [Union schema](./schema/anyof.md) and [Discriminated union](./schema/discriminated-union.md). <!-- id:Uw0jj-eH -->
- **Arm.** One of the schemas listed under `anyOf` in a union, or under `allOf` in an intersection. See [Union schema](./schema/anyof.md).
- **Intersection.** A schema that a value must satisfy all of. Its struct arms merge into one struct, so it is a subtype of each arm. You write it with `allOf`. See [Intersection schema](./schema/allof.md).
- **Discriminated union.** A type that is one of a fixed set of shapes. One field or test, the discriminant, tells which shape a value has. See [Discriminated Union](./schema/discriminated-union.md).
- **Link schema.** A schema for a CID link. With `target`, it also names the type the link must point at. See [Link schema](./schema/link-schema.md). <!-- id:ZR0vqtGY -->
- **Include.** A schema that names another schema and adds nothing: `{"type": "hm://…"}`. It becomes exactly the schema it names. See [Include schema](./schema/include-schema.md). <!-- id:97tuLxho -->
- **Extension.** A schema that names another schema and adds to it. That makes it a subtype of the schema it names. See [Extension](./schema/extension.md).
- **Generic.** A schema with a blank for a type. You fill in the blank when you use the schema. See [Generic](./schema/generic.md). <!-- id:RwWUQUHb -->
- **Variable schema, type variable.** `{"var": "<name>"}`, a placeholder inside a generic. It stands for the type that fills the parameter of that name. See [Variable Schema](./schema/var-schema.md).
- **Primitive.** One of the standard schemas that is exactly one kind, such as [string](./string.md) or [integer](./integer.md). See [Primitive](./schema/primitive.md). <!-- id:oSnst34U -->
- **Canonical encoding.** The one way to write a value as bytes in DAG-CBOR. It is why a schema has exactly one CID. See [Canonical Encoding](./schema/canonical-encoding.md) and [Encoding](./schema/encoding.md). <!-- id:paXKUcrW -->
- **Fixpoint problem.** A blob cannot contain its own CID, so blobs that link each other in a circle cannot be encoded. Names break such circles. See [Fixpoint Problem](./schema/fixpoint-problem.md) and [References and Naming](./schema/references.md). <!-- id:8gARS93M -->
- **Library.** The schemas and pages in the `hypermedia/` folder of the Seed repository. The Seed app and the SDK ship with them. Each schema is named `hm://hyper.media/<path>`. See [The Schema Library Pipeline](./schema/library-pipeline.md). <!-- id:hekDu784 -->
- **Lockfile.** `schemas.lock.json` in the repository. It records the CID of every library schema, and a check compares them before publishing. See [The Schema Library Pipeline](./schema/library-pipeline.md). <!-- id:255xCRyO -->
- **Schema view.** The Seed app's view of one schema: its fields, its union arms, what it depends on and what depends on it. A type page shows it above its body. See [Schema Workflows](./schema/workflows.md#read-a-document-and-its-type).
- **World Builder.** A demo in the Seed desktop app. One menu action publishes linked types for Characters, Places, Factions and Events, with typed pages to try them on. See [World Builder](./schema/world-builder.md).

# Apps and agents <!-- id:zTbkpg3w -->

Agents have their own vocabulary, defined once in the [Agents glossary](./agent/glossary.md). These are the terms you meet most often on the rest of the site. <!-- id:p4unACr4 -->
- **App.** A document typed `hm://hyper.media/app` that groups tools, pages and triggers into one thing people can share and run. It lists them with card embeds. See [App](./app.md).
- **Host.** The app or agent that a tool, a page or a trigger lives directly under. The host lists it with a card embed. See [Tool](./tool.md).
- **Public config of an app.** The settings in `metadata.publicConfig`. Every page and tool of the app can read them. See [App](./app.md).
- **Private config of an app.** The secret settings. Only the server that runs the app holds them, encrypted, and they are never in the document. See [App](./app.md).
- **Tool.** A document typed `hm://hyper.media/tool` that holds one function, with a schema for its input and one for its output. The server of its app or agent runs it. See [Tool](./tool.md).
- **Call record.** What the server keeps of one tool call: who called, the tool's version, the input, the output or the error, and how long the call took. Call records are not private. See [Tool](./tool.md#calls-are-not-private).
- **Page, custom page.** A document typed `hm://hyper.media/page` that carries a small web interface. It runs in a sandbox in the viewer's client, and a schema defines the input it takes from its URL. See [Page](./page.md).
- **Page input.** The typed values a page takes from its URL, one `p.<name>` parameter for each field of its input schema. See [Page Input](./page-input.md).
- **Page sandbox.** The closed box a custom page runs in. The page cannot leave it, and the viewer approves what the page may read, sign and publish. See [The Page Sandbox](./build/page-sandbox.md).
- **Page SDK.** `window.seed`, the object a custom page uses to read data, to sign and publish as the viewer, and to call its host's tools. See [The Page SDK](./build/page-sdk.md).
- **Trigger, trigger document.** A rule that acts when something happens. Its usual form is a document typed `hm://hyper.media/trigger` under an app or an agent, which the host's server fires. An agent can also keep triggers that exist only on its server. See [Trigger](./trigger.md). <!-- id:5mQOFGu3 -->
- **Agent, Seed Agents.** A language model with a memory, tools and its own Seed identity. It runs on an app environment, and it reads and writes Hypermedia with keys its owner gives it. See [Seed Agents](./agent.md). <!-- id:3iLepJog -->
- **Agent space.** Everything one agent has, as a tree of addresses: its memory, its tools, its triggers and its own definition. It is not the same thing as a protocol space. See [Space](./agent/space.md). <!-- id:HJOKTVDM -->
- **The five verbs.** [read](./agent/read.md), [write](./agent/write.md), [call](./agent/call.md), [delegate](./agent/delegate.md) and [plan](./agent/plan.md): the main tools an agent's model is given. The model also has two session verbs, `status` and `continue_session`, and a tool it has used can become a tool of its own. See [Tools](./agent/tools.md). <!-- id:uWLm_jV4 -->
- **Grants.** The permissions of an agent: the callable tools it may use, whether it may publish signed content, and the MCP servers it may reach. Capabilities, not grants, decide where it may publish. See [Grants](./agent/grants.md). <!-- id:aIa42PgS -->
- **App environment.** The server that runs agents and apps. The Seed app includes one, and hosted servers run one. You choose which one runs an agent or an app when you create it. See [The app environment](./software/app-environment.md).
- **MCP server.** A Model Context Protocol server that an agent connects to as a client. Its tools appear in the agent's space. No MCP server made by the Seed team exposes Seed itself. See [MCP](./agent/mcp.md). <!-- id:1769lNvE -->
- **seed-cli skill.** The skill that lets an agent outside Seed, such as Claude Code, use the Seed CLI to read and publish. See [Using Seed from your own agent](./build/agents.md). <!-- id:RUsX_znS -->

# Software and process <!-- id:yWwG-PYb -->

- **Program.** Software you install, run or deploy: the daemon, the desktop app, the web app, the CLI, the notify service, the vault, the mobile app, the Explorer and the app environment. It is not an app, which is a document. See [The Seed software](./software.md).
- **Seed daemon, daemon.** `seed-daemon`, the Go program that stores, indexes, verifies and syncs blobs. Every other Seed program talks to one. See [The Seed daemon](./software/daemon.md). <!-- id:_lcyYgtL -->
- **Node.** A computer that runs a Seed daemon and so holds its own copy of content: the Seed app on your machine, or a site on a server. See [The Seed daemon](./software/daemon.md).
- **Seed app, desktop app.** The desktop program for reading, writing and discussing. It runs its own daemon, so it keeps a full copy of what you open. See [The Seed desktop app](./software/desktop.md). <!-- id:cSXWzIi_ -->
- **API bridge.** The desktop app's local HTTP server. It serves the Seed API at `/api/<Key>` for the local node. See [The Seed desktop app](./software/desktop.md).
- **Inspector, blob editor.** The desktop app's screen that opens any blob by its CID and shows it as DAG-JSON. You can edit the blob there and publish it as a new one. See [The Seed desktop app](./software/desktop.md#inspecting-the-raw-data).
- **Seed web app, web app.** The server that puts a daemon on the web: it shows a space as a site and serves the Seed API. See [The Seed web app](./software/web.md). <!-- id:ranDOCO7 -->
- **Seed mobile app, mobile app.** The app for iOS, Android and the web. People use it to read, to comment and to talk to their agents. See [The Seed mobile app](./software/mobile.md).
- **Explorer.** A web page at `explore.hyper.media` that shows the raw data behind any `hm://` or `ipfs://` URL. See [The Explorer](./software/explorer.md).
- **Notify service.** The Seed service that watches a daemon for new comments and mentions, keeps a notification inbox for each account, and sends email. See [The notify service](./software/notify.md) and [The notify API](./build/notify-api.md).
- **Shared packages.** The five TypeScript packages in `frontend/packages/` that the Seed programs build on: `client` (the SDK), `shared`, `ui`, `editor` and `apps-ui`. See [The shared packages](./software/packages.md).
- **Landing page.** The page that stands for a folder of this site: `protocol.md` is the landing page of `protocol/`. It says what the area is and lists its pages. See [Editing these docs](./contribute/editing-these-docs.md).
- **Protocol change.** Any change to permanent data, to the sync protocol, to capabilities, to identity, or to any format that other software must read. It needs a written proposal and a review. See [Contributing](./contribute/contributing.md). <!-- id:yTSdjbju -->
- **Folder sync.** The round trip between a folder of markdown files in a git repository and a Hypermedia space. It publishes this site from the repository, in a workflow named `Repo HM sync`. See [Publish a folder](./build/publish-a-folder.md). <!-- id:mkEgUuP2 -->
- **Gate, replay gate, live gate, simulated-model gate.** A gate is a test that must pass before a change ships. The app environment has three. The replay gate uses recorded model answers, the live gate uses a running server and a real model, and the simulated-model gate uses no API key. See [Testing the app environment](./contribute/testing-the-app-environment.md).
- **Cassette.** A file of recorded model answers that the replay gate plays back. See [Testing the app environment](./contribute/testing-the-app-environment.md).

# Running Seed

- **Enterprise node.** A Seed node for one organization. Only the people it invites get an account, and it makes no peer-to-peer connection to the public network. See [Enterprise node](./operate/enterprise-node.md).
- **Health endpoint.** `/api/health` on an app environment. A `200` with `"status": "ok"` means the server is up and ready. See [Endpoints and health](./operate/endpoints-and-health.md#health).
- **Run queue.** The `runs` table of an app environment, used as the queue the server takes work from. See [Run queue](./operate/run-queue.md) for the operator's side and [Runs](./agent/runs.md) for the idea of a run.
- **Boot sweep.** The step at startup that puts interrupted runs back in the queue and marks unfinished effects as interrupted. See [Run queue](./operate/run-queue.md#across-a-restart).
- **Schema gate.** The check at startup that refuses a database whose schema version the server does not know. See [Persistence](./operate/persistence.md#schema-gate).
- **Retention task.** The background task that keeps the database of an app environment from growing forever. It deletes the durable stores of idle sessions and shortens the journals of finished runs. See [Database retention](./operate/database-retention.md).
- **Exec canary.** A background task that starts a new sandbox on an interval, to prove that code execution still works. See [Code execution backend](./operate/code-execution-backend.md#is-code-execution-working).
- **Loop lag.** How late a 100 ms timer fires on the one thread of an app environment. A high number is the sign of a stalled server. See [Diagnosing a stalled server](./operate/stalled-server.md).

# See also <!-- id:kJk74Vnq -->

- [The Hypermedia protocol](./protocol.md) is the tour these terms come from. <!-- id:gVMgrctA -->
- [Agents glossary](./agent/glossary.md) has every agent term. <!-- id:joAFt8D_ -->
- [Why Hypermedia](./why.md) gives the reasons behind these terms, for any reader. <!-- id:ExOLt8Sa -->
- [Building on Hypermedia](./build.md) has the task guides that use them. <!-- id:n38_BPBT -->
