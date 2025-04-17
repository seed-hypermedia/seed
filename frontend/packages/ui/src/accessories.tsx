import {ChevronLeft} from '@tamagui/lucide-icons'
import {Button} from 'tamagui'

import {styled} from 'tamagui'

export function AccessoryBackButton({
  onPress,
  label,
}: {
  onPress: () => void
  label?: string
}) {
  return (
    <StyledAccessoryBackButton icon={ChevronLeft} onPress={onPress}>
      {label || 'All Comments'}
    </StyledAccessoryBackButton>
  )
}

const StyledAccessoryBackButton = styled(Button, {
  chromeless: true,
  size: '$3',
  name: 'StyledAccessoryBackButton',
  color: '$color10',
  borderRadius: '$4',
  paddingHorizontal: '$2',
  paddingVertical: 0,
  justifyContent: 'flex-start',
})
