import {View} from '@tamagui/core'
import {YStack} from '@tamagui/stacks'

export function SideNavigationPlaceholder() {
  return (
    <View
      group="item"
      margin="$4"
      height="calc(75vh - 140px - 12px)"
      marginTop={156}
      zIndex="$zIndex.2"
      top={0}
      left={-6}
      position="absolute"
    >
      <YStack
        width={16}
        paddingVertical="$5"
        paddingHorizontal={3}
        backgroundColor="$backgroundTransparent"
        gap="$2.5"
        borderRadius="$4"
        hoverStyle={{
          backgroundColor: '$color5',
        }}
      >
        {Array.from({length: 6}).map((_, i) => (
          <View
            key={i}
            $group-item-hover={{backgroundColor: '$color9'}}
            height={2}
            bg="$color8"
          />
        ))}
      </YStack>
    </View>
  )
}
