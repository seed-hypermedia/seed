/** A detailed write guide loaded only when an agent asks for that Seed resource group. */
export type WriteGuide = {
  summary: string
  markdown: string
}

const preamble = `All Seed resource operations use the write verb. The common shape is:

\`\`\`json
{
  "address": "hm://TARGET_UID/optional-path",
  "content": "optional markdown",
  "options": {
    "action": "ACTION",
    "signer": {"publicKey": "SIGNER_UID"},
    "input": {}
  },
  "dryRun": true
}
\`\`\`

The address identifies the signed account and, for document operations, usually the document. Select an enabled signer with \`options.signer.publicKey\` or \`options.signer.profileName\`. Put fields for dotted actions in \`options.input\`, not loose inside \`options\`. Use top-level \`dryRun: true\` to validate an hm:// operation without publishing.`

/** Detailed Seed write guides, loaded progressively through reads of ~/tools/write/<resource>. */
export const writeGuideRegistry = {
  memory: {
    summary: 'Replace or delete private memory files, download URLs, and save conversation attachments.',
    markdown: `# Writing private memory

Memory addresses stay private to the agent and use \`~/memory/<path>\`.

- Write or replace a UTF-8 file: pass string \`content\`. Parent directories are created automatically; there is no append operation, so read-modify-write when preserving existing content.
- Delete a file or directory: \`options: {delete: true}\`.
- Download a public URL directly to memory: \`options: {fromUrl: "https://..."}\`.
- Save a conversation attachment: \`options: {fromAttachment: "ATTACHMENT_ID"}\`. The attachment must belong to the current session.

\`\`\`json
{"address":"~/memory/notes/project.md","content":"# Project\n\nCurrent state."}
\`\`\`

Memory writes are not public and do not use \`dryRun\` or a signer. A write replaces the entire target file.`,
  },
  tools: {
    summary: 'Create, replace, or delete an authored callable tool.',
    markdown: `# Authoring callable tools

Write JSON to \`~/tools/<name>\` with \`description\`, an input JSON schema, an optional output schema, source code, and optional runtime (TypeScript is the default; Python is also supported when available).

\`\`\`json
{"address":"~/tools/word_count","content":"{\"description\":\"Count words.\",\"input\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}},\"required\":[\"text\"]},\"source\":\"export default (input) => ({count: input.text.trim().split(/\\s+/).length})\"}"}
\`\`\`

The source runs in the execute sandbox with validated input. Read \`~/tools/<name>\` after saving to inspect the live contract, then invoke it with the call verb. Delete with \`options: {delete: true}\`. Tool authoring does not use \`dryRun\` or a signer.`,
  },
  triggers: {
    summary: 'Create, edit, enable, disable, or delete an automation trigger.',
    markdown: `# Writing triggers

Write JSON to \`~/triggers/<name>\` with \`source\`, \`prompt\`, and optional \`enabled\` and \`continuation\`. Read \`~/triggers/\` first: it lists current triggers and which source fits which request (mentions, replies, comments, document changes, schedules). New triggers default to enabled.

Check a trigger before saving it with \`options: {dryRun: true}\`: the write is validated and, for activity sources, replayed against recent activity to show how often it would have fired. Nothing is saved, so never create test triggers. If no source expresses the request, tell the user instead of approximating with a broad filter.

\`\`\`json
{"address":"~/triggers/hourly-review","content":"{\"source\":{\"type\":\"schedule\",\"schedule\":{\"kind\":\"interval\",\"every\":1,\"unit\":\"hours\"}},\"prompt\":\"Review current project state.\",\"enabled\":true}"}
\`\`\`

A trigger's \`continuation\` decides what a firing does. The default starts a thread from \`prompt\`. Use \`{kind: "newThread", systemPrompt: "…", tools: ["read", "search"]}\` when the automation needs additional system instructions or a narrower toolset; the agent-authored system prompt remains included by default and the tool list can only narrow the agent's grants. Set \`includeAgentSystemPrompt: false\` to omit the agent-authored prompt while retaining shared runtime instructions. To run code with no model involved, use \`{"kind":"tool","tool":"<name>","input":{...},"onFailure":"thread"}\` (one tool call; \`"$event"\` / \`"$event.<path>"\` strings in \`input\` are filled from the event) or \`{"kind":"script","script":"export default async function (input, ctx) {…}","onFailure":"thread"}\` (a workflow script with \`input = {event, input, trigger}\`; \`ctx.call\` tools, \`ctx.delegate\` a model only when needed). With \`onFailure: "thread"\`, a failed run starts a thread from \`prompt\` carrying the failure, so you are only involved when something goes wrong; \`prompt\` may then be omitted.

\`\`\`json
{"address":"~/triggers/deploy-hook","content":"{\"source\":{\"type\":\"webhook\"},\"continuation\":{\"kind\":\"tool\",\"tool\":\"record-deploy\",\"input\":{\"payload\":\"$event.payload\"},\"onFailure\":\"thread\"},\"prompt\":\"The deploy recorder failed; investigate and fix the record.\"}"}
\`\`\`

Replace the trigger document to edit it, write with \`enabled: false\` to disable it, or use \`options: {delete: true}\` to remove it. An edit keeps the kind of source that starts the trigger; switching kinds needs \`options: {replaceSource: true}\`, and interval schedules under 5 minutes need \`options: {frequentSchedule: true}\`, only when the user asked for exactly that. Trigger writes do not use a signer.`,
  },
  ipfs: {
    summary: 'Publish a file to IPFS, or a JSON object: a schema, an object that follows one, or a signed blob.',
    markdown: `# Publishing to IPFS

Write to \`ipfs://\` with exactly one source:

- Memory file: \`options: {fromPath: "~/memory/path/to/file"}\`.
- Current-session attachment: \`options: {fromAttachment: "ATTACHMENT_ID"}\`.
- A JSON object in \`content\` — see "Objects" below.

\`\`\`json
{"address":"ipfs://","options":{"fromPath":"~/memory/site-assets/icon.png"}}
\`\`\`

The result includes the CID and \`ipfs://\` URL. Publishing is public and requires the agent's publish grant. File publishing has no \`dryRun\` and no signer.

The gateway serves a file only once public Hypermedia content references it (a document image, a comment, a profile icon); an \`ipfs://\` URL on its own does not display anywhere yet. To show your user a file from memory in this chat, do not publish it — reference its memory path in markdown instead: \`![caption](~/memory/path/to/image.png)\`.

## Objects

A JSON object in \`content\` publishes as one content-addressed DAG-CBOR blob (dag-json: \`{"/": "<cid>"}\` is a link, \`{"/": {"bytes": "…"}}\` is bytes). Read it back with \`read ipfs://<cid>\`, which returns the decoded \`value\`, its \`signature\` and its \`schema\` check.

- \`options.schema\` — the schema the object must follow: a library name (\`schema\` is the meta-schema every schema must satisfy; \`document\`, \`blob\`, \`example/person\`, …), an \`ipfs://<cid>\` of a schema blob, or the \`hm://\` URL of a type document (a document whose metadata \`schemaDefinition\` points at its schema blob). The object is validated and, when it conforms, published with a \`schema\` link to the schema's CID (\`options.link: false\` omits the link). A violation refuses the publish and lists what is wrong; \`options.force: true\` publishes anyway and returns the violations as \`warnings\`.
- \`options.sign: true\` — a signed blob: the object's own fields are wrapped in the Hypermedia signed-blob envelope (\`type\`, \`signer\`, \`ts\`, \`sig\`) and signed by one of the agent's identities (\`options.signer\` chooses one as for hm:// writes). \`type\` comes from the schema when it pins one (a signed type extends \`blob\` and fixes \`type\` to a literal), else from \`options.type\`. Leave \`signer\`, \`ts\` and \`sig\` out of the content. The result carries the CID, \`signer\`, \`ts\` and \`blobType\`.
- \`dryRun: true\` validates and returns the CID and the exact value that would publish, without publishing.

Define a type: publish its schema as an object that follows \`schema\`, then bind it to a page with a document write whose \`options.metadata.schemaDefinition\` is the schema's \`ipfs://<cid>\`. The page's \`hm://\` URL is the type's name from then on.

\`\`\`json
{"address":"ipfs://","content":"{\\"type\\":\\"hm://hyper.media/struct\\",\\"properties\\":{\\"name\\":{\\"value\\":{\\"type\\":\\"hm://hyper.media/string\\"},\\"required\\":true}}}","options":{"schema":"schema"}}
\`\`\`

Publish an instance of a type, validated against it:

\`\`\`json
{"address":"ipfs://","content":"{\\"name\\":\\"Bob Smith\\"}","options":{"schema":"hm://ACCOUNT_UID/types/person"}}
\`\`\`

Sign an instance of a signed type (a schema that extends \`blob\`):

\`\`\`json
{"address":"ipfs://","content":"{\\"target\\":\\"hm://ACCOUNT_UID/notes\\",\\"choice\\":\\"yes\\"}","options":{"schema":"hm://ACCOUNT_UID/types/vote","sign":true}}
\`\`\`

Library schemas are named \`hm://hyper.media/<name>\` inside a schema (\`hm://hyper.media/string\`, \`hm://hyper.media/struct\`), and by the bare name in \`options.schema\`. The library is built into this server, so those names resolve without a network read.`,
  },
  documents: {
    summary: 'Create, update, move, redirect, fork, delete, and publish Seed documents.',
    markdown: `${preamble}

# Writing documents

Use this guide for document bodies, names, metadata, paths, and document lifecycle operations.

## Create

Omit \`options.action\` (or use \`document\`). Write markdown in \`content\`; pass the required document name in \`options.name\`. Additional attributes such as summary, icon, or cover belong in \`options.metadata\`. Parent documents must exist before nested paths.

\`\`\`json
{"address":"hm://SIGNER_UID/notes","content":"First paragraph.","options":{"name":"Notes","metadata":{"summary":"Working notes"},"signer":{"publicKey":"SIGNER_UID"}},"dryRun":true}
\`\`\`

## Update

Use \`options.action: "update"\` at the existing document address. Supplying \`content\` replaces the whole body, so first read the current document and preserve block/table identity comments for retained content. Omit \`content\` to change only \`name\` or \`metadata\`.

\`\`\`json
{"address":"hm://TARGET_UID/notes","content":"Complete replacement body.","options":{"action":"update","name":"Renamed Notes","signer":{"publicKey":"SIGNER_UID"}},"dryRun":true}
\`\`\`

## Other lifecycle actions

- Move: \`options: {action: "move", toPath: "/new-path"}\`. Use \`"/"\` for account home.
- Redirect: \`options: {action: "redirect", toUrl: "hm://OTHER_UID/path"}\`.
- Fork: the address is the destination; use \`options: {action: "fork", fromUrl: "hm://SOURCE_UID/path"}\`.
- Delete: the address is the document; use \`options: {action: "delete"}\`.
- Publish a memory markdown file: use \`options: {fromPath: "~/memory/file.md", signer: {...}}\`; frontmatter supplies metadata and the destination path may be derived when writing to account home.

## Custom HTML pages

Read \`~/tools/write/pages\` before building a custom HTML page. Durable page data uses schema-bound Seed resources; create the data model and resources before the HTML.

## Typed documents

Any metadata key is allowed: \`options.metadata\` is merged into the document's metadata as given (\`{surname: "Smith"}\` becomes a \`surname\` attribute). Three keys bind documents to Hypermedia schemas:

- \`attributesSchema\` — the type this document conforms to: the \`hm://\` URL of a schema document (or an \`ipfs://\` schema CID) whose struct describes the document's attributes.
- \`childAttributesSchema\` — the type every direct child of this document conforms to, unless a child sets its own \`attributesSchema\`.
- \`schemaDefinition\` — this document defines a type: the \`ipfs://<cid>\` of a schema blob (publish it first with \`write ipfs://\` and \`options.schema: "schema"\`; see \`~/tools/write/ipfs\`).

Conformance is advisory: a document that violates its type still publishes, and the result says so beside the id — \`schema\` ({schema, via, required, missing, violations}) and \`warnings\`, one line per violation (a \`schemaDefinition\` that is not a valid schema warns too). A \`dryRun\` reports the same, so check before publishing. A \`read\` of a typed document returns the same \`schema\` block.

\`\`\`json
{"address":"hm://ACCOUNT_UID/people/bob","content":"Bob is a person.","options":{"name":"Bob","metadata":{"surname":"Smith","born":"1990-01-01","attributesSchema":"hm://ACCOUNT_UID/types/person"}},"dryRun":true}
\`\`\`

Document create/update (including memory files and draft publication) checks Image, Video and File blocks plus icon/cover metadata. HTTP(S) media checks GET the exact embedded URL (never substitute another gateway), require a successful nonempty response, and require image/video MIME types and recognized signatures. Requests use public destinations only, standard ports, no credentials, bounded redirects, at most 64 distinct URLs, four requests at once, a 20-second batch deadline and a 1024-byte sample. These checks do not prove full decoding, full-file hashes, future availability or browser playback. Embed blocks, ordinary text hyperlinks and assets inside custom HTML pages are outside this check.

Native ipfs:// assets may not be served until a public document references them, so preflight marks them pending-publication rather than falsely rejecting an upload. After publication, media-bearing documents are read back at the committed version; their literal asset URLs are compared and checked again (native IPFS uses the configured HM gateway). The response's assetVerification distinguishes preflight, verified and unverified. A post-publication failure returns hypermedia_write_error with published: true, the committed id/version/cids and repair guidance: the document already exists; do not blindly retry creation. Dry runs check preflight only, including draft publication, and never claim read-back verification. skipLinkCheck does not bypass media checks.

Every hm:// link in document content is resolved before publishing. Use \`options.skipLinkCheck: true\` only when a linked resource is about to be created. Read the resulting document before citing block-level links because publishing can change block IDs.`,
  },
  pages: {
    summary: 'Build schema-first pages backed by Seed resources, then publish and test their UI.',
    markdown: `# Building pages with Seed data

**Default: model first, resources second, UI third.** A request such as “build me a task tracker” means a working page backed by Seed data, not a browser-local demo. Use existing types and collections where suitable. Stateless calculators need no invented schema; local-only primary data requires an explicit user request.

1. Infer the entities, fields, interactions, data owner/space and visibility from the user's specifications and current context. Distinguish a shared collection from per-user collections. Follow **Resolve access before building the UI** below; do not ship a collection only the authoring agent can edit.
2. Read ~/tools/write/ipfs. Publish each needed HM schema with write ipfs:// and options.schema: "schema"; bind the returned CID to a type document via metadata.schemaDefinition. These are Hypermedia schemas (type/properties/value/required), not JSON Schema. Reuse existing schemas without overwriting them.
3. Read ~/tools/write/documents. Create required parent documents, then a data collection with childAttributesSchema pointing to the type document. Store each independently editable record as a document with attributesSchema, structured metadata fields and optional body content. Do not pack the whole database into a JSON string, one localStorage entry or a comment thread. Schema conformance is advisory in today's document API: fix dry-run/read-back schema warnings before calling it valid.
4. Keep real collection/type HM URLs in one place: constants in the bundle, or page metadata only when the code actually reads that configuration. Do not add redundant dataRoot/type/collection attributes. Build the HTML against these resources through seed.directory, seed.resource and seed.publishDocument. When publishing, pass options.pageData: ["hm://DATA_OWNER/collection", ...] for every writable collection. The publisher checks child-record write access for the agent owner, not the agent signing key, and stops publication when access is missing. Its structured missingAccess result includes whether an enabled identity can grant access and exact dry-run grant inputs; use these to offer the repair, then recheck access after authorized publication of the grant. This is an access preflight, not an interaction test; shared apps must verify access for their other intended users too. Keep the URLs stable across page revisions and preserve existing records. Respect collection visibility and runtime protocol capabilities; do not silently publish private records publicly. UI permission approval is separate from having protocol write authority.
5. Exercise create → read → edit → read-back against the actual target, then reopen with local page state empty. Verify the same record through an ordinary Seed document/attributes view. Test deletion/archive and denied/error states where offered. A second host reading the same resource is sync evidence; browser refresh alone is not. Report which checks ran. Never report local state as Seed persistence, and never fall back to local-only saves when permission is denied or Seed is unavailable.

## Resolve access before building the UI

1. Identify the intended viewer from the authenticated message_sender and conversation intent. Use the current page/space and existing collections to infer the intended data location. ~/self.ownerAccountId is the agent owner, not necessarily the current requester; available_signing_identities lists the identities you can sign as. Profile names are labels, not permission evidence. Ask only when the relevant identity or intent is genuinely ambiguous.
2. Read the existing capabilities for that viewer at the actual record paths. Existing ownership or a valid scoped WRITER/AGENT capability may already cover the operation: reuse it and proceed. Do not infer missing access from a loading/schema error, or infer granted access from page approval or the agent's own successful write.
3. If access is missing, check whether an enabled signing identity owns the collection space. The publisher's pageDataAccess.viewer says whose access was checked: compare it to the intended viewer, and check other intended users separately. For each missingAccess entry, canGrant and grant describe the available owner authority and a dry-run repair; they do not indicate user approval. Never apply a proposal to the wrong recipient just because it appeared in a tool result.
4. When you can grant access, read ~/tools/write/capabilities and prepare WRITER grants for only the required collections and descendants, keeping the existing app/data location. Present all required scopes together as one specific offer. Use the person's known display name and meaningful collection names in conversation; retain exact IDs and paths in the tool inputs. Honor prior authorization for those recipients/scopes; otherwise ask once for that concrete change. After approval, apply it and continue without asking the same question again. If you cannot grant access, explain which owner must grant which scope. Never substitute local storage, move data by default, or ask for account-wide/AGENT/Any signing access as a shortcut.
5. Re-read capabilities after applying an authorized grant. Then test the original action as the intended viewer, verify the saved document and reopen the page. Permission setup is a step toward finishing the app, not evidence that the app already works. If UI testing is unavailable, say what was verified and what remains untested; do not tell the user the workflow is fixed.

For example, when a known user cannot add a pet to an agent-owned collection, a useful offer is: “Your account is missing write access to this app's data. I can give you writer access to the Pets and Care Tasks collections, including their records. Apply those two grants?” Fill in the real recipient and collection names from context. If those exact grants are already authorized, apply them and test Add pet instead of repeating the offer. Do not ask “Who are you?” or “Which space should I move the app to?” when the context already establishes those facts.

Local storage (including seed.storage) is optional for filters, theme, dismissed tips and temporary unsaved drafts. Durable tasks, notes, inventory and progress belong in Seed resources. Migrating an older local-only page requires an explicit import: preserve the original data until published records are read back successfully; do not discard or silently upload existing local private data.


## Schema-defined URL input

Before publishing the HTML, define the page's input contract as an HM struct and publish it with write ipfs:// and options.schema: "schema". Bind it to a type resource through schemaDefinition, then set the page metadata.inputSchema to that resource's hm:// URL (or the schema's ipfs:// CID). The publisher sets metadata.type to "hm://hyper.media/page" and metadata.html to the bundle. No inputs uses the published empty contract "hm://hyper.media/page-input".

For example, an optional prompt field: {"type":"hm://hyper.media/struct","properties":{"prompt":{"value":{"type":"hm://hyper.media/string"}}}}. Other tools read inputSchema to discover valid inputs. URL fields are named p.<field>, and each value is JSON encoded then URL encoded: ?p.prompt=%22Hello%22&p.count=3. These fields cannot overwrite Seed's v, l or panel parameters. Never put secrets or durable records in URL state.

Use seed.input.get() to get {values, schema, errors}. Incoming malformed or schema-invalid URLs return errors; show a useful correction UI. seed.input.push(values) and seed.input.replace(values) take the complete input object (omitted fields are removed), validate before navigation, and return the new state. Push adds history, replace edits the current entry. seed.input.onChange(state => render(state.values, state.errors)) returns an unsubscribe function and receives push/replace and Back/Forward changes without reloading the page. Subscribe before the initial get. Prefer replace for typing/filter changes and push for meaningful navigation. Test copied links, reload, Back/Forward, invalid inputs and both hosts before claiming the URL workflow works.

## Example: task schema and collection

Adapt the fields/statuses to the requested tracker. Publish this schema with options.schema: "schema", then a type document at hm://DATA_OWNER/types/task with schemaDefinition: "ipfs://<returned CID>". Create parents first. Create hm://DATA_OWNER/tasks with childAttributesSchema: "hm://DATA_OWNER/types/task"; choose its privacy deliberately. Configure the bundle with those real URLs; page metadata is optional and should only be added if the code reads it. DATA_OWNER is the intended data space, not a guessed viewer or agent account.

\`\`\`json
{"type":"hm://hyper.media/struct","properties":{"name":{"value":{"type":"hm://hyper.media/string"},"required":true},"status":{"value":{"anyOf":["todo","doing","done","archived"]},"required":true},"attributesSchema":{"value":{"type":"hm://hyper.media/url"},"required":true}}}
\`\`\`

The following data adapter uses the bridge's real protobuf change shapes. Pass the configured collection/type URLs. The host resolves an existing writer capability for the selected viewer; it never creates a grant. No page approval can substitute for protocol write authority. Create parents and verify access during setup; never embed a secret or an agent signing key. If configuration lives in metadata, read the page document identified by seed.context().document. Use the initial resource only for configuration; mutable task reads use unversioned HM URLs.

\`\`\`js
async function createTaskData(seed, {dataRoot, taskType}) {
  const root = await seed.resource(dataRoot)
  if (root.type !== 'document') throw new Error('Task collection is unavailable')
  const collection = root.id
  const path = root.document.path
  const visibility = root.document.visibility === 'PRIVATE' ? 2 : 1
  const statuses = ['todo', 'doing', 'done', 'archived']
  return {
    async list() {
      const rows = await seed.directory(dataRoot)
      return rows.filter(row => row.metadata.attributesSchema === taskType)
    },
    async create(name) {
      name = name.trim()
      if (!name) throw new Error('A task needs a name')
      const taskPath = path + '/task-' + crypto.randomUUID()
      const result = await seed.publishDocument({
        account: collection.uid, path: taskPath, visibility,
        changes: Object.entries({name, status: 'todo', attributesSchema: taskType}).map(([key, value]) => ({
          op: {case: 'setMetadata', value: {key, value}},
        })),
      })
      return seed.resource(result.document)
    },
    async setStatus(taskUrl, status) {
      if (!statuses.includes(status)) throw new Error('Invalid task status')
      const current = await seed.resource(taskUrl)
      if (current.type !== 'document' || current.id.uid !== collection.uid ||
          current.document.path.slice(0, current.document.path.lastIndexOf('/')) !== path ||
          current.document.metadata.attributesSchema !== taskType) throw new Error('Not a task in this collection')
      const doc = current.document
      await seed.publishDocument({
        account: current.id.uid, path: doc.path,
        baseVersion: doc.version, genesis: doc.genesis, generation: doc.generationInfo?.generation,
        visibility: doc.visibility === 'PRIVATE' ? 2 : 1,
        changes: [{op: {case: 'setMetadata', value: {key: 'status', value: status}}}],
      })
      return seed.resource(taskUrl)
    },
  }
}
\`\`\`

Use setStatus(taskUrl, "archived") for recoverable removal in this example. Do not recreate a document to edit it: preserve its genesis/generation and use its current baseVersion. Show read-only/sign-in/access-denied states rather than suggesting Any signing as a fix for missing writer authority. Disable duplicate submits, preserve input on rejection, and display a saved state only after successful publication/read-back. If read-back or indexing is pending, say so; do not create a second record blindly. For a real task tracker, also link each record to its Seed document with an hm:// anchor so its data remains usable outside the page.

## Pages

A document can be a page: a self-contained web page that Seed opens in place of the document body, sandboxed, and that syncs to anyone the document is shared with. After setting up its data model and Seed resources, write the HTML under \`~/memory/pages/<name>/index.html\` (prefer one self-contained HTML file for web and desktop compatibility), then write a document with \`options.page\` naming that folder or file. The folder is published with the document and its \`html\` attribute points at it. The document's \`hm://\` URL opens the full page view and is the link to give people. Page embeds inside chat are temporarily disabled; do not emit widget fences. Never offer a \`~/memory\` path as a link: it is private to you. Write to the same address again with \`options.page\` (and \`options.action: "update"\`) to publish a new revision.

\`\`\`json
{"address":"hm://SIGNER_UID/pages/counter","content":"A counter you can share.","options":{"name":"Counter","page":"~/memory/pages/counter","signer":{"publicKey":"SIGNER_UID"}}}
\`\`\`

For pages that work on both web and desktop, use a single self-contained HTML page with inline styles and classic scripts; no external imports, CDNs or runtime network calls. Include \`<script src="/.seed/client.js"></script>\` before your page script for desktop; the web sandbox installs the same \`window.seed\` API before executing your code and ignores that bridge include.

Publication validates classic JavaScript syntax and rejects external assets for the default \`options.pageTarget: "web-desktop"\`. Only use \`pageTarget: "desktop"\` when the user explicitly wants a desktop-only bundle. A dry run returns the same \`pageValidation\` receipt, pinned to the bundle CID. This is static validation, not a startup or interaction test. Report evidence separately: generated, syntax-checked, published/read-back, opened, interaction-tested. Never say "verified" when you only read the published document. After a tool/session error, read the destination before retrying: publication may already have succeeded.

Use \`seed.runtime()\` to discover the actual host's SDK version, implementation digest, method inventory and storage limits. This guide expects SDK 2.0.0. Feature-detect newer methods; if absent, show "Update Seed to use this feature" instead of guessing alternatives. The authoring server and the desktop/web host may run different builds.

For content links use ordinary \`<a href="hm://ACCOUNT/path?v=VERSION#BLOCK">Read the document</a>\` or \`await seed.open(hmUrl)\` in a click handler. Seed opens the content outside the page sandbox and preserves version/block references. Use \`{newWindow: true}\` when desired; anchors support Ctrl/Cmd/middle click and target="_blank". Explicit HTTP(S) URLs retain their original server, which matters for local and private networks. Do not replace window.location, invent gateway URLs, use parent DOM, or open the content inside the sandbox. Opening a link requires no account-write grant. Handle rejected opens visibly and preserve input. Use meaningful link labels.

## Diagnosing Add/Save failures

Read this local guide again before repairing a page; do not infer the browser SDK's shape from an agent read result or older published docs. The agent read tool returns an envelope containing resource; seed.resource returns the resource directly. For a document it is {type: "document", id: {id: "hm://…", uid, path}, document: {account, path, metadata, version, genesis, generationInfo, visibility}}. Directory returns an array of rows with id and metadata, not {results} and not document wrappers. publishDocument resolves to {document: "hm://…"} only after reading back the published version; blob storage alone is not proof of a successful save.

Initialize data before enabling Add/Save, show a persistent initialization error with Retry, and preserve form input on failed saves. Never render a failed collection load as an empty successful collection. Inspect seed.runtime() and the actual failing operation/error in the target host; do not guess alternate wrappers or property names. A verified missing writer capability should trigger the scoped permission repair described in **Resolve access before building the UI** and ~/tools/write/capabilities, not a dead-end error or broader page trust. Preserve the existing app/data location unless the user wants it changed. If publication was submitted but read-back was not confirmed, inspect the named address before retrying to avoid duplicates. Test the original failing button, reload, and edit before saying it is fixed. If no connected UI test surface is available, explicitly report that interaction remains unverified.

SDK calls return promises except \`seed.stringify(value)\`, a display-only JSON serializer for BigInt and binary values (never use it for signing). The exact supported shapes are:

- \`await seed.context()\` → \`{protocol: 1, document: "hm://ACCOUNT/path", version, account: "VIEWER_UID" | null, page: "BUNDLE_CID"}\`. The viewer ID is \`account\`, not \`viewer\`; the document author is not necessarily the viewer.
- \`await seed.profile()\` → \`{id: "VIEWER_UID", name: "Display name" | null}\`, or \`null\` when signed out. For a greeting, use \`const profile = await seed.profile(); heading.textContent = profile?.name ? "Hello, " + profile.name + "!" : "Hello, friend!"\`. Do not invent a profile schema or treat every SDK error as being signed out; show an error separately.
- **Optional local UI state only:** \`await seed.storage.get("key")\` → saved JSON value, or \`null\`. \`await seed.storage.set("key", value)\` saves JSON. State belongs to the viewer and canonical document HMID, persists across code revisions, and is separate for other documents/viewers. **It is saved on this device only: not synced, backed up, encrypted, or shared by this API.** Say "Saved on this device" in the page. Only real HM content writes create synced/shared data. Preserve existing storage keys and migrate deliberately on update. Native \`localStorage\` is unavailable on web and starts fresh on each desktop launch; use the broker only for local UI preferences or temporary unsaved drafts. Primary page data belongs in schema-bound Seed resources. Saved-data reads require approval. Limits: 64 keys, 128 characters/key, 16 KiB/value.
- \`await seed.resource((await seed.context()).document)\` reads the displayed page document without an additional read prompt; the context call still asks before disclosing the viewer identity. \`seed.resource("hm://VIEWER_UID/:profile")\` is a compatibility alias for the selected viewer's profile; prefer \`seed.profile()\`.
- \`await seed.hm.parseMarkdown(markdown)\` returns valid HM block nodes with IDs and annotations. \`seed.hm.validateContent(blockNodes)\` validates structured content; \`seed.hm.unpackHmId(url)\` parses an HM URL. These helpers do not sign or publish.

Reads of documents, the space profile, and queries confined to the page document's own space work by default, using the viewer's existing protocol access. This does not grant access to the viewer's other spaces. Cross-space redirects and unbounded queries still need approval. Seed asks separately before disclosing the viewer identity (including \`context\`, \`profile\`, or public-key reads), reading other spaces or saved state, signing, and publishing unapproved blobs. Call the operation from a user action; \`seed.permissions.request()\` only reports \`{grants}\`, it does not grant authority. Approval defaults to **Allow once**. The viewer can remember reading a resource/site, signing comments on one site, or all comments. Unknown signatures require a separate explicit approval; advanced **Any signing** does not grant reading. Seed classifies the actual signed bytes, not a helper name. Exact recognized blobs signed with approval can be published without a second prompt; added/changed blobs require publication approval.

Remembered rules belong to the selected viewer and canonical page document ID on this device, **including future page updates**. \`seed.permissions.revoke()\` or **Page permissions** in the breadcrumb menu removes them. Closing, changing account or updating code cancels in-flight calls; it does not erase remembered rules. Pages on joined sites, the viewer's own site or the current web site's identity may run automatically; other sites show **Run page**, without requiring a join. Running allows reads within the page's own space, but grants no signing authority. Handle denial visibly without retry loops. Do not claim that the sandbox prevents exfiltration after data is shared.

The same APIs work on web and desktop, subject to those independent approvals:

- \`seed.resource(hmUrl)\` and \`seed.directory(hmUrl, {all})\` read other documents/directories with the host's access.
- \`seed.request(key, input)\` exposes every request in the HM TypeScript SDK's \`HMRequest\` union, including Resource, Account, Query, PrepareDocumentChange and PublishBlobs. Use the existing SDK's exact input shapes; no invented daemon methods.
- \`seed.publish({blobs: [{cid, data}]})\` publishes arbitrary blobs; \`data\` is a Uint8Array, not base64. \`seed.publishDocument({account, path, changes, baseVersion?, genesis?, generation?, capability?, visibility?})\` prepares, signs and publishes document changes using the selected viewer. The account field is the TARGET space; the signer cannot be selected by the page. Changes use SDK protobuf operation shapes, not markdown.
- \`seed.signer.getPublicKey()\` and \`seed.signer.sign(new Uint8Array(bytes))\` implement the SDK's HMSigner interface. They return public key/signature bytes; private keys never leave Seed. Web sign-in may use a delegated device key, so its signing principal can differ from the selected account UID; existing protocol delegation still applies. A prebundled SDK can use this signer; do not fetch dependencies at runtime.
- \`seed.hm.createComment(input)\`, \`updateComment\`, \`deleteComment\`, \`createDocumentBlobs\`, \`createVersionRef\`, \`createRedirectRef\`, \`createTombstoneRef\`, \`createCapability\`, \`createContact\`, \`updateContact\`, \`deleteContact\`, and \`signDocumentChange\` use the corresponding SDK input and return types, with the host supplying the signer. Helpers sign but do not publish. The signed-change result uses a string for \`changeCid\` so it survives the bridge. \`seed.hm.signBlob(body)\` signs a custom dag-json blob body, returning \`{cid, data, ts, signer}\`; publish its cid/data through \`seed.publish\`.
- A new document can be created with \`const {account} = await seed.context(); const {blobs} = await seed.hm.createDocumentBlobs({space: account, path: "/pages/data", ops: [{type: "SetAttributes", attrs: [{key: ["name"], value: "Page data"}]}]}); await seed.publish({blobs});\`. Use document changes with a base version for edits; do not recreate an existing document.
- \`seed.comments.create({content: blockNodes, target?, version?})\` signs AND publishes a comment, returning \`{commentId, version}\`. It defaults to this page's document and displayed version. Another target needs its version in the URL or version field; visibility follows the target document. Example: \`const content = await seed.hm.parseMarkdown(messageInput.value); const posted = await seed.comments.create({content});\`.

Use click handlers for actions rather than form submission. Disable Submit while pending, preserve input on errors/denial, and only clear it on success. Calls awaiting trust stay pending until the viewer decides; at most 32 requests may be pending, with 8 MiB per request including binary bytes. Do not try to export keys, read another page's local state, or access parent DOM/cookies. Advanced Any signing includes lasting permission grants and arbitrary signatures. Do not push users toward broad trust to make a page work. Revocation stops further operations and late results; it cannot recall completed signatures, published writes or capabilities already granted. The sandbox does not guarantee data cannot leave through navigation. Verify the rendered page and SDK calls before claiming they work.

`,
  },
  comments: {
    summary: 'Create comments and replies, then update or delete existing comment records.',
    markdown: `${preamble}

# Writing comments

## Create or reply

Use the target document as \`address\`, markdown as \`content\`, and \`options.action: "comment"\`. The address is the target by default; \`options.target\` can override it. Set \`options.replyTo\` to an existing comment ID or URL for a reply.

A comment ID is \`<authorUid>/<tsid>\` — the same value found in \`replyParent\`, \`threadRoot\`, and activity \`comment.id\` fields. Before replying inside an existing thread, read the thread: \`read hm://<authorUid>/<tsid>\` returns a comment with the whole thread around it, and \`read hm://TARGET/:comments\` returns a document's entire discussion with every comment's ID. Reply to the specific comment you are answering (its ID as \`replyTo\`), not to the thread root, unless you are answering the root itself.

\`\`\`json
{"address":"hm://OWNER_UID/notes","content":"A useful comment.","options":{"action":"comment","signer":{"publicKey":"SIGNER_UID"}},"dryRun":true}
\`\`\`

## Mentions

To notify a person or activate an agent, mention their account inline: \`[@](hm://ACCOUNT_UID/:profile)\`. The link label is \`@\` and nothing else; any text after the \`@\` is ignored (\`[@Artist](…)\`, the form a read result prints, works the same), and readers render the account's current name. The autolink \`<hm://ACCOUNT_UID/:profile>\` is equivalent. The account UID is the \`author\` of any comment you read, and every entry in a thread read result prints its author's ready-made mention. A link to one of the person's comments, a link whose label does not start with \`@\`, or plain \`@Name\` text is not a mention: it notifies nobody and activates no agent. A comment body that still contains plain-text \`@Name\` is refused so that cannot happen by accident; pass \`options.allowPlainMentions: true\` only when the \`@\` is literal text (an email handle, a CSS at-rule, a social handle). \`[@](hm://UID/some-document)\` mentions a document inline the same way. The write result lists the mentioned accounts under \`mentions\`.

\`\`\`json
{"address":"hm://OWNER_UID/notes","content":"[@](hm://ARTIST_UID/:profile) could you make a 3:1 banner?","options":{"action":"comment","signer":{"publicKey":"SIGNER_UID"},"replyTo":"AUTHOR_UID/TSID"},"dryRun":true}
\`\`\`

## Edit

Use the signer account as \`address\`; the dotted action's fields go in \`options.input\`.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"comment.update","signer":{"publicKey":"SIGNER_UID"},"input":{"commentId":"COMMENT_ID","content":"Replacement comment body."}},"dryRun":true}
\`\`\`

## Delete

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"comment.delete","signer":{"publicKey":"SIGNER_UID"},"input":{"commentId":"COMMENT_ID"}},"dryRun":true}
\`\`\`

Comment content uses the same markdown and hm-link validation as documents. The signer must be authorized for the requested comment operation.`,
  },
  capabilities: {
    summary: 'Grant WRITER or AGENT authority to another account, optionally scoped to a document path.',
    markdown: `${preamble}

# Granting capabilities

Capabilities delegate authority from the signing account to another account. This write interface grants capabilities; it does not currently expose capability revocation.

Use \`capability.grant\` (\`capability.create\` is an alias). Required fields are \`delegate\` and \`role\`; optional fields are \`path\` and \`label\`.

- \`WRITER\` allows document writing in scope.
- \`AGENT\` delegates agent authority in scope.
- \`path\` scopes the grant; \`"/"\` covers the account root and descendants.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"capability.grant","signer":{"publicKey":"SIGNER_UID"},"input":{"delegate":"DELEGATE_UID","role":"WRITER","path":"/apps/my-app/data","label":"App data editor"}},"dryRun":true}
\`\`\`

Resolve the recipient from the authenticated message sender and conversation intent; the agent owner may be a different person. Do not ask for an ID already known. Check existing grants first. An enabled signing identity must own the target space; a WRITER capability alone does not let it grant permissions. For a data app, prefer WRITER on each relevant collection and descendants, preserving its existing data location. Offer the concrete recipient/role/paths together, honor prior authorization, otherwise get authorization for that scope before removing \`dryRun\`. Do not ask again once those exact grants are authorized. Then re-read the capabilities and resume the original task, testing the failed action as that user. The signer is the authority granting access; the delegate is the recipient.`,
  },
  contacts: {
    summary: 'Create a named contact for an account or delete an existing contact record.',
    markdown: `${preamble}

# Writing contacts

Contacts are signed records owned by the signer.

## Create

Use \`contact.create\` with the contacted account UID in \`subject\` and the local display name in \`name\`.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"contact.create","signer":{"publicKey":"SIGNER_UID"},"input":{"subject":"CONTACT_UID","name":"Eric"}},"dryRun":true}
\`\`\`

The result contains \`contactId\`; retain or obtain that record ID when deletion may be needed.

## Delete

Deletion requires the contact record ID, not merely the subject account UID.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"contact.delete","signer":{"publicKey":"SIGNER_UID"},"input":{"contactId":"CONTACT_RECORD_ID"}},"dryRun":true}
\`\`\``,
  },
  profiles: {
    summary: 'Update a signing account profile or publish a profile alias.',
    markdown: `${preamble}

# Writing profiles

## Update

Use \`profile.update\`. Supported input fields are \`name\`, \`description\`, and \`icon\` (\`avatar\` is accepted as an alias for icon). An omitted name uses the managed signing identity's current local label.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"profile.update","signer":{"publicKey":"SIGNER_UID"},"input":{"name":"Ion","description":"An autonomous Seed agent.","icon":"ipfs://CID"}},"dryRun":true}
\`\`\`

For managed agent signing keys, a successful name update also updates the key label shown by the agent runtime.

## Alias

Use \`profile.alias\` with another principal in \`input.alias\`.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"profile.alias","signer":{"publicKey":"SIGNER_UID"},"input":{"alias":"ALIAS_UID"}},"dryRun":true}
\`\`\``,
  },
  drafts: {
    summary: 'Stage, inspect, list, revise, delete, and publish private document drafts.',
    markdown: `${preamble}

# Writing drafts

Drafts are private agent-local staging records until published. Use the signer account as the hm address and put all draft fields in \`options.input\`.

## Create

\`draft.create\` requires a name (directly, in metadata, or in markdown frontmatter). Input can include \`content\`, \`metadata\`, \`path\`, \`edit\` (an existing document URL), \`location\`, and \`visibility\`.

\`\`\`json
{"address":"hm://SIGNER_UID","options":{"action":"draft.create","input":{"name":"Release notes","content":"Draft body","path":"/release-notes"}}}
\`\`\`

## Inspect and manage

- Get: \`{action: "draft.get", input: {draftId: "ID"}}\`.
- List: \`{action: "draft.list", input: {limit: 50}}\` (maximum 100).
- Update: \`{action: "draft.update", input: {draftId: "ID", content: "Replacement body", name: "Optional name"}}\`. Omit content to retain the body.
- Delete: \`{action: "draft.delete", input: {draftId: "ID"}}\`.

## Publish

Use \`draft.publish\` with \`draftId\`. A draft with an \`edit\` target updates that document; otherwise it creates a document using the staged path and metadata. \`expectedVersion\` may be supplied for update conflict protection.

\`\`\`json
{"address":"hm://TARGET_UID","options":{"action":"draft.publish","signer":{"publicKey":"SIGNER_UID"},"input":{"draftId":"ID","expectedVersion":"VERSION"}},"dryRun":true}
\`\`\`

Although draft get/list operations are read-like, they live here because they are commands in the write resource workflow.`,
  },
} satisfies Record<string, WriteGuide>
