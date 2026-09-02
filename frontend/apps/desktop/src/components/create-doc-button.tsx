import { roleCanWrite, useSelectedAccountCapability } from '@/models/access-control'
import { useMyAccountIds } from '@/models/daemon'
import { useCreateDraft } from '@/models/documents'
import { buildDocumentCollectionDraftSeed } from '@/utils/publish-utils'
import { UnpackedHypermediaId } from '@seed-hypermedia/client/hm-types'
import { Button } from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import { Add } from '@shm/ui/icons'
import { MenuItemType } from '@shm/ui/options-dropdown'
import { FilePlus2, Grid3X3, Import, Lock } from 'lucide-react'
import { nanoid } from 'nanoid'
import { ReactNode, useCallback, useMemo } from 'react'
import { useImportDialog, useImporting } from './import-doc-button'

/** Builds the document creation submenu item and its dialog content for the document options menu. */
export function useCreateDocumentMenuItem({
  locationId,
  canCreateChildren = true,
}: {
  locationId: UnpackedHypermediaId
  canCreateChildren?: boolean
}): {
  menuItem: MenuItemType | null
  content: ReactNode
} {
  const capability = useSelectedAccountCapability(locationId)
  const canEdit = roleCanWrite(capability?.role)
  const createDraft = useCreateDraft({
    locationPath: locationId.path || undefined,
    locationUid: locationId.uid,
  })
  const myAccountIds = useMyAccountIds()
  const importing = useImporting(locationId)
  const importDialog = useImportDialog()

  const openImportDialog = useCallback(() => {
    importDialog.open({
      onImportFile: importing.importFile,
      onImportDirectory: importing.importDirectory,
      onImportLatexFile: importing.importLatexFile,
      onImportLatexDirectory: importing.importLatexDirectory,
      onImportWebSite: importing.importWebSite,
      onImportWordPress: importing.importWordPress,
    })
  }, [importDialog, importing])

  const menuItem = useMemo<MenuItemType | null>(() => {
    if (!myAccountIds.data?.length) return null
    if (!canEdit || !canCreateChildren) return null

    return {
      key: 'new',
      label: 'New',
      icon: <Add className="size-4" />,
      children: [
        {
          key: 'new-document',
          label: 'Document',
          icon: <FilePlus2 className="size-4" />,
          onClick: () => {
            void createDraft()
          },
        },
        {
          key: 'new-document-collection',
          label: 'Collection',
          icon: <Grid3X3 className="size-4" />,
          onClick: () => {
            const seed = buildDocumentCollectionDraftSeed(nanoid(8))
            void createDraft({ initialMetadata: seed.metadata, initialContent: seed.content })
          },
        },
        {
          key: 'new-private-document',
          label: 'Private',
          icon: <Lock className="size-4" />,
          onClick: () => {
            void createDraft({ visibility: 'PRIVATE' })
          },
        },
        {
          key: 'import',
          label: 'Import',
          icon: <Import className="size-4" />,
          onClick: openImportDialog,
        },
      ],
    }
  }, [canCreateChildren, canEdit, createDraft, myAccountIds.data?.length, openImportDialog])

  return {
    menuItem,
    content: (
      <>
        {importDialog.content}
        {importing.content}
      </>
    ),
  }
}

function CreateDocumentButtonContent({ locationId }: { locationId: UnpackedHypermediaId }) {
  const { menuItem, content } = useCreateDocumentMenuItem({ locationId })

  if (!menuItem) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="sm" className="justify-center">
            <Add className="size-4" />
            <span className="truncate">New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {menuItem.children?.map((item) => (
            <div key={item.key}>
              {item.key === 'import' ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onClick={(event) => item.onClick?.(event as any)}>
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {content}
    </>
  )
}

/** Renders the standalone document creation dropdown used outside the document top bar. */
export function CreateDocumentButton({ locationId }: { locationId?: UnpackedHypermediaId }) {
  if (!locationId) return null

  return <CreateDocumentButtonContent locationId={locationId} />
}
