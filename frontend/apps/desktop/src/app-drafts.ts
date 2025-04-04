import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {
  HMDocumentMetadataSchema,
  HMDraft,
  HMDraftContent,
  HMDraftContentSchema,
  HMListedDraft,
  HMListedDraftSchema,
} from '@shm/shared/hm-types'
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

export async function initDrafts() {
  await fs.mkdir(draftsDir, {recursive: true})
  if (!(await fs.stat(draftIndexPath).catch(() => false))) {
    // index does not exist yet!
    // so we need to create the index. either because this is a fresh install, or because the user has migrated to a new version
    const allDraftFiles = await fs.readdir(draftsDir)
    const newDraftIndex: HMListedDraft[] = []
    const allDraftIds = allDraftFiles
      .filter((item) => item.match('.json'))
      .map(draftFileNameToId)
    console.log('Will migrate drafts', allDraftIds)
    for (const draftId of allDraftIds) {
      const oldDraftPath = join(
        draftsDir,
        `${Buffer.from(draftId).toString('base64')}.json`,
      )
      const draftDataJSON = await fs.readFile(oldDraftPath, 'utf-8')
      const draftData = JSON.parse(draftDataJSON)
      // legacy draft ids might start with hm:// or nothing
      const draftHmId = unpackHmId(draftId) || hmId('d', draftId)
      const lastPathTerm = draftHmId.path?.at(-1)
      const isNewChild = !!lastPathTerm?.startsWith('_')
      const newDraftId = nanoid(10)
      const {metadata, previousId, lastUpdateTime, members, ...restDraft} =
        draftData

      let deps: string[] = []
      let editPath: string[] | undefined = undefined
      let editUid: string | undefined = undefined

      if (previousId && !isNewChild) {
        editUid = previousId.uid
        editPath = previousId.path || []
      }
      if (!editUid && !isNewChild) {
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
      const indexedDraft: HMListedDraft = {
        id: newDraftId,
        locationUid: isNewChild ? draftHmId.uid : undefined,
        locationPath: isNewChild
          ? draftHmId.path?.slice(0, -1) || []
          : undefined,
        editUid,
        editPath,
        metadata,
        lastUpdateTime,
      }
      const newDraft = {
        ...restDraft,
        deps,
      }
      await fs.unlink(oldDraftPath)
      await fs.writeFile(
        join(draftsDir, `${newDraftId}.json`),
        JSON.stringify(newDraft, null, 2),
      )

      newDraftIndex.push(indexedDraft)
    }
    console.log('Migrating Draft Index', newDraftIndex)
    draftIndex = newDraftIndex
    await saveDraftIndex()
  } else {
    // draftIndexPath exits!
    const draftIndexJSON = await fs.readFile(draftIndexPath, 'utf-8')
    draftIndex = z.array(HMListedDraftSchema).parse(
      JSON.parse(draftIndexJSON).map((item: any) => {
        return {
          ...item,
          locationId: item.locationUid
            ? hmId('d', item.locationUid, {path: item.locationPath})
            : undefined,
          editId: item.editUid
            ? hmId('d', item.editUid, {path: item.editPath})
            : undefined,
        }
      }),
    )

    console.log('Loaded Draft Index', draftIndex)
  }
}

async function saveDraftIndex() {
  await fs.writeFile(draftIndexPath, JSON.stringify(draftIndex, null, 2))
}

function draftFileNameToId(filename: string) {
  const baseName = filename.replace(/\.json$/, '')
  const id = Buffer.from(baseName, 'base64').toString('utf-8')
  return id
}

export const draftsApi = t.router({
  list: t.procedure.query((): HMListedDraft[] => {
    return (
      draftIndex?.map((d) => ({
        ...d,
        locationId: d.locationUid
          ? hmId('d', d.locationUid, {path: d.locationPath})
          : undefined,
        editId: d.editUid
          ? hmId('d', d.editUid, {path: d.editPath})
          : undefined,
      })) || []
    )
  }),
  listAccount: t.procedure
    .input(z.string().optional())
    .query(({input}): HMListedDraft[] => {
      if (!input) return []
      // TODO: do we need to add editUid and editPath to the filter??
      return (
        draftIndex
          ?.filter(
            (d) =>
              !!input &&
              ((d.locationUid && d.locationUid === input) ||
                (d.editUid && d.editUid === input)),
          )
          .map((d) => ({
            ...d,
            locationId: d.locationUid
              ? hmId('d', d.locationUid, {path: d.locationPath})
              : undefined,
            editId: d.editUid
              ? hmId('d', d.editUid, {path: d.editPath})
              : undefined,
          })) || []
      )
    }),
  get: t.procedure
    .input(z.string().optional())
    .query(async ({input: draftId}) => {
      if (!draftId) return null
      const draftPath = join(draftsDir, `${draftId}.json`)

      try {
        const draftIndexEntry = draftIndex?.find((d) => d.id === draftId)
        if (!draftIndexEntry) return null
        const fileContent = await fs.readFile(draftPath, 'utf-8')

        const draft = JSON.parse(fileContent)
        const resultDraft: HMDraft = {
          ...draftIndexEntry,
          ...draft,
          editId: draftIndexEntry.editUid
            ? hmId('d', draftIndexEntry.editUid, {
                path: draftIndexEntry.editPath,
              })
            : undefined,
          locationId: draftIndexEntry.locationUid
            ? hmId('d', draftIndexEntry.locationUid, {
                path: draftIndexEntry.locationPath,
              })
            : undefined,
        }
        return resultDraft
      } catch (e) {
        error('[DRAFT]: Error when getting draft', {draftId, error: e})
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
      }),
    )
    .mutation(async ({input}) => {
      if (!draftIndex) {
        throw Error('[DRAFT]: Draft Index not initialized')
      }

      const draftId = input.id || nanoid(10)
      const draftPath = join(draftsDir, `${draftId}.json`)

      draftIndex = [
        ...draftIndex.filter((d) => d.id !== draftId),
        {
          id: draftId,
          locationUid: input.locationUid,
          locationPath: input.locationPath,
          editUid: input.editUid,
          editPath: input.editPath,
          metadata: input.metadata,
          lastUpdateTime: Date.now(),
        },
      ]
      await saveDraftIndex()
      const draft: HMDraftContent = {
        content: input.content,
        signingAccount: input.signingAccount,
        deps: input.deps,
      }

      // Validate draft content
      HMDraftContentSchema.parse(draft)

      try {
        console.log(
          `=== DRAFT WRITE input: ${input.id}`,
          JSON.stringify(draft, null, 2),
        )
        await fs.writeFile(draftPath, JSON.stringify(draft, null, 2))

        appInvalidateQueries(['trpc.drafts.list'])
        appInvalidateQueries(['trpc.drafts.listAccount'])
        return {id: draftId}
      } catch (error) {
        throw Error(
          `[DRAFT]: Error writing draft: ${JSON.stringify(error, null)}`,
        )
      }
    }),
  delete: t.procedure.input(z.string()).mutation(async ({input}) => {
    draftIndex = draftIndex?.filter((d) => d.id !== input)
    await saveDraftIndex()
    const draftPath = join(draftsDir, `${input}.json`)
    try {
      await fs.unlink(draftPath)
      appInvalidateQueries(['trpc.drafts.list'])
      appInvalidateQueries(['trpc.drafts.listAccount'])
    } catch (e) {
      error('[DRAFT]: Error deleting draft', {input: input, error: e})
    }
  }),
})
