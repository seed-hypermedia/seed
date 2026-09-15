import {renderDesktopInlineEditor} from '@/components/commenting'
import {DesktopDocumentActionsProvider} from '@/components/document-actions-provider'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Feed} from '@shm/ui/feed'
import {GeneralPageContainer, GeneralPageHeader} from '@shm/ui/general-page'
import {Separator} from '@shm/ui/separator'

// Activity across every space this node has synced, shown when no space is open.
export default function DesktopNodeFeedPage() {
  return (
    <div className="h-full max-h-full overflow-hidden rounded-lg border bg-white dark:bg-black">
      <CommentsProvider
        useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
        renderInlineEditor={renderDesktopInlineEditor}
        showDeletedContent
      >
        <DesktopDocumentActionsProvider>
          <ScrollArea>
            <GeneralPageContainer>
              <GeneralPageHeader title="Activity Feed" />
              <Separator />
              <Feed filterResource={undefined} size="md" />
            </GeneralPageContainer>
          </ScrollArea>
        </DesktopDocumentActionsProvider>
      </CommentsProvider>
    </div>
  )
}
