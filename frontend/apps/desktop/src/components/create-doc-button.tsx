import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useChildDrafts} from '@/models/documents'
import {useExperiments} from '@/models/experiments'
import {buildDocumentCollectionDraftSeed} from '@/utils/publish-utils'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {deriveDocumentType} from '@shm/shared/models/document-machine'
import {documentCreationMachine, inferDocumentSchema} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {queryQueryBlock} from '@shm/shared/models/queries'
import {useUniversalClient} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {Button} from '@shm/ui/button'
import {DocumentCreateButton} from '@shm/ui/document-create-button'
import {toast} from '@shm/ui/toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Add} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {emptyStructSchema} from '@shm/ui/schema/schema-editor'
import {FileCode2, FilePlus2, Grid3X3, Import} from 'lucide-react'
import {nanoid} from 'nanoid'
import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useActorRef, useSelector} from '@xstate/react'
import {useQuery} from '@tanstack/react-query'
import {useImportDialog, useImporting} from './import-doc-button'

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
  const experiments = useExperiments().data
  // The Hypermedia Schemas dev toggle (Settings → Developers) exposes schema creation here.
  const schemasEnabled = !!experiments?.hypermediaSchemas
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
        ...(schemasEnabled
          ? [
              {
                key: 'new-schema',
                label: 'Schema',
                icon: <FileCode2 className="size-4" />,
                onClick: () => {
                  // A real (public) document draft carrying a working schema: the Schema tab
                  // edits it in place; publish freezes it into a blob via schemaDefinition.
                  void createDraft({initialSchemaDraft: emptyStructSchema()})
                },
              },
            ]
          : []),
        {
          key: 'new-document-collection',
          label: 'Collection',
          icon: <Grid3X3 className="size-4" />,
          onClick: () => {
            const seed = buildDocumentCollectionDraftSeed(nanoid(8))
            void createDraft({initialMetadata: seed.metadata, initialContent: seed.content})
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
  }, [canCreateChildren, canEdit, createDraft, myAccountIds.data?.length, openImportDialog, schemasEnabled])

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

function CreateDocumentButtonContent({locationId}: {locationId: UnpackedHypermediaId}) {
  const {menuItem, content} = useCreateDocumentMenuItem({locationId})

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
export function CreateDocumentButton({locationId}: {locationId?: UnpackedHypermediaId}) {
  if (!locationId) return null

  return <CreateDocumentButtonContent locationId={locationId} />
}

function DesktopActorButton({
  locationId,
  currentIsCollection,
  parentId,
  parentIsCollection,
  canEditParent,
  schema,
  onImportFinished,
}: {
  locationId: UnpackedHypermediaId
  currentIsCollection: boolean
  parentId?: UnpackedHypermediaId
  parentIsCollection: boolean
  canEditParent: boolean
  schema?: ReturnType<typeof inferDocumentSchema>
  onImportFinished: () => void
}) {
  const destination = parentIsCollection && canEditParent && parentId ? parentId : locationId
  const createAtDestination = useCreateDraft({
    locationUid: destination.uid,
    locationPath: destination.path ?? undefined,
  })
  const createSubdocument = useCreateDraft({locationUid: locationId.uid, locationPath: locationId.path ?? undefined})
  const importStarted = useRef(false)
  const importing = useImporting(destination, schema, onImportFinished)
  const importDialog = useImportDialog(() => {
    if (!importStarted.current) onImportFinished()
  })
  const actor = useActorRef(documentCreationMachine, {
    input: {
      currentId: locationId,
      resolve: async () => ({
        canEditCurrent: true,
        currentIsCollection,
        parentId,
        parentIsCollection,
        canEditParent,
        schema,
      }),
      create: async (request) => {
        const createDraft = request.kind === 'subdocument' ? createSubdocument : createAtDestination
        if (request.kind === 'collection') {
          const seed = buildDocumentCollectionDraftSeed(nanoid(8))
          await createDraft({initialMetadata: {...seed.metadata, ...request.metadata}, initialContent: seed.content})
        } else {
          await createDraft({initialMetadata: request.metadata})
        }
        return request.destination
      },
    },
  })
  const snapshot = useSelector(actor, (state) => state)

  useEffect(() => {
    if (snapshot.value !== 'failedCreation') return
    toast.error(snapshot.context.error instanceof Error ? snapshot.context.error.message : 'Could not create document')
    actor.send({type: 'retry.requested'})
  }, [actor, snapshot.context.error, snapshot.value])

  return (
    <>
      <DocumentCreateButton
        hidden={JSON.stringify(snapshot.value) === JSON.stringify({resolved: 'hidden'})}
        disabled={JSON.stringify(snapshot.value) !== JSON.stringify({resolved: 'ready'})}
        showSubdocument={snapshot.can({type: 'create.requested', kind: 'subdocument'})}
        onCreate={(kind) => actor.send({type: 'create.requested', kind})}
        onImport={() => {
          actor.send({type: 'import.requested'})
          if (actor.getSnapshot().output?.type !== 'import') return
          importDialog.open({
            onImportFile: () => {
              importStarted.current = true
              importing.importFile()
            },
            onImportDirectory: () => {
              importStarted.current = true
              importing.importDirectory()
            },
            onImportLatexFile: () => {
              importStarted.current = true
              importing.importLatexFile()
            },
            onImportLatexDirectory: () => {
              importStarted.current = true
              importing.importLatexDirectory()
            },
            onImportWebSite: () => {
              importStarted.current = true
              importing.importWebSite()
            },
            onImportWordPress: () => {
              importStarted.current = true
              importing.importWordPress()
            },
          })
        }}
      />
      {importDialog.content}
      {importing.content}
    </>
  )
}

/** Actor-backed document creation split button for the desktop document toolbar. */
export function DesktopDocumentCreateButton({locationId}: {locationId: UnpackedHypermediaId}) {
  const client = useUniversalClient()
  const current = useResource(locationId)
  const currentDocument = current.data?.type === 'document' ? current.data.document : undefined
  const currentCapability = useSelectedAccountCapability(locationId)
  const canEditCurrent = roleCanWrite(currentCapability?.role)
  const parentId = locationId.path?.length ? hmId(locationId.uid, {path: locationId.path.slice(0, -1)}) : undefined
  const parent = useResource(parentId)
  const parentDocument = parent.data?.type === 'document' ? parent.data.document : undefined
  const parentCapability = useSelectedAccountCapability(parentId)
  const canEditParent = roleCanWrite(parentCapability?.role)
  const currentIsCollection =
    !!currentDocument && deriveDocumentType(currentDocument.content, locationId) === 'collection'
  const parentIsCollection =
    !!parentDocument && !!parentId && deriveDocumentType(parentDocument.content, parentId) === 'collection'
  const schemaId = currentIsCollection ? locationId : parentIsCollection && canEditParent ? parentId : undefined
  const children = useQuery(
    queryQueryBlock(
      client,
      schemaId
        ? {
            query: {
              includes: [{space: schemaId.uid, path: hmIdPathToEntityQueryPath(schemaId.path), mode: 'Children'}],
            },
          }
        : null,
    ),
  )
  const drafts = useChildDrafts(schemaId)
  const schema = useMemo(
    () =>
      schemaId
        ? inferDocumentSchema({
            collectionId: schemaId,
            publishedChildren: children.data?.results ?? [],
            draftChildren: drafts.flatMap((draft) =>
              draft.editUid ? [{id: hmId(draft.editUid, {path: draft.editPath}), metadata: draft.metadata ?? {}}] : [],
            ),
          })
        : undefined,
    [children.data?.results, drafts, schemaId],
  )
  const [generation, setGeneration] = useState(0)

  if (current.isLoading || (parentId && parent.isLoading) || (schemaId && children.isLoading)) {
    return <DocumentCreateButton disabled onCreate={() => {}} onImport={() => {}} />
  }
  if (!currentDocument || !canEditCurrent) return null

  return (
    <DesktopActorButton
      key={generation}
      locationId={locationId}
      currentIsCollection={currentIsCollection}
      parentId={parentId}
      parentIsCollection={parentIsCollection}
      canEditParent={canEditParent}
      schema={schema}
      onImportFinished={() => setGeneration((value) => value + 1)}
    />
  )
}
