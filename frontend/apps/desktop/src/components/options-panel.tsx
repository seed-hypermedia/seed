import {upgradeNewspaperLayoutModel} from '@/models/upgrade-document-model'
import {ImageForm} from '@/pages/image-form'
import {HMBlockNode, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {
  Button,
  ButtonText,
  Heading,
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
  onResetContent,
}: {
  onClose: () => void
  draftId: UnpackedHypermediaId
  onMetadata: (values: Partial<HMMetadata>) => void
  metadata: HMMetadata
  onResetContent: (blockNodes: HMBlockNode[]) => void
}) {
  const isHomeDoc = !draftId.path?.length
  return (
    <AccessoryContainer
      title={isHomeDoc ? 'Home Options' : 'Document Options'}
      onClose={onClose}
    >
      <OptionsPanelContent
        draftId={draftId}
        metadata={metadata}
        onMetadata={onMetadata}
        onResetContent={onResetContent}
      />
    </AccessoryContainer>
  )
}

function OptionsPanelContent({
  draftId,
  metadata,
  onMetadata,
  onResetContent,
}: {
  draftId: UnpackedHypermediaId
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
  onResetContent: (blockNodes: HMBlockNode[]) => void
}) {
  const isHomeDoc = !draftId.path || draftId.path.length === 0
  const isNewspaperLayout = metadata.layout === 'Seed/Experimental/Newspaper'

  if (isNewspaperLayout) {
    return (
      <>
        <YStack
          theme="red"
          gap="$4"
          padding="$4"
          backgroundColor="$red3"
          borderRadius="$4"
        >
          <Heading size="$3" fontSize="$4">
            Document Model Upgrade Required
          </Heading>
          <Button
            onPress={() => {
              upgradeNewspaperLayoutModel(draftId, onMetadata, onResetContent)
            }}
          >
            Upgrade Document
          </Button>
        </YStack>
      </>
    )
  }

  return (
    <>
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
            Cover Image
          </Label>
          <ImageForm
            id={`cover-${draftId.id}`}
            label={metadata.cover}
            url={metadata.cover ? getDaemonFileUrl(metadata.cover) : ''}
            onImageUpload={(imageCid) => {
              if (imageCid) {
                onMetadata({
                  cover: `ipfs://${imageCid}`,
                })
              }
            }}
            onRemove={() => {
              onMetadata({
                cover: '',
              })
            }}
          />
        </YStack>
      </YStack>
      {isHomeDoc ? (
        <>
          <YStack>
            <Label color="$color9" size="$1">
              Header Layout
            </Label>
            <SelectDropdown
              width="100%"
              options={
                [
                  {label: 'Default', value: ''},
                  {label: 'Centered', value: 'Center'},
                ] as const
              }
              value={metadata.theme?.headerLayout || ''}
              onValue={(headerLayout) => onMetadata({theme: {headerLayout}})}
            />
          </YStack>
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
        </>
      ) : null}
      <OriginalPublishDate metadata={metadata} onMetadata={onMetadata} />
      {isHomeDoc ? null : (
        <OutlineVisibility metadata={metadata} onMetadata={onMetadata} />
      )}
    </>
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
