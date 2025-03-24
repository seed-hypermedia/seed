import {HMDraft, HMListedDraft} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import fs from 'fs/promises'
import {nanoid} from 'nanoid'
import {join} from 'path'
import z from 'zod'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {error} from './logger'

const draftsDir = join(userDataPath, 'drafts')
const draftIndexPath = join(draftsDir, 'index.json')

type DraftMeta = {
  id: string
  destinationUid?: string
  destinationPath?: string[]
  isNewChild?: boolean
}

let draftIndex: DraftMeta[] | undefined = undefined

export async function initDrafts() {
  await fs.mkdir(draftsDir, {recursive: true})
  if (!(await fs.stat(draftIndexPath).catch(() => false))) {
    // index does not exist yet!
    // so we need to create the index. either because this is a fresh install, or because the user has migrated to a new version
    await fs.readdir(draftsDir)
    const allDraftFiles = await fs.readdir(draftsDir)
    const allDraftIds = allDraftFiles
      .filter((item) => item.match('.json'))
      .map(draftFileNameToId)
    console.log('MUST MIGRATE DRAFTS', allDraftIds)
    // draftIndex = allDraftIds
    const newDraftIndex: {
      id: string
      destinationUid?: string
      destinationPath?: string[]
      isNewChild?: boolean
    }[] = []
    for (const draftId of allDraftIds) {
      const oldDraftPath = join(draftsDir, inputIdToDraftFile(draftId))
      const draftContentJSON = await fs.readFile(oldDraftPath, 'utf-8')
      // legacy draft ids might start with hm:// or nothing
      const draftHmId = unpackHmId(draftId) || hmId('d', draftId)
      const lastPathTerm = draftHmId.path?.at(-1)
      const isNewChild = !!lastPathTerm?.startsWith('_')
      const draftPath = isNewChild
        ? draftHmId?.path?.slice(0, -1)
        : draftHmId?.path
      console.log('Will Migrate Draft', draftId, draftHmId.id, {
        hasDraft: !!draftContentJSON,
        isNewChild,
        draftPath,
      })
      const newDraftId = nanoid(10)
      console.log('New Draft ID', newDraftId)
      await fs.rename(oldDraftPath, join(draftsDir, `${newDraftId}.json`))

      newDraftIndex.push({
        id: newDraftId,
        destinationUid: draftHmId.uid,
        destinationPath: draftPath || undefined,
        isNewChild,
      })
    }
    console.log('Writing Draft Index', newDraftIndex)
    draftIndex = newDraftIndex
    await saveDraftIndex()
  } else {
    // draftIndexPath exits!
    draftIndex = JSON.parse(await fs.readFile(draftIndexPath, 'utf-8'))
    console.log('Loaded Draft Index', draftIndex)
  }
}

async function saveDraftIndex() {
  await fs.writeFile(draftIndexPath, JSON.stringify(draftIndex, null, 2))
}

function inputIdToDraftFile(id: string) {
  const encodedId = Buffer.from(id).toString('base64')
  return `${encodedId}.json`
}

function draftFileNameToId(filename: string) {
  const baseName = filename.replace(/\.json$/, '')
  const id = Buffer.from(baseName, 'base64').toString('utf-8')
  return id
}

async function loadDraft(d: DraftMeta): Promise<HMListedDraft> {
  const draftPath = join(draftsDir, `${d.id}.json`)
  const fileContent = await fs.readFile(draftPath, 'utf-8')
  const draft = JSON.parse(fileContent) as HMDraft
  const targetId = d.destinationUid
    ? hmId('d', d.destinationUid, {
        path: d.destinationPath,
      })
    : undefined
  return {
    id: d.id,
    metadata: draft.metadata,
    lastUpdateTime: draft.lastUpdateTime,
    isNewChild: d.isNewChild,
    targetId,
  }
}

export const draftsApi = t.router({
  list: t.procedure.query(async () => {
    return draftIndex
  }),
  listFull: t.procedure.input(z.undefined()).query(async () => {
    return await Promise.all(draftIndex?.map(loadDraft) || [])
  }),
  listAccount: t.procedure
    .input(z.string().optional())
    .query(async ({input}) => {
      const drafts = await Promise.all(
        draftIndex
          ?.filter(
            (d) => !!input && d.destinationUid && d.destinationUid === input,
          )
          .map(loadDraft) || [],
      )
      return drafts satisfies HMListedDraft[]
    }),
  get: t.procedure.input(z.string().optional()).query(async ({input}) => {
    if (!input) return null
    const draftPath = join(draftsDir, inputIdToDraftFile(input))
    try {
      const draftIndexEntry = draftIndex?.find((d) => d.id === input)
      const fileContent = await fs.readFile(draftPath, 'utf-8')
      const draft = JSON.parse(fileContent)

      return {
        id: input,
        draft: draft as HMDraft,
        destinationUid: draftIndexEntry?.destinationUid,
        destinationPath: draftIndexEntry?.destinationPath,
        isNewChild: draftIndexEntry?.isNewChild,
      }
    } catch (e) {
      error('[DRAFT]: Error when getting draft', {input: input, error: e})
      return null
    }
  }),
  write: t.procedure
    .input(
      z.object({
        draft: z.any(), // TODO: zod for draft object?
        id: z.string().optional(),
        destinationUid: z.string().optional(),
        destinationPath: z.string().array().optional(),
        isNewChild: z.boolean().optional(),
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
          destinationUid: input.destinationUid,
          destinationPath: input.destinationPath,
          isNewChild: input.isNewChild,
        },
      ]
      await saveDraftIndex()
      try {
        await fs.writeFile(
          draftPath,
          JSON.stringify({...input.draft, lastUpdateTime: Date.now()}, null, 2),
        )
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
    } catch (e) {
      error('[DRAFT]: Error deleting draft', {input: input, error: e})
    }
  }),
})
