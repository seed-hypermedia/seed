import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {Heading, YStack} from 'tamagui'

export function NotFoundPage() {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center">
      <Heading>404</Heading>
      <Text>Page not found</Text>
    </YStack>
  )
}

export function BaseLoading() {
  return (
    <div className="flex justify-center items-center p-6">
      <Spinner />
    </div>
  )
}
