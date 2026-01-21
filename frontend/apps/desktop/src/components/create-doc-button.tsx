import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {UnpackedHypermediaId} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@shm/ui/hover-card'
import {Add} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {ChevronDown, FilePlus2, Info, Lock} from 'lucide-react'
import {usePublishSite} from './publish-site'

export function CreateDocumentButton({
  locationId,
}: {
  locationId?: UnpackedHypermediaId
}) {
  const capability = useSelectedAccountCapability(locationId)
  const canEdit = roleCanWrite(capability?.role)
  const isHomeDoc = !locationId?.path?.length
  const createDraft = useCreateDraft({
    locationPath: locationId?.path || undefined,
    locationUid: locationId?.uid,
  })
  const myAccountIds = useMyAccountIds()
  const selectedAccount = useSelectedAccount()
  const publishSite = usePublishSite()

  const siteUrl =
    selectedAccount?.type === 'document'
      ? selectedAccount.document?.metadata?.siteUrl
      : undefined
  const hasSiteUrl = Boolean(siteUrl)

  if (!myAccountIds.data?.length) return null
  if (!canEdit) return null

  // Non-home docs: simple button, no dropdown
  if (!isHomeDoc) {
    return (
      <Button
        variant="default"
        className="justify-center"
        onClick={() => createDraft()}
      >
        <Add className="size-4" />
        <span className="truncate">New</span>
      </Button>
    )
  }

  // Home doc: dropdown with public/private options
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" className="justify-center">
            <Add className="size-4" />
            <span className="truncate">New</span>
            <ChevronDown size={14} className="ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => createDraft()}>
            <FilePlus2 className="size-4" />
            Public Document
          </DropdownMenuItem>
          {hasSiteUrl ? (
            <DropdownMenuItem
              onClick={() => createDraft({visibility: 'PRIVATE'})}
            >
              <Lock className="size-4" />
              Private Document
            </DropdownMenuItem>
          ) : (
            <HoverCard openDelay={100}>
              <HoverCardTrigger asChild>
                <div>
                  <DropdownMenuItem
                    className="pointer-events-none opacity-50"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Lock className="size-4" />
                    Private Document
                    <Info className="text-muted-foreground ml-auto size-3" />
                  </DropdownMenuItem>
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="right" sideOffset={12} className="w-64">
                <div className="flex flex-col gap-3">
                  <SizableText size="sm" className="text-muted-foreground">
                    To create private documents, you need to configure your web
                    domain first.
                  </SizableText>
                  <Button
                    size="sm"
                    variant="brand"
                    onClick={() => {
                      if (selectedAccount?.id) {
                        publishSite.open({id: selectedAccount.id})
                      }
                    }}
                  >
                    Set Up Web Domain
                  </Button>
                </div>
              </HoverCardContent>
            </HoverCard>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {publishSite.content}
    </>
  )
}
