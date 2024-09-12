import {Button, View, ViewProps, XStack, YStack} from '@shm/ui'

export function ListItemSkeleton() {
  return (
    <Button
      borderWidth={0}
      paddingHorizontal={16}
      paddingVertical="$1"
      bg="$backgroundHover"
      h={60}
      disabled
      gap="$2"
    >
      <Skeleton width={28} height={28} borderRadius={28} />

      <YStack f={1} gap="$2">
        <XStack ai="center" gap="$2">
          <Skeleton w="100%" maxWidth={300} height={20} borderRadius="$1" />
        </XStack>
        <XStack gap="$2" w="100%" overflow="hidden">
          <Skeleton w="100%" maxWidth={200} height={14} borderRadius="$1" />
        </XStack>
      </YStack>
      <Skeleton w="100%" maxWidth={80} height={20} borderRadius="$1" />

      <XStack>
        <Skeleton width={24} height={24} borderRadius={100} />
        <Skeleton width={24} height={24} borderRadius={100} marginLeft={-8} />
      </XStack>
    </Button>
  )
}

function Skeleton(props: ViewProps) {
  return <View {...props} bg="$color4" />
}
