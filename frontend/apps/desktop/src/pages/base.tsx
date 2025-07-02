import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {Heading} from 'tamagui'

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <Heading>404</Heading>
      <Text>Page not found</Text>
    </div>
  )
}

export function BaseLoading() {
  return (
    <div className="flex items-center justify-center p-6">
      <Spinner />
    </div>
  )
}
