import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'

export function EmptyList({
  description,
  action,
}: {
  description: string
  action: () => void
}) {
  return (
    <div className="flex flex-col gap-5 p-4 w-full max-w-2xl">
      <Text size="md">{description}</Text>
      <Button onClick={() => action()}>Create a new Document</Button>
    </div>
  )
}
