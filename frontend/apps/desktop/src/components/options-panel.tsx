import {ImageForm} from '@/pages/image-form'
import {
  HMBlockNode,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {SimpleDatePicker} from '@shm/ui/datepicker'
import {SwitchField} from '@shm/ui/form-fields'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {SizableText} from '@shm/ui/text'
import {useEffect, useRef, useState} from 'react'
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
      <div className="flex flex-col gap-4">
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
              className="mt-4 flex-1 px-1 select-none"
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
            <SummaryInput metadata={metadata} onMetadata={onMetadata} />
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
      </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
        Name
      </Label>
      <Input
        value={metadata.name}
        onChange={(e) => {
          const name = e.target.value
          onMetadata({name})
        }}
      />
    </div>
  )
}

function SummaryInput({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight(textareaRef.current)
    }
  }, [metadata.summary])

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // strip newlines:
    const textarea = e.target
    onMetadata({summary: textarea.value.replace(/\n/g, '')})

    // adjustHeight(textarea)
  }

  return (
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
        Summary
      </Label>
      <textarea
        ref={textareaRef}
        className="bg-muted border-border w-full rounded-md border-1 p-2 px-4"
        style={{
          resize: 'none',
          minHeight: '38px',
          overflow: 'hidden',
        }}
        value={metadata.summary}
        onChange={handleTextareaChange}
        onInput={(e) => {
          const textarea = e.target as HTMLTextAreaElement
          adjustHeight(textarea)
        }}
      />
    </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
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
    </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
        Cover Image
      </Label>
      <ImageForm
        height={100}
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
    </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
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
    </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
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
    </div>
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
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
        Header Logo
      </Label>
      <ImageForm
        emptyLabel="Add Logo"
        suggestedSize="height: 100px"
        height={100}
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
    </div>
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
      <Button size="sm" variant="link" onClick={() => setIsAdding(true)}>
        Set Publication Display Date
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <Label size="sm" className="text-muted-foreground">
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
    </div>
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
    <div className="flex flex-col gap-1">
      <SwitchField
        label="Show Outline"
        id="outline"
        defaultChecked={checked}
        onCheckedChange={(value) => {
          onMetadata({showOutline: value})
        }}
      />
    </div>
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
    <div className="flex flex-col gap-1">
      <SwitchField
        label="Enable Web Activity Panel"
        id="activity"
        checked={metadata.showActivity !== false}
        onCheckedChange={(value) => {
          onMetadata({showActivity: value})
        }}
      />
    </div>
  )
}

export function dateStringToDate(dateString: string) {
  return new Date(dateString)
}
