import type {AgentMemoryEntry, AgentMemoryFile} from './client'
import {
  uploadFileToAgentServer,
  useAgentMemoryDirs,
  useAgentMemoryFile,
  useDeleteAgentMemoryFile,
  useDownloadAgentMemoryFile,
  useUploadAgentMemoryFileToIpfs,
  useWriteAgentMemoryFile,
} from './models'
import {describeAgentError} from './errors'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {DialogTitle} from '@shm/ui/components/dialog'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Spinner} from '@shm/ui/spinner'
import {Notice} from '@shm/ui/notice'
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
  Info,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {useMedia} from '@shm/ui/use-media'
import {readAgentMemoryTabState, writeAgentMemoryTabState} from './memory-tab-state'

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
  // Phones keep the tree stacked above the file; anything wider gets side-by-side panes whose
  // divider drags, with the split remembered per browser (PanelGroup autoSaveId → localStorage).
  const media = useMedia()
  const stacked = media.xs
  // Where the user left this browser last time (memory-tab-state.ts): the tab unmounts on every
  // tab switch, so the open file, expanded folders, and scroll offsets are picked up from here.
  // A file named in the route (openPath) takes precedence over the remembered selection.
  const [restored] = useState(() => readAgentMemoryTabState(serverUrl, agentId))
  /** Directories currently expanded in the tree; everything starts collapsed. */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(restored?.expandedDirs ?? []))
  // The tree loads one directory level per query — the root plus each expanded directory — so a
  // huge memory never needs a full recursive walk. Levels refresh over the WebSocket: every memory
  // mutation invalidates these queries, so there is no polling.
  const dirPaths = useMemo(() => ['', ...Array.from(expandedDirs).sort()], [expandedDirs])
  const dirQueries = useAgentMemoryDirs(serverUrl, accountUid, agentId, dirPaths)
  const rootQuery = dirQueries[0]
  /** Loaded listing per directory path; a collapsed-then-reexpanded dir serves from cache. */
  const loadedLevels = useMemo(() => {
    const levels = new Map<string, {entries: AgentMemoryEntry[]; totalBytes: number}>()
    dirQueries.forEach((query, index) => {
      const path = dirPaths[index]
      if (query.data && path !== undefined) levels.set(path, query.data)
    })
    return levels
  }, [dirQueries, dirPaths])
  /** Union of all loaded levels, sorted so the flat tree renders parents before children. */
  const entries = useMemo(() => {
    const merged: AgentMemoryEntry[] = []
    loadedLevels.forEach((level) => merged.push(...level.entries))
    merged.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return merged
  }, [loadedLevels])
  /** Expanded directories whose listing has not arrived yet, for the loading rows. */
  const loadingDirs = useMemo(() => {
    const loading = new Set<string>()
    dirQueries.forEach((query, index) => {
      const path = dirPaths[index]
      if (path && !query.data && !query.isError) loading.add(path)
    })
    return loading
  }, [dirQueries, dirPaths])
  const writeFile = useWriteAgentMemoryFile(serverUrl, accountUid)
  const deleteFile = useDeleteAgentMemoryFile(serverUrl, accountUid)
  const downloadFromWeb = useDownloadAgentMemoryFile(serverUrl, accountUid)
  const uploadToIpfs = useUploadAgentMemoryFileToIpfs(serverUrl, accountUid)
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    openPath ? null : restored?.selectedPath ?? null,
  )
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
  const uploadInputRef = useRef<HTMLInputElement>(null)
  // Reading a file pulls its full bytes over the wire; very large files (multi-hundred-MB
  // uploads) would stall or crash the preview, so those render a size card instead of fetching.
  const selectedEntry = entries.find((entry) => entry.type === 'file' && entry.path === selectedPath)
  const selectedTooLarge = (selectedEntry?.size ?? 0) > MAX_MEMORY_PREVIEW_BYTES
  const file = useAgentMemoryFile(
    serverUrl,
    accountUid,
    agentId,
    selectedTooLarge ? undefined : selectedPath ?? undefined,
  )

  const totals = rootQuery?.data?.totals
  const memoryInfoDialog = useAppDialog(MemoryInfoDialog)
  const entryInfoDialog = useAppDialog(MemoryEntryInfoDialog)

  // Scroll offsets live in refs (a scroll is not a render) and are written with the rest of the
  // state: on every selection/expansion change, shortly after each scroll, and on unmount.
  const treeScrollRef = useRef<HTMLDivElement>(null)
  const fileScrollRef = useRef<HTMLTextAreaElement>(null)
  const scrollTopsRef = useRef({tree: restored?.treeScrollTop ?? 0, file: restored?.fileScrollTop ?? 0})
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef({selectedPath, expandedDirs})
  latestRef.current = {selectedPath, expandedDirs}
  function persistTabState() {
    writeAgentMemoryTabState(serverUrl, agentId, {
      selectedPath: latestRef.current.selectedPath,
      expandedDirs: Array.from(latestRef.current.expandedDirs),
      treeScrollTop: scrollTopsRef.current.tree,
      fileScrollTop: scrollTopsRef.current.file,
    })
  }
  function persistTabStateSoon() {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(persistTabState, 250)
  }
  useEffect(() => {
    persistTabState()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist reads the latest state via refs
  }, [serverUrl, agentId, selectedPath, expandedDirs])
  useEffect(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTabState()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
    [],
  )
  // The remembered selection should also be the route's, so the URL stays copyable and a later
  // listing refresh treats it like any opened file (see the openPath effect below).
  useEffect(() => {
    if (!openPath && restored?.selectedPath) onOpenPathChange?.(restored.selectedPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])
  // Restore the tree scroll once every remembered folder has loaded: earlier, the tree is shorter
  // than the offset and the browser would clamp it.
  const treeScrollRestoredRef = useRef(!restored)
  useLayoutEffect(() => {
    if (treeScrollRestoredRef.current || !rootQuery?.data || loadingDirs.size) return
    treeScrollRestoredRef.current = true
    return restoreScrollTop(treeScrollRef.current, scrollTopsRef.current.tree)
  }, [rootQuery?.data, loadingDirs])
  // Same for the file: once its text is in the textarea. Only the remembered file gets the offset;
  // a different selection starts at the top.
  const fileScrollRestoredRef = useRef(!restored?.selectedPath)
  useLayoutEffect(() => {
    if (fileScrollRestoredRef.current || !file.data || selectedPath !== restored?.selectedPath) return
    fileScrollRestoredRef.current = true
    return restoreScrollTop(fileScrollRef.current, scrollTopsRef.current.file)
  }, [file.data, selectedPath, restored?.selectedPath])
  const visibleEntries = entries.filter((entry) => isPathVisible(entry.path, expandedDirs))

  // Drop the selection when the selected file disappears from its directory's listing (e.g. the
  // agent or another window deleted it). Only a loaded parent level can prove absence.
  useEffect(() => {
    if (!selectedPath) return
    const parentLevel = loadedLevels.get(parentDirPath(selectedPath))
    if (!parentLevel) return
    if (!parentLevel.entries.some((entry) => entry.type === 'file' && entry.path === selectedPath)) {
      setSelectedPath(null)
      setDraftText(null)
    }
  }, [loadedLevels, selectedPath])

  function selectFile(path: string) {
    if (path !== selectedPath) {
      scrollTopsRef.current.file = 0
      fileScrollRestoredRef.current = true
    }
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
  // path — a later refresh of the listing must not yank the user back off whatever they opened
  // next. Ancestors expand first so their levels load; the file-or-directory decision waits for
  // the parent level, which also keeps a directory link from being opened as if it were a file.
  const openedPathRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!openPath || openedPathRef.current === openPath) return
    revealPath(openPath)
    const parentLevel = loadedLevels.get(parentDirPath(openPath))
    if (!parentLevel) return
    openedPathRef.current = openPath
    if (parentLevel.entries.some((entry) => entry.path === openPath && entry.type === 'dir')) {
      setExpandedDirs((current) => new Set(current).add(openPath))
      return
    }
    selectFile(openPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one reveal per requested path
  }, [openPath, loadedLevels])

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

  const treePane = (
    <div
      ref={treeScrollRef}
      onScroll={(event) => {
        scrollTopsRef.current.tree = event.currentTarget.scrollTop
        persistTabStateSoon()
      }}
      className={`flex h-full min-h-0 w-full flex-col overflow-y-auto p-2 ${
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
      {!rootQuery || rootQuery.isLoading ? (
        <div className="flex items-center justify-center p-4">
          <Spinner />
        </div>
      ) : rootQuery.isError ? (
        <MemoryLoadNotice
          error={rootQuery.error}
          failed="Couldn’t load memory"
          onRetry={() => void rootQuery.refetch()}
          retryPending={rootQuery.isFetching}
          className="m-2"
        />
      ) : entries.length === 0 ? (
        <SizableText size="sm" color="muted" className="p-2">
          No memory yet. The agent stores files here as it works, and you can add files for it to find — or drop files
          here.
        </SizableText>
      ) : (
        visibleEntries.map((entry) => (
          <MemoryEntryRow
            key={entry.path}
            entry={entry}
            loadingChildren={entry.type === 'dir' && expandedDirs.has(entry.path) && loadingDirs.has(entry.path)}
            selected={entry.type === 'file' && entry.path === selectedPath}
            confirmingDelete={confirmDeletePath === entry.path}
            expanded={entry.type === 'dir' && expandedDirs.has(entry.path)}
            onToggle={entry.type === 'dir' ? () => toggleDir(entry.path) : undefined}
            onSelect={() => (entry.type === 'file' ? selectFile(entry.path) : undefined)}
            onRequestDelete={readOnly ? undefined : () => setConfirmDeletePath(entry.path)}
            onCancelDelete={() => setConfirmDeletePath(null)}
            onConfirmDelete={() => void handleDelete(entry.path)}
            onShowInfo={() =>
              entryInfoDialog.open({entry, level: entry.type === 'dir' ? loadedLevels.get(entry.path) : undefined})
            }
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
  )

  const filePane = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
        <div className="flex flex-1 items-start justify-center p-4">
          <MemoryLoadNotice
            error={file.error}
            failed="Couldn’t read this file"
            onRetry={() => void file.refetch()}
            retryPending={file.isFetching}
            className="w-full max-w-md"
          />
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
              ref={fileScrollRef}
              onScroll={(event) => {
                scrollTopsRef.current.file = event.currentTarget.scrollTop
                persistTabStateSoon()
              }}
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
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {memoryInfoDialog.content}
        {entryInfoDialog.content}
        {!readOnly ? (
          <>
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
          </>
        ) : null}
        <OptionsDropdown
          align="end"
          ariaLabel="Memory options"
          menuItems={[
            {
              key: 'memory-info',
              label: 'Memory Info',
              icon: <Info className="size-4" />,
              onClick: () =>
                memoryInfoDialog.open({
                  totals,
                  rootEntries: rootQuery?.data?.entries ?? [],
                  loading: !rootQuery || rootQuery.isLoading,
                  readOnly,
                }),
            },
          ]}
        />
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

      {stacked ? (
        <div className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
          <div className="border-border max-h-56 flex-none border-b">{treePane}</div>
          {filePane}
        </div>
      ) : (
        <PanelGroup
          direction="horizontal"
          autoSaveId="agent-memory-panes"
          className="border-border bg-card min-h-0 flex-1 overflow-hidden rounded-xl border"
        >
          <Panel id="agent-memory-tree" order={1} defaultSize={25} minSize={12} maxSize={60}>
            {treePane}
          </Panel>
          <PanelResizeHandle className="panel-resize-handle visible" />
          <Panel id="agent-memory-file" order={2} minSize={40}>
            {filePane}
          </Panel>
        </PanelGroup>
      )}
    </section>
  )
}

/**
 * "Memory Info": what the header line used to say, on demand. The rollup comes from the root
 * listing's bounded walk, so counts and bytes read as minimums (with a trailing +) when the walk
 * was cut short; the top-level breakdown and latest change come from the root entries themselves.
 */
function MemoryInfoDialog({
  input,
}: {
  input: {
    totals?: {files: number; bytes: number; truncated: boolean}
    rootEntries: AgentMemoryEntry[]
    loading: boolean
    readOnly: boolean
  }
  onClose: () => void
}) {
  const {totals, rootEntries, loading, readOnly} = input
  const plus = totals?.truncated ? '+' : ''
  const folders = rootEntries.filter((entry) => entry.type === 'dir')
  const rootFiles = rootEntries.filter((entry) => entry.type === 'file')
  const latest = rootEntries.reduce<number>((max, entry) => Math.max(max, entry.updatedAt), 0)
  const rows: [string, string][] = [
    ['Files', loading ? '…' : totals ? `${totals.files}${plus}` : '—'],
    ['Size', loading ? '…' : totals ? `${formatBytes(totals.bytes)}${plus}` : '—'],
    [
      'Top level',
      loading
        ? '…'
        : `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${rootFiles.length} file${
            rootFiles.length === 1 ? '' : 's'
          }`,
    ],
    ['Last changed', loading ? '…' : latest ? formattedDateMedium(new Date(latest)) : '—'],
    ['Your access', readOnly ? 'Read-only' : 'Read and write'],
  ]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <DialogTitle>Memory Info</DialogTitle>
      </div>
      <SizableText size="sm" color="muted">
        Private files this agent reads and writes across sessions, through its own tools and this page.
      </SizableText>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate">{value}</dd>
          </div>
        ))}
      </dl>
      {totals?.truncated ? (
        <SizableText size="xs" color="muted">
          The memory is large, so counts and size are minimums from a bounded scan.
        </SizableText>
      ) : null}
    </div>
  )
}

/**
 * Renders binary memory files: inline previews for images (including animated GIFs), video, and
 * audio, and a download-first card for every other binary type.
 */
function BinaryFilePreview({file, onDownload}: {file: AgentMemoryFile; onDownload: () => void}) {
  // The object URL is created and revoked by the same effect. Creating it during render and
  // revoking in a cleanup looked equivalent, but StrictMode's mount → cleanup → mount pass revoked
  // the URL the <img> was still loading from, so the first image after mount never appeared.
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.data || !file.data.byteLength) {
      setObjectUrl(null)
      return
    }
    const blob = new Blob([new Uint8Array(file.data)], file.mimeType ? {type: file.mimeType} : undefined)
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

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
  loadingChildren,
  onToggle,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onShowInfo,
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
  /** True while this expanded directory's listing is still loading. */
  loadingChildren?: boolean
  /** Collapses/expands this directory. */
  onToggle?: () => void
  onSelect: () => void
  onRequestDelete?: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  /** Opens the file/folder info dialog for this entry. */
  onShowInfo: () => void
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
          {loadingChildren ? <Spinner className="ml-1 size-3 flex-none" /> : null}
        </button>
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left max-sm:min-h-10"
          onClick={onSelect}
        >
          {/* Chevron-width gutter so file icons line up with sibling folder icons. */}
          <span className="size-3 flex-none" aria-hidden />
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
        <OptionsDropdown
          size="iconSm"
          align="end"
          ariaLabel={`Options for ${entry.path}`}
          className="flex-none opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          triggerClassName="border-transparent bg-transparent shadow-none"
          menuItems={[
            {
              key: 'info',
              label: entry.type === 'dir' ? 'Folder info' : 'File info',
              icon: <Info className="size-4" />,
              onClick: onShowInfo,
            },
            onRequestDelete
              ? {
                  key: 'delete',
                  label: 'Delete',
                  icon: <Trash2 className="size-4" />,
                  variant: 'destructive' as const,
                  onClick: onRequestDelete,
                }
              : null,
          ]}
        />
      )}
    </div>
  )
}

/** File/folder info for one tree entry: what the row's size label and tooltip used to carry, and more. */
function MemoryEntryInfoDialog({
  input,
}: {
  input: {entry: AgentMemoryEntry; level?: {entries: AgentMemoryEntry[]; totalBytes: number}}
  onClose: () => void
}) {
  const {entry, level} = input
  const isDir = entry.type === 'dir'
  const name = entry.path.split('/').at(-1) || entry.path
  const rows: [string, string][] = [
    ['Name', name],
    ['Path', `~/memory/${entry.path}`],
    ['Type', isDir ? 'Folder' : entry.mimeType || 'File'],
  ]
  if (isDir) {
    const count = level ? level.entries.length : entry.entryCount
    if (count !== undefined) rows.push(['Items', `${count} item${count === 1 ? '' : 's'}`])
    if (level) rows.push(['Size of files inside', formatBytes(level.totalBytes)])
  } else {
    rows.push(['Size', formatBytes(entry.size)])
  }
  if (entry.updatedAt) rows.push(['Modified', formattedDateMedium(new Date(entry.updatedAt))])
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <DialogTitle>{isDir ? 'Folder info' : 'File info'}</DialogTitle>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground whitespace-nowrap">{label}</dt>
            <dd className="min-w-0 font-mono text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {isDir && !level ? (
        <SizableText size="xs" color="muted">
          Expand the folder to see the size of the files inside.
        </SizableText>
      ) : null}
    </div>
  )
}

/**
 * Puts a scroll container back at a remembered offset once its box has settled.
 *
 * The panes sit in a resizable panel group that applies its saved sizes in a re-render after the
 * first commit, and the file text is often served from cache on that very first render. Setting
 * the offset right then measures against a pane of the wrong width (different wrapping, so the
 * same pixels mean a different line) or no height at all (clamped to 0). Two frames later the
 * layout is final; the second pass re-asserts the offset in case the first was clamped.
 * Returns a cleanup that cancels the pending frames.
 */
function restoreScrollTop(element: HTMLElement | null, top: number): () => void {
  if (!element) return () => {}
  let frame = requestAnimationFrame(() => {
    element.scrollTop = top
    frame = requestAnimationFrame(() => {
      if (element.scrollTop !== top) element.scrollTop = top
    })
  })
  return () => cancelAnimationFrame(frame)
}

/** Directory path holding `path`: '' for root-level entries. */
function parentDirPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
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

function MemoryLoadNotice({
  error,
  failed,
  onRetry,
  retryPending,
  className,
}: {
  error: unknown
  failed: string
  onRetry: () => void
  retryPending: boolean
  className?: string
}) {
  const notice = describeAgentError(error, {failed})
  return (
    <Notice
      size="sm"
      tone={notice.tone}
      title={notice.title}
      onRetry={onRetry}
      retryPending={retryPending}
      className={className}
    >
      {notice.detail}
    </Notice>
  )
}
