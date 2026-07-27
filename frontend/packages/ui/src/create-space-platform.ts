import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {CREATE_SPACE_HEADER_LAYOUTS, type CreateSpaceFormState} from './create-space-form'

/**
 * Map the form's collected state to home doc metadata, given the CIDs of
 * any uploaded images. Shared so desktop and web write identical metadata.
 */
export function createSpaceMetadata(
  state: CreateSpaceFormState,
  images: {coverCid?: string; logoCid?: string},
): Partial<HMMetadata> {
  const storedHeaderLayout =
    CREATE_SPACE_HEADER_LAYOUTS.find((layout) => layout.value === state.headerLayout)?.stored ?? ''
  const metadata: Partial<HMMetadata> = {
    name: state.name,
    contentWidth: state.contentWidth,
    showActivity: state.showActivity,
    theme: {headerLayout: storedHeaderLayout},
  }
  if (images.coverCid) metadata.cover = `ipfs://${images.coverCid}`
  if (images.logoCid) metadata.seedExperimentalLogo = `ipfs://${images.logoCid}`
  return metadata
}
