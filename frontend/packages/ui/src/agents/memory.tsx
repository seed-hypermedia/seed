import type {AgentMemoryEntry, AgentMemoryFile} from './client'
import {
  uploadFileToAgentServer,
  useAgentMemory,
  useAgentMemoryFile,
  useDeleteAgentMemoryFile,
  useDownloadAgentMemoryFile,
  useUploadAgentMemoryFileToIpfs,
  useWriteAgentMemoryFile,
} from './models'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  FileText,
  Folder,
  Globe,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'

/** Files above this size skip the inline preview fetch — pulling hundreds of MB stalls the UI. */
const MAX_MEMORY_PREVIEW_BYTES = 32 * 1024 * 1024

/**
 * The agent Memory tab: a browser/editor for the agent's private persistent filesystem.
 * The same files are read and written by the agent's `memory_*` session tools, so this
 * gives the user full visibility and control over what the agent remembers. Text files
 * are editable in place; binary files (media the agent downloaded, or files the user
 * uploads) get previews, on-demand download, and one-click IPFS publishing for use in
 * Hypermedia content.
 */
export function AgentMemoryTab({
  serverUrl,
  accountUid,
  agentId,
  openPath,
  onOpenPathChange,
  readOnly = false,
}: {
  serverUrl: string
  accountUid: string | null
  agentId: string
  /** Prevents a reader collaborator from changing the shared memory. */
  readOnly?: boolean
  /** File the route asked for — a tool row linking to `~/memory/<path>` lands the user on it. */
  openPath?: string
  /** Reports the opened file back to the host so the route (and its copyable URL) can follow. */
  onOpenPathChange?: (path: string) => void
}) {
  const memory = useAgentMemory(serverUrl, accountUid, agentId)
  const writeFile = useWriteAgentMemoryFile(serverUrl, accountUid)
  const deleteFile = useDeleteAgentMemoryFile(serverUrl, accountUid)
  const downloadFromWeb = useDownloadAgentMemoryFile(serverUrl, accountUid)
  const uploadToIpfs = useUploadAgentMemoryFileToIpfs(serverUrl, accountUid)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [newFilePath, setNewFilePath] = useState('')
  const [addPanel, setAddPanel] = useState<'none' | 'new-file' | 'from-url'>('none')
  const [webUrl, setWebUrl] = useState('')
  const [webPath, setWebPath] = useState('')
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)
  /** In-flight local file upload shown as a progress bar; null when idle. */
  const [uploadProgress, setUploadProgress] = useState<{name: string; sent: number; total: number} | null>(null)
  /** Where dragged files would land: '' = memory root, a path = that folder, null = no drag. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** Last IPFS publish result per memory path, kept so the URL stays visible/copyable. */
  const [ipfsUrls, setIpfsUrls] = useState<Record<string, string>>({})
  /** Directories currently expanded in the tree; everything starts collapsed. */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const uploadInputRef = useRef<HTMLInputElement>(null)
  // Reading a file pulls its full bytes over the wire; very large files (multi-hundred-MB
  // uploads) would stall or crash the preview, so those render a size card instead of fetching.
  const selectedEntry = memory.data?.entries.find((entry) => entry.type === 'file' && entry.path === selectedPath)
  const selectedTooLarge = (selectedEntry?.size ?? 0) > MAX_MEMORY_PREVIEW_BYTES
  const file = useAgentMemoryFile(
    serverUrl,
    accountUid,
    agentId,
    selectedTooLarge ? undefined : selectedPath ?? undefined,
  )

  const entries = memory.data?.entries ?? []
  const fileCount = entries.filter((entry) => entry.type === 'file').length
  const visibleEntries = entries.filter((entry) => isPathVisible(entry.path, expandedDirs))

  // Drop the selection when the selected file disappears from the listing (e.g. the
  // agent or another window deleted it).
  useEffect(() => {
    if (!selectedPath || !memory.data) return
    if (!memory.data.entries.some((entry) => entry.type === 'file' && entry.path === selectedPath)) {
      setSelectedPath(null)
      setDraftText(null)
    }
  }, [memory.data, selectedPath])

  function selectFile(path: string) {
    setSelectedPath(path)
    setDraftText(null)
    setConfirmDeletePath(null)
    revealPath(path)
    if (path !== openPath) onOpenPathChange?.(path)
  }

  function toggleDir(path: string) {
    setExpandedDirs((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Arriving from a `~/memory/…` link: open that file (or reveal that folder) ONCE per requested
  // path — a later poll of the listing must not yank the user back off whatever they opened next.
  const openedPathRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Waiting for the listing keeps a directory link from being opened as if it were a file.
    if (!openPath || !memory.data || openedPathRef.current === openPath) return
    openedPathRef.current = openPath
    if (memory.data.entries.some((entry) => entry.path === openPath && entry.type === 'dir')) {
      setExpandedDirs((current) => new Set(current).add(openPath))
      revealPath(openPath)
      return
    }
    selectFile(openPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one reveal per requested path
  }, [openPath, memory.data])

  /** Expands every ancestor directory of a path so it is visible in the tree. */
  function revealPath(path: string) {
    const segments = path.split('/')
    if (segments.length <= 1) return
    setExpandedDirs((current) => {
      const next = new Set(current)
      for (let i = 1; i < segments.length; i++) next.add(segments.slice(0, i).join('/'))
      return next
    })
  }

  async function handleCreateFile() {
    const path = newFilePath.trim()
    if (!path) return
    try {
      await writeFile.mutateAsync({agentId, path, content: ''})
      setNewFilePath('')
      setAddPanel('none')
      selectFile(path.replace(/^\/+/, ''))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create memory file')
    }
  }

  async function handleDownloadFromWeb() {
    const url = webUrl.trim()
    if (!url) return
    try {
      const result = await downloadFromWeb.mutateAsync({agentId, url, path: webPath.trim() || undefined})
      setWebUrl('')
      setWebPath('')
      setAddPanel('none')
      selectFile(result.entry.path)
      toast.success(`Downloaded to ${result.entry.path}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download the file')
    }
  }

  /** Uploads local files into memory, optionally inside a target directory. Large files go in
   * chunks (each signed action stays small) with a visible progress bar. */
  async function handleUploadLocalFiles(localFiles: DroppedFile[], dirPath?: string) {
    if (!accountUid) {
      toast.error('Select an account first')
      return
    }
    let lastPath: string | null = null
    let uploaded = 0
    try {
      for (const {path: relativePath, file: localFile} of localFiles) {
        try {
          const bytes = new Uint8Array(await localFile.arrayBuffer())
          const path = dirPath ? `${dirPath}/${relativePath}` : relativePath
          setUploadProgress({name: relativePath, sent: 0, total: bytes.byteLength})
          await uploadFileToAgentServer({
            serverUrl,
            accountUid,
            target: {kind: 'memory', agentId, path},
            data: bytes,
            onProgress: (progress) => setUploadProgress({name: relativePath, ...progress}),
          })
          lastPath = path
          uploaded++
        } catch (error) {
          toast.error(error instanceof Error ? `${relativePath}: ${error.message}` : 'Could not add the file to memory')
        }
      }
    } finally {
      setUploadProgress(null)
      invalidateQueries(['agents', 'memory'])
    }
    if (lastPath) {
      selectFile(lastPath)
      toast.success(
        uploaded === 1
          ? `Added ${lastPath} to memory`
          : `Added ${uploaded} files to memory${dirPath ? ` in ${dirPath}/` : ''}`,
      )
    }
  }

  /** Handles a drop of OS files and/or folders, walking folders so their contents land as nested paths. */
  async function handleDroppedItems(dataTransfer: DataTransfer, dirPath?: string) {
    try {
      const dropped = await collectDroppedFiles(dataTransfer)
      if (dropped.length) await handleUploadLocalFiles(dropped, dirPath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the dropped files')
    }
  }

  async function handleSave() {
    if (selectedPath === null || draftText === null) return
    try {
      await writeFile.mutateAsync({agentId, path: selectedPath, content: draftText})
      setDraftText(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save memory file')
    }
  }

  async function handleDelete(path: string) {
    try {
      await deleteFile.mutateAsync({agentId, path})
      setConfirmDeletePath(null)
      if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
        setSelectedPath(null)
        setDraftText(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete from memory')
    }
  }

  async function handlePublishToIpfs() {
    if (!selectedPath) return
    try {
      const result = await uploadToIpfs.mutateAsync({agentId, path: selectedPath})
      setIpfsUrls((current) => ({...current, [result.path]: result.url}))
      await copyText(result.url)
      toast.success(`Published to IPFS — URL copied: ${result.url}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload to IPFS')
    }
  }

  const dirty = draftText !== null && draftText !== (file.data?.content ?? '')
  const selectedIpfsUrl = selectedPath ? ipfsUrls[selectedPath] : undefined

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 sm:flex-nowrap sm:items-center">
        <div className="flex min-w-0 flex-col">
          <SizableText weight="bold">Memory</SizableText>
          <SizableText size="xs" color="muted">
            Private files this agent reads and writes across sessions.{' '}
            {readOnly ? 'You have read-only access.' : 'You can edit everything here.'}
            {memory.data
              ? ` ${fileCount} file${fileCount === 1 ? '' : 's'}, ${formatBytes(memory.data.totalBytes)}.`
              : ''}
          </SizableText>
        </div>
        {!readOnly ? (
          <div className="flex flex-none items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const localFiles = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                if (localFiles.length) void handleUploadLocalFiles(localFiles.map((file) => ({path: file.name, file})))
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="max-sm:min-h-10"
              onClick={() => uploadInputRef.current?.click()}
              disabled={writeFile.isLoading}
            >
              <Upload className="mr-2 size-4" /> Add file
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="max-sm:min-h-10"
              onClick={() => setAddPanel((current) => (current === 'from-url' ? 'none' : 'from-url'))}
            >
              <Globe className="mr-2 size-4" /> From URL
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="max-sm:min-h-10"
              onClick={() => setAddPanel((current) => (current === 'new-file' ? 'none' : 'new-file'))}
            >
              <FilePlus className="mr-2 size-4" /> New file
            </Button>
          </div>
        ) : null}
      </div>

      {uploadProgress ? (
        <div className="border-border bg-card rounded-lg border p-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground min-w-0 truncate">
              Uploading {uploadProgress.name}… {formatBytes(uploadProgress.sent)} of {formatBytes(uploadProgress.total)}
            </span>
            <span className="text-muted-foreground flex-none">
              {Math.floor((uploadProgress.sent / Math.max(1, uploadProgress.total)) * 100)}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-200"
              style={{width: `${(uploadProgress.sent / Math.max(1, uploadProgress.total)) * 100}%`}}
            />
          </div>
        </div>
      ) : null}

      {addPanel === 'new-file' ? (
        <form
          className="border-border bg-card flex items-center gap-2 rounded-lg border p-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreateFile()
          }}
        >
          <Input
            autoFocus
            value={newFilePath}
            onChange={(event) => setNewFilePath(event.target.value)}
            placeholder="notes/topic.md"
            aria-label="New memory file path"
          />
          <Button type="submit" size="sm" disabled={!newFilePath.trim() || writeFile.isLoading}>
            Create
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddPanel('none')}>
            Cancel
          </Button>
        </form>
      ) : null}

      {addPanel === 'from-url' ? (
        <form
          className="border-border bg-card flex items-center gap-2 rounded-lg border p-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleDownloadFromWeb()
          }}
        >
          <Input
            autoFocus
            value={webUrl}
            onChange={(event) => setWebUrl(event.target.value)}
            placeholder="https://example.com/file.png"
            aria-label="URL to download into memory"
          />
          <Input
            value={webPath}
            onChange={(event) => setWebPath(event.target.value)}
            placeholder="Optional path (media/file.png)"
            aria-label="Optional memory path for the download"
            className="max-w-56"
          />
          <Button type="submit" size="sm" disabled={!webUrl.trim() || downloadFromWeb.isLoading}>
            {downloadFromWeb.isLoading ? 'Downloading…' : 'Download'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddPanel('none')}>
            Cancel
          </Button>
        </form>
      ) : null}

      <div className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border sm:flex-row">
        <div
          className={`border-border flex max-h-56 w-full flex-none flex-col overflow-y-auto border-b p-2 sm:max-h-none sm:w-64 sm:border-r sm:border-b-0 ${
            dropTarget === '' ? 'ring-primary/50 ring-2 ring-inset' : ''
          }`}
          onDragOver={(event) => {
            if (readOnly || !hasDraggedFiles(event)) return
            event.preventDefault()
            // Dir rows stop propagation while hovered, so reaching here means the root is targeted.
            setDropTarget('')
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDropTarget(null)
          }}
          onDrop={(event) => {
            if (readOnly || !hasDraggedFiles(event)) return
            event.preventDefault()
            setDropTarget(null)
            void handleDroppedItems(event.dataTransfer)
          }}
        >
          {memory.isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Spinner />
            </div>
          ) : memory.isError ? (
            <SizableText size="sm" color="muted" className="p-2">
              Could not load memory from the agent server.
            </SizableText>
          ) : entries.length === 0 ? (
            <SizableText size="sm" color="muted" className="p-2">
              No memory yet. The agent stores files here as it works, and you can add files for it to find — or drop
              files here.
            </SizableText>
          ) : (
            visibleEntries.map((entry) => (
              <MemoryEntryRow
                key={entry.path}
                entry={entry}
                selected={entry.type === 'file' && entry.path === selectedPath}
                confirmingDelete={confirmDeletePath === entry.path}
                expanded={entry.type === 'dir' && expandedDirs.has(entry.path)}
                onToggle={entry.type === 'dir' ? () => toggleDir(entry.path) : undefined}
                onSelect={() => (entry.type === 'file' ? selectFile(entry.path) : undefined)}
                onRequestDelete={readOnly ? undefined : () => setConfirmDeletePath(entry.path)}
                onCancelDelete={() => setConfirmDeletePath(null)}
                onConfirmDelete={() => void handleDelete(entry.path)}
                deleting={deleteFile.isLoading && confirmDeletePath === entry.path}
                dropTargeted={entry.type === 'dir' && dropTarget === entry.path}
                onDirDragOver={
                  !readOnly && entry.type === 'dir'
                    ? (event) => {
                        if (!hasDraggedFiles(event)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropTarget(entry.path)
                      }
                    : undefined
                }
                onDirDrop={
                  !readOnly && entry.type === 'dir'
                    ? (event) => {
                        if (!hasDraggedFiles(event)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropTarget(null)
                        void handleDroppedItems(event.dataTransfer, entry.path)
                      }
                    : undefined
                }
              />
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {selectedPath === null ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <SizableText size="sm" color="muted">
                Select a file to view and edit it.
              </SizableText>
            </div>
          ) : selectedTooLarge && selectedEntry ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
              <FileText className="text-muted-foreground size-8" />
              <SizableText size="sm" weight="bold" className="max-w-full truncate font-mono">
                {selectedPath}
              </SizableText>
              <SizableText size="sm" color="muted">
                {formatBytes(selectedEntry.size)}
                {selectedEntry.mimeType ? ` · ${selectedEntry.mimeType}` : ''} — too large to preview here.
              </SizableText>
              {!readOnly ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmDeletePath(selectedPath)} className="mt-2">
                  <Trash2 className="mr-1 size-3.5" /> Delete
                </Button>
              ) : null}
            </div>
          ) : file.isLoading ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <Spinner />
            </div>
          ) : file.isError ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <SizableText size="sm" color="muted">
                {file.error instanceof Error ? file.error.message : 'Could not read this memory file.'}
              </SizableText>
            </div>
          ) : file.data ? (
            <>
              <div className="border-border flex items-center gap-2 border-b px-3 py-2">
                <FileText className="text-muted-foreground size-4 flex-none" />
                <SizableText size="sm" weight="bold" className="min-w-0 flex-1 truncate font-mono">
                  {selectedPath}
                </SizableText>
                <SizableText size="xs" color="muted" className="flex-none">
                  {formatBytes(dirty ? new TextEncoder().encode(draftText ?? '').byteLength : file.data.size)}
                  {file.data.mimeType ? ` · ${file.data.mimeType}` : ''}
                  {file.data.updatedAt ? ` · ${formattedDateMedium(new Date(file.data.updatedAt))}` : ''}
                </SizableText>
                {!readOnly && file.data.encoding === 'utf8' && dirty ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-none"
                      onClick={() => setDraftText(null)}
                      disabled={writeFile.isLoading}
                    >
                      <RotateCcw className="mr-1 size-3.5" /> Revert
                    </Button>
                    <Button
                      size="sm"
                      className="flex-none"
                      onClick={() => void handleSave()}
                      disabled={writeFile.isLoading}
                    >
                      <Save className="mr-1 size-3.5" /> {writeFile.isLoading ? 'Saving…' : 'Save'}
                    </Button>
                  </>
                ) : null}
                <OptionsDropdown
                  align="end"
                  menuItems={[
                    {
                      key: 'download',
                      icon: <Download className="size-4" />,
                      label: 'Download',
                      onClick: () => file.data && saveFileToDisk(file.data),
                    },
                    {
                      key: 'publish-ipfs',
                      icon: <UploadCloud className="size-4" />,
                      label: uploadToIpfs.isLoading ? 'Publishing…' : 'Publish to IPFS',
                      disabled: readOnly || uploadToIpfs.isLoading,
                      onClick: () => void handlePublishToIpfs(),
                    },
                  ]}
                />
              </div>
              {selectedIpfsUrl ? (
                <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3 py-1.5">
                  <SizableText size="xs" color="muted" className="flex-none">
                    IPFS:
                  </SizableText>
                  <SizableText size="xs" className="min-w-0 flex-1 truncate font-mono">
                    {selectedIpfsUrl}
                  </SizableText>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    className="flex-none"
                    aria-label="Copy IPFS URL"
                    onClick={() => void copyText(selectedIpfsUrl).then(() => toast.success('IPFS URL copied'))}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              ) : null}
              {file.data.encoding === 'utf8' ? (
                <textarea
                  aria-label={`Memory file ${selectedPath}`}
                  className="focus:ring-primary/25 min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none focus:ring-2"
                  value={draftText ?? file.data.content ?? ''}
                  onChange={(event) => setDraftText(event.currentTarget.value)}
                  readOnly={readOnly}
                  spellCheck={false}
                />
              ) : (
                <BinaryFilePreview file={file.data} onDownload={() => file.data && saveFileToDisk(file.data)} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/**
 * Renders binary memory files: inline previews for images (including animated GIFs), video, and
 * audio, and a download-first card for every other binary type.
 */
function BinaryFilePreview({file, onDownload}: {file: AgentMemoryFile; onDownload: () => void}) {
  const objectUrl = useMemo(() => {
    if (!file.data || !file.data.byteLength) return null
    const blob = new Blob([new Uint8Array(file.data)], file.mimeType ? {type: file.mimeType} : undefined)
    return URL.createObjectURL(blob)
  }, [file])

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  const kind = file.mimeType?.split('/')[0]
  if (objectUrl && kind === 'image') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <img src={objectUrl} alt={file.path} className="max-h-full max-w-full rounded-md object-contain" />
      </div>
    )
  }
  if (objectUrl && kind === 'video') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <video src={objectUrl} controls className="max-h-full max-w-full rounded-md" />
      </div>
    )
  }
  if (objectUrl && kind === 'audio') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <audio src={objectUrl} controls className="w-full max-w-md" />
      </div>
    )
  }
  const name = file.path.split('/').at(-1) || file.path
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div className="border-border bg-muted/30 flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed p-8">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-xl">
          <FileText className="size-7" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <SizableText size="sm" weight="bold" className="max-w-full truncate font-mono">
            {name}
          </SizableText>
          <SizableText size="xs" color="muted">
            {formatBytes(file.size)}
            {file.mimeType ? ` · ${file.mimeType}` : ' · binary file'}
          </SizableText>
        </div>
        {objectUrl ? (
          <>
            <SizableText size="xs" color="muted" className="text-center">
              This file type has no inline preview.
            </SizableText>
            <Button onClick={onDownload}>
              <Download className="mr-2 size-4" /> Download
            </Button>
          </>
        ) : (
          <SizableText size="xs" color="muted" className="text-center">
            The file content could not be loaded for preview. If this agent server was recently updated, restart it and
            reopen the file.
          </SizableText>
        )}
      </div>
    </div>
  )
}

function MemoryEntryRow({
  entry,
  selected,
  confirmingDelete,
  deleting,
  expanded,
  onToggle,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  dropTargeted,
  onDirDragOver,
  onDirDrop,
}: {
  entry: AgentMemoryEntry
  selected: boolean
  confirmingDelete: boolean
  deleting: boolean
  /** True when this directory's contents are shown. */
  expanded?: boolean
  /** Collapses/expands this directory. */
  onToggle?: () => void
  onSelect: () => void
  onRequestDelete?: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  /** True while dragged files hover this directory row. */
  dropTargeted?: boolean
  onDirDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDirDrop?: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  const depth = entry.path.split('/').length - 1
  const name = entry.path.split('/').at(-1) || entry.path
  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-1 py-0.5 ${
        selected ? 'bg-primary/10' : dropTargeted ? 'bg-primary/15 ring-primary/50 ring-1' : 'hover:bg-muted/60'
      }`}
      style={{paddingLeft: `${4 + depth * 14}px`}}
      onDragOver={onDirDragOver}
      onDrop={onDirDrop}
    >
      {entry.type === 'dir' ? (
        <button
          type="button"
          className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left max-sm:min-h-10"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entry.path}`}
        >
          <ChevronRight className={`size-3 flex-none transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <Folder className="size-3.5 flex-none" />
          <span className="truncate font-mono text-xs">{name}</span>
        </button>
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left max-sm:min-h-10"
          onClick={onSelect}
        >
          <FileText className="text-muted-foreground size-3.5 flex-none" />
          <span className="truncate font-mono text-xs">{name}</span>
          <span className="text-muted-foreground/70 ml-auto flex-none pr-1 text-[10px]">{formatBytes(entry.size)}</span>
        </button>
      )}
      {confirmingDelete ? (
        <span className="flex flex-none items-center gap-1">
          <Button variant="destructive" size="xs" onClick={onConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <Button variant="ghost" size="xs" onClick={onCancelDelete} disabled={deleting}>
            Cancel
          </Button>
        </span>
      ) : onRequestDelete ? (
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`Delete ${entry.path}`}
          className="flex-none opacity-0 group-hover:opacity-100"
          onClick={onRequestDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

/** True when every ancestor directory of the path is expanded (root entries are always visible). */
function isPathVisible(path: string, expandedDirs: Set<string>): boolean {
  const segments = path.split('/')
  for (let i = 1; i < segments.length; i++) {
    if (!expandedDirs.has(segments.slice(0, i).join('/'))) return false
  }
  return true
}

/** True when a drag event carries OS files (rather than in-app text/element drags). */
function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/** A local file to upload, with its memory-relative path (includes folder names for folder drops). */
type DroppedFile = {path: string; file: File}

/**
 * Collects the files carried by a drop, recursing into dropped folders so nested files keep
 * their relative paths. Must be called synchronously from the drop event: `webkitGetAsEntry`
 * only works while the DataTransfer is live.
 */
async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const entries = Array.from(dataTransfer.items).map((item) => item.webkitGetAsEntry?.() ?? null)
  if (!entries.some(Boolean)) {
    // No entries API (or a non-filesystem drag): fall back to the flat file list.
    return Array.from(dataTransfer.files).map((file) => ({path: file.name, file}))
  }
  const collected: DroppedFile[] = []
  for (const entry of entries) {
    if (entry) await collectEntry(entry, collected)
  }
  return collected
}

async function collectEntry(entry: FileSystemEntry, out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    if (entry.name === '.DS_Store') return
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({path: entry.fullPath.replace(/^\/+/, ''), file})
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns results in batches (~100 in Chromium) until an empty batch.
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await collectEntry(child, out)
    }
  }
}

/** Saves a memory file to the user's computer via a browser download. */
function saveFileToDisk(file: AgentMemoryFile) {
  const bytes =
    file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
  const blob = new Blob([new Uint8Array(bytes)], file.mimeType ? {type: file.mimeType} : undefined)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.path.split('/').at(-1) || 'file'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard access can fail outside a focused window; the URL stays visible for manual copy.
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
