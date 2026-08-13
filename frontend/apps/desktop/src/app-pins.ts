import {pathMatches} from '@shm/shared/utils/entity-id-url'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const PINS_STORAGE_KEY = 'Pins-v001'

const pinnedDocumentSchema = z
  .object({
    siteUid: z.string(),
    path: z.array(z.string()),
    seenVersion: z.string().nullable(),
    title: z.string(),
    createdAt: z.string(),
  })
  .strict()

const pinsStateSchema = z
  .object({
    pins: z.array(pinnedDocumentSchema),
  })
  .strict()

type PinnedDocument = z.infer<typeof pinnedDocumentSchema>
type PinsState = z.infer<typeof pinsStateSchema>

function findPinIndex(pins: PinnedDocument[], siteUid: string, path: string[]) {
  return pins.findIndex((pin) => pin.siteUid === siteUid && pathMatches(pin.path, path))
}

function loadPins(): PinsState {
  const stored = appStore.get(PINS_STORAGE_KEY) as PinsState | undefined
  if (!stored) return {pins: []}
  const parsed = pinsStateSchema.safeParse(stored)
  if (!parsed.success) {
    console.error('Failed to parse pins', parsed.error)
    return {pins: []}
  }
  return parsed.data
}

let state: PinsState = loadPins()

async function writePins(newState: PinsState) {
  state = newState
  appStore.set(PINS_STORAGE_KEY, newState)
  return undefined
}

/**
 * Desktop tRPC router for pinned documents persisted in the Electron app store.
 */
export const pinsApi = t.router({
  get: t.procedure.query(async () => state),
  pin: t.procedure.input(pinnedDocumentSchema).mutation(async ({input}) => {
    const existingIndex = findPinIndex(state.pins, input.siteUid, input.path)
    const newPins = [...state.pins]
    if (existingIndex >= 0) {
      const existing = newPins[existingIndex]!
      newPins[existingIndex] = {
        ...existing,
        title: input.title,
        seenVersion: input.seenVersion,
      }
    } else {
      newPins.push(input)
    }
    await writePins({...state, pins: newPins})
  }),
  unpin: t.procedure
    .input(
      z
        .object({
          siteUid: z.string(),
          path: z.array(z.string()),
        })
        .strict(),
    )
    .mutation(async ({input}) => {
      const newPins = state.pins.filter((pin) => !(pin.siteUid === input.siteUid && pathMatches(pin.path, input.path)))
      await writePins({...state, pins: newPins})
    }),
  reorder: t.procedure
    .input(
      z
        .object({
          siteUid: z.string(),
          fromIndex: z.number(),
          toIndex: z.number(),
        })
        .strict(),
    )
    .mutation(async ({input}) => {
      const sitePins = state.pins.filter((pin) => pin.siteUid === input.siteUid)
      const otherPins = state.pins.filter((pin) => pin.siteUid !== input.siteUid)
      if (
        input.fromIndex < 0 ||
        input.fromIndex >= sitePins.length ||
        input.toIndex < 0 ||
        input.toIndex >= sitePins.length
      ) {
        throw new Error('Invalid pin indices')
      }
      const [moved] = sitePins.splice(input.fromIndex, 1)
      sitePins.splice(input.toIndex, 0, moved!)
      await writePins({pins: [...otherPins, ...sitePins]})
    }),
  acknowledge: t.procedure
    .input(
      z
        .object({
          siteUid: z.string(),
          path: z.array(z.string()),
          seenVersion: z.string().nullable().optional(),
          title: z.string().optional(),
        })
        .strict(),
    )
    .mutation(async ({input}) => {
      const newPins = state.pins.map((pin) => {
        if (pin.siteUid === input.siteUid && pathMatches(pin.path, input.path)) {
          return {
            ...pin,
            seenVersion: input.seenVersion ?? pin.seenVersion,
            title: input.title ?? pin.title,
          }
        }
        return pin
      })
      await writePins({...state, pins: newPins})
    }),
})
