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
    <AccessoryBackButtonButton icon={ChevronLeft} onPress={onPress}>
      {label || 'All Comments'}
    </AccessoryBackButtonButton>
  )
}

const AccessoryBackButtonButton = styled(Button, {
  chromeless: true,
  size: '$3',
  name: 'AccessoryBackButtonButton',
  color: '$color10',
  borderRadius: '$4',
  paddingHorizontal: '$2',
  paddingVertical: 0,
  justifyContent: 'flex-start',
})
