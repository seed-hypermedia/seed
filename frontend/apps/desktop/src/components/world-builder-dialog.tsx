// "New World…" — the World Builder's entry point (Developer Mode, in a
// document's options menu). Collects a name, genre, epoch, and which kit types
// to include, then publishes the whole tree under the current document.
import {useNavigate} from '@/utils/useNavigate'
import {useState} from 'react'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Input} from '@shm/ui/components/input'
import {DateValueField} from '@shm/ui/onyx/date-field'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {toast} from '@shm/ui/toast'
import {
  buildWorldPlan,
  publishWorld,
  slugify,
  WORLD_GENRES,
  WORLD_KIT,
  WORLD_KIT_TYPES,
  type WorldKitType,
} from '../world-builder'

export type WorldBuilderDialogInput = {
  /** The document the world is created under. */
  parentId: UnpackedHypermediaId
}

export function WorldBuilderDialog({input, onClose}: {input: WorldBuilderDialogInput; onClose: () => void}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [genre, setGenre] = useState<(typeof WORLD_GENRES)[number]>('fantasy')
  const [epoch, setEpoch] = useState('')
  const [tagline, setTagline] = useState('')
  const [types, setTypes] = useState<Set<WorldKitType>>(new Set(WORLD_KIT_TYPES))
  const [starters, setStarters] = useState(true)
  const [progress, setProgress] = useState<string | null>(null)
  const uid = input.parentId.uid
  const basePath = input.parentId.path ?? []
  const slug = slugify(name || 'world')

  const toggle = (t: WorldKitType, on: boolean) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (on) next.add(t)
      else next.delete(t)
      return next
    })

  const create = async () => {
    if (!name.trim() || types.size === 0) return
    setProgress('Planning…')
    try {
      const plan = await buildWorldPlan({
        uid,
        basePath,
        name: name.trim(),
        genre,
        epoch: epoch || undefined,
        tagline: tagline.trim() || undefined,
        types: [...WORLD_KIT_TYPES].filter((t) => types.has(t)),
        starters,
      })
      await publishWorld(
        plan,
        {
          publishBlobs: (blobs) => client.request('PublishBlobs', {blobs}),
          publishDocument: (doc) => {
            if (!client.publishDocument) throw new Error('This client cannot publish documents')
            return client.publishDocument(doc)
          },
        },
        (done, total, doc) => setProgress(`Publishing ${done}/${total}: ${doc.metadata.name}`),
      )
      toast.success(`Created the world "${name.trim()}"`)
      onClose()
      navigate({key: 'document', id: plan.rootId})
    } catch (e) {
      console.error('World Builder failed', e)
      toast.error(e instanceof Error ? e.message : 'Failed to create the world')
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="world-builder-dialog">
      <div>
        <h2 className="text-lg font-semibold">New World</h2>
        <p className="text-muted-foreground text-sm">
          Scaffold a typed world under <span className="font-mono">/{[...basePath, slug].join('/')}</span>: a type page
          per kind (Character, Place, Faction, Event) whose fields reference each other, a folder per type that only
          accepts pages of that type, and a starter page in each.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs font-medium">World name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. The Shattered Coast"
          aria-label="World name"
          autoFocus
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Genre</span>
          <Select value={genre} onValueChange={(v) => setGenre(v as (typeof WORLD_GENRES)[number])}>
            <SelectTrigger aria-label="Genre">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORLD_GENRES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Chronicle begins (epoch)</span>
          <DateValueField value={epoch} mode="date" onValue={setEpoch} onClear={() => setEpoch('')} />
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs font-medium">Tagline (optional)</span>
        <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line about this world" />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs font-medium">Types to include</span>
        <div className="flex flex-wrap gap-4">
          {WORLD_KIT_TYPES.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={types.has(t)} onCheckedChange={(on) => toggle(t, on === true)} />
              {WORLD_KIT[t].singular}
            </label>
          ))}
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={starters} onCheckedChange={(on) => setStarters(on === true)} />
            starter pages
          </label>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t pt-3">
        {progress && <span className="text-muted-foreground mr-auto text-sm">{progress}</span>}
        <Button variant="ghost" onClick={onClose} disabled={!!progress}>
          Cancel
        </Button>
        <Button onClick={create} disabled={!!progress || !name.trim() || types.size === 0}>
          Create world
        </Button>
      </div>
    </div>
  )
}
