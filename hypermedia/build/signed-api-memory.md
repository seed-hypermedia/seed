---
name: "Signed API: memory and uploads"
summary: This page lists the signed API actions that read and write an agent's memory files, session attachments, and chunked uploads.
---
These actions of the [signed API](./signed-api.md) move files. They cover an agent's [memory](../agent/memory.md), the [attachments](../agent/attachment.md) of a [session](../agent/session.md), and the chunked upload that feeds both. The [signed API](./signed-api.md) page covers what every action shares: the endpoint, the envelope, errors, [access levels](./signed-api.md#access-levels) and idempotency.

# Agent memory <!-- id:sl55O0AI -->

Each [agent](../agent.md) has its own folder of files, called its memory. The agent reads and writes it with [`read`](../agent/read.md) and [`write`](../agent/write.md), under `~/memory/` in its [Space](../agent/space.md). Its owner sees it on the Memory tab of the [Seed app](../software/desktop.md). The server stores it in `<stateDir>/memory`, where `<stateDir>` is the agent's own state folder. <!-- id:F4plBjdL -->

- To list or read files (`ListAgentMemory`, `ListAgentMemoryDir`, `ReadAgentMemoryFile`) you need reader access to the agent.
- To change files you need writer access.
- Paths are always relative to the memory folder: no leading `/`, no `..`, and no symlinks.
- Files can be UTF-8 text or binary.

```ts <!-- id:igtkULLY -->
type AgentMemoryEntry = {path: string; type: 'file' | 'dir'; size: number; updatedAt: number; mimeType?: string; entryCount?: number}
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
  - `ListAgentMemory {agentId}` returns `{_: 'ListAgentMemoryResponse'; agentId; entries: AgentMemoryEntry[]; totalBytes; truncated?}`. The files and folders are sorted by path. The list stops at `MAX_MEMORY_LIST_ENTRIES` (2000) entries, and `truncated` is then `true`. `ListAgentMemoryDir {agentId, path?}` lists one level and returns `{_: 'ListAgentMemoryDirResponse'; agentId; path; entries; totalBytes; totals?}`. Each folder in `entries` has an `entryCount`. `totalBytes` counts only the files at this level. `totals` (`{files, bytes, truncated}`) covers the whole memory and is sent only when you list the root. Use this action to browse a large memory. <!-- id:5oZzSBlu -->
  - `ReadAgentMemoryFile {agentId, path}` returns `{_: 'ReadAgentMemoryFileResponse'; agentId; file: AgentMemoryFile}`. A file that is valid UTF-8 text comes back as text, whatever its size. Everything else comes back as raw bytes. <!-- id:gcXVifoW -->
  - `WriteAgentMemoryFile {agentId, path, content}` writes the whole file, creates parent folders when needed, and returns `{_: 'WriteAgentMemoryFileResponse'; agentId; entry}`. `content` is a string (UTF-8 text) or `Uint8Array` bytes. After a write, a download or a delete, the server sends an `account-change` event with reason `agent-memory-changed`. Subscribers to `agents/<agentId>` on the [WebSocket](./websocket-subscriptions.md) get it too, so an open Memory tab refreshes. <!-- id:Pf3XwaO2 -->
  - `DeleteAgentMemoryFile {agentId, path}` removes a file, or a directory recursively, and returns `{_: 'DeleteAgentMemoryFileResponse'; agentId; path; deleted}`. `deleted` is false when nothing existed. <!-- id:hslyEoNq -->
  - `DownloadAgentMemoryFile {agentId, url, path?}` makes the server fetch a public http(s) URL into memory and returns `{_: 'DownloadAgentMemoryFileResponse'; agentId; entry; finalUrl; contentType?}`. The fetch stops if no data arrives for 60 seconds. Without `path`, the file goes under `downloads/`, named from the URL. A path with no extension gets one from the content type of the response. <!-- id:iCJPpKHx -->
  - `UploadAgentMemoryFileToIpfs {agentId, path}` splits the file into [UnixFS](../protocol/files.md) pieces, publishes them through the `PublishBlobs` key of the [Seed API](./web-api.md), and returns `{_: 'UploadAgentMemoryFileToIpfsResponse'; agentId; path; cid; url; size; mimeType?}`, `url` is the `ipfs://<cid>` URL that Hypermedia content can use. After publishing, anyone can fetch the file. <!-- id:b7BdF2s4 -->

Limits: a path can be at most 512 bytes and 16 levels deep (`apps/src/agent-memory.ts`). Memory has no total size limit. One chunked upload into memory can be at most 2 GiB, and one [account](../protocol/identity.md) can have at most 8 uploads in progress at a time. A bigger upload gets a `413`, and a ninth upload gets a `429`. A single `WriteAgentMemoryFile` has no size check of its own. The 256 KiB limit `MAX_WRITE_CONTENT_BYTES` in `api-service.ts` applies only to Hypermedia content that the `write` verb publishes, not to memory files. <!-- id:eXN97pf8 -->

# Session attachments <!-- id:2JNT-ocN -->

<!-- id:yaivXodZ -->
- `UploadSessionAttachment {sessionId, name, mimeType?, content}` → `{_: 'UploadSessionAttachmentResponse'; attachment: SessionAttachmentInfo}`. The attachment id is the SHA-256 hash of the bytes, written in hex, so uploading the same file again returns the same id. Limits: 100 MiB per attachment and 200 attachments per session (`apps/src/session-attachments.ts`). The server stores them under `<stateDir>/session-attachments/<sessionId>/`. <!-- id:-ax7SDcO -->
- `ReadSessionAttachment {sessionId, attachmentId}` → `{_: 'ReadSessionAttachmentResponse'; attachment; data}` so a client can show an attachment in the conversation. <!-- id:GDrE1qlb -->

# Chunked uploads

A large file is uploaded in chunks. Each signed action stays small, and a client can show progress: <!-- id:NWuxtcq2 -->
  - `BeginFileUpload {target, size}` → `{_: 'BeginFileUploadResponse'; uploadId; maxChunkBytes}`. `target` is `{kind: 'memory', agentId, path}` or `{kind: 'session-attachment', sessionId, name, mimeType?}`, The server checks it at the start, so a long upload does not fail at the end. `maxChunkBytes` is 8 MiB. <!-- id:e80mVQU_ -->
  - `AppendFileUploadChunk {uploadId, offset, content}` → `{_: 'AppendFileUploadChunkResponse'; uploadId; received}`. Chunks must arrive in order: `offset` must equal the bytes already received. A wrong offset returns `409`. A chunk over `maxChunkBytes` returns `413`. An empty chunk, or one that goes past the declared `size`, returns `400`. <!-- id:ta2EIYUV -->
  - `CommitFileUpload {uploadId}` → `{_: 'CommitFileUploadResponse'; entry?; attachment?}`: `entry` for a memory target, `attachment` for a session attachment. The bytes received must equal the declared `size`. <!-- id:xRZdKHtN -->
  - `AbortFileUpload {uploadId}` → `{_: 'AbortFileUploadResponse'; uploadId}`. An upload that receives no chunk for one hour is thrown away. <!-- id:rBJMxIwS -->

# See also

- [Signed API](./signed-api.md)
- [Sessions and runs](./signed-api-sessions.md) for `MessageSession`, which references attachments
- [Space](../agent/space.md)
- [Attachment](../agent/attachment.md)
- [Files](../protocol/files.md)
