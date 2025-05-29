import {DialogTitle} from '@/components/dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useContact, useSaveContact} from '@/models/contacts'
import {useMyAccounts} from '@/models/daemon'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {HMContact} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {HMIcon} from '@shm/ui/hm-icon'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Plus,
} from '@tamagui/lucide-icons'
import {useState} from 'react'
import {
  Control,
  FieldValues,
  Path,
  useController,
  useForm,
} from 'react-hook-form'
import {Form, Heading, Paragraph, Text, XStack, YStack} from 'tamagui'
import {z} from 'zod'

function ErrorPage({}: {error: any}) {
  // todo, this!
  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <Text fontFamily="$body" fontSize="$3">
            Error
          </Text>
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

export default function ContactPage() {
  //   const accounts = useAccountList()
  //   const ref = useRef(null)
  //   if (accounts.isLoading) {
  //     return (
  //       <PanelContainer>
  //         <MainWrapper scrollable>
  //           <Container centered>
  //             <Spinner />
  //           </Container>
  //         </MainWrapper>
  //       </PanelContainer>
  //     )
  //   }
  //   if (accounts.error) {
  //     return <ErrorPage error={accounts.error} />
  //   }
  const route = useNavRoute()
  const contactRoute = route.key === 'contact' ? route : null
  if (!contactRoute) throw new Error('Invalid route for contact page')
  const contact = useContact(contactRoute.id)
  const saveContactDialog = useAppDialog(SaveContactDialog)
  const navigate = useNavigate()

  console.log(contact.data)

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <YStack gap="$4">
            <HMIcon
              id={contactRoute.id}
              metadata={contact.data?.metadata}
              size={80}
            />
            <Heading>{contact.data?.metadata?.name}</Heading>
            {/* <Text>{JSON.stringify(contact.data?.contacts)}</Text> */}
            {contact.data ? <ContactEdgeNames contact={contact.data} /> : null}
            <XStack jc="center" gap="$3">
              <Button
                icon={ArrowUpRight}
                onPress={() =>
                  navigate({
                    key: 'document',
                    id: contactRoute.id,
                  })
                }
              >
                Open Site
              </Button>
              <Button
                icon={Plus}
                theme="green"
                onPress={() => {
                  saveContactDialog.open({
                    name: contact.data?.metadata?.name || '?',
                    subjectUid: contactRoute.id.uid,
                  })
                }}
              >
                Save Contact
              </Button>
            </XStack>
            {contact.data ? <AccountContacts contact={contact.data} /> : null}
          </YStack>
        </Container>
      </MainWrapper>
      {saveContactDialog.content}
    </PanelContainer>
  )
}

function ContactEdgeNames({contact}: {contact: HMContact}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const buttonLabel = isExpanded
    ? 'Collapse List of Edge Names'
    : 'Expand List of Edge Names'
  const buttonIcon = isExpanded ? ChevronDown : ChevronRight

  return (
    <YStack borderWidth={1} borderColor="$borderColor" p="$2" borderRadius="$2">
      <XStack jc="center">
        <Button
          chromeless
          size="$2"
          onPress={() => setIsExpanded(!isExpanded)}
          iconAfter={buttonIcon}
        >
          {buttonLabel}
        </Button>
      </XStack>
      {isExpanded ? (
        <YStack>
          {contact.subjectContacts?.map((contact) => {
            return <Text>{contact.name}</Text>
          })}
        </YStack>
      ) : null}
    </YStack>
  )
  // return <Text>Edge Names</Text>
}

function AccountContacts({contact}: {contact: HMContact}) {
  return (
    <YStack borderWidth={1} borderColor="$borderColor" p="$2" borderRadius="$2">
      <XStack jc="center"></XStack>
      <YStack>
        {contact.contacts?.map((contact) => {
          return <Text>{contact.name}</Text>
        })}
      </YStack>
    </YStack>
  )
  // return <Text>Edge Names</Text>
}

const SaveContactSchema = z.object({
  accountUid: z.string().min(1),
  name: z.string().min(1),
})

function SaveContactDialog({
  input,
  onClose,
}: {
  input: {
    name: string
    subjectUid: string
  }
  onClose: () => void
}) {
  const saveContact = useSaveContact()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<z.infer<typeof SaveContactSchema>>({
    resolver: zodResolver(SaveContactSchema),
    defaultValues: {
      name: input.name,
    },
  })
  function onSubmit(data: z.infer<typeof SaveContactSchema>) {
    saveContact
      .mutateAsync({
        accountUid: data.accountUid,
        name: data.name,
        subjectUid: input.subjectUid,
      })
      .then(() => {
        onClose()
      })
  }
  return (
    <>
      <DialogTitle>Save Contact</DialogTitle>
      <Paragraph fontStyle="italic">
        This contact will be saved publicly for others to see.
      </Paragraph>

      <Form onSubmit={handleSubmit(onSubmit)}>
        <FormField
          name="accountUid"
          label="I will save this contact with the following account:"
          errors={errors}
        >
          <FormAccountSelection control={control} name="accountUid" />
        </FormField>
        <FormField
          name="name"
          label="New Name for this Contact"
          errors={errors}
        >
          <FormInput
            control={control}
            name="name"
            placeholder="What you will publicly name this contact"
          />
        </FormField>
        <Form.Trigger asChild>
          <Button>Save Contact</Button>
        </Form.Trigger>
      </Form>
    </>
  )
}

function FormAccountSelection<Schema extends FieldValues>({
  control,
  name,
}: {
  control: Control<Schema>
  name: Path<Schema>
}) {
  const myAccounts = useMyAccounts()
  const {field} = useController({control, name})
  return (
    <SelectDropdown
      options={myAccounts
        .map((account) => account.data)
        .filter((a) => !!a)
        .map((account) => ({
          label: account.document?.metadata?.name || '?',
          value: account.id.uid,
          icon: (
            <HMIcon
              id={account.id}
              size={24}
              metadata={account.document?.metadata}
            />
          ),
        }))}
      value={field.value}
      onValue={(value) => {
        field.onChange(value)
      }}
    />
  )
}
