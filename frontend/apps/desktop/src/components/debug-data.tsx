import {SizableText} from '@shm/ui/text'
import {useState} from 'react'
import {Button, XStack, YStack} from 'tamagui'
import {useHasDevTools} from '../models/experiments'

export function DebugData({data}: {data: any}) {
  const hasDevTools = useHasDevTools()
  const [debugValue, setDebugValue] = useState(false)
  if (!hasDevTools) return null
  return (
    <YStack maxWidth="500px" marginHorizontal="auto" marginVertical="200px">
      <Button size="$1" width="100%" onPress={() => setDebugValue((v) => !v)}>
        toggle value
      </Button>
      {debugValue && (
        <XStack
          tag="pre"
          {...{
            whiteSpace: 'wrap',
          }}
        >
          <SizableText asChild size="xs">
            <code>{JSON.stringify(data, null, 3)}</code>
          </SizableText>
        </XStack>
      )}
    </YStack>
  )
}
