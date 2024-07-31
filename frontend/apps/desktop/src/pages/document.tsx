import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {Avatar} from '@/components/avatar'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {DialogTitle, useAppDialog} from '@/components/dialog'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {FormInput} from '@/components/form-input'
import {FormField} from '@/components/forms'
import {ListItem} from '@/components/list-item'
import {MainWrapper} from '@/components/main-wrapper'
import {useMyAccountIds} from '@/models/daemon'
import {useListDirectory} from '@/models/documents'
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
  HistoryIcon,
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
import {ReactNode, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {z} from 'zod'
import {EntityCitationsAccessory} from '../components/citations'
import {CopyReferenceButton} from '../components/titlebar-common'
import {AppDocContentProvider} from './document-content-provider'

type DocAccessoryOption = {
  key:
    | 'versions'
    | 'collaborators'
    | 'suggested-changes'
    | 'comments'
    | 'citations'
    | 'contacts'
    | 'all-documents'
  label: string
  icon: null | React.FC<{color: string}>
}

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no document id')

  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')
  const [copyDialogContent, onCopy] = useCopyGatewayReference()

  function handleClose() {
    if (route.key !== 'document') return
    replace({...route, accessory: null})
  }
  let accessory: ReactNode = null
  if (accessoryKey === 'citations') {
    accessory = (
      <EntityCitationsAccessory entityId={docId} onClose={handleClose} />
    )
  } else if (accessoryKey === 'versions') {
    accessory = <AccessoryContainer title="Versions" onClose={handleClose} />
  } else if (accessoryKey === 'collaborators') {
    accessory = (
      <AccessoryContainer title="Collaborators" onClose={handleClose} />
    )
  } else if (accessoryKey === 'suggested-changes') {
    accessory = (
      <AccessoryContainer title="Suggested Changes" onClose={handleClose} />
    )
  } else if (accessoryKey === 'comments') {
    accessory = <AccessoryContainer title="Comments" onClose={handleClose} />
  } else if (accessoryKey === 'all-documents') {
    accessory = (
      <AccessoryContainer title="All Documents" onClose={handleClose} />
    )
  } else if (accessoryKey === 'contacts') {
    accessory = <AccessoryContainer title="Contacts" onClose={handleClose} />
  }

  const accessoryOptions: DocAccessoryOption[] = []

  accessoryOptions.push({
    key: 'versions',
    label: 'Version History',
    icon: HistoryIcon,
  })
  if (docId.type === 'd') {
    accessoryOptions.push({
      key: 'collaborators',
      label: 'Collaborators',
      icon: CollaboratorsIcon,
    })
    accessoryOptions.push({
      key: 'suggested-changes',
      label: 'Suggested Changes',
      icon: SuggestedChangesIcon,
    })
  }
  accessoryOptions.push({
    key: 'comments',
    label: 'Comments',
    icon: CommentsIcon,
  })
  accessoryOptions.push({
    key: 'citations',
    label: 'Citations',
    icon: CitationsIcon,
  })
  if (docId.type === 'd' && !docId.path?.length) {
    accessoryOptions.push({
      key: 'all-documents',
      label: 'All Documents',
      icon: null,
    })
    accessoryOptions.push({
      key: 'contacts',
      label: 'Contacts',
      icon: null,
    })
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
        accessoryOptions={accessoryOptions}
      >
        <MainDocumentPage />
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
  return (
    <MainWrapper>
      <DocPageHeader />
      <DocPageContent docId={route.id} isBlockFocused={route.isBlockFocused} />
      <DocPageAppendix docId={route.id} />
    </MainWrapper>
  )
}

function DocPageHeader() {
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
                id={docId.uid}
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
        </Section>
      </PageContainer>
    </>
  )
}

function DocPageContent({
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
      </AppDocContentProvider>
    </PageContainer>
  )
}

function DocPageAppendix({docId}: {docId: UnpackedHypermediaId}) {
  const [tab, setTab] = useState<'discussion' | 'directory'>('directory')
  let content = null
  if (tab === 'directory') {
    content = <DocDirectory docId={docId} />
  }
  return (
    <PageContainer>
      <XStack>
        <RadioButtons
          value={tab}
          options={
            [
              {key: 'discussion', label: 'Discussion'},
              {key: 'directory', label: 'Directory'},
            ] as const
          }
          onValue={(value) => {
            setTab(value)
          }}
        />
      </XStack>
      {content}
    </PageContainer>
  )
}

function DocDirectory({docId}: {docId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
  const dir = useListDirectory(docId)
  return (
    <YStack>
      {dir.data &&
        dir.data
          .filter((item) => {
            const level = docId.path?.length || 0
            if (item.path.length !== level + 1) return false
            let pathPrefix = (docId.path || []).join('/')
            return item.path.join('/').startsWith(pathPrefix)
          })
          .map((item) => {
            return (
              <ListItem
                key={item.path.join('/')}
                title={item.metadata.name}
                onPress={() => {
                  const id = hmId(docId.type, docId.uid, {
                    path: item.path,
                  })
                  navigate({
                    key: 'document',
                    id,
                  })
                }}
              />
            )
          })}
      <XStack paddingVertical="$4">
        <NewSubDocumentButton parentDocId={docId} />
      </XStack>
    </YStack>
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
  input: UnpackedHypermediaId
  onClose: () => void
}) {
  const navigate = useNavigate()
  const onSubmit: SubmitHandler<NewSubDocumentFields> = (data) => {
    const path = pathNameify(data.name)
    onClose()
    navigate({
      key: 'draft',
      id: {...input, path: [...(input.path || []), path]},
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

function NewSubDocumentButton({
  parentDocId,
}: {
  parentDocId: UnpackedHypermediaId
}) {
  const {open, content} = useAppDialog<UnpackedHypermediaId>(NewDocumentDialog)
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
