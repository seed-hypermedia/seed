import {SizableText} from '@tamagui/text'
import {XStack} from 'tamagui'

export function DraftBadge() {
  return (
    <XStack
      alignSelf="center"
      paddingVertical="0"
      paddingHorizontal="$1.5"
      borderColor="$yellow10"
      borderRadius="$2"
      borderWidth={1}
    >
      <SizableText size="$1" color="$yellow10">
        Draft
      </SizableText>
    </XStack>
  )
}
