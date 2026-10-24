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

## Apps

A document can be an app: a self-contained web page that Seed opens in place of the document body, sandboxed, and that syncs to anyone the document is shared with. When someone asks for an app, a game, a tool or a widget, write the HTML under \`~/memory/apps/<name>/index.html\` (prefer one self-contained HTML file for web and desktop compatibility), then write a document with \`options.app\` naming that folder or file. The folder is published with the document and its \`app\` attribute points at it. The document's \`hm://\` URL opens the full app view and is the link to give people. App embeds inside chat are temporarily disabled; do not emit widget fences. Never offer a \`~/memory\` path as a link: it is private to you. Write to the same address again with \`options.app\` (and \`options.action: "update"\`) to publish a new revision.

\`\`\`json
{"address":"hm://SIGNER_UID/apps/counter","content":"A counter you can share.","options":{"name":"Counter","app":"~/memory/apps/counter","signer":{"publicKey":"SIGNER_UID"}}}
\`\`\`

For apps that work on both web and desktop, use a single self-contained HTML page with inline styles and classic scripts; no external imports, CDNs or runtime network calls. Include \`<script src="/.seed/client.js"></script>\` before your app script for desktop; the web sandbox installs the same \`window.seed\` API before executing your code and ignores that bridge include.

Publication validates classic JavaScript syntax and rejects external assets for the default \`options.appTarget: "web-desktop"\`. Only use \`appTarget: "desktop"\` when the user explicitly wants a desktop-only bundle. A dry run returns the same \`appValidation\` receipt, pinned to the bundle CID. This is static validation, not a startup or interaction test. Report evidence separately: generated, syntax-checked, published/read-back, opened, interaction-tested. Never say "verified" when you only read the published document. After a tool/session error, read the destination before retrying: publication may already have succeeded.

Use \`seed.runtime()\` to discover the actual host's SDK version, implementation digest, method inventory and storage limits. This guide expects SDK 1.1.0. Feature-detect newer methods; if absent, show "Update Seed to use this feature" instead of guessing alternatives. The authoring server and the desktop/web host may run different builds.

For content links use ordinary \`<a href="hm://ACCOUNT/path?v=VERSION#BLOCK">Read the document</a>\` or \`await seed.open(hmUrl)\` in a click handler. Seed opens the content outside the app sandbox and preserves version/block references. Use \`{newWindow: true}\` when desired; anchors support Ctrl/Cmd/middle click and target="_blank". Explicit HTTP(S) URLs retain their original server, which matters for local and private networks. Do not replace window.location, invent gateway URLs, use parent DOM, or open the content inside the sandbox. Opening a link requires no account-write grant. Handle rejected opens visibly and preserve input. Use meaningful link labels.

SDK calls return promises except \`seed.stringify(value)\`, a display-only JSON serializer for BigInt and binary values (never use it for signing). The exact supported shapes are:

- \`await seed.context()\` → \`{protocol: 1, document: "hm://ACCOUNT/path", version, account: "VIEWER_UID" | null, app: "BUNDLE_CID"}\`. The viewer ID is \`account\`, not \`viewer\`; the document author is not necessarily the viewer.
- \`await seed.profile()\` → \`{id: "VIEWER_UID", name: "Display name" | null}\`, or \`null\` when signed out. For a greeting, use \`const profile = await seed.profile(); heading.textContent = profile?.name ? "Hello, " + profile.name + "!" : "Hello, friend!"\`. Do not invent a profile schema or treat every SDK error as being signed out; show an error separately.
- \`await seed.storage.get("key")\` → saved JSON value, or \`null\`. \`await seed.storage.set("key", value)\` saves JSON. State belongs to the viewer and canonical document HMID, persists across code revisions, and is separate for other documents/viewers. **It is saved on this device only: not synced, backed up, encrypted, or shared by this API.** Say "Saved on this device" in the app. Only real HM content writes create synced/shared data. Preserve existing storage keys and migrate deliberately on update. Native \`localStorage\` is unavailable in the web sandbox. Limits: 64 keys, 128 characters/key, 16 KiB/value.
- \`await seed.resource((await seed.context()).document)\` reads the app document without an account grant. \`seed.resource("hm://VIEWER_UID/:profile")\` is a compatibility alias for the selected viewer's profile; prefer \`seed.profile()\`.
- \`await seed.hm.parseMarkdown(markdown)\` returns valid HM block nodes with IDs and annotations. \`seed.hm.validateContent(blockNodes)\` validates structured content; \`seed.hm.unpackHmId(url)\` parses an HM URL. These helpers do not sign or publish.

For broader reads, writes and signatures, call \`await seed.permissions.request()\` from a user action. Seed asks the viewer to trust this app with FULL access to their selected account for this open app session. The first privileged operation also requests this grant automatically. After approval, operations do not need individual confirmations. \`seed.permissions.revoke()\` or Seed's Revoke access button ends access; changing account, document/revision or closing the app also ends it. Never claim this is a narrowly scoped comment permission.

Once granted, the same APIs work on web and desktop:

- \`seed.resource(hmUrl)\` and \`seed.directory(hmUrl, {all})\` read other documents/directories with the host's access.
- \`seed.request(key, input)\` exposes every request in the HM TypeScript SDK's \`HMRequest\` union, including Resource, Account, Query, PrepareDocumentChange and PublishBlobs. Use the existing SDK's exact input shapes; no invented daemon methods.
- \`seed.publish({blobs: [{cid, data}]})\` publishes arbitrary blobs; \`data\` is a Uint8Array, not base64. \`seed.publishDocument({account, path, changes, baseVersion?, genesis?, generation?, capability?, visibility?})\` prepares, signs and publishes document changes using the selected viewer. The account field is the TARGET space; the signer cannot be selected by the app. Changes use SDK protobuf operation shapes, not markdown.
- \`seed.signer.getPublicKey()\` and \`seed.signer.sign(new Uint8Array(bytes))\` implement the SDK's HMSigner interface. They return public key/signature bytes; private keys never leave Seed. Web sign-in may use a delegated device key, so its signing principal can differ from the selected account UID; existing protocol delegation still applies. A prebundled SDK can use this signer; do not fetch dependencies at runtime.
- \`seed.hm.createComment(input)\`, \`updateComment\`, \`deleteComment\`, \`createDocumentBlobs\`, \`createVersionRef\`, \`createRedirectRef\`, \`createTombstoneRef\`, \`createCapability\`, \`createContact\`, \`updateContact\`, \`deleteContact\`, and \`signDocumentChange\` use the corresponding SDK input and return types, with the host supplying the signer. Helpers sign but do not publish. The signed-change result uses a string for \`changeCid\` so it survives the bridge. \`seed.hm.signBlob(body)\` signs a custom dag-json blob body, returning \`{cid, data, ts, signer}\`; publish its cid/data through \`seed.publish\`.
- A new document can be created with \`const {account} = await seed.context(); const {blobs} = await seed.hm.createDocumentBlobs({space: account, path: "/apps/data", ops: [{type: "SetAttributes", attrs: [{key: ["name"], value: "App data"}]}]}); await seed.publish({blobs});\`. Use document changes with a base version for edits; do not recreate an existing document.
- \`seed.comments.create({content: blockNodes, target?, version?})\` signs AND publishes a comment, returning \`{commentId, version}\`. It defaults to this app's document and displayed version. Another target needs its version in the URL or version field; visibility follows the target document. Example: \`const content = await seed.hm.parseMarkdown(messageInput.value); const posted = await seed.comments.create({content});\`.

Use click handlers for actions rather than form submission. Disable Submit while pending, preserve input on errors/denial, and only clear it on success. Calls awaiting trust stay pending until the viewer decides; at most 32 requests may be pending, with 8 MiB per request including binary bytes. Do not try to export keys, read another app's local state, or access parent DOM/cookies. Full account access includes permission grants and arbitrary signatures, so trust the app before allowing it. Revocation stops further operations and late results; it cannot recall completed signatures, published writes or capabilities already granted. The sandbox does not guarantee data cannot leave through navigation. Verify the rendered app and SDK calls before claiming they work.

## Typed documents

Any metadata key is allowed: \`options.metadata\` is merged into the document's metadata as given (\`{surname: "Smith"}\` becomes a \`surname\` attribute). Three keys bind documents to Hypermedia schemas:

- \`attributesSchema\` — the type this document conforms to: the \`hm://\` URL of a schema document (or an \`ipfs://\` schema CID) whose struct describes the document's attributes.
- \`childAttributesSchema\` — the type every direct child of this document conforms to, unless a child sets its own \`attributesSchema\`.
- \`schemaDefinition\` — this document defines a type: the \`ipfs://<cid>\` of a schema blob (publish it first with \`write ipfs://\` and \`options.schema: "schema"\`; see \`~/tools/write/ipfs\`).

Conformance is advisory: a document that violates its type still publishes, and the result says so beside the id — \`schema\` ({schema, via, required, missing, violations}) and \`warnings\`, one line per violation (a \`schemaDefinition\` that is not a valid schema warns too). A \`dryRun\` reports the same, so check before publishing. A \`read\` of a typed document returns the same \`schema\` block.

\`\`\`json
{"address":"hm://ACCOUNT_UID/people/bob","content":"Bob is a person.","options":{"name":"Bob","metadata":{"surname":"Smith","born":"1990-01-01","attributesSchema":"hm://ACCOUNT_UID/types/person"}},"dryRun":true}
\`\`\`

Every hm:// link in document content is resolved before publishing. Use \`options.skipLinkCheck: true\` only when a linked resource is about to be created. Read the resulting document before citing block-level links because publishing can change block IDs.`,
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
{"address":"hm://SIGNER_UID","options":{"action":"capability.grant","signer":{"publicKey":"SIGNER_UID"},"input":{"delegate":"DELEGATE_UID","role":"WRITER","path":"/","label":"Site editor"}},"dryRun":true}
\`\`\`

Verify the delegate UID, role, and scope carefully before removing \`dryRun\`. The signer is the authority granting access; the delegate is the recipient.`,
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
