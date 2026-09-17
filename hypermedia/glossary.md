---
name: Glossary
summary: Every term used across the Hypermedia and Seed pages in one to three sentences, each linking the page that explains it, with a table of names the project no longer uses.
---
This page defines the words the rest of the site uses. Each entry is short and links to the page with the full model, so you can use it as a map as well as a dictionary. Terms are grouped by the layer they belong to, from identity at the bottom to the software at the top. <!-- id:3OiP0-xD -->

Hypermedia is the protocol and Seed is the software that implements it. When an entry describes what "the daemon" does, it means the Seed daemon as of September 2026. <!-- id:rRU2ox4F -->

# Identity and keys <!-- id:T_8Q8IGa -->

- **Account.** A key pair used as an identity. Its public key is its name, and no account record exists anywhere else. See [Identity](./protocol/identity.md). <!-- id:Eq4EScpl -->
- **Space.** The namespace of documents an account owns, addressed as `hm://<account>/<path>`. Account and space are the same key seen from two sides: the identity that signs and the place its documents live. See [Documents](./protocol/documents.md). <!-- id:t-7AMQ1Y -->
- **Principal.** The wire form of a public key: a multicodec prefix followed by the raw key bytes, written as base58btc text that starts with `z6Mk` for Ed25519 keys and `zDn` for P-256 keys. See [Principal](./principal.md). <!-- id:nPBRgL2N -->
- **Account ID, uid.** The text form of an account's principal as it appears in URLs, for example `z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS`. See [Identity](./protocol/identity.md). <!-- id:m6GkTW-R -->
- **Key name.** A local alias under which the daemon or the CLI stores a key, such as `main`. It is never the same thing as the principal, and only the principal means anything to other people. See [Keys](./build/keys.md). <!-- id:YYW7wBy9 -->
- **Mnemonic.** A BIP-39 word list, 12 to 24 words with an optional passphrase, from which an Ed25519 account key is derived on the path `m/44'/104109'/0'`. One mnemonic and passphrase give exactly one account. See [Identity](./protocol/identity.md). <!-- id:3dJyziCz -->
- **Key file.** An exported `.hmkey.json` holding one key, optionally encrypted with a password, used by the CLI and in CI. See [Keys](./build/keys.md). <!-- id:PWw0yDWc -->
- **Vault.** The encrypted key store behind sign-in on the web and, since 2026, the desktop app. The server that holds a vault cannot read the keys inside it. See [Sign in with Seed](./build/sign-in.md). <!-- id:On4tmukn -->
- **Session key.** A browser-held key that a vault account delegates to with an AGENT capability, so a site can sign for you without ever receiving your account key. See [Sign in with Seed](./build/sign-in.md). <!-- id:HdEIPBwG -->
- **Device key.** The Ed25519 key that identifies one running daemon as a libp2p peer. It secures connections and never signs content. See [Network](./protocol/network.md). <!-- id:eBS-9s56 -->
- **Profile.** A small signed snapshot blob that gives an account a name, an avatar and a description. The daemon merges all of an account's profile blobs field by field. See [Profile](./profile.md). <!-- id:V2quF0dS -->
- **Alias.** A profile whose only field points at another account, meaning "this key is really that account". The daemon accepts it only if that account granted the key an AGENT capability. See [Identity](./protocol/identity.md). <!-- id:J90CYDNz -->
- **Key linking.** Joining several keys into one identity with an AGENT capability from the main account and an alias profile from the other key. It is how desktop, phone and browser keys all show up as one person. See [Identity](./protocol/identity.md). <!-- id:8XQHVpoa -->
- **Bearer token.** A token the daemon issues in exchange for a signed, short-lived capability, which the Seed web app forwards so that a public-only node can serve you private content. It never authorizes a write. See [Privacy](./protocol/privacy.md). <!-- id:g2T0h5UN -->

# Blobs and encoding <!-- id:NUGiiJeD -->

- **Blob.** An immutable piece of data named by the hash of its bytes. Structured blobs are signed DAG-CBOR maps, and file chunks are unsigned IPFS data. See [Signed Blobs](./protocol/blobs.md). <!-- id:uZTgXmyY -->
- **CID.** A content identifier: a self-describing hash that names a blob. Hypermedia uses CIDv1 with the `dag-cbor` codec for structured blobs, and `dag-pb` and `raw` for files. See [CID](./cid.md). <!-- id:gkdzPdiY -->
- **DAG-CBOR.** The deterministic binary encoding every structured blob uses: CBOR with sorted keys, shortest integers and native CID links. Because the encoding is canonical, one value always has one CID. See [DAG-CBOR](./schema/dag-cbor.md). <!-- id:9vQFpLmN -->
- **DAG-JSON.** The JSON projection of the same data, where a link is written `{"/": "<cid>"}` and bytes are written `{"/": {"bytes": "…"}}`. The CLI prints blobs in this form. See [DAG-JSON](./schema/dag-json.md). <!-- id:y3XRlTZV -->
- **Signed envelope.** The four fields every structured blob carries: `type`, `signer`, `sig` and `ts`. See [Blob](./blob.md). <!-- id:iaM6m4wS -->
- **Signature.** 64 bytes over the blob's canonical encoding taken with the `sig` field set to 64 zero bytes. The field is present, never omitted. See [Signature](./signature.md). <!-- id:KGVtgLSC -->
- **Timestamp (`ts`).** The signer's claimed time in Unix milliseconds. Nothing checks it against real time when a blob arrives. See [Integrity](./protocol/integrity.md). <!-- id:BWO1r4Z9 -->
- **Snapshot blob.** A blob that carries a record's whole value and is replaced whole on edit: comments, contacts and profiles. Documents are the other kind, built from deltas. See [Signed Blobs](./protocol/blobs.md). <!-- id:BwhZWs55 -->
- **TSID.** A timestamped id: 10 bytes of a 48-bit millisecond timestamp and the first 4 bytes of a SHA-256 hash, written as 14 or 15 base58 characters. It gives a snapshot record a stable identity across edits. See [Signed Blobs](./protocol/blobs.md). <!-- id:6EixjmEI -->
- **Stash.** Where the daemon keeps a blob it has stored but cannot yet interpret, because a dependency has not arrived or the signer is not yet authorized. The blob is retried when the missing piece lands. See [Signed Blobs](./protocol/blobs.md). <!-- id:U86WqFrM -->
- **BLAKE2b and SHA-256 CIDs.** The daemon hashes blobs it creates with BLAKE2b and the SDK and apps use SHA-256. Both are valid names for the same bytes. A blob that another blob references must be uploaded under the exact CID the referrer used. See [Signed Blobs](./protocol/blobs.md). <!-- id:dA5bUsiH -->

# Documents and resources <!-- id:TfdNYAw0 -->

- **Resource.** The umbrella term for anything mutable that is rebuilt from immutable blobs: documents, comments, contacts and profiles. It is the word the Seed API uses. See [The Hypermedia protocol](./protocol.md). <!-- id:EQ1YtOiK -->
- **IRI.** The daemon's internal identifier for a resource, an `hm://<account>/<path>` string without version or fragment. Sync scopes and subscriptions are keyed by IRI. See [Network](./protocol/network.md). <!-- id:pIQ8RxYJ -->
- **Document.** A change-based resource: a graph of signed Changes, replayed into metadata and a tree of blocks, and placed at an address by a Ref. See [Documents](./protocol/documents.md). <!-- id:KTSq9f-8 -->
- **Change.** A signed delta on a document: a list of operations plus links to the changes it builds on. See [Change](./change.md). <!-- id:v_HHROc9 -->
- **Genesis.** A document's first Change, and therefore its identity. Two Refs that name the same genesis talk about the same document, wherever they place it. See [Documents](./protocol/documents.md). <!-- id:2KxUlfPD -->
- **Home document.** The document at the empty path of a space, `hm://<account>`. Its genesis is a deterministic empty Change with `ts` 0, so every device of the account derives the same one. See [Documents](./protocol/documents.md). <!-- id:Dri6S3_G -->
- **Deps and depth.** A Change's `deps` are the heads its author saw, sorted by CID. Its `depth` is one more than the deepest dep. Together they order the history. See [Change](./change.md). <!-- id:ihtU17b5 -->
- **Operation (op).** One edit inside a Change: `SetAttributes`, `ReplaceBlock`, `MoveBlocks`, `DeleteBlocks`, or the deprecated `SetKey`. Each has an id of timestamp, position and actor that decides concurrent conflicts. See [Operations](./change/op.md). <!-- id:qZKqO48U -->
- **CRDT.** A conflict-free replicated data type: a merge rule that makes every replica reach the same state in any delivery order. Documents use a last-writer-wins register for metadata and a move tree with ordered sibling lists for blocks. See [Documents](./protocol/documents.md). <!-- id:dy5OI6oD -->
- **Head.** A Change that no other Change depends on yet. A document with two heads has two concurrent edits that nobody has merged. See [Documents](./protocol/documents.md). <!-- id:6xy8H4Ag -->
- **Version.** The set of head CIDs, sorted and joined with `.`, written `?v=` in a URL. A version always replays to the same content. See [URLs](./protocol/urls.md). <!-- id:BjQ5iozl -->
- **Latest (`l`).** A URL flag meaning "the newest version, and at least this one". Today the daemon simply returns the newest version it knows. See [URLs](./protocol/urls.md). <!-- id:rs_XaEuE -->
- **Ref.** A signed claim that an address currently shows a given version, is deleted, or redirects elsewhere. A document appears at an address only through an indexed Ref from an authorized signer. See [Ref](./ref.md). <!-- id:lPdSM9oW -->
- **Generation.** One life of an address, numbered by the writer. The highest generation wins. Publishing a Ref with a higher generation replaces whatever lived at the path. See [Documents](./protocol/documents.md). <!-- id:8rckapbW -->
- **Tombstone.** A Ref with a genesis and no heads, which marks the document deleted. The history stays on every node that holds it. See [Documents](./protocol/documents.md). <!-- id:0YElj_oJ -->
- **Redirect.** A Ref with no heads and a `redirect` target, so readers of the old address are sent to the new one. See [Redirect target](./ref/redirect-target.md). <!-- id:6FsTfeiy -->
- **Republish.** A redirect with `republish` set: the old address keeps showing the target's content under its own URL. See [Documents](./protocol/documents.md). <!-- id:bb6pz4zK -->
- **Fork (branch).** Publishing your own Ref, in your own space, that points at another document's genesis and heads. You get an address you control with the whole history intact. See [Documents](./protocol/documents.md). <!-- id:xDAYgRjP -->
- **Path.** The `/`-separated name of a document inside a space, such as `/notes/sushi`. Paths are plain strings, and a parent path confers no authority over its children except through capabilities. See [Documents](./protocol/documents.md). <!-- id:7nXURVOs -->
- **Directory.** The documents whose paths sit under a given path, found by a prefix query. The daemon stores no tree. A directory is only a listing. See [Documents](./protocol/documents.md). <!-- id:nO-Pbybk -->
- **Draft.** Unpublished edits kept by a client: the Seed app, the CLI and Seed Agents each keep their own. The daemon has no drafts. Publishing means signing a Change and a Ref. See [Documents](./protocol/documents.md). <!-- id:ZIyfQ3Sb -->
- **Metadata (attributes).** A document's key-value attributes such as `name`, `summary`, `icon` and `siteUrl`, set with `SetAttributes` and merged last-writer-wins. See [Document Metadata](./metadata.md). <!-- id:4o5TMHkl -->

# Content <!-- id:Hcelf4Wj -->

- **Block.** One addressable piece of a document or comment body, such as a paragraph, heading, image or table row, with a permanent id. See [Blocks](./protocol/blocks.md). <!-- id:3aE-TUts -->
- **Block node.** A block plus its list of child block nodes. A document body is an ordered list of them. See [Block node](./block/node.md). <!-- id:kBlwwc-r -->
- **Children type.** The `childrenType` attribute that lays out a block's children: `Group`, `Ordered`, `Unordered`, `Blockquote` or `Grid`. A list is a property of the parent, and its items carry no list type. See [Children type](./block/children-type.md). <!-- id:XwP-bbE0 -->
- **Annotation.** An inline layer over a range of a block's text: a style, a link, a highlight or an inline embed. Offsets count Unicode code points. See [Annotation](./block/annotation.md). <!-- id:xJ8aMYAC -->
- **Mention.** An inline embed over a placeholder character that links to an account or a document and renders the target's current name. The daemon indexes it as a link, which is how "mentions of me" works. See [Comments](./protocol/comments.md). <!-- id:mJHyWqJ3 -->
- **Embed.** A block that shows another resource in place: a document, a block, a block with its children, a text range or a discussion, pinned to a version or following the latest. See [Embed](./block/embed.md). <!-- id:y00RsMBd -->
- **Query block.** A block that stores a query (included spaces and paths, sort, limit) and shows its live result as cards, a list or a table. See [Query block](./block/query.md). <!-- id:2NMccQyT -->
- **Collection.** A document whose content is a single top-level query block that lists its own children. The indexer derives this from the content and reports it as `isCollection`. No attribute declares it. It is a presentation convention in the Seed app, and the protocol has no such concept. See [Blocks](./protocol/blocks.md). <!-- id:_s9jhb51 -->
- **Detached block.** A block that has content but no position in the tree. The daemon returns it separately, and the Seed app keeps a site's menu in one named `navigation`, whose children are `Link` blocks. See [Navigation item](./metadata/navigation-item.md). <!-- id:KjxBIpYZ -->
- **Revision.** The CID of the Change that last replaced a block, reported on every block the daemon serves. A citation records it so readers can tell whether the cited text has changed. See [Blocks](./protocol/blocks.md). <!-- id:pgtQLeP3 -->
- **Text fragment.** A URL fragment that names a block (`#id`), a block with its children (`#id+`) or a range of its text (`#id[start:end]`). See [URLs](./protocol/urls.md). <!-- id:3gJJuJ0J -->
- **Comment.** A signed snapshot blob in its author's space that targets a document version and carries a body of blocks. Anyone can comment on any document. See [Comments](./protocol/comments.md). <!-- id:1s6kwmwZ -->
- **Discussion (thread).** A comment with no `threadRoot` and every reply that names it as root. See [Comments](./protocol/comments.md). <!-- id:O25dPmCW -->
- **Citation (backlink).** A link record the daemon indexes for every `hm://` link it finds in a document or comment, from the source to the target. `ListCitations` returns a target's backlinks. See [Comments](./protocol/comments.md). <!-- id:tBYWHeTC -->
- **File.** An image, video or attachment stored as unsigned IPFS UnixFS data and linked from a block as `ipfs://<cid>`. It becomes public once a public blob links to it. See [Files](./protocol/files.md). <!-- id:G-R_nzmf -->

# Permissions and relationships <!-- id:CH5VsOuR -->

- **Capability.** A signed grant from a space owner to another key, with a role and an optional path scope. It never expires and cannot be revoked today. See [Permissions](./protocol/permissions.md). <!-- id:WDijUUnT -->
- **Role.** The kind of capability: `WRITER` may publish Refs at and under a path. `AGENT` is full delegation of the issuer's key and must have an empty path. No other role exists in data. See [Role](./role.md). <!-- id:vZUo05tD -->
- **Delegate.** The key a capability grants authority to. See [Capability](./capability.md). <!-- id:jkkT27v0 -->
- **Path scope.** The path a capability covers, matched by segment and always recursive: `/team` covers `/team/notes` but not `/teammates`. See [Permissions](./protocol/permissions.md). <!-- id:jq6U9atk -->
- **Collaborator.** A key that may write in a space through a capability, listed by the `ListDocumentCollaborators` request and the `/:collaborators` view. See [Permissions](./protocol/permissions.md). <!-- id:jZjJi7pv -->
- **Contact.** A public, signed address-book entry in which one account names another. The daemon never consults a contact for access. See [Contact](./contact.md). <!-- id:PZMycmxi -->
- **Join.** Publishing a contact for a site's account with `subscribe.site` set. The site's members list is derived from these contacts. See [Contact subscription](./contact/subscribe.md). <!-- id:2fnCKAdy -->
- **Follow.** Publishing a contact for a person with `subscribe.profile` set. See [Contact subscription](./contact/subscribe.md). <!-- id:N71IoYZ4 -->
- **Member.** An account that has joined a site. A member who also holds a capability is shown with its role. Membership grants no permissions. See [Permissions](./protocol/permissions.md). <!-- id:J7WoeHrk -->
- **Visibility.** Whether a Ref or comment is public (the empty string) or `Private`. Changes and files inherit visibility from whatever links to them. See [Visibility](./visibility.md). <!-- id:0lIDEN5A -->
- **Private document.** A document published with a private Ref, readable only by the owner, keys holding a root-scoped grant, and the site server. Creating new private documents is disabled in the daemon at the moment. See [Privacy](./protocol/privacy.md). <!-- id:xn5JE30b -->
- **Web of trust.** The long-term idea that trust between accounts filters what you see. Today only capabilities, aliases and contacts exist, and none of them carry trust transitively. See [Permissions](./protocol/permissions.md). <!-- id:7msLlJ6z -->

# Network and sites <!-- id:-FTAZYn0 -->

- **Peer.** One running daemon on the libp2p network, identified by a peer id derived from its device key, such as `12D3KooW…`. See [Network](./protocol/network.md). <!-- id:_WTYm6i- -->
- **Protocol id.** The libp2p protocol string every peer announces, `/hypermedia/0.9.2`, with a `-<name>` suffix on a testnet. Peers with different strings do not talk. See [Network](./protocol/network.md). <!-- id:oNgkQsrR -->
- **Bootstrap gateway.** One of the Seed servers compiled into every daemon, such as `hyper.media`, which hold nearly all public content and are asked first in every discovery. See [Sites](./protocol/sites.md). <!-- id:xaGvIO0Z -->
- **Gateway.** A word with three meanings: a bootstrap gateway, a web app run with the gateway flag that serves any account at `/hm/<account>/…`, and the daemon's `/ipfs/<cid>` file route. See [Sites](./protocol/sites.md). <!-- id:xX8L_voH -->
- **Discovery.** The daemon's search for an address it does not fully have: it asks the space's site server and the gateways, then connected peers, then stored peers. `DiscoverEntity` is its entry point. See [Network](./protocol/network.md). <!-- id:K7UFt5dU -->
- **RBSR.** Range-based set reconciliation: two peers compare hash summaries of ordered ranges of blobs and subdivide only where they differ. The cost grows with the number of differences, not the size of the set. See [Network](./protocol/network.md). <!-- id:lI8D6JN3 -->
- **Bitswap.** The IPFS block-exchange protocol that fetches blobs once reconciliation has named the missing CIDs. Seed filters each request so private blobs reach only authorized peers. See [Network](./protocol/network.md). <!-- id:JHq-G_ZK -->
- **Subscription.** A standing, periodic discovery for one address, optionally recursive. The Seed app subscribes to the spaces you join or follow, and a site server subscribes to its registered account. See [Network](./protocol/network.md). <!-- id:MCWB9inm -->
- **Push.** Announcing a set of blobs to a specific peer, usually a site server, so it fetches them right away instead of waiting for its subscription. See [Network](./protocol/network.md). <!-- id:23OhVJdo -->
- **Peer exchange.** Asking a connected peer for its recent peer list, which is how a node finds peers beyond the bootstrap list. There is no DHT today. See [Network](./protocol/network.md). <!-- id:s91IwmGD -->
- **Relay.** A server that forwards connections for peers behind NAT. The daemon uses two compiled-in Seed relays and never relays for others. See [Network](./protocol/network.md). <!-- id:42O6serL -->
- **Site.** A space published at a web domain by a server that holds its content and renders it as web pages. See [Sites](./protocol/sites.md). <!-- id:Z2JlW0jf -->
- **`siteUrl`.** The home document attribute that names a space's site. Nodes treat the server behind it as the space's authority and let it receive the space's private blobs. See [Sites](./protocol/sites.md). <!-- id:V7lmLuE6 -->
- **Site registration.** The handshake that binds one account to one site: the owner's app presents a one-time secret to `/hm/api/register`, pushes the space, and sets `siteUrl`. See [Sites](./protocol/sites.md). <!-- id:uXOObTck -->
- **`/hm/api/config`.** A site's public description of itself: its registered account, peer id, addresses and protocol id. Any client holding only a web URL starts here. See [Sites](./protocol/sites.md). <!-- id:4S5TlLKU -->
- **Custom domain.** A domain you own that points at a hosted `<name>.hyper.media` site or a self-hosted server. See [Sites](./protocol/sites.md). <!-- id:qZQN2e1f -->
- **Public-only node.** A daemon started with `-public-only`, which serves only public data over HTTP and gRPC unless a request carries a valid bearer token. Hosted sites and gateways run this way. See [Privacy](./protocol/privacy.md). <!-- id:9P4NLgPE -->
- **Hot and cold discovery.** Hot tasks come from something on screen and rerun every ten seconds while viewed. Cold tasks are subscriptions that rerun every minute. See [Network](./protocol/network.md). <!-- id:c3XzLhjO -->

# URLs and APIs <!-- id:H_i4c7kQ -->

- **hm:// URL.** `hm://<account>/<path>?v=<version>#<block>`, an address that names a space, a path, optionally an exact version and a block or text range. See [URLs](./protocol/urls.md). <!-- id:ecKbxVg2 -->
- **View suffix.** A path segment starting with `:` that selects a view of the same document, such as `/:comments`, `/:directory` or `/:attributes`. See [URLs](./protocol/urls.md). <!-- id:B4xPxZED -->
- **Seed API.** The typed HTTP API every Seed web app serves at `/api/<Key>`, such as `/api/Resource?id=…`. See [Web API](./build/web-api.md) and [the request catalogue](./rpc.md). <!-- id:obPcUTpG -->
- **Site services.** The web app's own endpoints under `/hm/api/*`: config, auth, file, register, discover and others. See [Web API](./build/web-api.md). <!-- id:OsCXuvoY -->
- **Daemon gRPC API.** The Seed daemon's gRPC services, served natively and as gRPC-web on its HTTP port, for deep integration. The local API has no authentication, so keep it on localhost. See [gRPC](./build/grpc.md). <!-- id:k9WnQ-6c -->
- **SDK.** `@seed-hypermedia/client`, the TypeScript library for reading through the Seed API and for building, signing and publishing blobs. See [SDK](./build/sdk.md). <!-- id:Hrd2ZG5N -->
- **Seed CLI.** `seed-cli`, the command-line tool for keys, documents, comments, blobs and schemas, and the tool external agents use through the seed-cli skill. See [Seed CLI](./build/cli.md). <!-- id:VZp3FlMd -->

# Hypermedia Schemas <!-- id:xGn-faz7 -->

- **Hypermedia Schemas.** The self-describing type system for content-addressed data: schemas are published as DAG-CBOR blobs and documents bind to them by CID. See [Schema](./schema.md) and [Why Schemas](./schema/why.md). <!-- id:0s5lTCFA -->
- **Meta-schema.** The schema of schemas, a discriminated union of every shape a schema can take, which is itself a valid instance of that union. See [Schema](./schema.md) and [Self-description](./schema/self-description.md). <!-- id:Gm3K0OFt -->
- **Typed document.** A document whose metadata binds it to a schema. See [Typed Documents](./schema/typed-documents.md). <!-- id:xerPJRf7 -->
- **`schemaDefinition`.** A metadata key holding the `ipfs://` CID of the schema a document defines. See [Typed Documents](./schema/typed-documents.md). <!-- id:rwrMM4FI -->
- **`attributesSchema`.** A metadata key naming the schema a document's own attributes must satisfy. See [Typed Documents](./schema/typed-documents.md). <!-- id:-cQc8P7k -->
- **`childAttributesSchema`.** A metadata key naming the schema that documents under this path must satisfy. See [Typed Documents](./schema/typed-documents.md). <!-- id:DwXMFGZK -->
- **Data model and kind.** Every value is one of nine IPLD kinds: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map` and `link`. See [Data Model](./schema/data-model.md) and [Kind](./schema/kind.md). <!-- id:SO32xew_ -->
- **Variant.** One member of the meta-schema union: a scalar, literal, list, map, struct, link, union, reference or variable schema. See [Variant](./schema/variant.md). <!-- id:Ti9w96Q9 -->
- **Struct schema.** A schema for a map with known fields, each a property. See [Struct schema](./schema/struct-schema.md) and [Property](./schema/property.md). <!-- id:RbR5twB1 -->
- **Map schema.** A schema for a map whose arbitrary keys all hold values of one schema. See [Map schema](./schema/map-schema.md) and [Closed map](./schema/closed-map.md). <!-- id:AS8ovaOI -->
- **List schema.** A schema for a list whose items match one schema. See [List schema](./schema/list-schema.md). <!-- id:TKRNLE7O -->
- **Literal.** A schema that accepts exactly one value. A fixed set of choices is a union of literals. See [Literal schema](./schema/literal-schema.md). <!-- id:GPfun5BC -->
- **Union.** A schema that matches any one of several alternatives, told apart by a discriminant when they are tagged. See [Union schema](./schema/anyof.md) and [Discriminated union](./schema/discriminated-union.md). <!-- id:Uw0jj-eH -->
- **Link schema.** A schema for a CID link, optionally naming the type the link must point at with `target`. See [Link schema](./schema/link-schema.md). <!-- id:ZR0vqtGY -->
- **Include and extension.** A schema node whose `type` names another schema. Bare, it is an include, and with extra refining keys it is an extension. See [Reference Schema](./schema/include-schema.md) and [Extension](./schema/extension.md). <!-- id:97tuLxho -->
- **Generic and variable.** A schema parameterized over a type, and the `{"var": "<name>"}` reference that stands for the bound parameter inside it. See [Generic](./schema/generic.md) and [Variable schema](./schema/var-schema.md). <!-- id:RwWUQUHb -->
- **Primitive.** One of the standard-library schemas that is exactly one kind, such as [string](./string.md) or [integer](./integer.md). See [Primitive](./schema/primitive.md). <!-- id:oSnst34U -->
- **Canonical encoding.** The single deterministic byte form of a value in DAG-CBOR, which is why a schema has exactly one CID. See [Canonical Encoding](./schema/canonical-encoding.md). <!-- id:paXKUcrW -->
- **Fixpoint problem.** A blob cannot contain its own CID, so a cycle of CID links has no encoding order. Names break such cycles. See [Fixpoint Problem](./schema/fixpoint-problem.md) and [References and Naming](./schema/references.md). <!-- id:8gARS93M -->
- **Library.** The schemas and pages in the `hypermedia/` folder of the Seed repository, which the Seed app and the SDK bundle. Each schema is named `hm://hyper.media/<path>`. See [How Schemas Work](./schema/how-it-works.md).
- **Authority.** The key that owns an `hm://` URL and signs what is published under it. The library writes its authority as the domain `hyper.media`, which the SDK and the docs sync understand but the network does not resolve yet. See [Authority](./authority.md).
- **Lockfile.** `schemas.lock.json` in the repository, which pins every library schema's CID and is checked before publishing. See [How Schemas Work](./schema/how-it-works.md). <!-- id:255xCRyO -->

# Seed Agents <!-- id:zTbkpg3w -->

Seed Agents has its own vocabulary, defined once in the [Agents glossary](./agent/glossary.md). The terms you meet most often from the rest of the site are these. <!-- id:p4unACr4 -->
  - **Seed Agents.** The hosted agent runtime, which reads and writes Hypermedia through the Seed API with keys the owner delegates. See [Seed Agents](./agent.md). <!-- id:3iLepJog -->
  - **Agent space.** Everything one agent has as an addressable tree of memory, tools, triggers and its own definition. It is a different thing from a protocol space. See [Space](./agent/space.md). <!-- id:HJOKTVDM -->
  - **The five verbs.** [read](./agent/read.md), [write](./agent/write.md), [call](./agent/call.md), [delegate](./agent/delegate.md) and [plan](./agent/plan.md), the whole model-facing tool surface. <!-- id:uWLm_jV4 -->
  - **Trigger.** Standing configuration that starts or wakes an agent on a schedule, a comment, a mention, a site update, a webhook or another run finishing. See [Trigger](./agent/trigger.md). <!-- id:5mQOFGu3 -->
  - **Grants.** An agent's permissions: the callable tools, the publish grant and the enabled MCP servers. See [Grants](./agent/grants.md). <!-- id:aIa42PgS -->
  - **MCP server.** A Model Context Protocol server that Seed Agents connects to as a client. Its tools appear in the agent's space. No first-party MCP server exposes Seed itself. See [MCP](./agent/mcp.md). <!-- id:1769lNvE -->
  - **seed-cli skill.** The agent skill that lets an external agent, such as Claude Code, use the Seed CLI to read and publish. See [Building with agents](./build/agents.md). <!-- id:RUsX_znS -->

# Software and process <!-- id:yWwG-PYb -->

- **Seed daemon.** `seed-daemon`, the Go program that stores, indexes, verifies and syncs blobs. Every other Seed program talks to one. See [Daemon](./apps/daemon.md). <!-- id:_lcyYgtL -->
- **Seed app.** The Electron desktop app, which runs its own daemon. See [Desktop](./apps/desktop.md). <!-- id:cSXWzIi_ -->
- **Seed web app.** The server-rendered web app that turns a daemon into a site and serves the Seed API. See [Web](./apps/web.md). <!-- id:ranDOCO7 -->
- **Extensions (plugins).** A planned plugin system in which a document carries a small app that a site installs. It is being redone and nothing ships today. See [Roadmap](./protocol/roadmap.md). <!-- id:sHvv1RQS -->
- **HM26.** The working name for a redesign of the blob layout and resource model under discussion in 2026. Nothing of it ships. See [Where this is going](./protocol/roadmap.md). <!-- id:dDtKuX_n -->
- **Protocol change.** Any change to permanent data, the sync protocol, capabilities, identity, or any interoperable wire or disk format. It goes through a written proposal and review. See [Contributing](./build/contributing.md). <!-- id:yTSdjbju -->
- **Repo HM sync.** The round trip between a git folder and a Hypermedia space that publishes this site from the repository. See [Publish a folder](./build/publish-a-folder.md). <!-- id:mkEgUuP2 -->

# Retired names <!-- id:wzhS50Pz -->

These names appear in old documents, commit messages, team notes and a few code comments. None of them is current. Use the replacement. <!-- id:S9KOynEc -->

<!-- id:p8h_J5CI -->
| Retired name <!-- col:nq2GEltf --> | What it was <!-- col:gNTqVAEe --> | Use instead <!-- col:4yvY0Yoi --> <!-- id:cAtw8oNW --> |
| --- | --- | --- |
| Mintter | The name of the project, company and app before it became Seed. The code moved from the old `mintter` repository into this one in July 2024, and the daemon's default data directory is still `~/.mtt`. | Seed for the software, Hypermedia for the protocol <!-- id:H8Dcg4Ay --> |
| HyperDocs | An early name for the protocol and its URL scheme, with type-prefixed addresses such as `hm://d/<document id>` and `hm://a/<account id>`. | Hypermedia; `hm://<account>/<path>` URLs <!-- id:vcCIb-US --> |
| Aer | An early proposal for converting HTTPS URLs into `hm://` links. | `/hm/api/config`, `X-Hypermedia-*` headers and the `/hm/` URL mapping on [URLs](./protocol/urls.md) <!-- id:fApWR02E --> |
| Groups | Group entities that owned documents and members, removed around 2024 when sites and capabilities replaced them. Disabled `groups` API code and "group site" wording still linger in the repository. | Spaces, sites and [capabilities](./capability.md) <!-- id:NZV6g7tU --> |
| KeyDelegation | The blob type that delegated authority between keys before capabilities existed. A few database helpers still carry the name. | [Capability](./capability.md) with the `AGENT` role <!-- id:tr--uff0 --> |
| ChangeResource, SnapshotResource | Internal jargon for the two kinds of resource. | "document" for the change-based kind, "snapshot blob" for comments, contacts and profiles <!-- id:9rcU6GYe --> |
| Onyx | The working name of the schema system until 2026-09-14. | [Hypermedia Schemas](./schema.md) <!-- id:PmRSJrKw --> |
| `schema`, `childrenSchema` | Metadata keys that bound a document and its children to schemas, replaced on 2026-09-14 with no backward compatibility. | `attributesSchema`, `childAttributesSchema` <!-- id:eLvEVgn7 --> |
| `ref` keyword | The schema key that named another schema, while `type` named a kind. Replaced on 2026-09-16 by one naming key. The validators still resolve `ref` in schemas published before then, and the library checker rejects it. | `type`, which names either a kind or another schema <!-- id:v-GSiejB --> |
| `$type` instance files | JSON files that wrapped example data as `{$type, value}`, removed on 2026-09-16. | A typed document whose own attributes are the data, bound with `attributesSchema` <!-- id:sTX2bf3G --> |
| `type: Collection` | A metadata attribute, shipped in release 2026.8.9, that marked a document as a collection. It was dropped by a decision on 2026-08-27. | Collection-ness derived from content: a single self-listing query block, reported as `isCollection` <!-- id:t-w2iwsB --> |
| `SetKey` | The original flat metadata operation. The daemon still accepts it. | `SetAttributes` <!-- id:o00J2oZi --> |
| `ListEntityMentions` | The old backlinks request, now deprecated. | `ListCitations` <!-- id:USgpAsO4 --> |
| `/:metadata` | The old view suffix for a document's attributes, still accepted in links. | `/:attributes` <!-- id:UGJSeQtM --> |
| EDITOR, Owner, Admin, Follower, Subscriber roles | Roles named in design notes and reserved in a proto comment. None exists in data. | `WRITER` or `AGENT`, see [Role](./role.md) <!-- id:OhlGEp3w --> |

# See also <!-- id:kJk74Vnq -->

- [The Hypermedia protocol](./protocol.md), the layered tour these terms come from. <!-- id:gVMgrctA -->
- [Agents glossary](./agent/glossary.md), for every Seed Agents term. <!-- id:joAFt8D_ -->
- [Why Hypermedia](./why.md), the motivation behind these terms, for any reader. <!-- id:ExOLt8Sa -->
- [Building on Hypermedia](./build.md), for task guides that use them. <!-- id:n38_BPBT -->
