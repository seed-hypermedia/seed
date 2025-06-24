import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useGatewayUrl} from '@/models/gateway-settings'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {
  BlockRange,
  createSiteUrl,
  createWebHMUrl,
  ExpandedBlockRange,
  hmId,
} from '@shm/shared/utils/entity-id-url'
import {Button, ButtonProps} from '@shm/ui/button'
import {ExternalLink} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {Link} from '@tamagui/lucide-icons'
import {PropsWithChildren, ReactNode, useState} from 'react'

export function useDocumentUrl({
  docId,
  isBlockFocused,
  latest,
}: {
  docId?: UnpackedHypermediaId
  isBlockFocused: boolean
  latest?: boolean
}): {
  label: string
  url: string
  onCopy: (
    blockId?: string | undefined,
    blockRange?: BlockRange | ExpandedBlockRange,
  ) => void
  content: ReactNode
} | null {
  const docEntity = useEntity(docId)
  if (!docId?.uid) return null
  const accountId = hmId('d', docId.uid)
  const accountEntity = useEntity(accountId)
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const siteHostname = accountEntity.data?.document?.metadata?.siteUrl
  const [copyDialogContent, onCopyReference] = useCopyReferenceUrl(
    siteHostname || gwUrl,
    siteHostname ? accountId : undefined,
  )
  if (!docId) return null
  const url = siteHostname
    ? createSiteUrl({
        hostname: siteHostname,
        path: docId.path,
        version: docEntity.data?.document?.version,
        latest,
      })
    : createWebHMUrl('d', docId.uid, {
        version: docEntity.data?.document?.version,
        hostname: gwUrl,
        path: docId.path,
        latest,
      })
  return {
    url,
    label: siteHostname
      ? 'Site' + (latest ? ' Latest' : ' Exact Version')
      : 'Public' + (latest ? ' Latest' : ' Exact Version'),
    content: copyDialogContent,
    onCopy: (
      blockId: string | undefined,
      blockRange?: BlockRange | ExpandedBlockRange | null,
    ) => {
      const focusBlockId = isBlockFocused ? docId.blockRef : null
      onCopyReference({
        ...docId,
        hostname: siteHostname || gwUrl,
        version: docEntity.data?.document?.version || null,
        blockRef: blockId || focusBlockId || null,
        blockRange: blockRange || null,
        path: docId.path,
        latest,
      })
    },
  }
}

export function CopyReferenceButton({
  children,
  docId,
  isBlockFocused,
  latest,
  copyIcon = Link,
  openIcon = ExternalLink,
  iconPosition = 'before',
  showIconOnHover = false,

  ...props
}: PropsWithChildren<
  ButtonProps & {
    docId: UnpackedHypermediaId
    isBlockFocused: boolean
    latest?: boolean
    isIconAfter?: boolean
    showIconOnHover?: boolean
    copyIcon?: React.ElementType
    openIcon?: React.ElementType
    iconPosition?: 'before' | 'after'
  }
>) {
  const [shouldOpen, setShouldOpen] = useState(false)
  const reference = useDocumentUrl({docId, isBlockFocused, latest})
  const {externalOpen} = useAppContext()
  if (!reference) return null
  const CurrentIcon = shouldOpen ? openIcon : copyIcon
  const icon = (
    <CurrentIcon
      className="size-3"
      style={{
        opacity: shouldOpen ? 1 : showIconOnHover ? 0 : 1,
      }}
    />
  )

  return (
    <>
      <Tooltip
        content={
          shouldOpen
            ? `Open ${reference.label} Link in Web Browser`
            : `Copy ${reference.label} Link`
        }
      >
        <Button
          size="icon"
          variant="ghost"
          onMouseLeave={() => {
            setShouldOpen(false)
          }}
          aria-label={`${shouldOpen ? 'Open' : 'Copy'} ${reference.label} Link`}
          className="no-window-drag"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (shouldOpen) {
              setShouldOpen(false)
              externalOpen(reference.url)
            } else {
              setShouldOpen(true)
              // in theory we should save this timeout in a ref and deal with it upon unmount. in practice it doesn't matter
              setTimeout(() => {
                setShouldOpen(false)
              }, 5000)
              reference.onCopy()
            }
          }}
          {...props}
        >
          {iconPosition == 'before' ? icon : null}
          {children}
          {iconPosition == 'after' ? icon : null}
        </Button>
      </Tooltip>

      {reference.content}
    </>
  )
}
