/**
 * Settings → Advanced → DEVELOPERS → "Extension dev overrides".
 *
 * Edits the `seed.extensions.devOverrides` localStorage map (extension id →
 * dev server URL). When an override exists for an extension the host loads its
 * iframe from that URL instead of the published entry, so `vite dev` hot reload
 * works against the real app. docs/extensions/design.md §7.
 */

import {
  EXTENSION_DEV_OVERRIDES_STORAGE_KEY,
  readExtensionDevOverrides,
  writeExtensionDevOverride,
} from '@seed-hypermedia/client/extensions'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Live view of the override map; re-reads on storage events from other windows. */
export function useExtensionDevOverrides() {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => readExtensionDevOverrides(getStorage()))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === EXTENSION_DEV_OVERRIDES_STORAGE_KEY) {
        setOverrides(readExtensionDevOverrides(getStorage()))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const set = useCallback((extensionId: string, devUrl: string | null) => {
    setOverrides(writeExtensionDevOverride(getStorage(), extensionId, devUrl))
  }, [])
  return {overrides, set}
}

/** Normalize a pasted extension id: accepts `hm://uid/path` (any version/query is dropped). */
function normalizeExtensionId(input: string): string | null {
  const id = unpackHmId(input.trim())
  if (!id?.uid) return null
  return `hm://${id.uid}${id.path?.length ? `/${id.path.join('/')}` : ''}`
}

export function ExtensionDevOverridesEditor() {
  const {overrides, set} = useExtensionDevOverrides()
  const [extensionId, setExtensionId] = useState('')
  const [devUrl, setDevUrl] = useState('http://localhost:5181')

  const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))

  function handleAdd() {
    const id = normalizeExtensionId(extensionId)
    if (!id) {
      toast.error('Extension id must be an hm:// document URL')
      return
    }
    const url = devUrl.trim()
    if (!/^https?:\/\//.test(url)) {
      toast.error('Dev URL must start with http:// or https://')
      return
    }
    set(id, url)
    setExtensionId('')
    toast.success(`Override set for ${id}`)
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <SizableText size="xs" className="text-muted-foreground">
        While an override is set, the extension page loads its iframe from the dev server URL (still sandboxed) instead
        of the published entry. Stored in this app's localStorage under{' '}
        <code>{EXTENSION_DEV_OVERRIDES_STORAGE_KEY}</code>.
      </SizableText>
      {entries.length === 0 ? (
        <SizableText size="sm" className="text-muted-foreground">
          No overrides.
        </SizableText>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map(([id, url]) => (
            <div key={id} className="bg-background flex items-center gap-2 rounded-md border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <SizableText size="xs" className="truncate font-mono">
                  {id}
                </SizableText>
                <SizableText size="xs" className="text-muted-foreground truncate font-mono">
                  → {url}
                </SizableText>
              </div>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Remove override for ${id}`}
                onClick={() => set(id, null)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={extensionId}
          placeholder="hm://z6Mk…/my-extension"
          className="font-mono"
          onChange={(e) => setExtensionId(e.target.value)}
        />
        <Input
          value={devUrl}
          placeholder="http://localhost:5181"
          className="font-mono sm:max-w-[220px]"
          onChange={(e) => setDevUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
        <Button size="sm" variant="outline" onClick={handleAdd} disabled={!extensionId.trim() || !devUrl.trim()}>
          Add override
        </Button>
      </div>
    </div>
  )
}
