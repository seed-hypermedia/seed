import {ImageForm} from '@/pages/image-form'
import {
  HMBlockNode,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {SimpleDatePicker} from '@shm/ui/datepicker'
import {SwitchField} from '@shm/ui/form-fields'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {SizableText} from '@shm/ui/text'
import {useState} from 'react'
import {ButtonText, Input, Label, YStack} from 'tamagui'
import {AccessoryContent} from './accessory-sidebar'
import {IconForm} from './icon-form'

export function OptionsPanel({
  draftId,
  onMetadata,
  metadata,
  onResetContent,
  isHomeDoc,
}: {
  draftId: string
  onMetadata: (values: Partial<HMMetadata>) => void
  metadata: HMMetadata
  onResetContent: (blockNodes: HMBlockNode[]) => void
  isHomeDoc: boolean
}) {
  return (
    <AccessoryContent>
      <YStack gap="$4">
        {isHomeDoc ? (
          <>
            <NameInput metadata={metadata} onMetadata={onMetadata} />
            <DocumentIconForm
              draftId={draftId}
              metadata={metadata}
              onMetadata={onMetadata}
            />
            <HeaderLogo
              draftId={draftId}
              metadata={metadata}
              onMetadata={onMetadata}
            />
            <HeaderLayout metadata={metadata} onMetadata={onMetadata} />

            <SizableText
              className="select-none px-1 mt-4 flex-1"
              size="md"
              weight="semibold"
            >
              Document Options
            </SizableText>
            <CoverImage
              draftId={draftId}
              metadata={metadata}
              onMetadata={onMetadata}
            />
            <OriginalPublishDate metadata={metadata} onMetadata={onMetadata} />
            <ContentWidth metadata={metadata} onMetadata={onMetadata} />
            <ActivityVisibility metadata={metadata} onMetadata={onMetadata} />
          </>
        ) : (
          <>
            <NameInput metadata={metadata} onMetadata={onMetadata} />
            <DocumentIconForm
              draftId={draftId}
              metadata={metadata}
              onMetadata={onMetadata}
            />
            <CoverImage
              draftId={draftId}
              metadata={metadata}
              onMetadata={onMetadata}
            />
            <OriginalPublishDate metadata={metadata} onMetadata={onMetadata} />
            <OutlineVisibility metadata={metadata} onMetadata={onMetadata} />
            <ActivityVisibility metadata={metadata} onMetadata={onMetadata} />
            <ContentWidth metadata={metadata} onMetadata={onMetadata} />
          </>
        )}
      </YStack>
    </AccessoryContent>
  )
}

function NameInput({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
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
  )
}

function DocumentIconForm({
  draftId,
  metadata,
  onMetadata,
}: {
  draftId: string
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
    <YStack>
      <Label color="$color9" size="$1">
        Icon
      </Label>
      <IconForm
        size={100}
        id={`icon-${draftId}`}
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
  )
}

function CoverImage({
  draftId,
  metadata,
  onMetadata,
}: {
  draftId: string
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
    <YStack>
      <Label color="$color9" size="$1">
        Cover Image
      </Label>
      <ImageForm
        maxHeight={100}
        id={`cover-${draftId}`}
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
  )
}

function ContentWidth({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
    <YStack>
      <Label color="$color9" size="$1">
        Content Width
      </Label>
      <SelectDropdown
        width="100%"
        options={
          [
            {value: 'S', label: 'Small'},
            {value: 'M', label: 'Medium'},
            {value: 'L', label: 'Large'},
          ] as const
        }
        value={metadata.contentWidth || 'M'}
        onValue={(contentWidth) => {
          onMetadata({contentWidth})
        }}
      />
    </YStack>
  )
}

function HeaderLayout({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
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
  )
}

function HeaderLogo({
  draftId,
  metadata,
  onMetadata,
}: {
  draftId: UnpackedHypermediaId
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
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
      <ButtonText size="$1" color="$brand5" onPress={() => setIsAdding(true)}>
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
  const checked =
    typeof metadata.showOutline == 'undefined' || metadata.showOutline
  return (
    <YStack>
      <SwitchField
        label="Show Outline"
        id="outline"
        defaultChecked={checked}
        opacity={checked ? 1 : 0.4}
        onCheckedChange={(value) => {
          onMetadata({showOutline: value})
        }}
      />
    </YStack>
  )
}

function ActivityVisibility({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  return (
    <YStack>
      <SwitchField
        label="Enable Web Activity Panel"
        id="activity"
        checked={metadata.showActivity !== false}
        opacity={metadata.showActivity !== false ? 1 : 0.4}
        onCheckedChange={(value) => {
          onMetadata({showActivity: value})
        }}
      />
    </YStack>
  )
}

export function dateStringToDate(dateString: string) {
  return new Date(dateString)
}
