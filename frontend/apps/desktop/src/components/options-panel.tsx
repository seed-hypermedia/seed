import {UnpackedHypermediaId} from '@shm/shared'
import {SelectDropdown} from '@shm/ui'
import {Label, YStack} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'

export function OptionsPanel({
  onClose,
  draftId,
  onValue,
  value,
}: {
  onClose: () => void
  draftId: UnpackedHypermediaId
  onValue: (value: 'Seed/Experimental/Newspaper' | '') => void
  value: 'Seed/Experimental/Newspaper' | ''
}) {
  console.log('value', value)
  return (
    <AccessoryContainer title="Options" onClose={onClose}>
      <YStack>
        <Label size="$1">Layout</Label>
        <SelectDropdown
          width="100%"
          options={
            [
              {label: 'Newspaper Home', value: 'Seed/Experimental/Newspaper'},
              {label: 'Document', value: ''},
            ] as const
          }
          value={value}
          onValue={onValue}
        />
      </YStack>
    </AccessoryContainer>
  )
}
