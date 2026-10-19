import {useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {makeWebFileUpload} from '@/document-edit/web-image-upload'
import {useUpdateHomeDocument} from '@/models/site'
import type {HMDocument, HMMetadata, HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {Switch} from '@shm/ui/components/switch'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {useNavigate} from '@shm/shared/utils/navigation'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useImageUrl} from '@shm/ui/get-file-url'
import {ImageForm} from '@shm/ui/image-form'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Globe,
  Image as ImageIcon,
  Navigation as NavigationIcon,
  Plus,
  Trash,
} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useState} from 'react'
import {WebDomainSettings} from './web-hosting'

const SETTINGS_SECTIONS = [
  {key: 'identity', label: 'Identity', icon: ImageIcon},
  {key: 'navigation', label: 'Navigation', icon: NavigationIcon},
  {key: 'web-domain', label: 'Web Domain', icon: Globe},
] as const

/** Full-page browser settings use the desktop master/detail layout and owner delegation. */
export function WebSpaceSettingsPage({
  siteUid,
  section,
}: {
  siteUid: string
  section?: 'identity' | 'navigation' | 'web-domain'
}) {
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const navigate = useNavigate()
  const siteId = useMemo(() => hmId(siteUid, {latest: true}), [siteUid])
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  // Ownership follows the delegated account, independent of the site serving this page.
  const canManage = identity?.delegatedAccountUid === siteId.uid && !!identity?.capabilityCid
  const activeSection = section ?? 'identity'

  return (
    <div className="bg-panel flex h-full min-h-0 w-full overflow-hidden">
      <nav
        aria-label="Space Settings"
        className={cn(
          'border-border w-full shrink-0 flex-col gap-1 overflow-y-auto p-2 sm:flex sm:w-[220px] sm:border-r',
          section ? 'hidden' : 'flex',
        )}
      >
        <SizableText size="xs" weight="bold" color="muted" className="px-3 py-2 uppercase">
          Space Settings
        </SizableText>
        {SETTINGS_SECTIONS.map(({key, label, icon: Icon}) => (
          <button
            key={key}
            type="button"
            aria-current={activeSection === key ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
              activeSection === key ? 'bg-brand/10 text-brand-2 font-medium' : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={() => navigate({key: 'site-settings', id: siteId, tab: key})}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
      <ScrollArea className={cn('min-w-0 flex-1 sm:block', section ? 'block' : 'hidden')}>
        <div className="flex flex-col gap-6 p-4 sm:p-6">
          <Button
            variant="ghost"
            className="self-start sm:hidden"
            onClick={() => navigate({key: 'site-settings', id: siteId})}
          >
            <ArrowLeft className="size-4" />
            Space Settings
          </Button>
          {!identityLoaded ? (
            <div role="status" aria-label="Loading account" className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : !canManage ? (
            <p className="text-muted-foreground">Sign in as the space owner to change these settings.</p>
          ) : resource.isInitialLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : !document ? (
            <div className="flex flex-col gap-3">
              <p role="alert">
                {resource.isError ? 'Could not load your space.' : 'Publish your space before changing its settings.'}
              </p>
              {resource.isError ? <Button onClick={() => resource.refetch()}>Retry</Button> : null}
            </div>
          ) : (
            <div key={`${siteId.uid}:${identity?.id}:${identity?.capabilityCid}:${activeSection}`}>
              {activeSection === 'identity' && <IdentitySettings siteId={siteId} metadata={document.metadata} />}
              {activeSection === 'navigation' && <NavigationSettings siteId={siteId} document={document} />}
              {activeSection === 'web-domain' && <WebDomainSettings siteId={siteId} page />}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

type ImageValue = string | File | null

function IdentitySettings({siteId, metadata}: {siteId: UnpackedHypermediaId; metadata: HMMetadata}) {
  const update = useUpdateHomeDocument(siteId.uid)
  const client = useUniversalClient()
  const upload = useMemo(() => makeWebFileUpload(client), [client])
  const [name, setName] = useState<string | null>(null)
  const [logo, setLogo] = useState<ImageValue | undefined>()
  const [favicon, setFavicon] = useState<ImageValue | undefined>()
  const [cover, setCover] = useState<ImageValue | undefined>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameValue = name ?? metadata.name ?? ''
  const dirty = name !== null || logo !== undefined || favicon !== undefined || cover !== undefined

  async function resolveImage(value: ImageValue) {
    return value instanceof File ? `ipfs://${await upload(value)}` : value ?? ''
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const changes: Partial<HMMetadata> = {}
      if (name !== null) changes.name = nameValue.trim()
      if (logo !== undefined) changes.seedExperimentalLogo = await resolveImage(logo)
      if (favicon !== undefined) changes.icon = await resolveImage(favicon)
      if (cover !== undefined) changes.cover = await resolveImage(cover)
      await update.mutateAsync({updateMetadata: (current) => ({...current, ...changes})})
      setName(null)
      setLogo(undefined)
      setFavicon(undefined)
      setCover(undefined)
      toast.success('Space identity updated')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update space identity')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && nameValue.trim() && !saving) void save()
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <SizableText size="2xl" weight="bold">
          Identity
        </SizableText>
        <Button type="submit" aria-label="Save identity" disabled={!dirty || !nameValue.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="space-settings-name">Space name</Label>
          <Input
            id="space-settings-name"
            value={nameValue}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Space logo</Label>
          <ImagePicker
            label="Space logo"
            value={logo === undefined ? metadata.seedExperimentalLogo || null : logo}
            onChange={setLogo}
            logo
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Favicon</Label>
          <ImagePicker
            label="Favicon"
            value={favicon === undefined ? metadata.icon || null : favicon}
            onChange={setFavicon}
            square
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Home cover image</Label>
          <ImagePicker
            label="Home cover image"
            value={cover === undefined ? metadata.cover || null : cover}
            onChange={setCover}
          />
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </form>
  )
}

function ImagePicker({
  label,
  value,
  onChange,
  square,
  logo,
}: {
  label: string
  value: ImageValue
  onChange: (value: ImageValue) => void
  square?: boolean
  logo?: boolean
}) {
  const imageUrl = useImageUrl()
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!(value instanceof File)) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  return (
    <div role="group" aria-label={label}>
      <ImageForm
        url={value instanceof File ? preview : value ? imageUrl(value) : ''}
        height={square || logo ? 100 : 160}
        width={square ? 100 : undefined}
        emptyLabel={`Add ${label.toLowerCase()}`}
        suggestedSize={square ? '512 × 512px' : logo ? '100px height JPG or PNG' : '1600 × 400px'}
        uploadOnChange={false}
        crop={
          square
            ? {aspect: 1, maxDimension: 512}
            : logo
              ? undefined
              : {aspect: 4, maxDimension: 1600, format: 'image/jpeg'}
        }
        onImageUpload={(file) => {
          if (file instanceof File) onChange(file)
        }}
      />
      {value ? (
        <Button variant="ghost" type="button" size="sm" onClick={() => onChange(null)}>
          Remove {label.toLowerCase()}
        </Button>
      ) : null}
    </div>
  )
}

function publishedNavigation(document: HMDocument): HMNavigationItem[] {
  return (
    document.detachedBlocks?.navigation?.children?.flatMap(({block}) =>
      block?.type === 'Link'
        ? [{id: block.id, type: 'Link' as const, text: block.text || '', link: block.link || ''}]
        : [],
    ) ?? []
  )
}

function validNavigationLink(value: string) {
  if (value.startsWith('hm://')) return !!unpackHmId(value)
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function NavigationSettings({siteId, document}: {siteId: UnpackedHypermediaId; document: HMDocument}) {
  const update = useUpdateHomeDocument(siteId.uid)
  const [items, setItems] = useState<HMNavigationItem[] | null>(null)
  const [layout, setLayout] = useState<'' | 'Center' | null>(null)
  const [width, setWidth] = useState<HMMetadata['contentWidth']>()
  const [activity, setActivity] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const metadata = document.metadata
  const nav = items ?? publishedNavigation(document)
  const layoutValue = layout ?? metadata.theme?.headerLayout ?? ''
  const activityValue = activity ?? metadata.showActivity ?? true
  const dirty = items !== null || layout !== null || activity !== null || width !== undefined
  const valid = nav.every((item) => item.text.trim() && validNavigationLink(item.link.trim()))
  function change(index: number, value: Partial<HMNavigationItem>) {
    setItems(nav.map((item, i) => (i === index ? {...item, ...value} : item)))
  }
  function move(index: number, offset: number) {
    const next = [...nav]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + offset, 0, item)
    setItems(next)
  }
  async function save() {
    setSaving(true)
    setError(null)
    try {
      await update.mutateAsync({
        updateMetadata: (current) => ({
          ...current,
          ...(activity === null ? {} : {showActivity: activity}),
          ...(layout === null ? {} : {theme: {...current.theme, headerLayout: layout}}),
          ...(width === undefined ? {} : {contentWidth: width}),
        }),
        navigation: items?.map((item) => ({...item, text: item.text.trim(), link: item.link.trim()})),
      })
      setItems(null)
      setLayout(null)
      setActivity(null)
      setWidth(undefined)
      toast.success('Navigation updated')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update navigation')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && valid && !saving) void save()
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <SizableText size="2xl" weight="bold">
          Navigation
        </SizableText>
        <Button type="submit" aria-label="Save navigation" disabled={!dirty || !valid || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          Home is always the first navigation item. Add links in the order you want them to appear.
        </p>
        {nav.map((item, index) => (
          <div key={item.id} className="border-border flex min-w-0 flex-col gap-2 rounded-md border p-3">
            <Label htmlFor={`nav-name-${item.id}`}>Link name</Label>
            <Input
              id={`nav-name-${item.id}`}
              value={item.text}
              onChange={(event) => change(index, {text: event.target.value})}
              required
            />
            <Label htmlFor={`nav-url-${item.id}`}>Link address</Label>
            <Input
              id={`nav-url-${item.id}`}
              value={item.link}
              onChange={(event) => change(index, {link: event.target.value})}
              placeholder="https://… or hm://…"
              required
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move link ${index + 1} up`}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move link ${index + 1} down`}
                disabled={index === nav.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove link ${index + 1}`}
                onClick={() => setItems(nav.filter((_, i) => i !== index))}
              >
                <Trash className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setItems([...nav, {id: nanoid(), type: 'Link', text: '', link: ''}])}
        >
          <Plus className="size-4" />
          Add navigation item
        </Button>
        <div className="flex flex-col gap-2">
          <Label htmlFor="space-header-layout">Header layout</Label>
          <Select
            value={layoutValue || 'horizontal'}
            onValueChange={(value) => setLayout(value === 'Center' ? 'Center' : '')}
            disabled={saving}
          >
            <SelectTrigger id="space-header-layout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">Horizontal</SelectItem>
              <SelectItem value="Center">Center</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="space-content-width">Content width</Label>
          <Select
            value={width ?? metadata.contentWidth ?? 'L'}
            onValueChange={(value) => setWidth(value as HMMetadata['contentWidth'])}
            disabled={saving}
          >
            <SelectTrigger id="space-content-width">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="S">Small</SelectItem>
              <SelectItem value="M">Medium</SelectItem>
              <SelectItem value="L">Large</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="space-show-activity">Show activity tabs</Label>
          <Switch id="space-show-activity" checked={activityValue} onCheckedChange={setActivity} disabled={saving} />
        </div>
      </fieldset>
      {!valid ? (
        <p className="text-muted-foreground text-sm">Each link needs a name and a valid web or Seed address.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </form>
  )
}
