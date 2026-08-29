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

Write JSON to \`~/triggers/<name>\` with \`source\`, \`prompt\`, and optional \`enabled\` and \`continuation\`. Read \`~/triggers/\` first for supported source shapes and current triggers. New triggers default to enabled.

\`\`\`json
{"address":"~/triggers/hourly-review","content":"{\"source\":{\"type\":\"schedule\",\"schedule\":{\"kind\":\"interval\",\"every\":1,\"unit\":\"hours\"}},\"prompt\":\"Review current project state.\",\"enabled\":true}"}
\`\`\`

Replace the trigger document to edit it, write with \`enabled: false\` to disable it, or use \`options: {delete: true}\` to remove it. Trigger writes do not use \`dryRun\` or a signer.`,
  },
  ipfs: {
    summary: 'Publish a private memory file or conversation attachment to IPFS.',
    markdown: `# Publishing to IPFS

Write to \`ipfs://\` with exactly one source:

- Memory file: \`options: {fromPath: "~/memory/path/to/file"}\`.
- Current-session attachment: \`options: {fromAttachment: "ATTACHMENT_ID"}\`.

\`\`\`json
{"address":"ipfs://","options":{"fromPath":"~/memory/site-assets/icon.png"}}
\`\`\`

The result includes the CID and \`ipfs://\` URL. Publishing is public, requires the agent's publish grant, and does not support \`dryRun\` or a signer.`,
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

Every hm:// link in document content is resolved before publishing. Use \`options.skipLinkCheck: true\` only when a linked resource is about to be created. Read the resulting document before citing block-level links because publishing can change block IDs.`,
  },
  comments: {
    summary: 'Create comments and replies, then update or delete existing comment records.',
    markdown: `${preamble}

# Writing comments

## Create or reply

Use the target document as \`address\`, markdown as \`content\`, and \`options.action: "comment"\`. The address is the target by default; \`options.target\` can override it. Set \`options.replyTo\` to an existing comment ID or URL for a reply.

\`\`\`json
{"address":"hm://OWNER_UID/notes","content":"A useful comment.","options":{"action":"comment","signer":{"publicKey":"SIGNER_UID"}},"dryRun":true}
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
