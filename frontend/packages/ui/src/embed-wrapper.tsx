import {UnpackedHypermediaId, useOpenRoute} from '@shm/shared'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {HTMLAttributes, PropsWithChildren} from 'react'
import {blockStyles} from './blocks-content'
import {useHighlighter} from './highlight-context'
import {cn} from './utils'

export function EmbedWrapper({
  id,
  parentBlockId,
  children,
  depth,
  viewType = 'Content',
  hideBorder = false,
  isRange = false,
  noClick = false,
  ...props
}: PropsWithChildren<
  {
    id?: UnpackedHypermediaId
    parentBlockId: string | null
    depth?: number
    viewType?: 'Content' | 'Card' | 'Comments'
    hideBorder?: boolean
    isRange?: boolean
    noClick?: boolean
  } & Omit<HTMLAttributes<HTMLDivElement>, 'id'>
>) {
  const openRoute = useOpenRoute()
  const highlight = useHighlighter()
  if (!id) return null

  return (
    <div
      contentEditable={false}
      className={cn(
        'block-embed flex flex-col',
        blockStyles,
        !hideBorder && 'border-l-primary border-l-3',
        'm-0 rounded-none',
        isRange && 'hm-embed-range-wrapper',
      )}
      data-content-type="embed"
      data-url={packHmId(id)}
      data-view={viewType}
      data-blockid={
        id &&
        id.blockRange &&
        'expanded' in id.blockRange &&
        id.blockRange.expanded
          ? id?.blockRef
          : undefined
      }
      data-resourceid={id?.blockRef ? undefined : id?.id}
      onClick={
        noClick
          ? undefined
          : (e) => {
              e.stopPropagation()
              const selection = window.getSelection()
              const hasSelection = selection && selection.toString().length > 0
              if (hasSelection) {
                return
              }
              if (openRoute) {
                e.preventDefault()
                openRoute({key: 'document', id})
              }
            }
      }
      {...highlight(id)}
      {...props}
    >
      {children}
    </div>
  )
}
