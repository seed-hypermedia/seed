import type {HMMetadata} from '@seed-hypermedia/client/hm-types'

/** Space-wide reader settings, as stored on the space's home document. */
export type SpaceSettings = {
  showConversations: boolean
  showActivity: boolean
  showDocumentBrowser: boolean
  showCollectionControls: boolean
}

/** The settings keys, in the order the General section shows them. */
export const SPACE_SETTING_KEYS = [
  'showConversations',
  'showActivity',
  'showDocumentBrowser',
  'showCollectionControls',
] as const satisfies readonly (keyof SpaceSettings)[]

/** Reads the space settings out of a space home document's metadata. */
export function readSpaceSettings(metadata: HMMetadata | null | undefined): SpaceSettings {
  return {
    showConversations: metadata?.showConversations !== false,
    showActivity: metadata?.showActivity !== false,
    showDocumentBrowser: metadata?.showDocumentBrowser !== false,
    showCollectionControls: metadata?.showCollectionControls !== false,
  }
}

/** How a document is laid out once its space's settings apply. */
export function resolveDocumentDisplay(
  document: HMMetadata | null | undefined,
  home: HMMetadata | null | undefined,
): {contentWidth: HMMetadata['contentWidth']; showOutline: boolean; showActivity: boolean} {
  return {
    contentWidth: home?.contentWidth ?? document?.contentWidth,
    showOutline: (home?.showOutline ?? document?.showOutline) !== false,
    showActivity: document?.showActivity !== false && home?.showActivity !== false,
  }
}
