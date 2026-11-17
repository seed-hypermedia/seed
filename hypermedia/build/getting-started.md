---
name: Getting started
summary: In about fifteen minutes you read a document from hyper.media with curl, the SDK and the CLI, then create a key and publish your first document.
---
This guide shows you how to read a [document](../protocol/documents.md) in three ways and then publish one of your own. It is the fastest way to understand the [Hypermedia protocol](../protocol.md). You do not need to run a [daemon](../software/daemon.md) or a server. Every request goes to `https://hyper.media`, the public [gateway](../protocol/sites.md). The [key](../protocol/identity.md) you create stays on your machine. <!-- id:rcv36Bj6 -->

**Goal.** You fetch a document with `curl`, with the [SDK](./sdk.md) and with the [Seed CLI](./cli.md). Then you create an [account](../protocol/identity.md) key, publish a home document and a page under it, and see them on the web. It takes about fifteen minutes. <!-- id:hZxc4H5u -->

**What you need.** `curl`, and [Node.js](https://nodejs.org/) 18 or newer. The CLI stores keys in the keyring of your operating system, and that works on macOS and Linux only. On Windows, export a key from the Seed app, put the file's contents in `SEED_CLI_KEYFILE`, and skip step 4. [Keys](./keys.md) describes the file. <!-- id:oBcsTktU -->

# 1. Read a document with curl <!-- id:Xmp_0E63 -->

Every document has an [`hm://` id](../protocol/urls.md). The id is the account that owns the document, then a path. This one is the self-hosting guide on the Seed team's [site](../protocol/sites.md). <!-- id:Ws3re7F5 -->

```sh <!-- id:NqtTfx5g -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

```json <!-- id:lnnLsbod -->
{"json":{"type":"document","document":{"content":[{"children":[],"block":{"type":"Paragraph","id":"OtLkse-T",…,"text":"If you want to publish on your own domain without relying on our service, …"}},…],"version":"bafy2bzacedia6…","authors":["z6MkfnCSnmst…","z6MkgisVMELv…",…],"metadata":{"name":"Self-Host a Seed Website","cover":"ipfs://bafkreie6…"},"genesis":"bafy2bzacedvbz…",…},"id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed","uid":"z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","path":["resources","self-host-seed"],…,"latest":true}}}
```

The answer is wrapped in `{"json": …}`. Inside, the document has four parts worth knowing: <!-- id:jh4e7yxU -->

- `content`, a tree of [blocks](../protocol/blocks.md). A block is one paragraph, heading, image or other piece of the page.
- `metadata`, the document's [metadata](../metadata.md), such as its name and cover image.
- `version`, the ids of the latest changes. A [version](../protocol/documents.md) names one exact state of the document.
- `authors`, the accounts that have changed it.

If you only want to read, you can get the same document as markdown. Add `.md` to its web address:

```sh <!-- id:cy0VIhNJ -->
curl 'https://seed.hyper.media/resources/self-host-seed.md'
```

If you have a web link and need the `hm://` id, ask the site. It puts the id in the response headers: <!-- id:A-p74dN3 -->

```sh <!-- id:3N6QY_hQ -->
curl -X OPTIONS -I 'https://seed.hyper.media/resources/self-host-seed' | grep -i x-hypermedia-id
```

``` <!-- id:Vlj3Fl73 -->
x-hypermedia-id: hm%3A%2F%2Fz6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS%2Fresources%2Fself-host-seed
```

The [Seed API](./web-api.md) page lists the other requests you can make. <!-- id:-_Ueno1B -->

# 2. Read it with the SDK <!-- id:J_SqXIx2 -->

`@seed-hypermedia/client` is the TypeScript SDK. It knows the name of every request, encodes what you send, unwraps the answer and checks its shape. <!-- id:yXUJ-Emj -->

Make a folder and install the SDK:

```sh <!-- id:nd03no_H -->
mkdir hm-hello && cd hm-hello && npm init -y >/dev/null
npm install @seed-hypermedia/client zod@^4.6.6
```

Save this as `read.mjs`:

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

Run it:

```sh <!-- id:cYF3HBM1 -->
node read.mjs
```

``` <!-- id:ABkhuSVP -->
Self-Host a Seed Website
If you want to publish on your own domain without relying on our service, …
```

`client.request` is typed. The request name (`'Resource'`) decides the type of the input and of the answer, and checking `resource.type` tells TypeScript which kind of answer you have. Search works the same way: `client.request('Search', {query: 'hypermedia', pageSize: 5})`. The SDK needs Zod 4 beside it (a peer dependency), which is why the install line names it. <!-- id:klMzyXLn -->

# 3. Read it with the CLI <!-- id:lgao_UOU -->

The Seed CLI offers the same API as commands, for the terminal and for scripts. [Agent skills](./agents.md) use it too. <!-- id:lj_AofZ8 -->

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

The CLI prints a document as markdown. The metadata is at the top, between the `---` lines, and each block ends with an `<!-- id:… -->` marker that holds the block's id. This form is the [markdown dialect](./markdown-dialect.md). It loses nothing, so you can edit the file and publish it back. Three more things to know: <!-- id:acdLnThY -->

- `--json` prints the structured form.
- You can paste a web URL where an `hm://` id is expected.
- `seed-cli search "self-host"` finds documents across the network.

The [CLI reference](./cli.md) lists the commands.

# 4. Create a key <!-- id:TZaKTuxF -->

An account is a key. The CLI makes one from a [mnemonic](../protocol/identity.md), a list of twelve words, and stores it in the keyring of your operating system. The words are the only backup, so write them down. <!-- id:34VU4Zy7 -->

```sh <!-- id:05zOtBMk -->
seed-cli key generate --name main --show-mnemonic
```

``` <!-- id:kcycI5Fz -->
⚠ SAVE THIS MNEMONIC SECURELY - it cannot be recovered!

<twelve words>

✓ Key "main" created
ℹ Account ID: z6Mk…
```

The account id is a [principal](../principal.md): `z6Mk` followed by an Ed25519 public key in base58. It is your name on the network. It is also the `uid` in every `hm://` URL of your [space](../protocol/spaces.md), the place where your documents live. <!-- id:6nM6zg4l -->

- `seed-cli key list` shows the id again.
- `seed-cli key derive "<words>"` prints the id for a phrase and stores nothing. The standard test phrase `abandon … about` gives `z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f`.

If you already use the [Seed app](../software/desktop.md), you can skip this step. The CLI also reads the app's local [vault](../software/vault.md), the encrypted file where the app keeps keys, so your account appears in `key list` with `"source": "vault"`. [Keys](./keys.md) covers mnemonics, key files and machines with no screen. <!-- id:XYXVNA7T -->

# 5. Publish <!-- id:wR5xysHm -->

A space begins with its [home document](../protocol/spaces.md), the document at the root path. Write a markdown file and publish it there. <!-- id:6ksUDL-y -->

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

Then publish a page under it: <!-- id:TsEcQf6r -->

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

Open the printed URL. The gateway shows your space. From here you can: <!-- id:j7xBnfiS -->

- read the page back with `seed-cli document get hm://z6Mk…/hello`;
- publish an edit with `seed-cli document update hm://z6Mk…/hello -f hello.md`, which adds a new change on top of the document's history;
- add `--dry-run` to see what a command would publish without sending it.

# What happened <!-- id:r4KBHPgM -->

Each `document create` did three things on your machine: <!-- id:bAqNTaqi -->

1. It turned the markdown into a [Change](../change.md) [blob](../protocol/blobs.md). A blob is a piece of data named by the hash of its bytes. A Change is a signed record of the steps that build the document. For a new document, the first change is also its [genesis](../protocol/documents.md), the id that names the document's whole history.
2. It signed a [Ref](../ref.md). A Ref is a small blob that says "in my space, at this path, the document is at this version".
3. It sent both blobs to `hyper.media` in one [`PublishBlobs`](./web-api.md) request.

The gateway's daemon checked the signatures and indexed the blobs. It gives them to any [peer](../protocol/network.md) that asks for your space.

When a new document is two or more levels deep and its parent exists, the CLI also adds a link card to the parent. `hello` sits directly under the root, so the home document did not change.

You did not log in anywhere. You may publish at `hm://z6Mk…/hello` because the Ref is signed by the key that owns the space. Anyone can fetch the blobs and [verify](../protocol/integrity.md) that. [Documents](../protocol/documents.md) explains changes, versions and Refs. [Blobs](../protocol/blobs.md) explains signing and content ids. <!-- id:69PS8YKY -->

# Next <!-- id:LTnHqNN- -->

- Publish a whole folder of markdown and keep it in sync with git: [publish a folder](./publish-a-folder.md). <!-- id:-3Mnam0M -->
- Publish and update a document from your own TypeScript: [publishing from code](./publishing-from-code.md).
- Build the blobs yourself in TypeScript, with `createDocumentBlobs`, `createComment` and `createCapability`: [SDK](./sdk.md). <!-- id:kykE3X_B -->
- Let an agent you run read and write your space with a key of its own: [using Seed from your own agent](./agents.md). The hosted kind of agent is [Seed Agents](../agent.md). <!-- id:rrfnOUBm -->
- Sign in a browser visitor to your own app with their Seed account: [sign in](./sign-in.md). <!-- id:XuPImF9N -->
- Serve your space on your own domain: [self-hosting](../operate/self-hosting.md). <!-- id:wY5wLGHU -->
- Understand what you used, from keys to sync: [the protocol](../protocol.md). <!-- id:2ZN96Db6 -->

# See also <!-- id:VOQUEID7 -->

- [Building on Hypermedia](../build.md) <!-- id:jutCfurG -->
- [Seed API](./web-api.md) <!-- id:AL7fkECh -->
- [Seed CLI](./cli.md) <!-- id:eou57Ryt -->
- [Keys](./keys.md) <!-- id:oCcSgCsv -->
- [Documents](../protocol/documents.md) <!-- id:DrVejWie -->
- [Glossary](../glossary.md) <!-- id:cXXiEpwM -->
