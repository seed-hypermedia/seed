import {
  HMDocumentMetadataSchema,
  HMDraft,
  HMDraftContent,
  HMDraftContentSchema,
  HMListedDraft,
  HMListedDraftReadSchema,
  HMMetadata,
  HMNavigationItemSchema,
  HMResourceVisibilitySchema,
} from '@seed-hypermedia/client/hm-types'
import {parseDraftFilename} from '@seed-hypermedia/client/blocks-to-markdown'
import {parseMarkdown} from '@seed-hypermedia/client/markdown-to-blocks'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {hmIdPathToEntityQueryPath, pathMatches} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import fs from 'fs/promises'
import {nanoid} from 'nanoid'
import {join} from 'path'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {grpcClient} from './grpc-client'
import {error} from './logger'

/**
 * new draft creation:
 * - draft route params:
 *   - draftId?: string
 *   - locationId?: UnpackedHMId
 *   - editId?: UnpackedHMId
 *
 * - use cases:
 * 1. new draft from the sidebar button:
 * - everything is undefined
 * - need to load the editor with no content
 *
 * 2. new draft from location:
 * - locationUId is defined
 * - locationPath is defined (optional)
 * - editId is empty
 * - draftId is empty
 *
 * 3. new draft from edit:
 * - editUId is defined
 * - locationId is empty`
 * - draftId is empty
 *
 * 4. open draft:
 * - draftId is defined
 * - open the draft from the middle end
 *
 * after the first edit, we create the draft with the correct info in the draft state and replace the route with the draftId ONLY
 *
 * DraftMeta
 * - if the draftMeta has editUId and editPath, we don't show the publish dialog when the user clicks
 */

const draftsDir = join(userDataPath, 'drafts')
const draftIndexPath = join(draftsDir, 'index.json')

let draftIndex: HMListedDraft[] | undefined = undefined

/**
 * Map from draft ID → filename on disk.
 * Needed because filenames include a slug prefix that can change.
 */
let draftFileMap: Map<string, string> = new Map()

export async function initDrafts() {
  await fs.mkdir(draftsDir, {recursive: true})
  const oldDraftsToRm: string[] = []
  const newDraftIndex: HMListedDraft[] = []

  async function migrateDraft(draftData: any, draftId: string | undefined, oldDraftPath: string) {
    // legacy draft ids might start with hm:// or nothing
    const draftHmId = draftId ? unpackHmId(draftId) || hmId(draftId) : undefined
    const lastPathTerm = draftHmId?.path?.at(-1)
    const isNewChild = !!lastPathTerm && lastPathTerm.startsWith('_')
    const newDraftId = nanoid(10)
    const {metadata, previousId, lastUpdateTime, members, visibility, ...restDraft} = draftData

    let deps: string[] = []
    let editPath: string[] | undefined = undefined
    let editUid: string | undefined = undefined

    if (previousId && !isNewChild) {
      editUid = previousId.uid
      editPath = previousId.path || []
    }
    if (draftHmId && !editUid && !isNewChild) {
      editUid = draftHmId.uid
      editPath = draftHmId.path || []
    }
    if (editUid && !deps?.length) {
      try {
        const doc = await grpcClient.documents.getDocument({
          account: editUid,
          path: hmIdPathToEntityQueryPath(editPath || []),
        })
        deps = doc.version.split('.')
      } catch (e) {
        // @ts-expect-error
        if (e.message.match('document not found')) {
          console.error('deps edit doc not found')
          editUid = undefined
          editPath = undefined
        } else {
          console.error('Error getting deps edit doc', e)
          throw e
        }
      }
    }
    const locationUid = isNewChild ? draftHmId?.uid : undefined
    const locationPath = isNewChild ? draftHmId?.path?.slice(0, -1) || [] : undefined

    // Skip invalid legacy drafts that have neither locationUid nor editUid
    if (!editUid && !locationUid) {
      console.warn(`Skipping invalid legacy draft: ${oldDraftPath} (no location or edit)`)
      oldDraftsToRm.push(oldDraftPath)
      return
    }

    const indexedDraft = {
      id: newDraftId,
      locationUid,
      locationPath,
      editUid,
      editPath,
      metadata: metadata || {},
      lastUpdateTime: lastUpdateTime || Date.now(),
      visibility: visibility || 'PUBLIC',
      deps,
      navigation: undefined,
    } as HMListedDraft
    const newDraft = {
      ...restDraft,
      deps,
    }
    await fs.writeFile(join(draftsDir, `${newDraftId}.json`), JSON.stringify(newDraft, null, 2))
    newDraftIndex.push(indexedDraft)
    oldDraftsToRm.push(oldDraftPath)
  }
  if (!(await fs.stat(draftIndexPath).catch(() => false))) {
    // index does not exist yet!
    // so we need to create the index. either because this is a fresh install, or because the user has migrated to a new version
    const allDraftFiles = await fs.readdir(draftsDir)
    console.log('Will migrate drafts: ', allDraftFiles)
    const oldDraftShortIds: string[] = []
    const oldDraftIds: string[] = []
    allDraftFiles
      .filter((item) => item.match('.json'))
      .forEach((draftPath) => {
        const baseName = draftPath.replace(/\.json$/, '')
        if (baseName.length === 10) {
          oldDraftShortIds.push(baseName)
        } else {
          const id = Buffer.from(baseName, 'base64').toString('utf-8')
          oldDraftIds.push(id)
        }
      })

    for (const draftId of oldDraftIds) {
      const oldDraftPath = join(draftsDir, `${Buffer.from(draftId).toString('base64')}.json`)
      const draftDataJSON = await fs.readFile(oldDraftPath, 'utf-8')
      const draftData = JSON.parse(draftDataJSON)
      await migrateDraft(draftData, draftId, oldDraftPath)
    }
    for (const draftId of oldDraftShortIds) {
      const oldDraftPath = join(draftsDir, `${draftId}.json`)
      const draftDataJSON = await fs.readFile(oldDraftPath, 'utf-8')
      const draftData = JSON.parse(draftDataJSON)
      await migrateDraft(draftData, undefined, oldDraftPath)
    }
    console.log('Migrating Draft Index', newDraftIndex)
    draftIndex = newDraftIndex
    await saveDraftIndex()
    // we can leave old drafts in place, they don't really harm anything and its possible we will need to recover data from them
  } else {
    // draftIndexPath exists!
    const draftIndexJSON = await fs.readFile(draftIndexPath, 'utf-8')
    const rawDrafts = JSON.parse(draftIndexJSON) as any[]

    // Warn about legacy drafts without location (they'll be treated as first publish)
    rawDrafts.forEach((item) => {
      if (!item.editUid && !item.locationUid) {
        console.warn(`Legacy draft without location: ${item.id} - will prompt for location on publish`)
      }
    })

    // Use looser schema for reading (no refinement) to preserve legacy drafts
    // Type assertion: legacy drafts may not satisfy strict HMListedDraft but publish UI handles it
    draftIndex = z.array(HMListedDraftReadSchema).parse(
      rawDrafts.map((item: any) => {
        return {
          ...item,
          metadata: fixDraftMetadata(item.metadata || {}),
          locationId: item.locationUid ? hmId(item.locationUid, {path: item.locationPath}) : undefined,
          editId: item.editUid ? hmId(item.editUid, {path: item.editPath}) : undefined,
        }
      }),
    ) as HMListedDraft[]
  }

  // Build the file map from disk
  await rebuildFileMap()
}

/**
 * Scan the drafts directory and build a map of draft ID → filename.
 * Also discovers new .md files not in the index (CLI-created drafts).
 */
async function rebuildFileMap() {
  let allFiles: string[]
  try {
    allFiles = await fs.readdir(draftsDir)
  } catch {
    return
  }

  draftFileMap.clear()
  const indexedIds = new Set(draftIndex?.map((d) => d.id) || [])
  let discovered = 0

  for (const file of allFiles) {
    const {id, ext} = parseDraftFilename(file)
    if (ext !== '.md' && ext !== '.json') continue
    if (file === 'index.json') continue

    // Prefer .json over .md when both exist — .json is the authoritative
    // format after desktop edits (the .md may be the original CLI file).
    if (draftFileMap.has(id) && ext === '.md') continue
    draftFileMap.set(id, file)

    // Discover .md files not in the index
    if (ext === '.md' && !indexedIds.has(id)) {
      try {
        const raw = await fs.readFile(join(draftsDir, file), 'utf-8')
        const {metadata} = parseMarkdown(raw)
        const stat = await fs.stat(join(draftsDir, file))

        // location/edit left undefined — user will be prompted on publish (same as legacy drafts)
        const entry = {
          id,
          metadata: fixDraftMetadata(metadata),
          lastUpdateTime: stat.mtimeMs,
          visibility: 'PUBLIC',
          deps: [],
        } as HMListedDraft

        draftIndex?.push(entry)
        indexedIds.add(id)
        discovered++
      } catch (e) {
        console.warn(`Failed to discover markdown draft ${file}:`, e)
      }
    }
  }

  if (discovered > 0) {
    console.log(`Discovered ${discovered} new markdown draft(s)`)
    await saveDraftIndex()
  }
}

/**
 * Quick check for new .md files not yet in the index.
 * Compares readdir() filenames against the index — only parses frontmatter
 * for genuinely new files. Called on each list query.
 */
async function discoverNewDrafts() {
  if (!draftIndex) return

  // Merge entries written to disk by CLI since last in-memory load.
  // This preserves CLI-set metadata (editUid, locationUid, etc.) that
  // would otherwise be lost when we create stripped-down entries from
  // parsing .md frontmatter below.
  try {
    const diskIndexJSON = await fs.readFile(draftIndexPath, 'utf-8')
    const diskEntries = JSON.parse(diskIndexJSON) as any[]
    const memoryIds = new Set(draftIndex.map((d) => d.id))
    for (const entry of diskEntries) {
      if (entry.id && !memoryIds.has(entry.id)) {
        draftIndex.push({
          ...entry,
          metadata: fixDraftMetadata(entry.metadata),
        } as HMListedDraft)
      }
    }
  } catch {}

  let allFiles: string[]
  try {
    allFiles = await fs.readdir(draftsDir)
  } catch {
    return
  }

  const indexedIds = new Set(draftIndex.map((d) => d.id))
  let discovered = 0

  for (const file of allFiles) {
    const {id, ext} = parseDraftFilename(file)
    if (ext !== '.md') continue
    if (indexedIds.has(id)) {
      // Update the file map in case the file was renamed (slug changed)
      draftFileMap.set(id, file)
      continue
    }

    try {
      const raw = await fs.readFile(join(draftsDir, file), 'utf-8')
      const {metadata} = parseMarkdown(raw)
      const stat = await fs.stat(join(draftsDir, file))

      const entry = {
        id,
        metadata: fixDraftMetadata(metadata),
        lastUpdateTime: stat.mtimeMs,
        visibility: 'PUBLIC',
        deps: [],
      } as HMListedDraft

      draftIndex.push(entry)
      draftFileMap.set(id, file)
      discovered++
    } catch (e) {
      console.warn(`Failed to discover markdown draft ${file}:`, e)
    }
  }

  if (discovered > 0) {
    console.log(`Discovered ${discovered} new markdown draft(s)`)
    await saveDraftIndex()
    appInvalidateQueries([queryKeys.DRAFTS_LIST])
    appInvalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  }
}

function fixDraftMetadata(metadata: any): HMMetadata {
  if (!metadata) return {}
  return {
    ...metadata,
    // a user had an error where icon and cover are null, which was failing validation and breaking app launch
    icon: metadata.icon || undefined,
    cover: metadata.cover || undefined,
  }
}

async function saveDraftIndex() {
  await fs.writeFile(draftIndexPath, JSON.stringify(draftIndex, null, 2))
}

/**
 * Resolve the filename on disk for a given draft ID.
 * Checks the file map first, then falls back to scanning common patterns.
 */
async function resolveDraftFile(draftId: string): Promise<{path: string; ext: string} | null> {
  // Check file map first
  const mapped = draftFileMap.get(draftId)
  if (mapped) {
    const fullPath = join(draftsDir, mapped)
    try {
      await fs.access(fullPath)
      const {ext} = parseDraftFilename(mapped)
      return {path: fullPath, ext}
    } catch {
      // File was deleted — clear from map
      draftFileMap.delete(draftId)
    }
  }

  // Fall back: try common patterns
  // 1. <nanoid>.md (simple)
  const simpleMd = join(draftsDir, `${draftId}.md`)
  try {
    await fs.access(simpleMd)
    draftFileMap.set(draftId, `${draftId}.md`)
    return {path: simpleMd, ext: '.md'}
  } catch {}

  // 2. <nanoid>.json (legacy)
  const legacyJson = join(draftsDir, `${draftId}.json`)
  try {
    await fs.access(legacyJson)
    draftFileMap.set(draftId, `${draftId}.json`)
    return {path: legacyJson, ext: '.json'}
  } catch {}

  // 3. Scan for <slug>_<nanoid>.md pattern
  try {
    const allFiles = await fs.readdir(draftsDir)
    for (const file of allFiles) {
      const {id, ext} = parseDraftFilename(file)
      if (id === draftId) {
        draftFileMap.set(draftId, file)
        return {path: join(draftsDir, file), ext}
      }
    }
  } catch {}

  return null
}

/**
 * Read a draft's content from disk. Supports both .md (new) and .json (legacy) formats.
 */
async function readDraftContent(draftId: string, indexEntry: HMListedDraft): Promise<HMDraftContent | null> {
  const file = await resolveDraftFile(draftId)
  if (!file) return null

  if (file.ext === '.md') {
    try {
      const raw = await fs.readFile(file.path, 'utf-8')
      const {tree} = parseMarkdown(raw)
      const editorBlocks = hmBlocksToEditorContent(tree)

      return {
        content: editorBlocks,
        deps: indexEntry.deps || [],
        navigation: indexEntry.navigation,
      }
    } catch (e) {
      console.error(`Failed to read markdown draft ${draftId}:`, e)
      return null
    }
  }

  // .json (legacy format)
  try {
    const fileContent = await fs.readFile(file.path, 'utf-8')
    return HMDraftContentSchema.parse(JSON.parse(fileContent))
  } catch (e) {
    console.error(`Failed to read json draft ${draftId}:`, e)
    return null
  }
}

export const draftsApi = t.router({
  list: t.procedure.query(async (): Promise<HMListedDraft[]> => {
    // Check for new CLI-created drafts on every list call
    await discoverNewDrafts()

    return (
      draftIndex?.map((d) => ({
        ...d,
        locationId: d.locationUid ? hmId(d.locationUid, {path: d.locationPath}) : undefined,
        editId: d.editUid ? hmId(d.editUid, {path: d.editPath}) : undefined,
      })) || []
    )
  }),
  listAccount: t.procedure.input(z.string().optional()).query(async ({input}): Promise<HMListedDraft[]> => {
    if (!input) return []

    // Check for new CLI-created drafts
    await discoverNewDrafts()

    return (
      draftIndex
        ?.filter((d) => !!input && ((d.locationUid && d.locationUid === input) || (d.editUid && d.editUid === input)))
        .map((d) => ({
          ...d,
          locationId: d.locationUid ? hmId(d.locationUid, {path: d.locationPath}) : undefined,
          editId: d.editUid ? hmId(d.editUid, {path: d.editPath}) : undefined,
        })) || []
    )
  }),
  findByEdit: t.procedure
    .input(
      z.object({
        editUid: z.string(),
        editPath: z.array(z.string()),
      }),
    )
    .query(({input}): HMListedDraft | null => {
      const found = draftIndex?.find(
        (d) => d.editUid === input.editUid && pathMatches(d.editPath || [], input.editPath),
      )
      return found || null
    }),
  get: t.procedure.input(z.string().optional()).query(async ({input: draftId}) => {
    if (!draftId) return null

    try {
      const draftIndexEntry = draftIndex?.find((d) => d.id === draftId)
      if (!draftIndexEntry) return null

      const draftContent = await readDraftContent(draftId, draftIndexEntry)
      if (!draftContent) return null

      const draft: HMDraft = {
        ...draftIndexEntry,
        ...draftContent,
        id: draftId,
      }
      return draft
    } catch (e) {
      console.error(`Failed to get draft ${draftId}`, e)
      return null
    }
  }),
  write: t.procedure
    .input(
      z.object({
        id: z.string(),
        locationUid: z.string().optional(),
        locationPath: z.string().array().optional(),
        editUid: z.string().optional(),
        editPath: z.string().array().optional(),
        metadata: HMDocumentMetadataSchema,
        content: z.any(),
        signingAccount: z.string().optional(),
        deps: z.array(z.string().min(1)).default([]),
        navigation: z.array(HMNavigationItemSchema).optional(),
        visibility: HMResourceVisibilitySchema,
        cursorPosition: z.number().optional(),
      }),
    )
    .mutation(async ({input}) => {
      if (!draftIndex) {
        throw Error('[DRAFT]: Draft Index not initialized')
      }

      const draftId = input.id || nanoid(10)

      // Build the index entry with deps and navigation included
      const newDraft = {
        id: draftId,
        locationUid: input.locationUid,
        locationPath: input.locationPath,
        editUid: input.editUid,
        editPath: input.editPath,
        metadata: input.metadata,
        lastUpdateTime: Date.now(),
        visibility: input.visibility,
        deps: input.deps,
        navigation: input.navigation,
      } as HMListedDraft

      draftIndex = [...draftIndex.filter((d) => d.id !== draftId), newDraft]
      await saveDraftIndex()

      // Save content as JSON (preserves all block types losslessly).
      // Markdown write path will be enabled once all block types can roundtrip.
      const draftPath = join(draftsDir, `${draftId}.json`)
      const draft: HMDraftContent = {
        content: input.content,
        // @ts-expect-error
        signingAccount: input.signingAccount,
        deps: input.deps,
        navigation: input.navigation,
        cursorPosition: input.cursorPosition,
      }

      HMDraftContentSchema.parse(draft)

      try {
        await fs.writeFile(draftPath, JSON.stringify(draft, null, 2))
        draftFileMap.set(draftId, `${draftId}.json`)
        appInvalidateQueries([queryKeys.DRAFTS_LIST])
        appInvalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
        appInvalidateQueries([queryKeys.DRAFT, draftId])
        return {id: draftId}
      } catch (err) {
        throw Error(`[DRAFT]: Error writing draft: ${JSON.stringify(err, null)}`)
      }
    }),
  delete: t.procedure.input(z.string()).mutation(async ({input}) => {
    draftIndex = draftIndex?.filter((d) => d.id !== input)
    await saveDraftIndex()

    // Remove the file from disk using the file map
    const filename = draftFileMap.get(input)
    if (filename) {
      try {
        await fs.unlink(join(draftsDir, filename))
      } catch {}
      draftFileMap.delete(input)
    }

    // Also try removing legacy patterns
    for (const ext of ['.md', '.json']) {
      try {
        await fs.unlink(join(draftsDir, `${input}${ext}`))
      } catch {}
    }

    appInvalidateQueries(['trpc.drafts.list'])
    appInvalidateQueries(['trpc.drafts.listAccount'])
  }),
})
