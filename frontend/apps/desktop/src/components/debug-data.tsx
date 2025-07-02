import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {useState} from 'react'
import {useHasDevTools} from '../models/experiments'

export function DebugData({data}: {data: any}) {
  const hasDevTools = useHasDevTools()
  const [debugValue, setDebugValue] = useState(false)
  if (!hasDevTools) return null
  return (
    <div className="mx-auto my-[200px] flex max-w-[500px] flex-col">
      <Button
        size="sm"
        className="w-full"
        onClick={() => setDebugValue((v) => !v)}
      >
        toggle value
      </Button>
      {debugValue && (
        <pre className="flex whitespace-normal">
          <SizableText asChild size="xs">
            <code>{JSON.stringify(data, null, 3)}</code>
          </SizableText>
        </pre>
      )}
    </div>
  )
}
