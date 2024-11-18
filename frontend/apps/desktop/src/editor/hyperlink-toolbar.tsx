import {unpackHmId} from '@shm/shared'
import {SizableText, SizeTokens, YStack} from '@shm/ui'
import {useEffect, useMemo, useState} from 'react'
import {HyperlinkToolbarProps} from './blocknote'
import {HypermediaLinkForm} from './hm-link-form'

export function HypermediaLinkToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    onClose: (bool: boolean) => void
    type: string
  },
) {
  const formSize: SizeTokens = '$2'

  const [_url, setUrl] = useState(props.url || '')
  const [_text, setText] = useState(props.text || '')
  const unpackedRef = useMemo(() => unpackHmId(_url), [_url])
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
      <SizableText fontWeight="700">{`${
        props.type.charAt(0).toUpperCase() + props.type.slice(1)
      } settings`}</SizableText>
      <HypermediaLinkForm
        url={props.url}
        text={props.text}
        updateLink={props.updateHyperlink}
        editLink={props.editHyperlink}
        openUrl={props.openUrl}
        type={props.type}
        hasName={true}
        hasSearch={props.type === 'mention'}
      />
      {/* <<YStack>
        <XStack ai="center" gap="$2" p="$1">
          <TextCursorInput size={16} />
          <Input
            flex={1}
            size={formSize}
            placeholder="link text"
            id="link-text"
            key={props.text}
            value={_text}
            onKeyPress={handleKeydown}
            onChangeText={(val) => {
              setText(val)
              props.updateHyperlink(props.url, val)
            }}
          />
        </XStack>
        <XStack ai="center" gap="$2" p="$1">
          <LinkIcon size={16} />
          <Input
            flex={1}
            size="$2"
            key={props.url}
            value={_url}
            onKeyPress={handleKeydown}
            onChangeText={(val) => {
              setUrl(val)
              props.updateHyperlink(val, props.text)
            }}
          />
        </XStack>
        <SizableText marginLeft={26} fontSize="$2" color="$brand5">
          {unpackedRef ? 'Seed Document' : 'Web Address'}
        </SizableText>
      </YStack>> */}
      {/* <Separator backgroundColor="$backgroundStrong" />
      <YStack p="$1">
        <XStack ai="center" gap="$2"> */}
      {/* {unpackedRef ? (
            <XStack ai="center" minWidth={200} gap="$2">
              <Checkbox
                id="link-latest"
                size="$2"
                key={_latest}
                value={_latest}
                onCheckedChange={(newValue) => {
                  let newUrl = createHmDocLink_DEPRECATED({
                    documentId: unpackedRef?.id,
                    version: unpackedRef?.version,
                    blockRef: unpackedRef?.blockRef,
                    variants: unpackedRef?.variants,
                    latest: newValue != 'indeterminate' ? newValue : false,
                  })
                  console.log('== newUrl', newUrl)
                  props.updateHyperlink(newUrl, props.text)
                  setUrl(newUrl)
                }}
              >
                <Checkbox.Indicator>
                  <Check />
                </Checkbox.Indicator>
              </Checkbox>
              <Label htmlFor="link-latest" size={formSize}>
                Link to Latest Version
              </Label>
            </XStack>
          ) : null} */}
      {/* <Tooltip content="Remove link">
            <Button
              chromeless
              size="$1"
              icon={Unlink}
              onPress={props.deleteHyperlink}
            />
          </Tooltip>
          <Tooltip content="Open in a new Window">
            <Button
              chromeless
              size="$1"
              icon={ExternalLink}
              onPress={() => props.openUrl(props.url, true)}
            />
          </Tooltip> */}
      {/* </XStack>
      </YStack> */}
    </YStack>
  )
}
