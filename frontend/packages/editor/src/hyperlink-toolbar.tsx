import {HyperlinkToolbarProps} from '@/blocknote'
import {SizableText} from '@shm/ui/text'
import {useEffect, useState} from 'react'
import {HypermediaLinkForm} from './hm-link-form'
export function HypermediaLinkToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    onClose: (bool: boolean) => void
    type: string
    isFocused: boolean
    setIsFocused: (focused: boolean) => void
  },
) {
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
    <div
      className="bg-muted absolute bottom-0 z-50 flex flex-col gap-2 overflow-hidden rounded-md px-3 py-4 shadow-md"
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
        isHmLink={!!unpackedRef}
      />
    </div>
  )
}
