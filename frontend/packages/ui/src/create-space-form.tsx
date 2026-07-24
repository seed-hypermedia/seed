import {HelpCircle, X} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {Badge} from './components/badge'
import {Input} from './components/input'
import {Label} from './components/label'
import {ScrollArea} from './components/scroll-area'
import {Switch} from './components/switch'
import {SwitchField} from './form-fields'
import {ImageForm} from './image-form'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

export const SPACE_NAME_MAX_LENGTH = 20
const TOTAL_STEPS = 3

// Values for the header layout select. `stored` is the value persisted in
// home doc metadata.
export const CREATE_SPACE_HEADER_LAYOUTS = [
  {value: 'horizontal', label: 'Horizontal', stored: '' as const},
  {value: 'center', label: 'Center', stored: 'Center' as const},
] as const

export type CreateSpaceHeaderLayout = (typeof CREATE_SPACE_HEADER_LAYOUTS)[number]['value']

// Values the form collects before an account or space exists.
export type CreateSpaceFormState = {
  name: string
  cover: File | null
  logo: File | null
  headerLayout: CreateSpaceHeaderLayout
  contentWidth: 'S' | 'M' | 'L'
  showPublicationDate: boolean
  showActivity: boolean
}

export const defaultCreateSpaceFormState: CreateSpaceFormState = {
  name: '',
  cover: null,
  logo: null,
  headerLayout: 'horizontal',
  contentWidth: 'L',
  showPublicationDate: true,
  showActivity: true,
}

type StepProps = {
  state: CreateSpaceFormState
  update: (values: Partial<CreateSpaceFormState>) => void
}

/**
 * Create a space panel. Collects a CreateSpaceFormState and passes it to
 * onComplete callback.
 */
export function CreateSpaceForm({
  onComplete,
  onClose,
  initialState,
}: {
  onComplete: (state: CreateSpaceFormState) => void
  onClose?: () => void
  initialState?: Partial<CreateSpaceFormState>
}) {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<CreateSpaceFormState>({
    ...defaultCreateSpaceFormState,
    ...initialState,
  })

  function update(values: Partial<CreateSpaceFormState>) {
    setState((prev) => ({...prev, ...values}))
  }

  const isLastStep = step === TOTAL_STEPS - 1
  const canContinue = step > 0 || state.name.trim().length > 0

  function goNext() {
    if (isLastStep) onComplete(state)
    else setStep(step + 1)
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between p-4 pb-0">
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
          Step {step + 1}/{TOTAL_STEPS}
        </Badge>
        {onClose ? (
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 p-4">
          {step === 0 ? <NameStep state={state} update={update} /> : null}
          {step === 1 ? <IdentityStep state={state} update={update} /> : null}
          {step === 2 ? <AppearanceStep state={state} update={update} /> : null}
        </div>
      </ScrollArea>
      <div className="flex gap-2 p-4">
        {step === 1 ? (
          <Button variant="outline" size="lg" className="flex-1" onClick={goNext}>
            Skip for now
          </Button>
        ) : null}
        <Button variant="default" size="lg" className="flex-1" disabled={!canContinue} onClick={goNext}>
          {isLastStep ? 'Create space' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

function StepHeader({title, description}: {title: string; description: string}) {
  return (
    <div className="flex flex-col gap-2">
      <SizableText size="2xl" weight="bold" asChild>
        <h2>{title}</h2>
      </SizableText>
      <SizableText size="sm" className="text-muted-foreground">
        {description}
      </SizableText>
    </div>
  )
}

function NameStep({state, update}: StepProps) {
  return (
    <>
      <StepHeader
        title="Let's start! Name your space"
        description="This is how your space appears in links and search. You can always change it later from space settings."
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="space-name">Space name</Label>
          <SizableText size="xs" className="text-muted-foreground">
            {state.name.length}/{SPACE_NAME_MAX_LENGTH}
          </SizableText>
        </div>
        <Input
          id="space-name"
          value={state.name}
          maxLength={SPACE_NAME_MAX_LENGTH}
          onChange={(e) => update({name: e.target.value})}
        />
      </div>
    </>
  )
}

// Object URL for previewing an in memory image file, revoked on change/unmount.
function useFilePreviewUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])
  return url
}

function IdentityStep({state, update}: StepProps) {
  const coverUrl = useFilePreviewUrl(state.cover)
  const logoUrl = useFilePreviewUrl(state.logo)
  return (
    <>
      <StepHeader
        title="Add the main identity elements of your space"
        description="You can skip this and do it later from space settings if you prefer."
      />
      <div className="flex flex-col gap-1">
        <Label>Home cover image</Label>
        <ImageForm
          id="space-cover"
          height={120}
          url={coverUrl}
          uploadOnChange={false}
          suggestedSize="1600 × 400px"
          onImageUpload={(file) => {
            if (file instanceof File) update({cover: file})
          }}
          onRemove={() => update({cover: null})}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Space logo</Label>
        <ImageForm
          id="space-logo"
          height={100}
          url={logoUrl}
          uploadOnChange={false}
          emptyLabel="Add Logo"
          suggestedSize="100px height JPG or PNG"
          onImageUpload={(file) => {
            if (file instanceof File) update({logo: file})
          }}
          onRemove={() => update({logo: null})}
        />
      </div>
    </>
  )
}

function AppearanceStep({state, update}: StepProps) {
  return (
    <>
      <StepHeader
        title="Navigation & Appearance"
        description="Set up how your space and documents look. You can skip this and do it later from space settings if you prefer."
      />
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label>Header layout</Label>
          <Select
            value={state.headerLayout}
            onValueChange={(headerLayout: CreateSpaceFormState['headerLayout']) => update({headerLayout})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATE_SPACE_HEADER_LAYOUTS.map((layout) => (
                <SelectItem key={layout.value} value={layout.value}>
                  {layout.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label>Content width</Label>
          <Select
            value={state.contentWidth}
            onValueChange={(contentWidth: CreateSpaceFormState['contentWidth']) => update({contentWidth})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="S">Small</SelectItem>
              <SelectItem value="M">Medium</SelectItem>
              <SelectItem value="L">Large</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="bg-muted rounded-lg p-3">
        <SwitchField
          label="Set publication display date"
          id="space-publication-date"
          checked={state.showPublicationDate}
          onCheckedChange={(showPublicationDate) => update({showPublicationDate})}
        />
      </div>
      <div className="bg-muted flex items-center justify-between gap-4 rounded-lg p-3">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="space-activity-tabs">Show activity tabs</Label>
          <Tooltip content="Show the People, Comments, and Citations tabs on your site's pages.">
            <HelpCircle className="text-muted-foreground size-3.5" />
          </Tooltip>
        </div>
        <Switch
          id="space-activity-tabs"
          checked={state.showActivity}
          onCheckedChange={(showActivity) => update({showActivity})}
        />
      </div>
    </>
  )
}
