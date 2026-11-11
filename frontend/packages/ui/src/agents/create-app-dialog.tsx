import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {pathNameify} from '@shm/shared/utils/path'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useState} from 'react'
import {APP_TOOL_TYPE, APP_TYPE} from './apps'
import {signDocumentAttributes, type PreparedAgentMount} from './mount'
import {useNavigate} from './navigation'

/** What an app's slug may look like: the server refuses an app page with any other. */
export const APP_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** The slug an app named `name` gets by default: its path form, cut to the length a slug may have. */
export function appSlugFromName(name: string): string {
  return pathNameify(name)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)
}

/** The two pages New → App publishes: the app page, and its typed `tools` folder. */
export type AppPagePlan = {
  app: {id: UnpackedHypermediaId; attrs: {key: string[]; value: string}[]}
  tools: {id: UnpackedHypermediaId; attrs: {key: string[]; value: string}[]}
}

/**
 * The app page lands under `parent` at its slug, and its `tools` folder beneath it, typed so that a
 * document created inside is a tool page with the tool's contract and code as its attributes.
 */
export function appPagePlan(
  parent: UnpackedHypermediaId,
  {name, slug, summary}: {name: string; slug: string; summary: string},
): AppPagePlan {
  const appPath = [...(parent.path ?? []), slug]
  return {
    app: {
      id: hmId(parent.uid, {path: appPath}),
      attrs: [
        {key: ['name'], value: name},
        {key: ['summary'], value: summary},
        {key: ['attributesSchema'], value: APP_TYPE},
        {key: ['slug'], value: slug},
      ],
    },
    tools: {
      id: hmId(parent.uid, {path: [...appPath, 'tools']}),
      attrs: [
        {key: ['name'], value: 'Tools'},
        {key: ['summary'], value: `The tools of ${name}: one page per tool, with its contract and its code.`},
        {key: ['childAttributesSchema'], value: APP_TOOL_TYPE},
      ],
    },
  }
}

/** Signs both pages of the plan; the app page first, since the folder is its child. */
export async function prepareAppPages({
  client,
  accountUid,
  plan,
}: {
  client: ReturnType<typeof useUniversalClient>
  accountUid: string
  plan: AppPagePlan
}): Promise<PreparedAgentMount[]> {
  const app = await signDocumentAttributes({client, accountUid, to: plan.app.id, attrs: plan.app.attrs})
  const tools = await signDocumentAttributes({client, accountUid, to: plan.tools.id, attrs: plan.tools.attrs})
  return [app, tools]
}

/**
 * New → App: names the app, publishes its page and its typed tools folder under the location on
 * screen, and opens the page. A tool is then a new document inside the folder, with its code
 * uploaded from the attribute pill; installing the app is a page of its own.
 */
export function CreateAppDialog({
  input,
  onClose,
}: {
  input: {accountUid: string; location: UnpackedHypermediaId}
  onClose: () => void
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const {onPushPublished} = useUniversalAppContext()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [summary, setSummary] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const effectiveSlug = slugEdited ? slug : appSlugFromName(name)
  const slugValid = APP_SLUG_PATTERN.test(effectiveSlug)
  const ready = name.trim().length > 0 && summary.trim().length > 0 && slugValid

  async function create() {
    if (!ready || creating) return
    setCreating(true)
    setError(null)
    try {
      const plan = appPagePlan(input.location, {name: name.trim(), slug: effectiveSlug, summary: summary.trim()})
      const pages = await prepareAppPages({client, accountUid: input.accountUid, plan})
      await client.publish({blobs: pages.flatMap((page) => page.blobs)})
      for (const page of [plan.app, plan.tools]) invalidateQueries([queryKeys.ENTITY, page.id.id])
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, plan.app.id.uid])
      onPushPublished?.(plan.app.id)
      toast.success('App created')
      onClose()
      navigate({key: 'document', id: plan.app.id})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the app')
    } finally {
      setCreating(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <DialogTitle>New app</DialogTitle>
      <DialogDescription>
        An app is a page with a tools folder. Each tool is a page inside it that carries the tool's contract and code;
        the app's page is what its users read.
      </DialogDescription>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Datalab converter"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Slug
        </SizableText>
        <Input
          value={effectiveSlug}
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.target.value)
          }}
          placeholder="converter"
        />
        <SizableText size="xs" color="muted">
          {slugValid || !effectiveSlug
            ? 'Lowercase letters, digits, - and _, up to 32 characters. The environment names the app by it.'
            : 'A slug is lowercase letters, digits, - and _, up to 32 characters, starting with a letter or digit.'}
        </SizableText>
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Summary
        </SizableText>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="What the app does, in one sentence"
        />
      </label>
      {error ? (
        <SizableText size="sm" className="text-destructive">
          {error}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || creating}>
          {creating ? 'Creating…' : 'Create app'}
        </Button>
      </div>
    </form>
  )
}
