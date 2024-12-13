import {ImageForm} from '@/pages/image-form'
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
  const isNewspaperLayout = metadata.layout === 'Seed/Experimental/Newspaper'
  const isSplashLayout = metadata.layout === 'Seed/Experimental/Splash'
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
                {label: 'Splash Home', value: 'Seed/Experimental/Splash'},
                {label: 'Document', value: ''},
              ] as const
            }
            value={metadata.layout || ''}
            onValue={(layout) => onMetadata({layout})}
          />
        </YStack>
      </YStack>
      <YStack>
        <Label size="$1">Header Logo</Label>
        <ImageForm
          size={100}
          id={`logo-${draftId.id}`}
          label={metadata.seedExperimentalLogo}
          url={
            metadata.seedExperimentalLogo
              ? getFileUrl(metadata.seedExperimentalLogo)
              : ''
          }
          onImageUpload={(imgageCid) => {
            if (imgageCid) {
              onMetadata({
                seedExperimentalLogo: `ipfs://${imgageCid}`,
              })
            }
          }}
          onRemove={() => {
            onMetadata({
              seedExperimentalLogo: '',
            })
          }}
        />
      </YStack>
      {isNewspaperLayout ? (
        <YStack>
          <Label size="$1">Sort Home Content</Label>
          <SelectDropdown
            width="100%"
            options={
              [
                {label: 'Last Updated First', value: 'UpdatedFirst'},
                {label: 'Last Created First', value: 'CreatedFirst'},
              ] as const
            }
            value={metadata.seedExperimentalHomeOrder || 'UpdatedFirst'}
            onValue={(seedExperimentalHomeOrder) =>
              onMetadata({seedExperimentalHomeOrder})
            }
          />
        </YStack>
      ) : null}
      {isSplashLayout ? (
        <>
          <YStack>
            <Label size="$1">Splash Image</Label>
            <ImageForm
              size={100}
              id={`splash-${draftId.id}`}
              label={metadata.seedExperimentalSplashBackgroundImage}
              url={
                metadata.seedExperimentalSplashBackgroundImage
                  ? getFileUrl(metadata.seedExperimentalSplashBackgroundImage)
                  : ''
              }
              onImageUpload={(imgageCid) => {
                if (imgageCid) {
                  onMetadata({
                    seedExperimentalSplashBackgroundImage: `ipfs://${imgageCid}`,
                  })
                }
              }}
              onRemove={() => {
                onMetadata({
                  seedExperimentalSplashBackgroundImage: '',
                })
              }}
            />
          </YStack>
          <YStack>
            <Label size="$1">Splash Hero Color</Label>
            <SelectDropdown
              width="100%"
              options={
                [
                  {label: 'blue', value: 'blue'},
                  {label: 'green', value: 'green'},
                  {label: 'red', value: 'red'},
                  {label: 'yellow', value: 'yellow'},
                ] as const
              }
              value={metadata.seedExperimentalSplashBackgroundColor || 'blue'}
              onValue={(seedExperimentalSplashBackgroundColor) =>
                onMetadata({seedExperimentalSplashBackgroundColor})
              }
            />
          </YStack>
        </>
      ) : null}
    </AccessoryContainer>
  )
}
