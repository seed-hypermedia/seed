import {getFileUrl, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {Input, Label, SelectDropdown, YStack} from '@shm/ui'
import {AccessoryContainer} from './accessory-sidebar'
import {IconForm} from './icon-form'

export function OptionsPanel({
  onClose,
  draftId,
  onMetadata,
  metadata,
}: {
  onClose: () => void
  draftId: UnpackedHypermediaId
  onMetadata: (values: Partial<HMMetadata>) => void
  metadata: HMMetadata
}) {
  const isHome = !draftId.path || draftId.path.length === 0
  return (
    <AccessoryContainer
      title={isHome ? 'Home Options' : 'Document Options'}
      onClose={onClose}
    >
      <YStack gap="$4">
        <YStack>
          <Label size="$1">Name</Label>
          <Input
            size="$"
            value={metadata.name}
            onChangeText={(name) => onMetadata({name})}
          />
        </YStack>
        <YStack>
          <Label size="$1">Icon</Label>
          <IconForm
            size={100}
            id={`icon-${draftId.id}`}
            label={metadata.name}
            url={metadata.icon ? getFileUrl(metadata.icon) : ''}
            onIconUpload={(icon) => {
              if (icon) {
                onMetadata({
                  icon: `ipfs://${icon}`,
                })
              }
            }}
            onRemoveIcon={() => {
              onMetadata({
                icon: '',
              })
            }}
          />
        </YStack>
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
            value={metadata.layout || ''}
            onValue={(layout) => onMetadata({layout})}
          />
        </YStack>
      </YStack>
    </AccessoryContainer>
  )
}
