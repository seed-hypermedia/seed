---
name: Write
summary: "The write verb is the mirror of read: it writes memory files and triggers, uploads to IPFS, and publishes signed Hypermedia content under the publish grant."
---
**write** is the mirror of [read](./read.md). It writes [memory](./memory.md) files and [triggers](../trigger.md) in the agent's [Space](./space.md). It publishes signed Hypermedia content, such as [documents](../protocol/documents.md) and [comments](../protocol/comments.md), when the agent holds the **publish** [grant](./grants.md), and it uploads [files to IPFS](../protocol/files.md). <!-- id:04mtKDlp -->

This page is the reference for the verb: its input, each target, the actions and options of a Hypermedia write, and what is refused. `read ~/tools/write/<resource>` returns a write guide for one kind of resource.

# Input and targets <!-- id:v941MPk4 -->

The mirror of `read` (`executeWriteVerb`, `api-service.ts`). <!-- id:5vvn-Fqz -->

```ts <!-- id:1cFLuUeT -->
type WriteInput = {
  address: string
  content?: string
  options?: Record<string, unknown>
  dryRun?: boolean
}
```

`dryRun` is a flag on the call itself, so it sits at the top level and not in `options`. It is strict. A non-boolean value is a 400, never a silent real publish. It applies to `hm://` writes, `ipfs://` object writes, and `~/triggers/` writes: the handler returns an echo of what would be published or stored before anything is. Passing it on a memory or tools write is refused. <!-- id:ygGo2VPt -->
  - **`~/memory/<path>`**: writes `content` and creates parent directories. Writing an existing file replaces it whole. There is no append. `options.delete` removes a file or directory, `options.fromUrl` downloads a URL to the path, and `options.fromAttachment` saves a session attachment to it. <!-- id:X3Fn2IAS -->
  - **`~/tools/<name>`**: refused. A tool is a resource in an app or an agent, published at an hm:// address with `options.tool` (read `~/tools/write/apps`). <!-- id:gXx2r3N7 -->
  - **`~/triggers/<name>`**: creates or edits a [trigger](../trigger.md) (`writeTriggerAddress`). `content` is JSON `{source, prompt, enabled?, continuation?}` (or `options.trigger` as an object). The name comes from the address, and a name inside the content cannot retarget the write. Sources and continuations go through the same normalizers the signed CRUD actions use. `enabled` is honored as written and defaults to true, so the agent enables, disables, and retires its own automations directly. See the threat-model note in [security](./security.md). Names are not unique, so an ambiguous name is refused with the matching ids. Addressing by id works too. `options.delete` removes a trigger. The other options are `combineWith` (merge another trigger into this one), `useOtherAction`, `expectedUpdatedAt` (refuse a stale edit), `replaceSource`, `frequentSchedule` (allow a schedule under the usual minimum), and `dryRun`. Writes emit `trigger-updated` account events, so the desktop Triggers tab updates live. <!-- id:KRN56YOI -->
  - **`ipfs://`**: publishes a file from `options.fromPath` (a memory file) or `options.fromAttachment`, or an **object** when `content` is DAG-JSON: the object is encoded as a DAG-CBOR blob, optionally bound to a `schema`, signed (`sign`, `signer`), typed (`type`), linked (`link`), or forced past validation (`force`), and its `ipfs://<cid>` comes back. For a file it chunks the data into [UnixFS](../protocol/files.md) blocks with the shared client helper, sends those blocks through `PublishBlobs` on the typed HM API, and returns the root `ipfs://<cid>` URL. It does not depend on a server-specific `/ipfs/file-upload` route. `SEED_APPS_IPFS_SERVER_URL` only selects the gateway used by `read ipfs://…`, and defaults to the HM API origin. Requires the publish grant. Publishing makes the file publicly retrievable. <!-- id:xqte77_C -->
  - **`hm://<account>/<path>`**: publishes signed hypermedia. Requires the publish grant. <!-- id:gj2w4grI -->

# Hypermedia writes

Hypermedia writes map `options.action` onto the command envelope shared with the [CLI](../build/cli.md) (`api-service.ts`): the default `document` becomes `document.create`, plus `update`, `comment` (with `target` and `replyTo`), `move` (`toPath`), `redirect` (`toUrl`), `delete`, and `fork` (`fromUrl`). The runtime builds and signs the [Change](../change.md) and [Ref](../ref.md). <!-- id:PbMNPSW8 -->

For `update`, the write address **is** the edit target. The envelope fills `input.edit` from it ("same address, new version"), so there is no separate option to name the target. An update with `content` replaces the whole document body. An update with no `content` at all changes only metadata and leaves the body untouched. It never diffs against an empty tree, which would delete every block. <!-- id:QUdlrjMK -->

Any dotted action passes through as a raw command: `draft.create`, `profile.update`, `contact.create`, `capability.grant`, and the rest, with the address filling account and path. Extra command fields go **only** in `options.input`, never as loose option keys. The command handlers accept aliases (`reply`, `commentId`, `name`, …), and a stray key that silently changes the operation is a real hazard. <!-- id:OVZd6Zcp -->

The agent signs with one of its own keys. Which keys an agent has, and how it gets write access to a space, is on [agent identity](./identity.md).

# Unknown options are refused

An unrecognized loose option key is **refused with a 400 naming the key and the supported set**. It is never silently dropped. This is enforced per address form (`assertKnownWriteOptions`). A model can read a loud refusal and correct itself. It cannot learn from a silent drop. Two retired spellings get a hint in the refusal (`RETIRED_WRITE_OPTION_HINTS`): `title` points at `name` or `metadata.name`, and `dryRun` points at the top-level field. <!-- id:omwu1HQq -->

# Other rules

More write behavior: <!-- id:6PdHCPGt -->
  - The document model has no separate "title". The document's name **is** `metadata.name`, and `options.name` is shorthand for it. A markdown `#` heading is body content and does not set the name. <!-- id:vqOTxHM1 -->
  - `document.create` (and `draft.create`) **require a name**, from `options.name`, `metadata: {name}`, or content frontmatter (`name:`; the shared markdown parser also accepts `title:`). A nameless create is refused. Markdown content whose frontmatter YAML does not parse, or that holds a ```` ```mermaid ```` fence mermaid cannot parse, is refused with a 400 naming the problem (on create, update and memory publish; drafts are checked when published). <!-- id:tqh88y7F -->
  - `options.metadata` (document and update, and dotted document-shaped commands) is an object of document [metadata](../metadata.md) attributes merged into the document's metadata: `{summary, icon, cover, …}` or custom keys. It merges over markdown frontmatter metadata, and `options.name` wins for `name`. <!-- id:pacPuZKE -->
  - `options.signer` picks the identity by `profileName` or `publicKey` from the agent's selected signing [keys](../build/keys.md). <!-- id:FwTGvj_C -->
  - A comment mentions an account only through an inline mention. See [comments and mentions](./comments-and-mentions.md).
  - `options.fromPath` on an `hm://` address publishes a memory markdown file (frontmatter plus resolved images) through the dedicated pipeline. Path `/` derives the document path from the file's frontmatter name. <!-- id:gZfg4J0I -->
  - `document.create` refuses a nested path whose parent is not already published. Top-level paths are always allowed. The server enforces this, including in `dryRun`. <!-- id:KlGDRPlO -->
  - `options.skipLinkCheck` publishes without checking that every link in the body resolves. <!-- id:WV4ngnGU -->
  - Root-level `server` and `dev` are accepted only when they resolve to the configured agent HM server. Publishing always uses that server, never one the model picks (`api-service.ts`). <!-- id:Dlh1Pqbd -->
  - `path: "/"` means the account [home document](../protocol/documents.md) and is published as the canonical empty HM path. <!-- id:zkDp34Z8 -->
  - [Tables](../block/table.md) round-trip through markdown as GFM tables that carry identity comments. See [markdown tables](./markdown-tables.md).
  - Hypermedia content is bounded at 256 KiB (`MAX_WRITE_CONTENT_BYTES`). `normalizeWriteContent()` (`api-service.ts`) rejects oversized document and comment bodies, and publishing a memory file refuses the same ceiling (`api-service.ts`). Memory writes themselves are unbounded. See the note in [security](./security.md). <!-- id:Ftyq2lzE -->

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
