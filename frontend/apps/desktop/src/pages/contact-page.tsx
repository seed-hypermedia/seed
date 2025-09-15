import {FavoriteButton} from '@/components/favoriting'
import {
  useAllAccountsWithContacts,
  useContact,
  useContactList,
  useDeleteContact,
  useSaveContact,
  useSelectedAccountContacts,
} from '@/models/contacts'
import {useSubscribedResources} from '@/models/entities'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {zodResolver} from '@hookform/resolvers/zod'
import {
  Contact,
  getMetadataName,
  HMAccount,
  HMAccountsMetadata,
  HMContact,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {PanelContainer} from '@shm/ui/container'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {HMIcon} from '@shm/ui/hm-icon'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pencil,
  ShieldCheck,
  ShieldPlus,
  Trash,
} from 'lucide-react'
import {useState} from 'react'
import {useForm} from 'react-hook-form'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {z} from 'zod'

export default function ContactPage() {
  const route = useNavRoute()
  const contactRoute = route.key === 'contact' ? route : null
  if (!contactRoute) throw new Error('Invalid route for contact page')
  return <ContactListPage contactId={contactRoute.id} />
}

export function ContactListPage({
  contactId,
}: {
  contactId?: UnpackedHypermediaId | undefined
}) {
  return (
    <PanelContainer>
      <PanelGroup direction="horizontal" autoSaveId="contact-page">
        <Panel defaultSize={30} minSize={20} maxSize={40}>
          <ContactPageSidebar contactId={contactId} />
        </Panel>
        <PanelResizeHandle className="panel-resize-handle visible" />
        <Panel>
          {contactId ? <ContactPageMain contactId={contactId} /> : null}
        </Panel>
      </PanelGroup>
    </PanelContainer>
  )
}

function Tab({
  label,
  isActive,
  onPress,
}: {
  label: string
  isActive: boolean
  onPress: () => void
}) {
  return (
    <button
      className={cn(
        'inline-block flex-shrink-0 border-b-3 p-4 whitespace-nowrap dark:text-white',
        isActive
          ? 'border-primary rounded-none font-bold text-black'
          : 'rounded-none border-transparent text-gray-600 hover:text-gray-800',
      )}
      onClick={onPress}
      role="tab"
      aria-selected={isActive}
    >
      {label}
    </button>
  )
}

function ContactPageSidebar({
  contactId,
}: {
  contactId?: UnpackedHypermediaId | undefined
}) {
  const selectedAccountContacts = useSelectedAccountContacts()
  const [tab, setTab] = useState<'all' | 'saved'>('all')
  const allAccounts = useAllAccountsWithContacts()
  let displayContacts =
    tab === 'all'
      ? allAccounts.data
      : allAccounts.data?.filter((account) => {
          return !!selectedAccountContacts.data?.find(
            (c) => c.subject === account.id,
          )
        })
  return (
    <div className="flex h-full flex-col items-stretch">
      <div className="mt-4 flex flex-shrink-0 px-2">
        <Tab
          label="All Contacts"
          isActive={tab === 'all'}
          onPress={() => setTab('all')}
        />
        <Tab
          label="Saved Contacts"
          isActive={tab === 'saved'}
          onPress={() => setTab('saved')}
        />
      </div>
      <div className="flex flex-1 flex-col items-stretch overflow-y-auto">
        {displayContacts?.map((account) => {
          if (account.aliasAccount) return null
          return (
            <ContactListItem
              key={account.id}
              account={account}
              active={account.id === contactId?.uid}
              savedContact={selectedAccountContacts.data?.find(
                (c) => c.subject === account.id,
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

function ContactListItem({
  account,
  active,
  savedContact,
}: {
  account: HMAccount
  active: boolean
  savedContact: PlainMessage<Contact> | undefined
}) {
  const navigate = useNavigate()
  const id = hmId(account.id, {})
  return (
    <Button
      className="group mx-2 h-auto items-center gap-1 py-2"
      variant={active ? 'brand-12' : 'ghost'}
      onClick={() => {
        navigate({key: 'contact', id})
      }}
    >
      <HMIcon size={28} id={id} name={account.metadata?.name} icon={account.metadata?.icon} />
      <span className="text-foreground flex-1 truncate overflow-hidden pl-2 text-left whitespace-nowrap">
        {savedContact ? savedContact.name : getMetadataName(account.metadata)}
      </span>

      <FavoriteButton active={active} hideUntilItemHover id={id} />

      <ShieldCheck
        className={cn(
          'size-4',
          'text-primary dark:text-brand-5',
          !savedContact && 'opacity-0',
        )}
      />
    </Button>
  )
}

function ContactPageMain({contactId}: {contactId: UnpackedHypermediaId}) {
  const contact = useContact(contactId)
  const contactFormDialog = useAppDialog(ContactFormDialog)
  const deleteContactDialog = useAppDialog(DeleteContactDialog)
  const navigate = useNavigate()
  const selectedAccountContacts = useSelectedAccountContacts()
  const accounts = useContactList()
  const myContact = selectedAccountContacts.data?.find(
    (c) => c.subject === contactId?.uid,
  )
  let primaryTitle = contact.data?.metadata?.name
  let primaryTooltip = 'Self-Published Name'
  let secondaryTitle = null
  let secondaryTooltip = ''
  if (myContact) {
    if (myContact.name === contact.data?.metadata?.name) {
      primaryTooltip = 'My Contact Name + Self-Published Name'
    } else {
      primaryTitle = myContact.name
      primaryTooltip = 'My Contact Name'
      secondaryTitle = contact.data?.metadata?.name
      secondaryTooltip = 'Self-Published Name'
    }
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-1 flex-row justify-center p-4">
        <div className="border-border bg-background mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-lg border p-4 py-7 dark:bg-black">
          <HMIcon id={contactId} name={contact.data?.metadata?.name} icon={contact.data?.metadata?.icon} size={80} />
          <Tooltip content={primaryTooltip}>
            <h2 className="text-3xl font-bold break-all">{primaryTitle}</h2>
          </Tooltip>
          {secondaryTitle && (
            <Tooltip content={secondaryTooltip}>
              <h3 className="text-2xl text-gray-600 dark:text-gray-300">
                {secondaryTitle}
              </h3>
            </Tooltip>
          )}
          {contact.data ? (
            <ContactEdgeNames
              contact={contact.data}
              accounts={accounts.data?.accountsMetadata}
            />
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  key: 'document',
                  id: contactId,
                })
              }
            >
              <ArrowUpRight className="size-4" />
              Open Site
            </Button>
            {myContact ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    contactFormDialog.open({
                      editId: myContact.id,
                      name: myContact.name,
                      subjectUid: contactId?.uid,
                    })
                  }}
                >
                  <Pencil className="size-4" />
                  Edit Contact
                </Button>
                <OptionsDropdown
                  menuItems={[
                    {
                      key: 'delete',
                      icon: <Trash className="size-4" />,
                      label: 'Delete Contact',
                      onClick: () => {
                        deleteContactDialog.open({contact: myContact})
                      },
                    },
                  ]}
                />
              </>
            ) : (
              <Button
                onClick={() => {
                  contactFormDialog.open({
                    name: contact.data?.metadata?.name || '?',
                    subjectUid: contactId?.uid,
                  })
                }}
              >
                <ShieldPlus className="text-primary size-4" />
                Save Contact
              </Button>
            )}
          </div>
          {contact.data ? (
            <AccountContacts
              contact={contact.data}
              ownerLabel={primaryTitle || 'Untitled'}
            />
          ) : null}
          {contactFormDialog.content}
          {deleteContactDialog.content}
        </div>
      </div>
    </div>
  )
}

function DeleteContactDialog({
  input,
  onClose,
}: {
  input: {contact: PlainMessage<Contact>}
  onClose: () => void
}) {
  const deleteContact = useDeleteContact()
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Delete Contact?</DialogTitle>
      <div>
        You will publicly delete this contact named "{input.contact.name}".
      </div>
      <div className="flex flex-row items-center justify-between gap-2">
        <Spinner hide={!deleteContact.isLoading} />
        <Button
          variant="destructive"
          onClick={() => {
            console.log('~ will deleteContact', input.contact)
            deleteContact.mutateAsync(input.contact).then(() => {
              onClose()
            })
          }}
        >
          <Trash className="size-4" />
          Confirm Delete
        </Button>
      </div>
    </div>
  )
}

function ContactEdgeNames({
  contact,
  accounts,
}: {
  contact: HMContact
  accounts: HMAccountsMetadata
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const navigate = useNavigate()
  const buttonLabel = isExpanded
    ? 'Collapse List of Edge Names'
    : 'Expand List of Edge Names'
  const buttonIcon = isExpanded ? ChevronDown : ChevronRight

  return (
    <div className="border-border self-stretch rounded-md border-2 p-2">
      {contact.subjectContacts?.length ? (
        <>
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((v) => !v)}
            >
              {isExpanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              {buttonLabel}
            </Button>
          </div>
          {isExpanded ? (
            <div className="flex flex-col">
              {contact.subjectContacts?.map((contact) => {
                const account = accounts[contact.account]
                return (
                  <div className="flex flex-row items-center justify-between gap-2">
                    <span className="font-bold">{contact.name}</span>
                    {account ? (
                      <Tooltip
                        content={account.metadata?.name || 'Unknown Account'}
                      >
                        <button
                          onClick={() => {
                            navigate({
                              key: 'contact',
                              id: account.id,
                            })
                          }}
                        >
                          <HMIcon
                            id={account.id}
                            name={account.metadata?.name}
                            icon={account.metadata?.icon}
                            size={24}
                          />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </>
      ) : (
        <span className="text-foreground block w-full text-center text-sm">
          No Edge Names
        </span>
      )}
    </div>
  )
}

function AccountContacts({
  contact,
  ownerLabel,
}: {
  contact: HMContact
  ownerLabel: string
}) {
  const subjectAccounts = useSubscribedResources(
    contact.contacts?.map((c) => ({id: hmId(c.subject)})) || [],
  )
  const navigate = useNavigate()
  return (
    <div className="border-border dark:bg-background mt-4 self-stretch rounded-md border bg-white p-2">
      <h3 className="text-l p-3 font-bold break-words">
        {contact.contacts?.length
          ? `${ownerLabel}'s Contacts`
          : `${ownerLabel} has no Contacts`}
      </h3>
      <div className="flex flex-col">
        {contact.contacts?.map((contact) => {
          const subjectAccount = subjectAccounts.find(
            (a) => a.data?.id?.uid === contact.subject,
          )?.data
          const contactName = contact.name
          const subjectName =
            subjectAccount?.type === 'document'
              ? subjectAccount.document?.metadata?.name
              : undefined

          return (
            <div
              className="flex flex-row items-center gap-2 p-2 text-gray-700 hover:text-black dark:text-gray-300 dark:hover:text-white"
              onClick={() => {
                navigate({
                  key: 'contact',
                  id: hmId(contact.subject),
                })
              }}
            >
              {subjectAccount ? (
                <HMIcon
                  id={subjectAccount.id}
                  name={
                    subjectAccount.type === 'document'
                      ? subjectAccount.document?.metadata?.name
                      : undefined
                  }
                  icon={
                    subjectAccount.type === 'document'
                      ? subjectAccount.document?.metadata?.icon
                      : undefined
                  }
                  size={32}
                />
              ) : null}
              <span className="font-bold">{subjectName}</span>
              {subjectName !== contactName ? (
                <span className="text-gray-500 dark:text-gray-300">
                  | {contactName}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const SaveContactSchema = z.object({
  name: z.string().min(1),
})

function ContactFormDialog({
  input,
  onClose,
}: {
  input: {
    editId?: string
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
      name: input.name || '',
    },
  })
  const selectedAccount = useSelectedAccount()
  function onSubmit(data: z.infer<typeof SaveContactSchema>) {
    console.log('~ onSubmit', data)
    if (!selectedAccount?.id) {
      toast.error('No account selected')
      return
    }
    saveContact
      .mutateAsync({
        editId: input.editId,
        accountUid: selectedAccount.id.uid,
        name: data.name,
        subjectUid: input.subjectUid,
      })
      .then(() => {
        onClose()
      })
  }
  return (
    <div className="flex flex-col gap-6">
      <DialogTitle>Save Contact</DialogTitle>
      <p className="text-foreground italic">
        This contact will be saved publicly for others to see.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit(onSubmit)()
        }}
        className="flex flex-col gap-4"
      >
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

        <Button type="submit" variant="default">
          {selectedAccount?.id ? (
            <HMIcon
              id={selectedAccount?.id}
              name={selectedAccount?.document?.metadata?.name}
              icon={selectedAccount?.document?.metadata?.icon}
              size={24}
            />
          ) : null}
          Save Contact
        </Button>
      </form>
    </div>
  )
}
