import {useState, type ReactNode} from 'react'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Textarea} from '@shm/ui/components/textarea'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Switch} from '@shm/ui/components/switch'
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@shm/ui/components/tabs'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shm/ui/components/dialog'
import {Text} from '@shm/ui/text'
import {toast, Toaster} from '@shm/ui/toast'
import {AccountAvatar} from '@shm/ui/account-avatar'
import {ExplorePersonCard, ExploreDocumentCard} from '@shm/ui/explore-cards'
import {ContentEmbed} from '@shm/ui/content-embed'
import {ActivityEventCard} from '@shm/ui/activity-event-card'
import {ConnectionsPanel} from '@shm/ui/connections-panel'
import {PublishDomainStatus} from '@shm/ui/publish-site'
import {Notice} from '@shm/ui/notice'
import {StoryProviders, storyBlocks, storyDocument, storyDocumentInfo, storyId} from '@shm/ui/story-fixtures'

/** Configurable Storybook location, including relative deployment paths. */
export const storybookBase = import.meta.env.VITE_STORYBOOK_URL || 'http://localhost:6006'
/** Link a composed story to its matching Storybook entry. */
export function storyUrl(id: string): string {
  const url = new URL(storybookBase.replace(/\/?$/, '/'), window.location.href)
  url.searchParams.set('path', '/story/' + id)
  return url.href
}
function Composition({title, children}: {title: string; children: ReactNode}) {
  return (
    <article className="composition bg-card rounded-lg border p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {children}
    </article>
  )
}
/** Realistic offline combinations, sharing Storybook's providers and fixtures. */
export function Canvas() {
  const [publish, setPublish] = useState<'waiting-dns' | 'ready'>('waiting-dns')
  return (
    <StoryProviders>
      <div className="composition-grid">
        <Composition title="Document and activity">
          <div className="document-composition grid gap-6">
            <div className="bg-muted/20 min-w-0 self-start rounded-lg border p-6">
              <ContentEmbed
                id={storyId}
                blocks={storyBlocks}
                title="Project notes"
                openOnClick={false}
                identity={{id: storyId, name: 'Ada Lovelace'}}
              />
            </div>
            <aside className="flex flex-col gap-4">
              <Text weight="semibold">Activity & discussion</Text>
              <ActivityEventCard
                route={null}
                event={{
                  id: 'playground-event',
                  type: 'doc-update',
                  docId: storyId,
                  author: {id: storyId, metadata: {name: 'Ada Lovelace'}},
                  time: {seconds: 1792490400, nanos: 0},
                  document: storyDocument,
                }}
              />
              <div className="h-48 overflow-auto rounded-md border">
                <ConnectionsPanel docId={storyId} />
              </div>
              <Textarea aria-label="Comment" placeholder="Write a comment…" />
              <Button onClick={() => toast.success('Comment saved in this preview')}>Comment</Button>
            </aside>
          </div>
        </Composition>
        <Composition title="Account settings">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              toast.success('Settings saved')
            }}
          >
            <div className="flex items-center gap-3">
              <AccountAvatar id={storyId} name="Ada Lovelace" size={40} />
              <Text weight="semibold">Ada Lovelace</Text>
            </div>
            <label className="flex flex-col gap-2">
              Display name
              <Input defaultValue="Ada Lovelace" />
            </label>
            <label className="flex flex-col gap-2">
              Email
              <Input type="email" defaultValue="ada@example.com" />
            </label>
            <label className="flex items-center gap-2">
              <Checkbox defaultChecked />
              Email notifications
            </label>
            <label className="flex items-center justify-between gap-2">
              Public profile
              <Switch defaultChecked />
            </label>
            <Button type="submit">Save settings</Button>
          </form>
        </Composition>
        <Composition title="Publish flow">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              Site address
              <Input defaultValue="notes.example.com" />
            </label>
            <PublishDomainStatus
              hostname="notes.example.com"
              siteUrl="https://seed.hyper.media"
              status={publish}
              onRetry={() => setPublish('ready')}
              onCancel={() => setPublish('waiting-dns')}
            />
            <Notice tone="info" title="Preview environment">
              Publishing here changes only this offline preview.
            </Notice>
            <Button onClick={() => setPublish(publish === 'ready' ? 'waiting-dns' : 'ready')}>
              {publish === 'ready' ? 'Reconfigure' : 'Verify connection'}
            </Button>
          </div>
        </Composition>
        <Composition title="Explore feed">
          <div className="flex flex-col gap-4">
            <Input aria-label="Search explore feed" placeholder="Search documents and people" />
            <ExplorePersonCard account={{uid: storyId.uid, name: 'Ada Lovelace', role: 'owner'}} />
            <ExploreDocumentCard document={storyDocumentInfo} spaceName="Design notes" />
          </div>
        </Composition>
        <Composition title="Navigation and lists">
          <div className="flex flex-col gap-4">
            <Text weight="semibold">Workspace</Text>
            <Tabs defaultValue="documents">
              <TabsList>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
              </TabsList>
              <TabsContent value="documents">
                <div className="flex flex-col gap-2">
                  {['Project notes', 'Research', 'Meeting notes'].map((name) => (
                    <Button key={name} variant="ghost" className="justify-start">
                      {name}
                    </Button>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="people">
                <ExplorePersonCard account={{uid: storyId.uid, name: 'Ada Lovelace', role: 'owner'}} />
              </TabsContent>
            </Tabs>
          </div>
        </Composition>
        <Composition title="Dialogs and notifications">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Edit document</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit document</DialogTitle>
                  <DialogDescription>Changes stay in this preview.</DialogDescription>
                </DialogHeader>
                <Input aria-label="Document title" defaultValue="Project notes" />
                <Button onClick={() => toast.success('Document saved')}>Save</Button>
              </DialogContent>
            </Dialog>
            <Button onClick={() => toast.success('Changes saved')}>Show toast</Button>
            <Button variant="destructive" onClick={() => toast.error('Connection unavailable')}>
              Error toast
            </Button>
          </div>
        </Composition>
      </div>
      <Toaster />
    </StoryProviders>
  )
}
