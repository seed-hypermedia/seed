import {SizableText} from '@tamagui/text'
import {AccessoryContainer} from './accessory-sidebar'

export function CommentsPanel({
  onClose,
  openComment,
}: {
  onClose?: () => void
  openComment?: string
}) {
  return (
    <AccessoryContainer title="Comments" onClose={onClose}>
      <SizableText>{openComment}</SizableText>
    </AccessoryContainer>
  )
}
