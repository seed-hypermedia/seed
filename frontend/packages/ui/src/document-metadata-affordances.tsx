import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {FileText, ImagePlus, Plus, Smile} from 'lucide-react'
import {ChangeEvent, useCallback, useEffect, useRef, useState} from 'react'
import {Button} from './button'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {cn} from './utils'

type MetadataAffordanceKey = 'icon' | 'cover'

export type DocumentMetadataAffordanceButtonsProps = {
  metadata?: Pick<HMMetadata, 'icon' | 'cover' | 'summary'> | null
  visible: boolean
  onMetadata: (values: Partial<HMMetadata>) => void
  onRequestSummary: () => void
  fileUpload?: (file: File) => Promise<string>
  className?: string
  onBeforeMetadataChange?: () => void
  showSummary?: boolean
  keepSummaryButtonVisible?: boolean
  hideSummaryButton?: boolean
  alwaysVisibleOnMobile?: boolean
  mobileOnly?: boolean
}

export type EditableDocumentMetadataFieldsProps = {
  name: string
  summary: string
  metadata?: Pick<HMMetadata, 'icon' | 'cover' | 'summary'> | null
  onMetadata: (values: Partial<HMMetadata>) => void
  onBeginEdit: () => void
  fileUpload?: (file: File) => Promise<string>
  className?: string
  titleClassName?: string
  summaryClassName?: string
  focusTitleOnMount?: boolean
  onCancelEdit?: () => void
  onSummaryEnter?: () => void
  summaryRequested: boolean
  onSummaryRequestedChange: (requested: boolean) => void
}

export type HomeDocumentMetadataAffordanceBarProps = {
  metadata?: Pick<HMMetadata, 'icon' | 'cover' | 'summary'> | null
  onMetadata: (values: Partial<HMMetadata>) => void
  onBeginEdit: () => void
  fileUpload?: (file: File) => Promise<string>
  className?: string
}

function toIpfsUrl(cidOrUrl: string) {
  return cidOrUrl.startsWith('ipfs://') ? cidOrUrl : `ipfs://${cidOrUrl}`
}

/** Subtle inline buttons that hint at optional document metadata fields. */
export function DocumentMetadataAffordanceButtons({
  metadata,
  visible,
  onMetadata,
  onRequestSummary,
  fileUpload,
  className,
  onBeforeMetadataChange,
  showSummary = true,
  keepSummaryButtonVisible = false,
  hideSummaryButton = false,
  alwaysVisibleOnMobile = false,
  mobileOnly = false,
}: DocumentMetadataAffordanceButtonsProps) {
  const iconInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const summaryMenuRequestedRef = useRef(false)
  const [uploading, setUploading] = useState<MetadataAffordanceKey | null>(null)
  const hasIcon = !!metadata?.icon
  const hasCover = !!metadata?.cover
  const hasSummary = !!metadata?.summary
  const showIconButton = !hasIcon && !!fileUpload
  const showSummaryButton = showSummary && !hideSummaryButton && (!hasSummary || keepSummaryButtonVisible)
  const showCoverButton = !hasCover && !!fileUpload
  const hiddenClass = alwaysVisibleOnMobile
    ? 'opacity-100 md:pointer-events-none md:opacity-0'
    : 'pointer-events-none opacity-0'
  const rowIsAccessible = visible || alwaysVisibleOnMobile
  const tabIndex = rowIsAccessible ? undefined : -1

  async function handleFileChange(field: MetadataAffordanceKey, event: ChangeEvent<HTMLInputElement>) {
    event.stopPropagation()
    const file = event.target.files?.[0]
    if (!file || !fileUpload) return

    setUploading(field)
    try {
      const cid = await fileUpload(file)
      onBeforeMetadataChange?.()
      onMetadata({[field]: toIpfsUrl(cid)} as Partial<HMMetadata>)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Failed to upload document ${field}: ${message}`, error)
    } finally {
      setUploading(null)
      event.target.value = ''
    }
  }

  if (!showIconButton && !showSummaryButton && !showCoverButton) {
    return null
  }

  if (mobileOnly) {
    const menuItems: (MenuItemType | null)[] = [
      showIconButton
        ? {
            key: 'icon',
            label: 'Add icon',
            icon: <Smile className="size-3.5" />,
            onClick: () => iconInputRef.current?.click(),
          }
        : null,
      showSummaryButton
        ? {
            key: 'summary',
            label: 'Add Summary',
            icon: <FileText className="size-3.5" />,
            onClick: () => {
              summaryMenuRequestedRef.current = true
              onBeforeMetadataChange?.()
            },
          }
        : null,
      showCoverButton
        ? {
            key: 'cover',
            label: 'Add cover image',
            icon: <ImagePlus className="size-3.5" />,
            onClick: () => coverInputRef.current?.click(),
          }
        : null,
    ]

    return (
      <div className="md:hidden">
        {showIconButton ? (
          <input
            ref={iconInputRef}
            type="file"
            accept="image/*"
            aria-label="Choose document icon"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void handleFileChange('icon', event)}
          />
        ) : null}
        {showCoverButton ? (
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            aria-label="Choose document cover image"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void handleFileChange('cover', event)}
          />
        ) : null}
        <OptionsDropdown
          menuItems={menuItems}
          align="end"
          side="bottom"
          button={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-full px-2 text-xs font-medium opacity-80 hover:bg-black/5 hover:opacity-100 active:scale-[0.98] dark:hover:bg-white/10"
              aria-label="Add document metadata"
            >
              <Plus className="size-3.5" />
              <span>Add</span>
            </Button>
          }
          onCloseAutoFocus={(event) => {
            if (summaryMenuRequestedRef.current) {
              event.preventDefault()
              onRequestSummary()
            }
            summaryMenuRequestedRef.current = false
          }}
        />
      </div>
    )
  }

  return (
    <div
      data-document-metadata-affordances
      className={cn(
        'flex flex-wrap items-center gap-1.5 transition-opacity duration-200 motion-reduce:transition-none',
        visible ? 'opacity-100' : hiddenClass,
        className,
      )}
      aria-hidden={!rowIsAccessible}
    >
      {showIconButton ? (
        <>
          <input
            ref={iconInputRef}
            type="file"
            accept="image/*"
            aria-label="Choose document icon"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void handleFileChange('icon', event)}
          />
          <MetadataHintButton
            aria-label="Add document icon"
            icon={<Smile className="size-3.5" />}
            loading={uploading === 'icon'}
            tabIndex={tabIndex}
            onClick={() => iconInputRef.current?.click()}
          >
            Add icon
          </MetadataHintButton>
        </>
      ) : null}
      {showSummaryButton ? (
        <MetadataHintButton
          aria-label="Add document summary"
          icon={<FileText className="size-3.5" />}
          tabIndex={tabIndex}
          onClick={() => {
            onBeforeMetadataChange?.()
            onRequestSummary()
          }}
        >
          Add Summary
        </MetadataHintButton>
      ) : null}
      {showCoverButton ? (
        <>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            aria-label="Choose document cover image"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void handleFileChange('cover', event)}
          />
          <MetadataHintButton
            aria-label="Add document cover image"
            icon={<ImagePlus className="size-3.5" />}
            loading={uploading === 'cover'}
            tabIndex={tabIndex}
            onClick={() => coverInputRef.current?.click()}
          >
            Add cover image
          </MetadataHintButton>
        </>
      ) : null}
    </div>
  )
}

/** Editable title/summary fields with subtle metadata add buttons. */
export function EditableDocumentMetadataFields({
  name,
  summary,
  metadata,
  onMetadata,
  onBeginEdit,
  fileUpload,
  className,
  titleClassName,
  summaryClassName,
  focusTitleOnMount,
  onCancelEdit,
  onSummaryEnter,
  summaryRequested,
  onSummaryRequestedChange,
}: EditableDocumentMetadataFieldsProps) {
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const summaryRef = useRef<HTMLTextAreaElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [summaryFocused, setSummaryFocused] = useState(false)
  const summaryText = summary ?? ''
  const showSummaryInput = !!summaryText || summaryRequested || summaryFocused
  const showAffordances = hovered || summaryRequested

  const reflowTextareas = useCallback(() => {
    const resize = () => {
      if (titleRef.current) resizeTextarea(titleRef.current)
      if (summaryRef.current) resizeTextarea(summaryRef.current)
    }

    resize()
    requestAnimationFrame(resize)
    ;(document as Document & {fonts?: FontFaceSet}).fonts?.ready.then(resize).catch(() => {})
  }, [])

  useEffect(() => {
    if (titleRef.current) resizeTextarea(titleRef.current)
  }, [name])

  useEffect(() => {
    const resizeTextareas = () => {
      if (titleRef.current) resizeTextarea(titleRef.current)
      if (summaryRef.current) resizeTextarea(summaryRef.current)
    }

    resizeTextareas()
    window.addEventListener('resize', resizeTextareas)
    return () => window.removeEventListener('resize', resizeTextareas)
  }, [])

  useEffect(() => {
    if (focusTitleOnMount) titleRef.current?.focus()
  }, [focusTitleOnMount])

  useEffect(() => {
    if (summaryRef.current) resizeTextarea(summaryRef.current)
  }, [summaryText, showSummaryInput])

  useEffect(() => {
    reflowTextareas()
    window.addEventListener('resize', reflowTextareas)

    const container = titleRef.current?.parentElement
    const observer = container && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reflowTextareas) : null
    observer?.observe(container!)

    return () => {
      window.removeEventListener('resize', reflowTextareas)
      observer?.disconnect()
    }
  }, [reflowTextareas])

  useEffect(() => {
    if (!summaryRequested) return
    summaryRef.current?.focus()
  }, [summaryRequested])

  function requestSummary() {
    onSummaryRequestedChange(true)
  }

  return (
    <div
      className={cn('relative flex flex-col gap-2', metadata?.cover && 'pt-8', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <DocumentMetadataAffordanceButtons
        metadata={metadata}
        visible={showAffordances}
        fileUpload={fileUpload}
        className={cn('absolute left-0 z-10 -ml-2 pb-1 max-md:hidden', metadata?.cover ? 'top-0' : 'bottom-full')}
        onBeforeMetadataChange={onBeginEdit}
        onMetadata={onMetadata}
        onRequestSummary={requestSummary}
        keepSummaryButtonVisible={summaryRequested}
        hideSummaryButton={summaryFocused && !summaryRequested && !summaryText}
        alwaysVisibleOnMobile
      />
      <textarea
        ref={titleRef}
        rows={1}
        aria-label="Document title"
        className={cn(
          'w-full resize-none border-none border-transparent bg-transparent text-2xl font-bold shadow-none ring-0 ring-transparent outline-none focus:ring-0 max-md:leading-tight md:text-4xl',
          titleClassName,
        )}
        value={name}
        onFocus={onBeginEdit}
        onInput={(event) => {
          resizeTextarea(event.currentTarget)
          onMetadata({name: event.currentTarget.value})
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancelEdit?.()
            event.currentTarget.blur()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            requestSummary()
          }
        }}
        placeholder="Document Title"
      />
      {showSummaryInput ? (
        <textarea
          ref={summaryRef}
          rows={1}
          aria-label="Document summary"
          className={cn(
            'text-muted-foreground w-full resize-none border-none border-transparent bg-transparent font-serif text-xl font-normal shadow-none ring-0 ring-transparent outline-none focus:ring-0',
            summaryClassName,
          )}
          value={summaryText}
          onFocus={() => {
            setSummaryFocused(true)
            onBeginEdit()
          }}
          onInput={(event) => {
            const nextSummary = event.currentTarget.value.replace(/\n/g, '')
            resizeTextarea(event.currentTarget)
            onMetadata({summary: nextSummary})
          }}
          onBlur={(event) => {
            const relatedTarget = event.relatedTarget
            if (
              relatedTarget instanceof Element &&
              relatedTarget.closest('[role="menu"], [data-radix-menu-content], [data-radix-popover-content]')
            ) {
              return
            }
            onSummaryRequestedChange(false)
            setSummaryFocused(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCancelEdit?.()
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onSummaryEnter?.()
            }
          }}
          placeholder="Document Summary"
        />
      ) : null}
    </div>
  )
}

/** Metadata affordance area used by home documents, which have no document header. */
export function HomeDocumentMetadataAffordanceBar({
  metadata,
  onMetadata,
  onBeginEdit,
  fileUpload,
  className,
}: HomeDocumentMetadataAffordanceBarProps) {
  const showAffordances = true

  return (
    <div data-home-document-metadata-affordances className={cn('flex flex-col gap-2 px-4 pt-5 sm:px-6', className)}>
      <DocumentMetadataAffordanceButtons
        metadata={metadata}
        visible={showAffordances}
        fileUpload={fileUpload}
        onBeforeMetadataChange={onBeginEdit}
        onMetadata={onMetadata}
        onRequestSummary={() => {}}
        showSummary={false}
      />
    </div>
  )
}

function MetadataHintButton({
  children,
  icon,
  ...props
}: React.ComponentProps<'button'> & {icon: React.ReactNode; loading?: boolean}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-muted-foreground hover:text-foreground h-7 rounded-full px-2 text-xs font-medium opacity-80 hover:bg-black/5 hover:opacity-100 active:scale-[0.98] dark:hover:bg-white/10"
      {...props}
    >
      {icon}
      <span>{children}</span>
    </Button>
  )
}

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
