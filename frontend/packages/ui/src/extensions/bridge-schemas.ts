/**
 * Minimal zod validation for the params of every bridge method. The host
 * validates before dispatching so handlers can trust the shapes; anything that
 * fails here is answered with `invalid_params`.
 *
 * These deliberately mirror `ExtensionMethods` in
 * `@seed-hypermedia/client/extensions` (the normative types) without being
 * derived from them — zod cannot infer schemas from TS types, so keep both in
 * sync by hand when a method changes.
 */

import {EXTENSION_READ_QUERY_KEYS, type ExtensionMethodName} from '@seed-hypermedia/client/extensions'
import * as z from 'zod'

const stringRecord = z.record(z.string(), z.string())

export const EXTENSION_METHOD_PARAM_SCHEMAS: {[M in ExtensionMethodName]: z.ZodTypeAny} = {
  hello: z.object({protocol: z.number().int().positive(), sdkVersion: z.string().optional()}),
  getContext: z.object({}).passthrough().or(z.undefined()).or(z.null()),

  'api.query': z.object({key: z.enum(EXTENSION_READ_QUERY_KEYS), input: z.unknown()}),
  'file.url': z.object({cid: z.string().min(1)}),
  'file.read': z.object({cid: z.string().min(1), maxBytes: z.number().int().positive().optional()}),

  'sign.comment': z
    .object({
      targetId: z.string().min(1),
      targetVersion: z.string().optional(),
      markdown: z.string().optional(),
      blocks: z.array(z.unknown()).optional(),
      replyCommentVersion: z.string().optional(),
      rootReplyCommentVersion: z.string().optional(),
    })
    .refine((v) => v.markdown !== undefined || v.blocks !== undefined, {
      message: 'either markdown or blocks is required',
    }),
  'sign.document': z
    .object({
      id: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
      blocks: z.array(z.unknown()).optional(),
      summary: z.string().optional(),
    })
    .refine((v) => v.metadata !== undefined || v.blocks !== undefined, {
      message: 'either metadata or blocks is required',
    }),
  'sign.data': z.object({base64: z.string(), purpose: z.string().min(1)}),

  navigate: z.object({url: z.string().min(1), replace: z.boolean().optional()}),
  openExternal: z.object({url: z.string().min(1)}),
  'route.set': z.object({
    subPath: z.array(z.string()),
    query: stringRecord.optional(),
    replace: z.boolean().optional(),
  }),

  'storage.get': z.object({key: z.string().min(1)}),
  'storage.set': z.object({key: z.string().min(1), value: z.string()}),
  'storage.remove': z.object({key: z.string().min(1)}),
  'storage.keys': z.object({}).passthrough().or(z.undefined()).or(z.null()),

  'ui.toast': z.object({message: z.string(), kind: z.enum(['info', 'success', 'error']).optional()}),
  'ui.setTitle': z.object({title: z.string()}),
  'ui.resize': z.object({height: z.number().nonnegative()}),
}

export function isKnownExtensionMethod(method: unknown): method is ExtensionMethodName {
  return typeof method === 'string' && Object.prototype.hasOwnProperty.call(EXTENSION_METHOD_PARAM_SCHEMAS, method)
}
