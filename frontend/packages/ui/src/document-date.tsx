import {
  formattedDateDayOnly,
  formattedDateLong,
  formattedDateMedium,
  HMMetadata,
} from '@shm/shared'
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
  const displayText = metadata?.displayPublishTime
    ? formattedDateDayOnly(new Date(metadata.displayPublishTime))
    : formattedDateMedium(updateTime)
  const content: React.ReactNode[] = [
    <SizableText size="$3">
      Last Update: {formattedDateLong(updateTime)}
    </SizableText>,
    // // Disabled because this is always 1969 because the backend looks at the deterministic genesis blob instead of the actual creation time
    // <SizableText size="$2">
    //   First published: {formattedDateLong(document?.createTime)}
    // </SizableText>,
  ]
  if (metadata?.displayPublishTime) {
    content.unshift(
      <SizableText color="$blue10" size="$3">
        Original Publish date: {displayText}
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
        flexShrink={0}
        flexGrow={0}
        size="$1"
        hoverStyle={{cursor: 'default'}}
        color={metadata?.displayPublishTime ? '$blue10' : '$color9'}
      >
        {displayText}
      </SizableText>
    </HoverCard>
  )
}
