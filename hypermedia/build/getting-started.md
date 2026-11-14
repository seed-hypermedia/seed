---
name: Getting started
summary: Read a document from hyper.media with curl, the SDK and the CLI, then create a key and publish your first document, in about fifteen minutes.
---
The fastest way to understand the [Hypermedia protocol](../protocol.md) is to read a [document](../protocol/documents.md) three ways and then publish one. You do not need to run a [daemon](../apps/daemon.md) or a server. Every request goes to `https://hyper.media`, the public [gateway](../protocol/sites.md), and the [key](./keys.md) you create stays on your machine. <!-- id:rcv36Bj6 -->

**Goal.** In fifteen minutes you will fetch a document with `curl`, with the [SDK](./sdk.md) and with the [Seed CLI](./cli.md). Then you create an [account](../protocol/identity.md) key, publish a home document and a page under it, and see them on the web. <!-- id:hZxc4H5u -->

**Prerequisites.** `curl`, and [Node.js](https://nodejs.org/) 18 or newer. The CLI's key storage uses the OS keyring and needs macOS or Linux. The CLI's key store does not support Windows yet, so on Windows use a key file, described in [keys](./keys.md). <!-- id:oBcsTktU -->

# 1. Read a document with curl <!-- id:Xmp_0E63 -->

Every document has an [`hm://` id](../protocol/urls.md): the account that owns it, then a path. This one is the self-hosting guide on the Seed team's [site](../protocol/sites.md). <!-- id:Ws3re7F5 -->

```sh <!-- id:NqtTfx5g -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

```json <!-- id:lnnLsbod -->
{"json":{"type":"document","document":{"content":[{"children":[],"block":{"type":"Paragraph","id":"OtLkse-T",…,"text":"If you want to publish on your own domain without relying on our service, …"}},…],"version":"bafy2bzacedia6…","authors":["z6MkfnCSnmst…","z6MkgisVMELv…",…],"metadata":{"name":"Self-Host a Seed Website","cover":"ipfs://bafkreie6…"},"genesis":"bafy2bzacedvbz…",…},"id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed","uid":"z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","path":["resources","self-host-seed"],…,"latest":true}}}
```

The body is wrapped in `{"json": …}`. The document is a tree of [blocks](../protocol/blocks.md) with [metadata](../metadata.md), a [`version`](../protocol/documents.md) (the ids of the changes it is made of) and the accounts that ever changed it. If you only want to read, the same document is one URL away as markdown: <!-- id:jh4e7yxU -->

```sh <!-- id:cy0VIhNJ -->
curl 'https://seed.hyper.media/resources/self-host-seed.md'
```

If you have a web link and need the `hm://` id, the site tells you the id in response headers: <!-- id:A-p74dN3 -->

```sh <!-- id:3N6QY_hQ -->
curl -X OPTIONS -I 'https://seed.hyper.media/resources/self-host-seed' | grep -i x-hypermedia-id
```

``` <!-- id:Vlj3Fl73 -->
x-hypermedia-id: hm%3A%2F%2Fz6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS%2Fresources%2Fself-host-seed
```

The full request surface is on the [Seed API](./web-api.md) page. <!-- id:-_Ueno1B -->

# 2. Read it with the SDK <!-- id:J_SqXIx2 -->

`@seed-hypermedia/client` is the TypeScript SDK. It knows every request key, encodes inputs, unwraps responses and validates the result. <!-- id:yXUJ-Emj -->

```sh <!-- id:nd03no_H -->
mkdir hm-hello && cd hm-hello && npm init -y >/dev/null
npm install @seed-hypermedia/client zod@^3.20
```

```ts <!-- id:6cBExWB7 -->
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

```sh <!-- id:cYF3HBM1 -->
node read.mjs
```

``` <!-- id:ABkhuSVP -->
Self-Host a Seed Website
If you want to publish on your own domain without relying on our service, …
```

`client.request` is typed. The request key picks the input and output types, and `resource.type` narrows the union. Search works the same way: `client.request('Search', {query: 'hypermedia', pageSize: 5})`. Zod 3 is a peer dependency. Zod 4 does not work. <!-- id:klMzyXLn -->

# 3. Read it with the CLI <!-- id:lgao_UOU -->

The Seed CLI wraps the same API for the terminal and for scripts. [Agent skills](./agents.md) use it too. <!-- id:lj_AofZ8 -->

```sh <!-- id:GUkcvOXv -->
npm install -g @seed-hypermedia/cli
seed-cli document get hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed
```

``` <!-- id:VQblrR4- -->
---
name: Self-Host a Seed Website
cover: ipfs://bafkreie6wls4wzt26vl3smvcc5smulmbostaokyftwmig2ojfpkhbmbee4
---
If you want to publish on your own domain without relying on our service, you are welcome to self-host your site. … <!-- id:OtLkse-T -->

This guide is a bit technical, but it will allow you to publish on the web with complete freedom from any single company. <!-- id:fjRkSmjy -->
```

The CLI prints documents as markdown with frontmatter and a trailing `<!-- id:… -->` comment per block. This dialect round-trips, so you can publish an edited file back. `--json` gives the structured form. You can paste a web URL instead of an `hm://` id, and `seed-cli search "self-host"` finds documents across the network. The [CLI reference](./cli.md) lists every command. <!-- id:acdLnThY -->

# 4. Create a key <!-- id:TZaKTuxF -->

An account is a key. The CLI generates one from a [mnemonic](../protocol/identity.md) and stores it in your OS keyring. The mnemonic is the only backup. <!-- id:34VU4Zy7 -->

```sh <!-- id:05zOtBMk -->
seed-cli key generate --name main --show-mnemonic
```

``` <!-- id:kcycI5Fz -->
⚠ SAVE THIS MNEMONIC SECURELY - it cannot be recovered!

<twelve words>

✓ Key "main" created
ℹ Account ID: z6Mk…
```

The account id is a [principal](../principal.md): `z6Mk` followed by the base58 encoding of an Ed25519 public key. It is your account id on the network and the `uid` in every `hm://` URL of your [space](../protocol/identity.md). `seed-cli key list` shows it again. To derive the id from a phrase without storing it, run `seed-cli key derive "<words>"`. The standard test phrase `abandon … about` derives `z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f`. <!-- id:6nM6zg4l -->

If you already use the [Seed app](../apps/desktop.md), the CLI reads the app's [vault](../apps/vault.md) too, so your existing account shows up in `key list` with `"source": "vault"` and you can skip this step. [Keys](./keys.md) covers mnemonics, key files and headless setups. <!-- id:XYXVNA7T -->

# 5. Publish <!-- id:wR5xysHm -->

A space begins with its home document. Write a markdown file and publish it at the root path. <!-- id:6ksUDL-y -->

```sh <!-- id:C8uayPUI -->
cat > home.md <<'EOF'
---
name: My Space
summary: A first Hypermedia space, published from the command line.
---
Hello from the Hypermedia network. This document is signed by my key and stored as content-addressed blobs.
EOF

seed-cli document create -f home.md --path /
```

``` <!-- id:Jqq9H-p2 -->
✓ Document published: https://hyper.media/hm/z6Mk…
```

Now a page under it: <!-- id:TsEcQf6r -->

```sh <!-- id:1orzMUSq -->
cat > hello.md <<'EOF'
---
name: Hello
---
A second document, one level below the home document.
EOF

seed-cli document create -f hello.md --path hello
```

``` <!-- id:PMeUjw58 -->
✓ Document published: https://hyper.media/hm/z6Mk…/hello
```

Open the printed URL. The gateway renders your space. `seed-cli document get hm://z6Mk…/hello` reads it back, and `seed-cli document update hm://z6Mk…/hello -f hello.md` publishes an edit as a new change on top of the existing history. `--dry-run` shows what would be published without sending it. <!-- id:j7xBnfiS -->

# What happened <!-- id:r4KBHPgM -->

Each `document create` did three things on your machine. It turned the markdown into a [Change](../change.md) [blob](../protocol/blobs.md): a signed, content-addressed record of the operations that build the document. For a new document that first change is also its [genesis](../protocol/documents.md), the id that names the document's whole history. It then signed a [Ref](../ref.md), a small blob saying "in my space, at this path, the document is at this version", and sent both blobs to `hyper.media` with a single [`PublishBlobs`](./web-api.md) request. When a new document is two or more levels deep and its parent exists, the CLI also adds a link card to the parent. `hello` sits directly under the root, so the home document does not change. The gateway's daemon verified the signatures, indexed the blobs, and will hand them to any [peer](../protocol/network.md) that asks for your space. <!-- id:bAqNTaqi -->

Nothing was logged in. Your authority to publish at `hm://z6Mk…/hello` is that the Ref is signed by the key that owns the space. Anyone can fetch the blobs and [verify](../protocol/integrity.md) that. [Documents](../protocol/documents.md) explains the change graph, versions and refs. [Blobs](../protocol/blobs.md) explains the signing envelope and content ids. <!-- id:69PS8YKY -->

# Next <!-- id:LTnHqNN- -->

- Publish a whole folder of markdown and keep it in sync with git: [publish a folder](./publish-a-folder.md). <!-- id:-3Mnam0M -->
- Build the blobs yourself in TypeScript, with `createDocumentBlobs`, `createComment` and `createCapability`: [SDK](./sdk.md). <!-- id:kykE3X_B -->
- Let an agent read and write your space with a delegated key: [using Seed from your own agent](./agents.md). <!-- id:rrfnOUBm -->
- Sign in a browser visitor to your own app with their Seed account: [sign in](./sign-in.md). <!-- id:XuPImF9N -->
- Serve your space on your own domain: [self-hosting](./self-hosting.md). <!-- id:wY5wLGHU -->
- Understand what you just used, from keys to sync: [the protocol](../protocol.md). <!-- id:2ZN96Db6 -->

# See also <!-- id:VOQUEID7 -->

- [Building on Hypermedia](../build.md) <!-- id:jutCfurG -->
- [Seed API](./web-api.md) <!-- id:AL7fkECh -->
- [Seed CLI](./cli.md) <!-- id:eou57Ryt -->
- [Keys](./keys.md) <!-- id:oCcSgCsv -->
- [Documents](../protocol/documents.md) <!-- id:DrVejWie -->
- [Glossary](../glossary.md) <!-- id:cXXiEpwM -->
