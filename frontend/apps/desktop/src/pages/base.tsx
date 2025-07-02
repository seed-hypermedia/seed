import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <Text size="lg">404</Text>
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
