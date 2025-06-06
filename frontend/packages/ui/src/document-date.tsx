import {HMMetadata} from '@shm/shared'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {SizableText} from '@tamagui/text'
import {YStack} from 'tamagui'
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
    <SizableText size="$3">
      {tx('Last Update')}: {formattedDateLong(updateTime)}
    </SizableText>,
    // // Disabled because this is always 1969 because the backend looks at the deterministic genesis blob instead of the actual creation time
    // <SizableText size="sm">
    //   First published: {formattedDateLong(document?.createTime)}
    // </SizableText>,
  ]
  if (metadata?.displayPublishTime) {
    content.unshift(
      <SizableText color="$blue10" size="$3">
        {tx('Original Publish date')}: {displayText}
      </SizableText>,
    )
  }
  return (
    <HoverCard
      content={
        <YStack gap="$4" padding="$4">
          {content}
        </YStack>
      }
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
