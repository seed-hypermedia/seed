import {HMMetadata} from '@shm/shared'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {SizableText} from './text'

import {HoverCard} from './hover-card'

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
        className="text-brand/50"
        size="sm"
        key="original-publish-date"
      >
        {tx('Original Publish date')}: {displayText}
      </SizableText>,
    )
  }
  return (
    <HoverCard
      content={<div className="flex flex-col gap-2">{content}</div>}
      disabled={disableTooltip}
    >
      <SizableText
        size="xs"
        color={metadata?.displayPublishTime ? 'brand' : 'muted'}
        className="shrink-0 grow-0 cursor-default"
      >
        {displayText}
      </SizableText>
    </HoverCard>
  )
}
