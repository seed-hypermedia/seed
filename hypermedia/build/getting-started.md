---
name: Getting started
summary: Read a document from hyper.media with curl, the SDK and the CLI, then create a key and publish your first document, in about fifteen minutes.
---
The fastest way to understand the Hypermedia protocol is to read a document three ways and then publish one. Nothing here requires running a daemon or a server: every request goes to `https://hyper.media`, the public gateway, and the key you create stays on your machine.

**Goal.** In fifteen minutes: fetch a document with `curl`, with the SDK and with the Seed CLI; create an account key; publish a home document and a page under it; see them on the web.

**Prerequisites.** `curl`, and [Node.js](https://nodejs.org/) 18 or newer. macOS or Linux for the CLI's key storage, which uses the OS keyring (Windows is not supported by the CLI's key store yet; use a key file, described in [keys](./keys.md)).

# 1. Read a document with curl

Every document has an `hm://` id: the account that owns it, then a path. This one is the self-hosting guide on the Seed team's site.

```sh
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

```json
{"json":{"type":"document","document":{"content":[{"children":[],"block":{"type":"Paragraph","id":"OtLkse-T",…,"text":"If you want to publish on your own domain without relying on our service, …"}},…],"version":"bafy2bzacedia6…","authors":["z6MkfnCSnmst…","z6MkgisVMELv…",…],"metadata":{"name":"Self-Host a Seed Website","cover":"ipfs://bafkreie6…"},"genesis":"bafy2bzacedvbz…",…},"id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed","uid":"z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","path":["resources","self-host-seed"],…,"latest":true}}}
```

The body is wrapped in `{"json": …}`; the document is a tree of blocks with metadata, a `version` (the ids of the changes it is made of) and the accounts that ever changed it. If you only want to read, the same document is one URL away as markdown:

```sh
curl 'https://seed.hyper.media/resources/self-host-seed.md'
```

And if you have a web link rather than an `hm://` id, the site tells you the id in response headers:

```sh
curl -X OPTIONS -I 'https://seed.hyper.media/resources/self-host-seed' | grep -i x-hypermedia-id
```

```
x-hypermedia-id: hm%3A%2F%2Fz6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS%2Fresources%2Fself-host-seed
```

The full request surface is on the [Seed API](./web-api.md) page.

# 2. Read it with the SDK

`@seed-hypermedia/client` is the TypeScript SDK. It knows every request key, encodes inputs, unwraps responses and validates the result.

```sh
mkdir hm-hello && cd hm-hello && npm init -y >/dev/null
npm install @seed-hypermedia/client zod@^3.20
```

```ts
// read.mjs
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'

const client = createSeedClient('https://hyper.media')
const id = unpackHmId('hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed')
const resource = await client.request('Resource', id)

if (resource.type === 'document') {
  console.log(resource.document.metadata.name)
  console.log(resource.document.content[0].block.text)
}
```

```sh
node read.mjs
```

```
Self-Host a Seed Website
If you want to publish on your own domain without relying on our service, …
```

`client.request` is typed: the key picks the input and output types, and `resource.type` narrows the union. Search works the same way: `client.request('Search', {query: 'hypermedia', pageSize: 5})`. Zod 3 is a peer dependency; zod 4 is not supported.

# 3. Read it with the CLI

The Seed CLI wraps the same API for the terminal and for scripts, and it is what agent skills use.

```sh
npm install -g @seed-hypermedia/cli
seed-cli document get hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed
```

```
---
name: Self-Host a Seed Website
cover: ipfs://bafkreie6wls4wzt26vl3smvcc5smulmbostaokyftwmig2ojfpkhbmbee4
---
If you want to publish on your own domain without relying on our service, you are welcome to self-host your site. … <!-- id:OtLkse-T -->

This guide is a bit technical, but it will allow you to publish on the web with complete freedom from any single company. <!-- id:fjRkSmjy -->
```

The CLI prints documents as markdown with frontmatter and a trailing `<!-- id:… -->` comment per block; this dialect round-trips, so a file you edit can be published back. `--json` gives the structured form. You can paste a web URL instead of an `hm://` id, and `seed-cli search "self-host"` finds documents across the network. The [CLI reference](./cli.md) lists every command.

# 4. Create a key

An account is a key. The CLI generates one from a mnemonic and stores it in your OS keyring; the mnemonic is the only backup.

```sh
seed-cli key generate --name main --show-mnemonic
```

```
⚠ SAVE THIS MNEMONIC SECURELY - it cannot be recovered!

<twelve words>

✓ Key "main" created
ℹ Account ID: z6Mk…
```

The account id is a [principal](../principal.md): `z6Mk` followed by the base58 encoding of an Ed25519 public key. It is your account id on the network and the `uid` in every `hm://` URL of your space. `seed-cli key list` shows it again. To derive the id from a phrase without storing it, `seed-cli key derive "<words>"`; the standard test phrase `abandon … about` derives `z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f`.

If you already use the Seed app, the CLI reads the app's vault too, so your existing account shows up in `key list` with `"source": "vault"` and you can skip this step. [Keys](./keys.md) covers mnemonics, key files and headless setups.

# 5. Publish

A space begins with its home document. Write a markdown file and publish it at the root path.

```sh
cat > home.md <<'EOF'
---
name: My Space
summary: A first Hypermedia space, published from the command line.
---
Hello from the Hypermedia network. This document is signed by my key and stored as content-addressed blobs.
EOF

seed-cli document create -f home.md --path /
```

```
✓ Document published: https://hyper.media/hm/z6Mk…
```

Now a page under it:

```sh
cat > hello.md <<'EOF'
---
name: Hello
---
A second document, one level below the home document.
EOF

seed-cli document create -f hello.md --path hello
```

```
✓ Document published: https://hyper.media/hm/z6Mk…/hello
```

Open the printed URL. The gateway renders your space; `seed-cli document get hm://z6Mk…/hello` reads it back, and `seed-cli document update hm://z6Mk…/hello -f hello.md` publishes an edit as a new change on top of the existing history. `--dry-run` shows what would be published without sending it.

# What happened

Each `document create` did three things on your machine. It turned the markdown into a [Change](../change.md) blob: a signed, content-addressed record of the operations that build the document. For a new document that first change is also its genesis, the id that names the document's whole history. It then signed a [Ref](../ref.md), a small blob saying "in my space, at this path, the document is at this version", and sent both blobs to `hyper.media` with a single `PublishBlobs` request. When a new document is two or more levels deep and its parent exists, the CLI also adds a link card to the parent. `hello` sits directly under the root, so the home document does not change. The gateway's daemon verified the signatures, indexed the blobs, and will hand them to any peer that asks for your space.

Nothing was logged in. Your authority to publish at `hm://z6Mk…/hello` is that the Ref is signed by the key that owns the space. Anyone can fetch the blobs and verify that. [Documents](../protocol/documents.md) explains the change graph, versions and refs; [Blobs](../protocol/blobs.md) explains the signing envelope and content ids.

# Next

- Publish a whole folder of markdown and keep it in sync with git: [publish a folder](./publish-a-folder.md).
- Build the blobs yourself in TypeScript, with `createDocumentBlobs`, `createComment` and `createCapability`: [SDK](./sdk.md).
- Let an agent read and write your space with a delegated key: [building agents](./agents.md).
- Sign in a browser visitor to your own app with their Seed account: [sign in](./sign-in.md).
- Serve your space on your own domain: [self-hosting](./self-hosting.md).
- Understand what you just used, from keys to sync: [the protocol](../protocol.md).
