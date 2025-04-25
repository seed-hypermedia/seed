import {unpackHmId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {useEffect, useMemo, useState} from 'react'
import {Button, SizableText, XStack, YStack} from 'tamagui'
import {Pencil} from '../../ui/src/icons'
import {HyperlinkToolbarProps} from './blocknote'
import {HypermediaLinkForm} from './hm-link-form'

export function HypermediaLinkPreview(
  props: HyperlinkToolbarProps & {
    url: string
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    stopEditing: boolean
    forceEditing?: boolean
    formComponents: () => React.JSX.Element
    type: string
    setHovered?: (hovered: boolean) => void
  },
) {
  const [isEditing, setIsEditing] = useState(props.forceEditing || false)
  const unpackedRef = useMemo(() => unpackHmId(props.url), [props.url])
  const entity = useEntity(unpackedRef)
  useEffect(() => {
    if (props.stopEditing && isEditing) {
      setIsEditing(false)
    }
  }, [props.stopEditing, isEditing])

  return (
    <XStack
      className="switch-toolbar"
      borderRadius="$5"
      background="$backgroundFocus"
      shadowColor="$shadowColorHover"
      elevation="$3"
      width={300}
      paddingVertical="$2"
      paddingHorizontal="$3"
      zIndex="$zIndex.4"
      {...(props.setHovered && {
        onMouseEnter: () => {
          props.setHovered?.(true)
        },
        onMouseLeave: () => {
          props.setHovered?.(false)
          props.editor.hyperlinkToolbar.startHideTimer()
        },
      })}
    >
      {isEditing ? (
        <YStack flex={1} gap="$2">
          <SizableText fontWeight="700">{`${
            props.type.charAt(0).toUpperCase() + props.type.slice(1)
          } settings`}</SizableText>

          {props.formComponents && props.formComponents()}

          <HypermediaLinkForm
            url={props.url}
            text={props.text}
            updateLink={props.updateHyperlink}
            editLink={props.editHyperlink}
            openUrl={props.openUrl}
            type={props.type}
            hasName={props.type !== 'embed' && props.type !== 'mention'}
            hasSearch={props.type !== 'link'}
            seedEntityType={unpackHmId(props.url)?.type}
          />
        </YStack>
      ) : (
        <XStack
          width="100%"
          justifyContent="space-between"
          alignItems="center"
          gap="$2"
        >
          <SizableText
            size="$4"
            color="$brand5"
            flex={1}
            overflow="hidden"
            whiteSpace="nowrap"
            textOverflow="ellipsis"
          >
            {entity.data?.document?.metadata.name ?? props.url}
          </SizableText>

          <Button
            icon={Pencil}
            size="$2"
            chromeless
            onPress={() => setIsEditing(true)}
          />
        </XStack>
      )}
    </XStack>
  )
}
