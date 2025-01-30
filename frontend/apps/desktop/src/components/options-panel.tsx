import {ImageForm} from '@/pages/image-form'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {
  ButtonText,
  Input,
  Label,
  SelectDropdown,
  SimpleDatePicker,
  SwitchField,
  YStack,
} from '@shm/ui'
import {getDaemonFileUrl} from '@shm/ui/src/get-file-url'
import {useState} from 'react'
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
  return (
    <AccessoryContainer
      title={isHome ? 'Home Options' : 'Document Options'}
      onClose={onClose}
    >
      <YStack gap="$4">
        <YStack>
          <Label color="$color9" size="$1">
            Name
          </Label>
          <Input
            size="$"
            value={metadata.name}
            onChangeText={(name) => onMetadata({name})}
          />
        </YStack>
        <YStack>
          <Label color="$color9" size="$1">
            Icon
          </Label>
          <IconForm
            size={100}
            id={`icon-${draftId.id}`}
            label={metadata.name}
            url={metadata.icon ? getDaemonFileUrl(metadata.icon) : ''}
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
          <Label color="$color9" size="$1">
            Layout
          </Label>
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
      {isNewspaperLayout ? (
        <>
          <YStack>
            <Label color="$color9" size="$1">
              Header Logo
            </Label>
            <ImageForm
              size={100}
              id={`logo-${draftId.id}`}
              label={metadata.seedExperimentalLogo}
              url={
                metadata.seedExperimentalLogo
                  ? getDaemonFileUrl(metadata.seedExperimentalLogo)
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
          <YStack>
            <Label color="$color9" size="$1">
              Sort Home Content
            </Label>
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
        </>
      ) : null}
      <OriginalPublishDate metadata={metadata} onMetadata={onMetadata} />
      {!isNewspaperLayout ? (
        <OutlineVisibility metadata={metadata} onMetadata={onMetadata} />
      ) : null}
    </AccessoryContainer>
  )
}

function OriginalPublishDate({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  const [isAdding, setIsAdding] = useState(false)
  if (!isAdding && !metadata.displayPublishTime) {
    return (
      <ButtonText size="$1" color="$blue10" onPress={() => setIsAdding(true)}>
        Set Publication Display Date
      </ButtonText>
    )
  }
  return (
    <YStack>
      <Label color="$color9" size="$1">
        Publication Display Date
      </Label>
      <SimpleDatePicker
        value={
          metadata.displayPublishTime
            ? dateStringToDate(metadata.displayPublishTime).toDateString()
            : new Date().toDateString()
        }
        onValue={(displayPublishTime) => {
          onMetadata({displayPublishTime})
        }}
        onReset={() => {
          setIsAdding(false)
          onMetadata({displayPublishTime: ''})
        }}
      />
    </YStack>
  )
}

function OutlineVisibility({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
    <YStack
    // borderTopWidth={1}
    // // borderBottomWidth={1}
    // borderColor="$color6"
    // paddingVertical="$4"
    >
      <SwitchField
        label="Show outline"
        id="outline"
        defaultChecked={
          typeof metadata.showOutline == 'undefined'
            ? true
            : metadata.showOutline
        }
        opacity={
          typeof metadata.showOutline == 'undefined'
            ? 1
            : metadata.showOutline
            ? 1
            : 0.4
        }
        onCheckedChange={(value) => {
          onMetadata({showOutline: value})
        }}
      />
    </YStack>
  )
}

export function dateStringToDate(dateString: string) {
  return new Date(dateString)
}
