import type {AgentMemoryEntry, AgentMemoryFile} from '@/agents-client'
import {
  useAgentMemory,
  useAgentMemoryFile,
  useDeleteAgentMemoryFile,
  useDownloadAgentMemoryFile,
  useUploadAgentMemoryFileToIpfs,
  useWriteAgentMemoryFile,
} from '@/models/agents'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {
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
}: {
  serverUrl: string
  accountUid: string | null
  agentId: string
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
  /** Where dragged files would land: '' = memory root, a path = that folder, null = no drag. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** Last IPFS publish result per memory path, kept so the URL stays visible/copyable. */
  const [ipfsUrls, setIpfsUrls] = useState<Record<string, string>>({})
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const file = useAgentMemoryFile(serverUrl, accountUid, agentId, selectedPath ?? undefined)

  const entries = memory.data?.entries ?? []
  const fileCount = entries.filter((entry) => entry.type === 'file').length

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

  /** Uploads local files into memory, optionally inside a target directory. */
  async function handleUploadLocalFiles(localFiles: File[], dirPath?: string) {
    let lastPath: string | null = null
    for (const localFile of localFiles) {
      try {
        const bytes = new Uint8Array(await localFile.arrayBuffer())
        const path = dirPath ? `${dirPath}/${localFile.name}` : localFile.name
        await writeFile.mutateAsync({agentId, path, content: bytes})
        lastPath = path
      } catch (error) {
        toast.error(error instanceof Error ? `${localFile.name}: ${error.message}` : 'Could not add the file to memory')
      }
    }
    if (lastPath) {
      selectFile(lastPath)
      toast.success(
        localFiles.length === 1
          ? `Added ${lastPath} to memory`
          : `Added ${localFiles.length} files to memory${dirPath ? ` in ${dirPath}/` : ''}`,
      )
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <SizableText weight="bold">Memory</SizableText>
          <SizableText size="xs" color="muted">
            Private files this agent reads and writes across sessions. You can edit everything here.
            {memory.data
              ? ` ${fileCount} file${fileCount === 1 ? '' : 's'}, ${formatBytes(memory.data.totalBytes)}.`
              : ''}
          </SizableText>
        </div>
        <div className="flex flex-none items-center gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const localFiles = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              if (localFiles.length) void handleUploadLocalFiles(localFiles)
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => uploadInputRef.current?.click()}
            disabled={writeFile.isLoading}
          >
            <Upload className="mr-2 size-4" /> Add file
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddPanel((current) => (current === 'from-url' ? 'none' : 'from-url'))}
          >
            <Globe className="mr-2 size-4" /> From URL
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddPanel((current) => (current === 'new-file' ? 'none' : 'new-file'))}
          >
            <FilePlus className="mr-2 size-4" /> New file
          </Button>
        </div>
      </div>

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

      <div className="border-border bg-card flex min-h-0 flex-1 overflow-hidden rounded-xl border">
        <div
          className={`border-border flex w-64 flex-none flex-col overflow-y-auto border-r p-2 ${
            dropTarget === '' ? 'ring-primary/50 ring-2 ring-inset' : ''
          }`}
          onDragOver={(event) => {
            if (!hasDraggedFiles(event)) return
            event.preventDefault()
            // Dir rows stop propagation while hovered, so reaching here means the root is targeted.
            setDropTarget('')
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDropTarget(null)
          }}
          onDrop={(event) => {
            if (!hasDraggedFiles(event)) return
            event.preventDefault()
            setDropTarget(null)
            const localFiles = Array.from(event.dataTransfer.files)
            if (localFiles.length) void handleUploadLocalFiles(localFiles)
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
            entries.map((entry) => (
              <MemoryEntryRow
                key={entry.path}
                entry={entry}
                selected={entry.type === 'file' && entry.path === selectedPath}
                confirmingDelete={confirmDeletePath === entry.path}
                onSelect={() => (entry.type === 'file' ? selectFile(entry.path) : undefined)}
                onRequestDelete={() => setConfirmDeletePath(entry.path)}
                onCancelDelete={() => setConfirmDeletePath(null)}
                onConfirmDelete={() => void handleDelete(entry.path)}
                deleting={deleteFile.isLoading && confirmDeletePath === entry.path}
                dropTargeted={entry.type === 'dir' && dropTarget === entry.path}
                onDirDragOver={
                  entry.type === 'dir'
                    ? (event) => {
                        if (!hasDraggedFiles(event)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropTarget(entry.path)
                      }
                    : undefined
                }
                onDirDrop={
                  entry.type === 'dir'
                    ? (event) => {
                        if (!hasDraggedFiles(event)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropTarget(null)
                        const localFiles = Array.from(event.dataTransfer.files)
                        if (localFiles.length) void handleUploadLocalFiles(localFiles, entry.path)
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
                {file.data.encoding === 'utf8' && dirty ? (
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
                      disabled: uploadToIpfs.isLoading,
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
                  spellCheck={false}
                />
              ) : (
                <BinaryFilePreview file={file.data} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** Renders an inline media preview for binary memory files, or a download hint otherwise. */
function BinaryFilePreview({file}: {file: AgentMemoryFile}) {
  const objectUrl = useMemo(() => {
    if (!file.data) return null
    const blob = new Blob([new Uint8Array(file.data)], file.mimeType ? {type: file.mimeType} : undefined)
    return URL.createObjectURL(blob)
  }, [file])

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  const kind = file.mimeType?.split('/')[0]
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {objectUrl && kind === 'image' ? (
        <img src={objectUrl} alt={file.path} className="max-h-full max-w-full rounded-md object-contain" />
      ) : objectUrl && kind === 'video' ? (
        <video src={objectUrl} controls className="max-h-full max-w-full rounded-md" />
      ) : objectUrl && kind === 'audio' ? (
        <audio src={objectUrl} controls className="w-full max-w-md" />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <FileText className="text-muted-foreground size-8" />
          <SizableText size="sm" color="muted">
            No preview for this file type{file.mimeType ? ` (${file.mimeType})` : ''}. Use the download button to save
            it.
          </SizableText>
        </div>
      )}
    </div>
  )
}

function MemoryEntryRow({
  entry,
  selected,
  confirmingDelete,
  deleting,
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
  onSelect: () => void
  onRequestDelete: () => void
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
        <span className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
          <Folder className="size-3.5 flex-none" />
          <span className="truncate font-mono text-xs">{name}</span>
        </span>
      ) : (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left" onClick={onSelect}>
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
      ) : (
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`Delete ${entry.path}`}
          className="flex-none opacity-0 group-hover:opacity-100"
          onClick={onRequestDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

/** True when a drag event carries OS files (rather than in-app text/element drags). */
function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
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
