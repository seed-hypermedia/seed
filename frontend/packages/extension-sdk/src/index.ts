/**
 * @seed-hypermedia/extension-sdk — the iframe side of Seed extensions.
 *
 * ```ts
 * import {connect, applyTheme, injectBaseStyles} from '@seed-hypermedia/extension-sdk'
 * const seed = await connect()
 * seed.onContext(applyTheme)
 * ```
 */

export {connect, createWindowTransport, hmRef, SDK_VERSION, SeedExtension} from './connect'
export type {ConnectOptions, ExtensionTransport, HMIdRef, SearchOptions, SignDataResult} from './connect'
export {base64Decode, base64Encode} from './base64'
export {applyTheme, injectBaseStyles, seedBaseStyles} from './theme'

// Protocol types and the error class, re-exported so extensions need only this package.
export {
  EXTENSION_PROTOCOL_VERSION,
  EXTENSION_READ_QUERY_KEYS,
  ExtensionError,
  buildSignDataPayload,
} from '@seed-hypermedia/client/extensions'
export type {
  ExtensionContext,
  ExtensionErrorCode,
  ExtensionManifest,
  ExtensionMethodName,
  ExtensionMethods,
  ExtensionPermission,
  ExtensionPlatform,
  ExtensionReadQueryKey,
  ExtensionTheme,
  ExtensionUser,
} from '@seed-hypermedia/client/extensions'
export type {
  HMDocument,
  HMDocumentInfo,
  HMQueryResult,
  HMResource,
  HMSearchPayload,
} from '@seed-hypermedia/client/hm-types'
