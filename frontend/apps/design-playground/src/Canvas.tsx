import {useState, type ReactNode} from 'react'
import {ArrowUpRight, Check, CircleAlert, Copy, FileText, Plus, Settings2} from 'lucide-react'
import {Button} from '@shm/ui/button'
import {Badge} from '@shm/ui/components/badge'
import {Input} from '@shm/ui/components/input'
import {Textarea} from '@shm/ui/components/textarea'
import {Checkbox} from '@shm/ui/components/checkbox'
import {RadioGroup, RadioGroupItem} from '@shm/ui/components/radio-group'
import {Switch} from '@shm/ui/components/switch'
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@shm/ui/components/tabs'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@shm/ui/components/dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@shm/ui/components/alert-dialog'
import {Progress} from '@shm/ui/components/progress'
import {Text} from '@shm/ui/text'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Tooltip} from '@shm/ui/tooltip'
import {toast, Toaster} from '@shm/ui/toast'
import {AccountAvatar} from '@shm/ui/account-avatar'
import {ProfileName} from '@shm/ui/profile-name'
import {ExplorePersonCard, ExploreDocumentCard} from '@shm/ui/explore-cards'
import {ContentEmbed} from '@shm/ui/content-embed'
import {ActivityEventCard} from '@shm/ui/activity-event-card'
import {ConnectionsPanel} from '@shm/ui/connections-panel'
import {PublishDomainStatus} from '@shm/ui/publish-site'
import {Notice} from '@shm/ui/notice'
import {StoryProviders, storyBlocks, storyDocument, storyDocumentInfo, storyId} from '@shm/ui/story-fixtures'

/** Configurable Storybook location; relative bases support the combined static site. */
export const storybookBase = import.meta.env.VITE_STORYBOOK_URL || 'http://localhost:6006'
/** Create a stable story URL for either an absolute origin or a relative deployment path. */
export function storyUrl(id: string): string {
  const url = new URL(storybookBase.replace(/\/?$/, '/'), window.location.href)
  url.searchParams.set('path', '/story/' + id)
  return url.href
}
function Card({
  title,
  story,
  children,
  className = '',
}: {
  title: string
  story: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={'sample-card ' + className}>
      <div className="sample-heading">
        <h2>{title}</h2>
        <a
          href={storyUrl(story)}
          target="_blank"
          rel="noreferrer"
          aria-label={'Open ' + title + ' in Storybook'}
          title="Open in Storybook"
        >
          <ArrowUpRight size={15} />
          <span className="sr-only">Open in Storybook</span>
        </a>
      </div>
      {children}
    </section>
  )
}

/** A masonry of real Seed components, using the same offline contexts as Storybook. */
export function Canvas({colors, checks}: {colors: Record<string, string>; checks: {label: string; ratio: number}[]}) {
  const [category, setCategory] = useState('design')
  const [publish, setPublish] = useState<'waiting-dns' | 'ready'>('waiting-dns')
  return (
    <StoryProviders>
      <div className="sample-grid">
        <Card title="Type & rhythm" story="components-text--default" className="type-card">
          <Badge variant="outline">THE SEED DESIGN SYSTEM</Badge>
          <Text asChild family="serif" className="type-headline">
            <h3>
              A little space.
              <br />
              For big ideas.
            </h3>
          </Text>
          <Text asChild size="sm" color="muted">
            <p>Good tools make room for thought. Explore the details that make Seed feel like Seed.</p>
          </Text>
          <div className="type-specimen">
            <Text size="xl" weight="semibold">
              Designing with intention
            </Text>
            <Text size="sm">A clear hierarchy. A comfortable reading rhythm.</Text>
            <Text family="mono" size="xs" color="muted">
              Aa Bb Cc · 0123456789 · {'{ seed }'}
            </Text>
            <a className="sample-link" href={storyUrl('components-text--large')}>
              A link worth following ↗
            </a>
          </div>
        </Card>
        <Card title="Actions" story="components-button--default">
          <div className="flex flex-wrap gap-2">
            {(
              [
                'default',
                'secondary',
                'outline',
                'ghost',
                'destructive',
                'danger',
                'accent',
                'link',
                'brand',
                'brand-12',
                'blue',
                'green',
                'orange',
                'inverse',
              ] as const
            ).map((variant) => (
              <Button key={variant} variant={variant} onClick={() => toast(variant + ' button pressed')}>
                {variant === 'default' ? 'Primary' : variant}
              </Button>
            ))}
          </div>
          <div className="sample-divider" />
          <div className="flex flex-wrap items-center gap-2">
            {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
              <Button key={size} variant="outline" size={size}>
                {size}
              </Button>
            ))}
            <Button variant="outline" size="icon" aria-label="Add">
              <Plus />
            </Button>
            <Button variant="outline" size="iconSm" aria-label="Copy">
              <Copy />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="default" loading>
              Saving
            </Button>
            <Button variant="outline" disabled>
              Unavailable
            </Button>
          </div>
        </Card>
        <Card title="Compose something" story="components-input--default">
          <div className="flex flex-col gap-4">
            <label className="sample-label">
              Page title
              <Input placeholder="An idea worth sharing" defaultValue="A garden of ideas" />
            </label>
            <label className="sample-label">
              Collection
              <SelectDropdown
                value={category}
                onValue={setCategory}
                options={[
                  {value: 'design', label: 'Design notes'},
                  {value: 'research', label: 'Research'},
                  {value: 'personal', label: 'Personal'},
                ]}
              />
            </label>
            <label className="sample-label">
              Your thoughts
              <Textarea placeholder="Start with a little curiosity…" rows={3} />
            </label>
            <Input aria-label="Disabled input" disabled placeholder="Read only" />
            <Input aria-label="Invalid input" aria-invalid defaultValue="An invalid value" />
            <Button variant="default" onClick={() => toast.success('Your idea is safe here.')}>
              <Plus />
              Create a page
            </Button>
          </div>
        </Card>
        <Card title="Color stories" story="components-button--secondary">
          <div className="swatch-grid">
            {[
              'background',
              'foreground',
              'primary',
              'secondary',
              'muted',
              'accent',
              'destructive',
              'border',
              'link',
              'card',
              'chart-1',
              'chart-2',
            ].map((name) => (
              <div key={name}>
                <span style={{background: colors['--' + name] || 'var(--' + name + ')'}} />
                <code>{name}</code>
              </div>
            ))}
          </div>
          <div className="brand-strip">
            {Array.from({length: 12}, (_, i) => (
              <span key={i} style={{background: 'var(--brand-' + (i + 1) + ')'}} title={'--brand-' + (i + 1)} />
            ))}
          </div>
          <Text size="xs" color="muted">
            The full twelve-step brand scale.
          </Text>
        </Card>
        <Card title="Small details" story="components-checkbox--default">
          <div className="flex flex-wrap gap-2">
            {(['default', 'secondary', 'accent', 'outline', 'warning', 'destructive'] as const).map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
          <div className="sample-divider" />
          <label className="sample-choice">
            <Checkbox defaultChecked />
            Email me the good things
          </label>
          <label className="sample-choice">
            <Checkbox />
            Include a little surprise
          </label>
          <RadioGroup defaultValue="public" aria-label="Page visibility" className="flex flex-wrap gap-4">
            <label className="sample-choice">
              <RadioGroupItem value="public" />
              Public
            </label>
            <label className="sample-choice">
              <RadioGroupItem value="private" />
              Private
            </label>
          </RadioGroup>
          <label className="sample-choice justify-between">
            Publish to the web
            <Switch defaultChecked />
          </label>
          <label className="sample-choice text-muted-foreground justify-between">
            Managed by your space
            <Switch disabled />
          </label>
          <Progress value={64} aria-label="Upload progress" />
        </Card>
        <Card title="Meet your people" story="components-accountavatar--default">
          <div className="flex items-center gap-3">
            <AccountAvatar id={storyId} name="Ada Lovelace" size={48} />
            <div>
              <ProfileName
                publicName="Ada Lovelace"
                petname="Ada"
                onSave={async () => {
                  toast.success('Contact name updated')
                }}
              />
              <Text size="xs" color="muted">
                A mind for the possibilities.
              </Text>
            </div>
          </div>
          <div className="sample-divider" />
          <ExplorePersonCard account={{uid: storyId.uid, name: 'Ada Lovelace', role: 'owner'}} />
          <a className="sample-link" href={storyUrl('components-profilename--default')}>
            Profile name in Storybook ↗
          </a>
        </Card>
        <Card title="A place for your notes" story="components-explorecards--document">
          <div className="document-cover">
            <FileText size={32} />
            <span>FIELD NOTES / 001</span>
          </div>
          <ExploreDocumentCard document={storyDocumentInfo} spaceName="Design notes" />
          <ContentEmbed
            id={storyId}
            blocks={storyBlocks}
            title="Project notes"
            openOnClick={false}
            identity={{id: storyId, name: 'Ada Lovelace'}}
          />
          <Notice tone="info" title="Yours to build on">
            A shared space for ideas, notes and new beginnings.
          </Notice>
        </Card>
        <Card title="Make the next move" story="components-dialog--default">
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>A fresh perspective</DialogTitle>
                  <DialogDescription>Real Seed dialog styles, with your live theme.</DialogDescription>
                </DialogHeader>
                <Input aria-label="Dialog page name" placeholder="Name your page" />
                <DialogClose asChild>
                  <Button variant="default">Save changes</Button>
                </DialogClose>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Alert dialog</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start over?</AlertDialogTitle>
                  <AlertDialogDescription>This is a preview. Nothing will be deleted.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep exploring</AlertDialogCancel>
                  <AlertDialogAction onClick={() => toast('Preview confirmed')}>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Tooltip asChild content="A little context, right when you need it.">
              <Button variant="outline" size="icon" aria-label="Show tooltip">
                <Settings2 />
              </Button>
            </Tooltip>
            <Button variant="default" onClick={() => toast.success('A little progress, celebrated.')}>
              Show toast
            </Button>
          </div>
          <Text size="sm" color="muted">
            Dialogs, tooltips and toasts stay connected to the same theme, even in a portal.
          </Text>
        </Card>
        <Card title="Keep things in view" story="components-tabs--default">
          <Tabs defaultValue="notes">
            <TabsList className="w-full">
              <TabsTrigger value="notes" className="flex-1">
                Notes
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-1">
                Activity
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">
                Settings
              </TabsTrigger>
            </TabsList>
            <TabsContent value="notes">
              <Text asChild size="sm" color="muted">
                <p className="py-3">One quiet place for everything you're thinking about.</p>
              </Text>
            </TabsContent>
            <TabsContent value="activity">
              <Text size="sm">You're all caught up.</Text>
            </TabsContent>
            <TabsContent value="settings">
              <label className="sample-choice py-3">
                Enable notifications
                <Switch />
              </label>
            </TabsContent>
          </Tabs>
        </Card>
        <Card title="Room for conversation" story="pages-connectionspanel--empty">
          <ConnectionsPanel docId={storyId} />
        </Card>
        <Card title="What's growing" story="components-activityeventcard--created">
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
        </Card>
        <Card title="Ready for the world" story="components-publishdomainstatus--default">
          <PublishDomainStatus
            hostname="notes.example.com"
            siteUrl="https://seed.hyper.media"
            status={publish}
            onRetry={() => setPublish('ready')}
            onCancel={() => setPublish('waiting-dns')}
          />
        </Card>
        <Card title="A little clarity" story="components-notice--default">
          <div className="contrast-title">
            <span>WCAG 2 · Normal text</span>
            <Badge variant="outline">AA ≥ 4.5:1</Badge>
          </div>
          <div className="contrast-list">
            {checks.map(({label, ratio}) => (
              <div key={label}>
                <div>
                  <code>{label}</code>
                  <span>{ratio.toFixed(2)}:1</span>
                </div>
                <span className={ratio >= 4.5 ? 'contrast-pass' : 'contrast-fail'}>
                  {ratio >= 4.5 ? <Check size={14} /> : <CircleAlert size={14} />}{' '}
                  {ratio >= 4.5 ? 'AA pass' : 'AA fail'}
                </span>
              </div>
            ))}
          </div>
          <Text size="xs" color="muted">
            Measured from rendered colors. A failing pair is a useful signal, not something we hide.
          </Text>
        </Card>
      </div>
      <Toaster />
    </StoryProviders>
  )
}
