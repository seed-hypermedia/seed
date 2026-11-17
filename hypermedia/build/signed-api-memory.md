---
name: "Signed API: memory and uploads"
summary: The signed API actions for an agent's memory files, session attachments, and chunked uploads.
---
These are the actions of the [signed API](./signed-api.md) that move files: an agent's [memory](../agent/space.md), a session's [attachments](../agent/attachment.md), and the chunked upload that feeds both. The envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency are on the [signed API](./signed-api.md) page.

# Agent memory <!-- id:sl55O0AI -->

Each agent owns a private memory filesystem at `<stateDir>/memory`. It is the `~/memory/` half of its [Space](../agent/space.md). The agent reaches it through the [`read`](../agent/read.md) and [`write`](../agent/write.md) verbs, and its owner sees it on the desktop Memory tab. `ListAgentMemory`, `ListAgentMemoryDir`, and `ReadAgentMemoryFile` need reader access to the agent; the writing actions need writer access. Every path is a sandboxed relative path: no absolute paths, no `..`, symlinks refused. Files can be UTF-8 text or binary. <!-- id:F4plBjdL -->

```ts <!-- id:igtkULLY -->
type AgentMemoryEntry = {path: string; type: 'file' | 'dir'; size: number; updatedAt: number; mimeType?: string}
type AgentMemoryFile = {
  path: string
  size: number
  updatedAt: number
  mimeType?: string
  encoding: 'utf8' | 'binary'
  content?: string // present when encoding is 'utf8'
  data?: Uint8Array // present when encoding is 'binary'
}
```

Actions: <!-- id:dRAJrWd3 -->
  - `ListAgentMemory {agentId}` returns `{_: 'ListAgentMemoryResponse'; agentId; entries: AgentMemoryEntry[]; totalBytes}` with files and directories sorted by path, capped at `MAX_MEMORY_LIST_ENTRIES` (2000) with `truncated: true` past that. `ListAgentMemoryDir {agentId, path?}` lists one level with `entryCount` and totals per entry, and is the call to browse a large memory. <!-- id:5oZzSBlu -->
  - `ReadAgentMemoryFile {agentId, path}` returns `{_: 'ReadAgentMemoryFileResponse'; agentId; file: AgentMemoryFile}`. Small clean-UTF-8 files come back as text. Everything else comes back as raw bytes for preview and download in the Memory tab. <!-- id:gcXVifoW -->
  - `WriteAgentMemoryFile {agentId, path, content}` returns `{_: 'WriteAgentMemoryFileResponse'; agentId; entry}` after writing the full file content, creating parent directories as needed. `content` may be a string (UTF-8 text) or `Uint8Array` bytes (e.g. a local file uploaded from the Memory tab). Writes, downloads, and deletes emit an `account-change` event with reason `agent-memory-changed`, which is also fanned out to `agents/<agentId>` WebSocket subscribers so open Memory tabs refresh. <!-- id:Pf3XwaO2 -->
  - `DeleteAgentMemoryFile {agentId, path}` removes a file, or a directory recursively, and returns `{_: 'DeleteAgentMemoryFileResponse'; agentId; path; deleted}`. `deleted` is false when nothing existed. <!-- id:hslyEoNq -->
  - `DownloadAgentMemoryFile {agentId, url, path?}` server-side fetches a public http(s) URL into memory (streamed, with a 60-second idle timeout) and returns `{_: 'DownloadAgentMemoryFileResponse'; agentId; entry; finalUrl; contentType?}`. Omitting `path` stores the file under `downloads/`, named from the URL. Extension-less paths gain an extension from the response content type. <!-- id:iCJPpKHx -->
  - `UploadAgentMemoryFileToIpfs {agentId, path}` chunks the file as [UnixFS](../protocol/files.md) and publishes its blocks through the typed HM API's `PublishBlobs` action, then returns `{_: 'UploadAgentMemoryFileToIpfsResponse'; agentId; path; cid; url; size; mimeType?}`, where `url` is the `ipfs://<cid>` URL usable from Hypermedia content. Publishing makes the file publicly retrievable. <!-- id:b7BdF2s4 -->

Path limits (`apps/src/agent-memory.ts`): 512 bytes per normalized relative path, 16 levels of nesting. Memory itself has no per-file or per-agent size cap (only the listing is capped at 2000 entries). The server accepts uploads of any size (`main.ts` raises Bun's request-body limit for this). The 256 KiB `MAX_WRITE_CONTENT_BYTES` bound in `api-service.ts` applies only to hypermedia content the `write` verb publishes. It does not apply to memory files. <!-- id:eXN97pf8 -->

# Session attachments <!-- id:2JNT-ocN -->

<!-- id:yaivXodZ -->
- `UploadSessionAttachment {sessionId, name, mimeType?, content}` → `{_: 'UploadSessionAttachmentResponse'; attachment: SessionAttachmentInfo}`. The attachment id is the SHA-256 hex of the bytes, so re-uploading the same file returns the same id. Caps: 100 MiB per attachment and 200 attachments per session (`apps/src/session-attachments.ts`), stored under `<stateDir>/session-attachments/<sessionId>/`. <!-- id:-ax7SDcO -->
- `ReadSessionAttachment {sessionId, attachmentId}` → `{_: 'ReadSessionAttachmentResponse'; attachment; data}` for rendering an attachment back in the thread. <!-- id:GDrE1qlb -->

# Chunked uploads

Large files upload in bounded chunks, so each signed action stays small and clients can show progress: <!-- id:NWuxtcq2 -->
  - `BeginFileUpload {target, size}` → `{_: 'BeginFileUploadResponse'; uploadId; maxChunkBytes}`. `target` is `{kind: 'memory', agentId, path}` or `{kind: 'session-attachment', sessionId, name, mimeType?}`, validated up front so a long upload cannot fail at the very end. `maxChunkBytes` is 8 MiB. <!-- id:e80mVQU_ -->
  - `AppendFileUploadChunk {uploadId, offset, content}` → `{_: 'AppendFileUploadChunkResponse'; uploadId; received}`. Chunks must arrive in order: `offset` must equal the bytes already staged. Oversized chunks return `413`. <!-- id:ta2EIYUV -->
  - `CommitFileUpload {uploadId}` → `{_: 'CommitFileUploadResponse'; entry?; attachment?}`: `entry` for a memory target, `attachment` for a session attachment. The staged byte count must equal the declared `size`. <!-- id:xRZdKHtN -->
  - `AbortFileUpload {uploadId}` → `{_: 'AbortFileUploadResponse'; uploadId}`. Staged uploads also expire after an hour. <!-- id:rBJMxIwS -->

# See also

- [Signed API](./signed-api.md)
- [Sessions and runs](./signed-api-sessions.md) for `MessageSession`, which references attachments
- [Space](../agent/space.md)
- [Attachment](../agent/attachment.md)
- [Files](../protocol/files.md)
