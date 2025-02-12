import {HMDraft} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import fs from 'fs/promises'
import {join} from 'path'
import z from 'zod'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {error, info} from './logger'

const draftsDir = join(userDataPath, 'drafts')

let draftIdList: string[] | undefined = undefined

async function initDrafts() {
  await fs.mkdir(draftsDir, {recursive: true})
  await fs.readdir(draftsDir)
  const allDraftFiles = await fs.readdir(draftsDir)
  const allDraftIds = allDraftFiles
    .filter((item) => item.match('.json'))
    .map(draftFileNameToId)
  draftIdList = allDraftIds
}

initDrafts()
  .then(() => {
    info('Drafts ready')
  })
  .catch((e) => {
    error('Error preparing drafts', {error: e})
  })

function inputIdToDraftFile(id: string) {
  const encodedId = Buffer.from(id).toString('base64')
  return `${encodedId}.json`
}

function draftFileNameToId(filename: string) {
  const baseName = filename.replace(/\.json$/, '')
  const id = Buffer.from(baseName, 'base64').toString('utf-8')
  return id
}

export const draftsApi = t.router({
  list: t.procedure.query(async () => {
    return draftIdList
  }),
  listAccount: t.procedure.input(z.string()).query(async ({input}) => {
    const drafts = await Promise.all(
      draftIdList
        ?.filter((id) => id.startsWith(hmId('d', input).id))
        .map((id) => unpackHmId(id))
        .filter((id) => !!id)
        .map(async (id) => {
          const draftPath = join(draftsDir, inputIdToDraftFile(id.id))
          const fileContent = await fs.readFile(draftPath, 'utf-8')
          const draft = JSON.parse(fileContent) as HMDraft
          return {
            id,
            metadata: draft.metadata,
            lastUpdateTime: draft.lastUpdateTime,
          }
        }) || [],
    )
    return drafts
  }),
  get: t.procedure.input(z.string().optional()).query(async ({input}) => {
    if (!input) return null
    const draftPath = join(draftsDir, inputIdToDraftFile(input))
    try {
      const fileContent = await fs.readFile(draftPath, 'utf-8')
      const draft = JSON.parse(fileContent)

      return draft as HMDraft
    } catch (e) {
      error('[DRAFT]: Error when getting draft', {input: input, error: e})
      return null
    }
  }),
  write: t.procedure
    .input(
      z.object({
        draft: z.any(), // TODO: zod for draft object?
        id: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      const draftPath = join(draftsDir, inputIdToDraftFile(input.id))
      if (!draftIdList?.includes(input.id)) {
        draftIdList?.push(input.id)
      }
      try {
        await fs.writeFile(
          draftPath,
          JSON.stringify({...input.draft, lastUpdateTime: Date.now()}, null, 2),
        )
        return input
      } catch (error) {
        throw Error(
          `[DRAFT]: Error writing draft: ${JSON.stringify(error, null)}`,
        )
      }
    }),
  delete: t.procedure.input(z.string()).mutation(async ({input}) => {
    const draftPath = join(draftsDir, inputIdToDraftFile(input))
    draftIdList = draftIdList?.filter((id) => id !== input)
    await fs.unlink(draftPath)
  }),
})
