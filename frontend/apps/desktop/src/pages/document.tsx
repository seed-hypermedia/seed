import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {Avatar} from '@/components/avatar'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {DialogTitle, useAppDialog} from '@/components/dialog'
import {DocumentListItem} from '@/components/document-list-item'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {FormInput} from '@/components/form-input'
import {FormField} from '@/components/forms'
import {ListItem} from '@/components/list-item'
import {MainWrapperNoScroll} from '@/components/main-wrapper'
import {useMyAccountIds} from '@/models/daemon'
import {useAccountDocuments} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {getFileUrl} from '@/utils/account-url'
import {useNavRoute} from '@/utils/navigation'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {
  DocContent,
  getProfileName,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  CitationsIcon,
  CollaboratorsIcon,
  CommentsIcon,
  Form,
  H3,
  HistoryIcon,
  MainWrapper,
  Section,
  Separator,
  SizableText,
  Spinner,
  SuggestedChangesIcon,
  XStack,
  YStack,
} from '@shm/ui'
import {PageContainer} from '@shm/ui/src/container'
import {RadioButtons} from '@shm/ui/src/radio-buttons'
import {FilePlus} from '@tamagui/lucide-icons'
import React, {ReactNode} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {z} from 'zod'
import {EntityCitationsAccessory} from '../components/citations'
import {CopyReferenceButton} from '../components/titlebar-common'
import {AppDocContentProvider} from './document-content-provider'

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no document id')

  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')
  const [copyDialogContent, onCopy] = useCopyGatewayReference()
  let accessory: ReactNode = null
  if (accessoryKey === 'citations') {
    accessory = <EntityCitationsAccessory entityId={docId} />
  } else if (accessoryKey === 'versions') {
    accessory = <AccessoryContainer title="Versions" />
  } else if (accessoryKey === 'collaborators') {
    accessory = <AccessoryContainer title="Collaborators" />
  } else if (accessoryKey === 'suggested-changes') {
    accessory = <AccessoryContainer title="Suggested Changes" />
  } else if (accessoryKey === 'comments') {
    accessory = <AccessoryContainer title="Comments" />
  }

  return (
    <>
      <AccessoryLayout
        accessory={accessory}
        accessoryKey={accessoryKey}
        onAccessorySelect={(key: typeof accessoryKey) => {
          if (key === accessoryKey || key === undefined)
            return replace({...route, accessory: null})
          replace({...route, accessory: {key}})
        }}
        accessoryOptions={
          [
            {key: 'versions', label: 'Version History', icon: HistoryIcon},
            {
              key: 'collaborators',
              label: 'Collaborators',
              icon: CollaboratorsIcon,
            },
            {
              key: 'suggested-changes',
              label: 'Suggested Changes',
              icon: SuggestedChangesIcon,
            },
            {
              key: 'comments',
              label: 'Comments',
              icon: CommentsIcon,
            },
            {
              key: 'citations',
              label: 'Citations',
              icon: CitationsIcon,
            },
          ] as const
        }
      >
        <MainWrapperNoScroll>
          <MainDocumentPage />
        </MainWrapperNoScroll>
      </AccessoryLayout>
      <Footer></Footer>
    </>
  )
}

function MainDocumentPage() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('Invalid route for MainDocumentPage')
  if (!route.id) throw new Error('MainDocumentPage requires id')

  let content: null | React.ReactElement = (
    <DocumentPageContent docId={route.id} />
  )
  if (route.tab === 'activity') {
    content = null // todo
  } else if (route.tab === 'contacts') {
    content = null // todo
  } else if (route.tab === 'home') {
    content = (
      <DocumentPageContent
        docId={route.id}
        isBlockFocused={route.isBlockFocused}
      />
    )
  } else if (route.tab === 'documents') {
    content = <AccountPageDocuments id={route.id} />
  }
  return (
    <MainWrapper>
      <AccountPageHeader />
      {content}
    </MainWrapper>
  )
}

function AccountPageHeader() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no doc id')
  const myAccountIds = useMyAccountIds()
  const doc = useEntity(docId)

  const isMyAccount = myAccountIds.data?.includes(docId.id)
  const accountName = getProfileName(doc.data?.document)

  return (
    <>
      <PageContainer marginTop="$6">
        <Section
          paddingVertical={0}
          gap="$2"
          marginBottom={route.tab !== 'home' ? '$4' : undefined}
        >
          <XStack gap="$4" alignItems="center" justifyContent="space-between">
            <XStack gap="$4" alignItems="center">
              <Avatar
                id={docId.eid}
                size={60}
                label={accountName}
                url={
                  doc.data?.document?.metadata.thumbnail
                    ? getFileUrl(doc.data?.document?.metadata.thumbnail)
                    : ''
                }
              />
              <SizableText
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
                size="$5"
                fontWeight="700"
              >
                {accountName}
              </SizableText>
            </XStack>

            <XStack space="$2">
              {isMyAccount ? null : <FavoriteButton id={docId} />}
              <CopyReferenceButton />
            </XStack>
          </XStack>
          <XStack>
            <RadioButtons
              key={route.tab}
              value={route.tab || 'home'}
              options={
                [
                  {key: 'home', label: 'Home'},
                  {key: 'documents', label: 'Documents'},
                  {key: 'activity', label: 'Activity'},
                  {key: 'contacts', label: 'Contacts'},
                ] as const
              }
              onValue={(tab) => {
                replace({...route, tab})
              }}
            />
          </XStack>
        </Section>
      </PageContainer>
    </>
  )
}

function DocumentPageContent({
  docId,
  isBlockFocused,
}: {
  docId: UnpackedHypermediaId
  blockId?: string
  isBlockFocused?: boolean
}) {
  const entity = useEntity(docId)
  const navigate = useNavigate()
  if (entity.isLoading) return <Spinner />
  if (!entity.data?.document) return null
  const blockId = docId.blockRef
  return (
    <PageContainer>
      <AppDocContentProvider routeParams={{blockRef: blockId}}>
        <DocContent
          document={entity.data?.document}
          focusBlockId={isBlockFocused ? blockId : undefined}
        />
        <Separator />
        <H3 marginTop="$4">Index</H3>
        <YStack>
          {Object.keys(entity.data?.document?.index).map((key) => {
            return (
              <ListItem
                key={key}
                title={key}
                onPress={() => {
                  const id = hmId(docId.type, docId.eid, {
                    indexPath: docId.indexPath
                      ? `${docId.indexPath}/${key}`
                      : key,
                  })
                  console.log('navigate', id)
                  navigate({
                    key: 'document',
                    id,
                  })
                }}
              />
            )
          })}
          <XStack paddingVertical="$4">
            <NewSubDocumentButton parentDocId={docId.qid} />
          </XStack>
        </YStack>
      </AppDocContentProvider>
    </PageContainer>
  )
}

const newSubDocumentSchema = z.object({
  name: z.string(),
})
type NewSubDocumentFields = z.infer<typeof newSubDocumentSchema>

function NewDocumentDialog({
  input,
  onClose,
}: {
  input: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const onSubmit: SubmitHandler<NewSubDocumentFields> = (data) => {
    // console.log('NewDocument', id)
    const indexPath = pathNameify(data.name)
    const id = `${input}/${indexPath}`
    onClose()
    navigate({
      key: 'draft',
      id,
      name: data.name,
    })
  }
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<NewSubDocumentFields>({
    resolver: zodResolver(newSubDocumentSchema),
    defaultValues: {
      name: '',
    },
  })
  return (
    <>
      <DialogTitle>New Document</DialogTitle>
      {/* <DialogDescription>description</DialogDescription> */}
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        <FormField name="name" label="Title" errors={errors}>
          <FormInput
            control={control}
            name="name"
            placeholder="Document Title"
          />
        </FormField>
        <XStack space="$3" justifyContent="flex-end">
          <Form.Trigger asChild>
            <Button>Create Document</Button>
          </Form.Trigger>
        </XStack>
      </Form>
    </>
  )
}

function NewSubDocumentButton({parentDocId}: {parentDocId: string}) {
  const {open, content} = useAppDialog<string>(NewDocumentDialog)
  return (
    <>
      <Button
        icon={FilePlus}
        onPress={() => {
          open(parentDocId)
        }}
      >
        Create Document
      </Button>
      {content}
    </>
  )
}

function AccountPageDocuments({id}: {id: UnpackedHypermediaId}) {
  const docs = useAccountDocuments(id.eid)
  return (
    <PageContainer>
      {docs.data?.documents.map((doc) => {
        return (
          <DocumentListItem
            key={doc.id}
            document={doc}
            author={[]}
            editors={[]}
            hasDraft={undefined}
            menuItems={() => [
              // copyLinkMenuItem(() => {
              //   const id = unpackDocId(docId)
              //   if (!id) return
              //   onCopyId({
              //     ...id,
              //     version: item.document.version || null,
              //   })
              // }, 'Document'),
              // {
              //   label: 'Delete Document',
              //   key: 'delete',
              //   icon: Trash,
              //   onPress: () => {
              //     openDelete({
              //       id: docId,
              //       title: getDocumentTitle(item.document),
              //     })
              //   },
              // },
            ]}
            openRoute={{
              key: 'document',
              id: hmId('d', doc.id, {
                version: doc.version,
              }),
            }}
          />
        )
      })}
    </PageContainer>
  )
  return null
}
