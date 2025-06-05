import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {YStack} from 'tamagui'

export function EmptyList({
  description,
  action,
}: {
  description: string
  action: () => void
}) {
  return (
    <YStack gap="$5" paddingVertical="$4" width="100%" maxWidth={850}>
      <Text size="md">{description}</Text>
      <Button size="$4" onPress={() => action()} alignSelf="flex-start">
        Create a new Document
      </Button>
    </YStack>
  )
}
