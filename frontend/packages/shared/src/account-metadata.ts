import {Struct} from '@bufbuild/protobuf'
import {HMDocumentMetadataSchema, HMMetadata, hmMetadataJsonCorrection} from './hm-types'

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

function nonEmptyProfileField(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  if (!value.trim()) {
    return undefined
  }
  return value
}

export function accountMetadataFromAccount(account: AccountMetadataInput): HMMetadata {
  const metadata = parseDocumentMetadata(account.homeDocumentInfo?.metadata || account.metadata)

  return {
    ...metadata,
    name: nonEmptyProfileField(account.profile?.name) ?? metadata.name,
    icon: nonEmptyProfileField(account.profile?.icon) ?? metadata.icon,
    summary: nonEmptyProfileField(account.profile?.description) ?? metadata.summary,
  }
}
