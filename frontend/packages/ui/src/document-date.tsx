import {HMMetadata} from '@shm/shared'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {SizableText} from './text'

import {HoverCard, HoverCardContent, HoverCardTrigger} from './/hover-card'

export function DocumentDate({
  metadata,
  updateTime,
  disableTooltip = false,
}: {
  metadata?: HMMetadata
  updateTime: (
    | string
    | {
        seconds: number | bigint
        nanos: number
      }
  ) &
    (
      | string
      | {
          seconds: number | bigint
          nanos: number
        }
      | undefined
    )
  disableTooltip?: boolean
}) {
  const tx = useTx()
  const {formattedDateDayOnly, formattedDateMedium, formattedDateLong} =
    useTxUtils()
  const displayText = metadata?.displayPublishTime
    ? formattedDateDayOnly(new Date(metadata.displayPublishTime))
    : formattedDateMedium(updateTime)
  const content: React.ReactNode[] = [
    <SizableText size="sm" color="muted" key="last-update">
      {tx('Last Update')}: {formattedDateLong(updateTime)}
    </SizableText>,
    // // Disabled because this is always 1969 because the backend looks at the deterministic genesis blob instead of the actual creation time
    // <SizableText size="sm">
    //   First published: {formattedDateLong(document?.createTime)}
    // </SizableText>,
  ]
  if (metadata?.displayPublishTime) {
    content.unshift(
      <SizableText
        // className="text-brand/50"
        className="brand"
        size="sm"
        key="original-publish-date"
      >
        {tx('Original Publish date')}: {displayText}
      </SizableText>,
    )
  }
  return (
    <HoverCard>
      <HoverCardTrigger>
        <SizableText
          size="xs"
          color={metadata?.displayPublishTime ? 'brand' : 'muted'}
          className="cursor-default shrink-0 grow-0"
        >
          {displayText}
        </SizableText>
      </HoverCardTrigger>
      {!disableTooltip && (
        <HoverCardContent>
          <div className="flex flex-col gap-2 justify-center items-center">
            {content}
          </div>
        </HoverCardContent>
      )}
    </HoverCard>
  )
}
