import {z} from 'zod'
import {navRouteSchema} from '@shm/shared/routes'

/** Validated renderer intents; the receiving webContents determines the source window. */
export const windowNavigationActionSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('push'), route: navRouteSchema}),
  z.object({type: z.literal('replace'), route: navRouteSchema}),
  z.object({type: z.literal('backplace'), route: navRouteSchema}),
  z.object({type: z.literal('pop')}),
  z.object({type: z.literal('forward')}),
  z.object({type: z.literal('closeBack')}),
  z.object({type: z.literal('resolveBrowser'), url: z.string(), route: navRouteSchema}),
  z.object({
    type: z.literal('browserLocation'),
    requested: z.boolean(),
    location: z.object({url: z.string(), title: z.string(), browserId: z.number(), historyIndex: z.number().int()}),
  }),
])
