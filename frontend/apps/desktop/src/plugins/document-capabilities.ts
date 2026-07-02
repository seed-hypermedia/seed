/**
 * The document-scoped capabilities the currently open (editable) document
 * page offers to plugins. The page registers them while its document machine
 * is mounted; the plugin bridge consults this registry at call time, so
 * `document.read` / `document.updateMetadata` work exactly when a document
 * page is actually open — with staged-draft semantics identical to the
 * metadata editor (nothing publishes; the user reviews and publishes).
 */

export type DocumentPluginCapabilities = {
  /** The open document: hm id + merged (draft-over-published) metadata. */
  readDocument: () => Promise<{id: string; metadata: Record<string, unknown>}>
  /** Stage a metadata patch into the draft. Absent without edit permission. */
  updateDocumentMetadata?: (patch: Record<string, unknown>) => Promise<void>
}

let current: DocumentPluginCapabilities | null = null

export function setDocumentPluginCapabilities(capabilities: DocumentPluginCapabilities | null) {
  current = capabilities
}

export function getDocumentPluginCapabilities(): DocumentPluginCapabilities | null {
  return current
}
