import {useUniversalAppContext} from '@shm/shared/routing'
import {Button} from '@tamagui/button'
import {Copy, ExternalLink} from '@tamagui/lucide-icons'
import {useRef} from 'react'
import {TamaguiTextElement, Text, XGroup, XStack} from 'tamagui'
import {copyTextToClipboard} from './copy-to-clipboard'
import {toast} from './toast'
import {Tooltip} from './tooltip'

export function CopyUrlField({url, label}: {url: string; label: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<TamaguiTextElement>(null)
  return (
    <XGroup borderColor="$color8" borderWidth={1}>
      <XGroup.Item>
        <XStack flex={1} alignItems="center">
          <Text
            onPress={(e) => {
              e.preventDefault()
              if (textRef.current) {
                const range = document.createRange()
                range.selectNode(textRef.current)
                window.getSelection()?.removeAllRanges()
                window.getSelection()?.addRange(range)
              }
            }}
            fontSize={18}
            color="$color11"
            ref={textRef}
            marginHorizontal="$3"
            overflow="hidden"
            numberOfLines={1}
            textOverflow="ellipsis"
          >
            {url}
          </Text>
          <Tooltip content="Copy URL">
            <Button
              chromeless
              size="$2"
              margin="$2"
              icon={Copy}
              onPress={() => {
                copyTextToClipboard(url)
                toast(`Copied ${label} URL`)
              }}
            />
          </Tooltip>
        </XStack>
      </XGroup.Item>
      <XGroup.Item>
        <Button onPress={() => openUrl(url)} iconAfter={ExternalLink}>
          Open
        </Button>
      </XGroup.Item>
    </XGroup>
  )
}
