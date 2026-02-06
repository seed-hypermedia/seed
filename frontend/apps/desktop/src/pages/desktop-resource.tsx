import {CommentBox} from '@/components/commenting'
import {CreateDocumentButton} from '@/components/create-doc-button'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useExistingDraft} from '@/models/drafts'
import {useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {hmId} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {ResourcePage} from '@shm/ui/resource-page-common'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Pencil} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useNavigate} from '@/utils/useNavigate'

export default function DesktopResourcePage() {
  const route = useNavRoute()
  const navigate = useNavigate()

  // Only handle document-related routes
  const supportedKeys = [
    'document',
    'feed',
    'directory',
    'collaborators',
    'activity',
    'discussions',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  // @ts-expect-error - route.id exists on all supported route types
  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  const existingDraft = useExistingDraft(route)
  const capability = useSelectedAccountCapability(docId)
  const canEdit = roleCanWrite(capability?.role)

  // Get site URL for CreateDocumentButton
  const siteHomeResource = useResource(hmId(docId.uid), {subscribed: true})
  const siteUrl =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document?.metadata?.siteUrl
      : undefined

  const editActions = canEdit ? (
    <>
      <Tooltip content={existingDraft ? 'Resume Editing' : 'Edit'}>
        <Button
          size="sm"
          variant={existingDraft ? undefined : 'ghost'}
          className={cn(existingDraft && 'bg-yellow-200')}
          onClick={() => {
            if (existingDraft) {
              navigate({
                key: 'draft',
                id: existingDraft.id,
                panel: null,
              })
            } else {
              navigate({
                key: 'draft',
                id: nanoid(10),
                editUid: docId.uid,
                editPath: docId.path || [],
                deps: docId.version ? [docId.version] : undefined,
                panel: null,
              })
            }
          }}
        >
          <Pencil className="size-4" />
          {existingDraft ? 'Resume Editing' : 'Edit'}
        </Button>
      </Tooltip>
      <CreateDocumentButton locationId={docId} siteUrl={siteUrl} />
    </>
  ) : null

  return (
    <div className="h-full max-h-full overflow-hidden rounded-lg border bg-white">
      <ResourcePage
        docId={docId}
        CommentEditor={CommentBox}
        editActions={editActions}
        existingDraft={existingDraft}
      />
    </div>
  )
}
