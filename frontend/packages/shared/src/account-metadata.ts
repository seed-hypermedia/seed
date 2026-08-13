import {Struct} from '@bufbuild/protobuf'
import {HMDocumentMetadataSchema, HMMetadata, hmMetadataJsonCorrection} from '@seed-hypermedia/client/hm-types'

type AccountMetadataInput = {
  metadata?: Struct
  homeDocumentInfo?: {
    metadata?: Struct
  } | null
  profile?: {
    name?: string
    icon?: string
    description?: string
  } | null
}

function parseDocumentMetadata(metadata: Struct | undefined): HMMetadata {
  const metadataJson = (metadata?.toJson({emitDefaultValues: true, enumAsInteger: false}) || {}) as Record<
    string,
    unknown
  >
  if (metadataJson.theme === '[object Object]') {
    metadataJson.theme = undefined
  }
  const parsedMetadata = HMDocumentMetadataSchema.safeParse(hmMetadataJsonCorrection(metadataJson))
  if (!parsedMetadata.success) {
    return {}
  }
  return parsedMetadata.data
}

function nonEmptyField(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  if (!value.trim()) {
    return undefined
  }
  return value
}

type AccountMetadataOptions = {
  /**
   * When true, prefer values from the home document metadata over the profile.
   * The profile is still used as a fallback when a home document field is empty.
   */
  preferHomeDocument?: boolean
}

/**
 * Resolve the display metadata for an account from its home document and profile.
 */
export function accountMetadataFromAccount(
  account: AccountMetadataInput,
  options?: AccountMetadataOptions,
): HMMetadata {
  const metadata = parseDocumentMetadata(account.homeDocumentInfo?.metadata || account.metadata)
  const profileName = nonEmptyField(account.profile?.name)
  const profileIcon = nonEmptyField(account.profile?.icon)
  const profileSummary = nonEmptyField(account.profile?.description)

  if (options?.preferHomeDocument) {
    return {
      ...metadata,
      name: nonEmptyField(metadata.name) ?? profileName ?? metadata.name,
      icon: nonEmptyField(metadata.icon) ?? profileIcon ?? metadata.icon,
      summary: nonEmptyField(metadata.summary) ?? profileSummary ?? metadata.summary,
    }
  }

  return {
    ...metadata,
    name: profileName ?? metadata.name,
    icon: profileIcon ?? metadata.icon,
    summary: profileSummary ?? metadata.summary,
  }
}
