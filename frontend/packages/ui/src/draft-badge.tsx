import {XStack} from 'tamagui'
import {SizableText} from './text'

export function DraftBadge() {
  return (
    <XStack
      alignSelf="center"
      paddingVertical="0"
      paddingHorizontal="$1.5"
      borderColor="$yellow9"
      borderRadius="$2"
      borderWidth={1}
    >
      <SizableText size="xs" color="warning">
        Draft
      </SizableText>
    </XStack>
  )
}
