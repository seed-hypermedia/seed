---
name: Write
summary: "The write verb is the mirror of read: it writes memory files and triggers, uploads to IPFS, and publishes signed Hypermedia content under the publish grant."
---
**write** is the verb an [agent](../agent.md) uses to change something. The agent gives an address and the new content. For example, `write ~/memory/notes.md` saves a file, and `write hm://…` publishes a [document](../protocol/documents.md). It is the mirror of [read](./read.md). <!-- id:04mtKDlp -->

`write` does four things:

- It writes [memory](./memory.md) files in the agent's [Space](./space.md).
- It creates and edits [triggers](../trigger.md).
- It uploads [files to IPFS](../protocol/files.md).
- It publishes signed Hypermedia content, such as documents and [comments](../protocol/comments.md).

The last two need the **publish** [grant](./grants.md).

This page is the reference for the verb: its input, each target, the actions and options of a Hypermedia write, and what is refused. `read ~/tools/write/<resource>` returns a write guide for one kind of resource.

# Input and targets <!-- id:v941MPk4 -->

One function handles every target (`executeWriteVerb`, `api-service.ts`). <!-- id:5vvn-Fqz -->

```ts <!-- id:1cFLuUeT -->
type WriteInput = {
  address: string
  content?: string
  options?: Record<string, unknown>
  dryRun?: boolean
}
```

`dryRun` asks what a write would do without doing it. It is a flag on the call itself, so it sits at the top level and not in `options`. It must be a boolean: any other value is a 400, never a real publish by mistake. It works on `hm://` writes, `ipfs://` object writes, and `~/triggers/` writes. The result shows what would be published or stored. On a memory or tools write, `dryRun` is refused. <!-- id:ygGo2VPt -->

The targets:

  - **`~/memory/<path>`**: writes `content` and creates parent directories. Writing an existing file replaces it whole. There is no append. `options.delete` removes a file or directory, `options.fromUrl` downloads a URL to the path, and `options.fromAttachment` saves a [session attachment](./session.md) to it. <!-- id:X3Fn2IAS -->
  - **`~/tools/<name>`**: refused. A tool is a resource in an app or an agent, published at an hm:// address with `options.tool` (read `~/tools/write/apps`). <!-- id:gXx2r3N7 -->
  - **`~/triggers/<name>`**: creates or edits a trigger stored on the server (`writeTriggerAddress`). See [the rules below](#triggers-stored-on-the-server). <!-- id:KRN56YOI -->
  - **`ipfs://`**: publishes a file or an object, and returns its `ipfs://<cid>`. See [the rules below](#ipfs-writes). Needs the publish grant. Anything published is public. <!-- id:xqte77_C -->
  - **`hm://<account>/<path>`**: publishes signed Hypermedia content in the space of an [account](../protocol/identity.md). Needs the publish grant. See [Hypermedia writes](#hypermedia-writes). <!-- id:gj2w4grI -->

# Triggers stored on the server

Most triggers are trigger documents, published with an `hm://` write and `options.trigger`. Use `~/triggers/<name>` only for what a document cannot say, such as a script continuation or a wake.

- `content` is JSON: `{source, prompt, enabled?, continuation?}`. `options.trigger` as an object works too.
- The name comes from the address. A name inside the content cannot point the write at another trigger.
- Sources and continuations are checked by the same code the signed trigger actions use.
- `enabled` is kept as written and defaults to true. So the agent turns its own automations on and off. See the threat-model note in [security](./security.md).
- Names are not unique. A name that matches several triggers is refused, and the refusal lists the matching ids. An id works as the address too.
- `options.delete` removes a trigger.
- The other options are `combineWith` (merge another trigger into this one), `useOtherAction`, `expectedUpdatedAt` (refuse a stale edit), `replaceSource`, and `frequentSchedule` (allow a schedule under the usual minimum).
- Triggers also accept `dryRun` inside `options`. Prefer the top-level field.
- A write emits a `trigger-updated` account event, so the Triggers tab in the [Seed app](../software/desktop.md) updates live.

# IPFS writes

- For a file, pass `options.fromPath` (a memory file) or `options.fromAttachment`.
- For an object, pass [DAG-JSON](../schema/dag-json.md) as `content`. The server stores it as a [DAG-CBOR](../schema/dag-cbor.md) [blob](../protocol/blobs.md). The options `schema`, `sign`, `signer`, `type`, `link` and `force` apply to objects only. `force` publishes an object that fails its schema check.
- A file is cut into [UnixFS](../protocol/files.md) pieces by the shared client helper and sent through `PublishBlobs` on the typed HM API. The result is the root `ipfs://<cid>` URL. No server-specific `/ipfs/file-upload` route is needed.
- `SEED_APPS_IPFS_SERVER_URL` only selects the [gateway](../protocol/sites.md) that `read ipfs://…` uses. It defaults to the HM API origin.

# Hypermedia writes

`options.action` says what kind of write this is. The runtime turns it into the same command the [CLI](../build/cli.md) uses (`api-service.ts`), then builds and signs the [Change](../change.md) and [Ref](../ref.md). <!-- id:PbMNPSW8 -->

| `options.action` | what it does | its options |
| --- | --- | --- |
| `document` (the default) | creates a document (`document.create`) | `name`, `metadata`, `page`, `pageTarget`, `pageData`, `tool`, `trigger` |
| `update` | publishes a new version of the document at the address | the same as `document` |
| `comment` | comments on the document at the address | `target`, `replyTo`, `allowPlainMentions` |
| `move` | moves the document | `toPath` |
| `redirect` | makes the address redirect | `toUrl` |
| `delete` | deletes the document | none |
| `fork` | copies another document to the address | `fromUrl` |
| `run` | starts an app on this server | `privateConfig` (the app's private settings) |
| `stop` | stops an app on this server | none |

Every action also takes `signer`, `input` and `skipLinkCheck`.

On `document` and `update`, three options turn the document into something more. A document can be only one of these:

- `options.page` publishes a memory folder as a [custom HTML page](../page.md). `options.pageData` lists the collections the page writes.
- `options.tool` publishes a memory folder as the code of a [tool](../tool.md).
- `options.trigger` makes the document a trigger.

Read `~/tools/write/pages`, `~/tools/write/apps` and `~/tools/write/triggers` before using them.

For `update`, the write address **is** the document to edit. There is no separate option to name it. An update with `content` replaces the whole document body. An update with no `content` changes only metadata and leaves the body as it is. It never compares against an empty body, which would delete every [block](../protocol/blocks.md). <!-- id:QUdlrjMK -->

An update stores only what differs. The runtime compares the new body with the document and asks the site to compute the change (`PrepareDocumentChange`, through the SDK's [`documentUpdateBlobs`](../build/sdk.md)). A block that did not change is not written again, and a block that did not move is not moved again. The runtime signs what the site prepared and publishes it.

- When nothing differs, nothing is published. The result carries `unchanged: true`, a message saying the document is already up to date, and the document's current `version`. A dry run reports the same.
- Files the write refers to (a page bundle, a code folder) are still stored.
- A metadata map is sent as its entries, plus a null for each entry that went away. Values the site's API cannot carry (lists, fractions, [IPLD](../schema/ipld.md) links, keys with a dot or a leading `$`) go in a second change the runtime builds on top of the prepared one, only when they differ from the document.
- The runtime builds the whole change itself, stored as written, when the site's answer cannot be used: the site does not answer within 15 seconds, refuses the request as too large (413), fails to apply it, or returns a change that does not fit the request. The service logs the reason. A refusal for lack of permission is still an error.

An action with a dot in its name is passed through as a raw command: `draft.create`, `profile.update`, `contact.create`, `capability.grant`, and the rest. The address fills in the account and path. Extra command fields go **only** in `options.input`, never as loose option keys. The commands accept other spellings (`reply`, `commentId`, `name`, …), so a loose key could change the operation without anyone noticing. <!-- id:OVZd6Zcp -->

The agent signs with one of its own keys. Which keys an agent has, and how it gets write access to a space, is on [agent identity](./identity.md).

# Unknown options are refused

An option key the server does not know is **refused with a 400 that names the key and the supported set**. It is never dropped in silence. The check is per address form (`assertKnownWriteOptions`). A model can read a clear refusal and correct itself. It cannot learn from a silent drop. <!-- id:omwu1HQq -->

Two old spellings get a hint in the refusal (`RETIRED_WRITE_OPTION_HINTS`): `title` points at `name` or `metadata.name`, and `dryRun` points at the top-level field.

# Other rules

More write behavior: <!-- id:6PdHCPGt -->
  - A document has no separate "title". The document's name **is** `metadata.name`, and `options.name` is a short way to set it. A markdown `#` heading is body content and does not set the name. <!-- id:vqOTxHM1 -->
  - `document.create` (and `draft.create`) **need a name**, from `options.name`, `metadata: {name}`, or content frontmatter (`name:`; the shared markdown parser also accepts `title:`). A create with no name is refused. <!-- id:tqh88y7F -->
  - Markdown with frontmatter YAML that does not parse is refused with a 400 that names the problem. So is a ```` ```mermaid ```` fence that mermaid cannot parse. This applies to create, update and memory publish. Drafts are checked when they are published.
  - `options.metadata` is an object of document [metadata](../metadata.md) attributes, such as `{summary, icon, cover, …}` or custom keys. It works on `document`, `update`, and dotted commands that take a document. The server merges it over the metadata in the markdown frontmatter, and `options.name` wins for `name`. <!-- id:pacPuZKE -->
  - `options.signer` picks the identity by `profileName` or `publicKey` from the agent's selected [signing identities](./identity.md). <!-- id:FwTGvj_C -->
  - A comment mentions an account only through an inline mention. See [comments and mentions](./comments-and-mentions.md).
  - `options.fromPath` on an `hm://` address publishes a memory markdown file, with its frontmatter and its images. Path `/` takes the document path from the file's frontmatter name. <!-- id:gZfg4J0I -->
  - `document.create` refuses a nested path whose parent is not published. Top-level paths are always allowed. The server enforces this, also in `dryRun`. <!-- id:KlGDRPlO -->
  - `options.skipLinkCheck` publishes without checking that every link in the body resolves. <!-- id:WV4ngnGU -->
  - Root-level `server` and `dev` are accepted only when they name the HM server the agent is configured with. Publishing always uses that server, never one the model picks (`api-service.ts`). <!-- id:Dlh1Pqbd -->
  - `path: "/"` means the account's [home document](../protocol/spaces.md). It is published as the empty HM path. <!-- id:zkDp34Z8 -->
  - [Tables](../block/table.md) are written as GFM markdown tables that carry identity comments. See [markdown tables](./markdown-tables.md).
  - Hypermedia content can be at most 256 KiB (`MAX_WRITE_CONTENT_BYTES`). `normalizeWriteContent()` (`api-service.ts`) refuses a larger document or comment body, and publishing a memory file has the same limit. Memory writes themselves have no size limit. See the note in [security](./security.md). <!-- id:Ftyq2lzE -->

# See also <!-- id:RmoES-fb -->

- [Read](./read.md) <!-- id:uZ72PEPs -->
- [Call](./call.md) <!-- id:2iUulfvt -->
- [Grants](./grants.md) <!-- id:SyQwNzfM -->
- [Space](./space.md) <!-- id:qFAoDeph -->
- [Tools](./tools.md) <!-- id:WsqiYcPm -->
- [Memory](./memory.md)
- [Comments and mentions](./comments-and-mentions.md)
- [Markdown tables](./markdown-tables.md)
- [Agent identity](./identity.md)
- [Documents in the protocol](../protocol/documents.md) <!-- id:RGCl2cqh -->
