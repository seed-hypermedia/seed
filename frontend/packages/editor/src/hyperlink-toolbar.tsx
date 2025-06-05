import {HyperlinkToolbarProps} from '@/blocknote'
import {HMEntityType} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'
import {useEffect, useState} from 'react'
import {SizeTokens, YStack} from 'tamagui'
import {HypermediaLinkForm} from './hm-link-form'
export function HypermediaLinkToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    onClose: (bool: boolean) => void
    type: string
    seedEntityType?: HMEntityType
    isFocused: boolean
    setIsFocused: (focused: boolean) => void
  },
) {
  const formSize: SizeTokens = '$2'

  const [_url, setUrl] = useState(props.url || '')
  const [_text, setText] = useState(props.text || '')
  // const unpackedRef = useMemo(() => unpackHmId(_url), [_url])
  // const _latest = unpackedRef?.latest || false

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key == 'Enter') {
      event.preventDefault()
      props.editHyperlink(_url, _text)
    }
  }

  useEffect(() => {
    props.editor.hyperlinkToolbar.on('update', (state) => {
      if (!state.show) props.onClose(false)
      setText(state.text || '')
      setUrl(state.url || '')
    })
  }, [props.editor])

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [])

  return (
    <YStack
      paddingVertical="$4"
      paddingHorizontal="$3"
      gap="$2"
      borderRadius="$4"
      overflow="hidden"
      bg="$backgroundFocus"
      elevation="$3"
      zIndex="$zIndex.5"
      bottom="0"
      position="absolute"
      onMouseEnter={props.stopHideTimer}
      onMouseLeave={props.startHideTimer}
    >
      <SizableText weight="bold">{`${
        props.type.charAt(0).toUpperCase() + props.type.slice(1)
      } settings`}</SizableText>
      <HypermediaLinkForm
        url={props.url}
        text={props.text}
        updateLink={props.updateHyperlink}
        editLink={props.editHyperlink}
        openUrl={props.openUrl}
        type={props.type}
        hasName={props.type !== 'mention'}
        hasSearch={props.type === 'mention'}
        seedEntityType={props.seedEntityType}
      />
    </YStack>
  )
}
