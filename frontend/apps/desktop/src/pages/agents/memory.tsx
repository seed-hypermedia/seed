import type {AgentMemoryEntry} from '@/agents-client'
import {useAgentMemory, useAgentMemoryFile, useDeleteAgentMemoryFile, useWriteAgentMemoryFile} from '@/models/agents'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {FilePlus, FileText, Folder, RotateCcw, Save, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'

/**
 * The agent Memory tab: a browser/editor for the agent's private persistent filesystem.
 * The same files are read and written by the agent's `memory_*` session tools, so this
 * gives the user full visibility and control over what the agent remembers.
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [newFilePath, setNewFilePath] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)
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
      setShowNewFile(false)
      selectFile(path.replace(/^\/+/, ''))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create memory file')
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

  const dirty = draftText !== null && draftText !== (file.data?.content ?? '')

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
        <Button variant="outline" size="sm" onClick={() => setShowNewFile((current) => !current)}>
          <FilePlus className="mr-2 size-4" /> New file
        </Button>
      </div>

      {showNewFile ? (
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
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewFile(false)}>
            Cancel
          </Button>
        </form>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="border-border bg-card flex w-64 flex-none flex-col overflow-y-auto rounded-xl border p-2">
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
              No memory yet. The agent stores files here as it works, and you can add files for it to find.
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
              />
            ))
          )}
        </div>

        <div className="border-border bg-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
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
          ) : (
            <>
              <div className="border-border flex items-center gap-2 border-b px-3 py-2">
                <FileText className="text-muted-foreground size-4 flex-none" />
                <SizableText size="sm" weight="bold" className="min-w-0 flex-1 truncate font-mono">
                  {selectedPath}
                </SizableText>
                {file.data ? (
                  <SizableText size="xs" color="muted" className="flex-none">
                    {formatBytes(dirty ? new TextEncoder().encode(draftText ?? '').byteLength : file.data.size)}
                    {file.data.updatedAt ? ` · ${formattedDateMedium(new Date(file.data.updatedAt))}` : ''}
                  </SizableText>
                ) : null}
                {dirty ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-none"
                    onClick={() => setDraftText(null)}
                    disabled={writeFile.isLoading}
                  >
                    <RotateCcw className="mr-1 size-3.5" /> Revert
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  className="flex-none"
                  onClick={() => void handleSave()}
                  disabled={!dirty || writeFile.isLoading}
                >
                  <Save className="mr-1 size-3.5" /> {writeFile.isLoading ? 'Saving…' : 'Save'}
                </Button>
              </div>
              <textarea
                aria-label={`Memory file ${selectedPath}`}
                className="focus:ring-primary/25 min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none focus:ring-2"
                value={draftText ?? file.data?.content ?? ''}
                onChange={(event) => setDraftText(event.currentTarget.value)}
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </section>
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
}: {
  entry: AgentMemoryEntry
  selected: boolean
  confirmingDelete: boolean
  deleting: boolean
  onSelect: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const depth = entry.path.split('/').length - 1
  const name = entry.path.split('/').at(-1) || entry.path
  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-1 py-0.5 ${
        selected ? 'bg-primary/10' : 'hover:bg-muted/60'
      }`}
      style={{paddingLeft: `${4 + depth * 14}px`}}
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
