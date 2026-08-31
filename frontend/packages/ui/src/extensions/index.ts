/**
 * `@shm/ui/extensions` — the platform-agnostic extension host.
 *
 * Hosts (web, desktop) wrap `ExtensionPage` in an `ExtensionHostProvider`
 * with their `ExtensionHostAdapter`. See docs/extensions/design.md §4.
 */

export * from './extension-host-context'
export * from './extension-page'
export {ExtensionFrame, EXTENSION_IFRAME_SANDBOX, type ExtensionFrameProps} from './extension-frame'
export {
  createExtensionBridgeServer,
  toExtensionErrorPayload,
  type ExtensionBridgeServer,
  type ExtensionBridgeServerOptions,
  type ExtensionHandledMethodName,
  type ExtensionHandler,
  type ExtensionHandlers,
} from './bridge-server'
export {EXTENSION_METHOD_PARAM_SCHEMAS, isKnownExtensionMethod} from './bridge-schemas'
export {
  createExtensionHandlers,
  createSessionAllowStore,
  defaultSessionAllowStore,
  sessionAllowKey,
  type ExtensionHandlerDeps,
  type SessionAllowStore,
} from './host-handlers'
export {
  useSignConfirmDialog,
  type ConfirmSignFn,
  type SignConfirmDetail,
  type SignConfirmMetadataChange,
  type SignConfirmRequest,
  type SignConfirmResult,
} from './sign-confirm-dialog'
export {navExtensionMounts, useResolvedExtensionMount, useSiteExtensionMounts} from './use-site-extensions'
export {
  extensionIdString,
  extensionStorageKey,
  extensionStoragePrefix,
  normalizeHmIdInput,
  normalizeQueryInput,
  toCloneable,
} from './host-utils'
