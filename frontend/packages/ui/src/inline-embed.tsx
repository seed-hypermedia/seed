import {getContactMetadata, getMetadataName} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {InlineEmbedButton, useDocContentContext} from './document-content'

export interface InlineEmbedProps {
  entityId: UnpackedHypermediaId
  block: any
  parentBlockId: string | null
  depth?: number
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
  style?: any
  contacts?: any
  renderDocument?: any
}

export function InlineEmbed({
  entityId,
  block,
  parentBlockId,
  depth,
  onHoverIn,
  onHoverOut,
  style,
  contacts,
  renderDocument,
}: InlineEmbedProps) {
  const doc = useResource(entityId)
  const ctx = useDocContentContext()
  const document =
    renderDocument ||
    (doc.data?.type === 'document' ? doc.data.document : undefined)

  const name =
    getContactMetadata(
      entityId.uid,
      document?.metadata,
      contacts || ctx?.contacts,
    ).name ||
    getMetadataName(document?.metadata) ||
    '...'

  return (
    <InlineEmbedButton
      entityId={entityId}
      block={block}
      parentBlockId={parentBlockId}
      depth={depth}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={style}
    >
      {name}
    </InlineEmbedButton>
  )
}
