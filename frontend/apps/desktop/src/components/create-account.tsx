import {grpcClient} from '@/grpc-client'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useNavRoute} from '@/utils/navigation'
import {extractWords} from '@/utils/onboarding'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {DAEMON_FILE_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMDraft} from '@shm/shared/hm-types'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {createWebHMUrl, hmId} from '@shm/shared/utils/entity-id-url'
import {eventStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/checkbox-field'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Field} from '@shm/ui/form-fields'
import {Link, Reload} from '@shm/ui/icons'
import * as Onboarding from '@shm/ui/onboarding'
import {toast} from '@shm/ui/toast'
import {Copy} from '@tamagui/lucide-icons'
import {nanoid} from 'nanoid'
import {SVGProps, useEffect, useMemo, useRef, useState} from 'react'
import {TextInput} from 'react-native'
import {
  Dialog,
  Input,
  Separator,
  SizableText,
  TextArea,
  useTheme,
  XStack,
  YStack,
} from 'tamagui'
import {
  NamedKey,
  useMnemonics,
  useMyAccountIds,
  useRegisterKey,
} from '../models/daemon'
import {trpc} from '../trpc'
import {useOpenDraft} from '../utils/open-draft'
import {IconForm} from './icon-form'

export const [dispatchWizardEvent, wizardEvents] = eventStream<boolean>()

type AccountStep = 'create' | 'name' | 'members' | 'complete'

export function AccountWizardDialog() {
  const route = useNavRoute()
  const theme = useTheme()
  const accounts = useMyAccountIds()
  const createDraft = trpc.drafts.write.useMutation()
  const [open, setOpen] = useState(false)
  const [newAccount, setNewAccount] = useState<null | boolean>(true)
  const [step, setStep] = useState<AccountStep>('create')
  const [existingWords, setExistingWords] = useState<string>('')
  const [icon, setIcon] = useState('')
  const [name, setName] = useState('')
  // const [error, setError] = useState('')
  const navigate = useNavigate('push')

  const onboardingColor = theme.brand5.val
  const [isSaveWords, setSaveWords] = useState<null | boolean>(true)
  const [isUserSavingWords, setUserSaveWords] = useState<null | boolean>(null)
  const [isExistingWordsSave, setExistingWordsSave] = useState<boolean>(false)
  const [createdAccount, setCreatedAccount] = useState<NamedKey | null>(null)
  const openDraft = useOpenDraft('push')
  const inputWords = useRef<TextInput | null>(null)

  const saveWords = trpc.secureStorage.write.useMutation()

  const {data: genWords, refetch: refetchWords} = useMnemonics()

  const register = useRegisterKey()

  useEffect(() => {
    wizardEvents.subscribe((val) => {
      if (!val) {
        resetForm()
      }
      setOpen(val)
    })
  }, [])

  useEffect(() => {
    if (step == 'create' && !newAccount) {
      // Focus the textarea when changing to this step (better UX!)
      inputWords.current?.focus()
    } else {
      refetchWords()
    }
  }, [step, newAccount])

  async function handleAccountCreation(existing?: boolean) {
    const name = `temp${nanoid(8)}`
    try {
      const createdAccount = await register.mutateAsync({
        mnemonic: existing
          ? extractWords(existingWords)
          : typeof words == 'string'
          ? extractWords(words)
          : (words as Array<string>),
        name,
      })

      const renamedKey = await grpcClient.daemon.updateKey({
        currentName: name,
        newName: createdAccount.accountId,
      })

      if (isSaveWords) {
        saveWords.mutate({key: renamedKey.name, value: words})
      }

      await createDraft.mutateAsync({
        id: createdAccount.accountId,
        draft: {
          signingAccount: createdAccount.accountId,
          content: [],
          metadata: {},
          members: [],
          previousId: null,
          deps: [],
          lastUpdateTime: Date.now(),
        } as HMDraft,
      })
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
      invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
      invalidateQueries([queryKeys.SEARCH])
      setCreatedAccount(renamedKey)
      if (existing) {
        navigate({
          key: 'document',
          id: hmId('d', createdAccount!.accountId),
        })
      }
      setStep(existing ? 'complete' : 'name')
    } catch (error) {
      toast.error(`REGISTER ERROR: ${error}`)
    }
  }

  async function handleDocEdit() {
    if (!name) {
      toast.error('Name is required. Please add one')
    } else {
      try {
        let changes = [
          new DocumentChange({
            op: {
              case: 'setMetadata',
              value: {
                key: 'name',
                value: name,
              },
            },
          }),
        ]

        if (icon) {
          changes.push(
            new DocumentChange({
              op: {
                case: 'setMetadata',
                value: {
                  key: 'icon',
                  value: `ipfs://${icon}`,
                },
              },
            }),
          )
        }

        const doc = await grpcClient.documents.createDocumentChange({
          account: createdAccount?.accountId,
          signingKeyName: createdAccount?.publicKey,
          baseVersion: undefined, // undefined because this is the first change of this document
          changes,
        })

        if (doc) {
          invalidateQueries([
            queryKeys.ENTITY,
            hmId('d', createdAccount!.accountId).id,
          ])
          invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
          navigate({
            key: 'document',
            id: hmId('d', createdAccount!.accountId),
          })
          setStep('complete')
        }
      } catch (error) {
        toast.error(`Updating Home document Error: ${JSON.stringify(error)}`)
      }
    }
  }

  const words = useMemo(() => {
    if (newAccount) {
      return genWords
    } else {
      return extractWords(existingWords)
    }
  }, [genWords, existingWords, newAccount])

  const gatewayUrl = useGatewayUrl()

  function resetForm() {
    setName('')
    setIcon('')
    setExistingWords('')
    setSaveWords(true)
    setUserSaveWords(null)
    setExistingWordsSave(false)
    setCreatedAccount(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val: boolean) => {
        dispatchWizardEvent(val)
        if (!val) {
          setStep('create')
          setNewAccount(true)
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          height="100vh"
          bg={'#00000088'}
          width="100vw"
          animation="fast"
          opacity={0.8}
          enterStyle={{opacity: 0}}
          exitStyle={{opacity: 0}}
        />
        <Dialog.Content
          overflow="hidden"
          h={460}
          w="100%"
          maxWidth={600}
          p={0}
          backgroundColor={'$background'}
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
        >
          {step == 'create' && newAccount ? (
            <Onboarding.Wrapper>
              <MarketingSection />
              <Onboarding.MainSection>
                <Onboarding.Title>Create your new Account</Onboarding.Title>
                <YStack gap="$2">
                  {words?.length ? (
                    <Field id="words" label="Secret Words">
                      <TextArea
                        borderColor="$colorTransparent"
                        borderWidth={0}
                        id="words"
                        disabled
                        value={(words as Array<string>).join(', ')}
                      />
                    </Field>
                  ) : null}
                  <XStack gap="$4">
                    <Button
                      size="$2"
                      f={1}
                      onPress={() => {
                        refetchWords()
                      }}
                      icon={Reload}
                    >
                      Regenerate
                    </Button>
                    <Button
                      size="$2"
                      f={1}
                      icon={Copy}
                      onPress={() => {
                        copyTextToClipboard(
                          (words as Array<string>).join(', '),
                        ).then(() => {
                          toast.success('Secret words copied successfully')
                        })
                      }}
                    >
                      Copy
                    </Button>
                  </XStack>
                </YStack>
                <YStack>
                  <CheckboxField
                    value={isSaveWords || false}
                    id="register-save-words"
                    onValue={setSaveWords}
                  >
                    Save words on this device
                  </CheckboxField>
                  {!isSaveWords ? (
                    <CheckboxField
                      value={isUserSavingWords || false}
                      id="register-user-save-words"
                      onValue={setUserSaveWords}
                    >
                      <SizableText fontWeight="bold" color="red">
                        I will save my words somewhere else
                      </SizableText>
                    </CheckboxField>
                  ) : null}
                </YStack>
                <YStack gap="$4" marginTop="auto">
                  <Button
                    bg={onboardingColor}
                    color="white"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: 'white',
                      borderColor: '$colorTransparent',
                    }}
                    f={1}
                    disabled={!isSaveWords && !isUserSavingWords}
                    opacity={!isSaveWords && !isUserSavingWords ? 0.4 : 1}
                    onPress={() => handleAccountCreation()}
                  >
                    Create new Account
                  </Button>
                  <Separator />
                  <YStack gap="$2">
                    <SizableText
                      size="$2"
                      color={onboardingColor}
                      textAlign="center"
                      fontWeight="bold"
                    >
                      Have an account already?
                    </SizableText>
                    <Button
                      size="$2"
                      bg="$colorTransparent"
                      color={onboardingColor}
                      borderColor={onboardingColor}
                      f={1}
                      disabled={!isSaveWords && !isUserSavingWords}
                      opacity={!isSaveWords && !isUserSavingWords ? 0.4 : 1}
                      onPress={() => setNewAccount(false)}
                    >
                      Add Existing account
                    </Button>
                  </YStack>
                </YStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : step == 'create' && !newAccount ? (
            <Onboarding.Wrapper>
              <MarketingSection />
              <Onboarding.MainSection>
                <Onboarding.Title>My secret words</Onboarding.Title>
                <YStack gap="$2">
                  <Field id="input-words" label="Secret Words">
                    <TextArea
                      borderColor="$colorTransparent"
                      borderWidth={0}
                      id="input-words"
                      ref={inputWords}
                      value={existingWords}
                      onChangeText={setExistingWords}
                      placeholder="foo, bar, baz..."
                    />
                  </Field>
                </YStack>
                <CheckboxField
                  value={isExistingWordsSave}
                  onValue={setExistingWordsSave}
                  id="existing-save-words"
                >
                  I have my words saved somewhere
                </CheckboxField>
                <YStack gap="$4" marginTop="auto">
                  <Button
                    bg={onboardingColor}
                    color="$color1"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: '$color1',
                      borderColor: '$colorTransparent',
                    }}
                    f={1}
                    opacity={!isExistingWordsSave ? 0.4 : 1}
                    disabled={!isExistingWordsSave}
                    onPress={() => {
                      handleAccountCreation(true)
                    }}
                  >
                    Add Existing account
                  </Button>
                  <Separator />
                  <YStack gap="$2">
                    <SizableText
                      size="$2"
                      color={onboardingColor}
                      textAlign="center"
                      fontWeight="bold"
                    >
                      Don't have an account?
                    </SizableText>
                    <Button
                      size="$2"
                      bg="$colorTransparent"
                      color={onboardingColor}
                      borderColor={onboardingColor}
                      f={1}
                      disabled={!isSaveWords && !isUserSavingWords}
                      opacity={!isSaveWords && !isUserSavingWords ? 0.4 : 1}
                      onPress={() => setNewAccount(true)}
                    >
                      Create a new account
                    </Button>
                  </YStack>
                </YStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : null}
          {step == 'name' ? (
            <Onboarding.Wrapper>
              <MarketingSection />
              <Onboarding.MainSection>
                <Onboarding.Title>Account Information</Onboarding.Title>
                <YStack gap="$2">
                  <IconForm
                    emptyLabel="ADD ICON"
                    url={icon ? `${DAEMON_FILE_URL}/${icon}` : undefined}
                    onIconUpload={(d) => {
                      setIcon(d)
                    }}
                  />
                  <Input
                    value={name}
                    onChangeText={setName}
                    placeholder="Name"
                  />
                </YStack>
                <XStack gap="$4" marginTop="auto">
                  <Button
                    alignSelf="flex-end"
                    bg={onboardingColor}
                    color="$color1"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: '$color1',
                      borderColor: '$colorTransparent',
                    }}
                    onPress={handleDocEdit}
                  >
                    Next
                  </Button>
                </XStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : null}
          {/* {step == 'members' && accountType == 'publisher' ? (
            <Onboarding.Wrapper>
              <MarketingSection />
              <Onboarding.MainSection>
                <Onboarding.Title>Add Members</Onboarding.Title>
                <Onboarding.Text>Add members COPY. TODO</Onboarding.Text>
                <YStack gap="$2"></YStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : null} */}
          {step == 'complete' ? (
            <Onboarding.Wrapper>
              <Onboarding.MainSection ai="center">
                <Onboarding.SuccessIcon />
                <Onboarding.Title>Account Created!</Onboarding.Title>
                <Onboarding.Text>
                  Your account has successfully been created. Check out the
                  things you could do next!
                </Onboarding.Text>
                <YStack gap="$2" alignSelf="stretch" marginTop="auto">
                  <Button
                    size="$3"
                    f={1}
                    onPress={() => {
                      if (createdAccount) {
                        dispatchWizardEvent(false)
                        setNewAccount(true)
                        setName('')
                        setIcon('')
                        setStep('create')

                        openDraft({id: hmId('d', createdAccount.accountId)})
                      }
                    }}
                  >
                    Update my Home Document
                  </Button>
                  <Button
                    size="$3"
                    f={1}
                    onPress={() => {
                      if (createdAccount) {
                        const url = createWebHMUrl(
                          'd',
                          createdAccount.accountId,
                          {
                            hostname: gatewayUrl.data || DEFAULT_GATEWAY_URL,
                          },
                        )
                        copyTextToClipboard(url).then(() => {
                          toast.success('Copied account successfully')
                        })
                      }
                    }}
                    icon={Link}
                  >
                    Share my account with others
                  </Button>
                </YStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function MarketingSection() {
  return (
    <Onboarding.AccentSection>
      <Onboarding.Title color="white">
        Getting started with Seed Hypermedia
      </Onboarding.Title>
      <Onboarding.Text color="white" opacity={0.8}>
        Dive into our collaborative documents and join a community that's
        passionate about innovation and shared knowledge.
      </Onboarding.Text>
    </Onboarding.AccentSection>
  )
}

function AuthorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={102}
      height={102}
      fill="none"
      {...props}
    >
      <rect
        width={86.326}
        height={86.325}
        x={14.254}
        y={1.517}
        stroke={props.color}
        strokeWidth={2}
        rx={1.34}
      />
      <path
        stroke={props.color}
        strokeWidth={2}
        d="M1.428 12.191v85.986a2.34 2.34 0 0 0 2.34 2.34h85.986M74.995 37.198c0 9.71-7.871 17.58-17.58 17.58-9.71 0-17.581-7.87-17.581-17.58 0-9.71 7.87-17.581 17.58-17.581 9.71 0 17.581 7.871 17.581 17.58Z"
      />
      <path
        stroke={props.color}
        strokeWidth={2}
        d="M88.79 87.754c0-14.799-10.247-31.184-24.033-34.489m-38.713 34.49c0-14.8 10.246-31.185 24.032-34.49"
      />
    </svg>
  )
}

function PublisherIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" {...props}>
      <path
        stroke={props.color}
        strokeLinecap="round"
        strokeWidth={2.022}
        d="M48.721 38.774h11.334M48.721 45.514h11.334M48.721 52.254h11.334M48.721 58.994h47.627M48.721 65.734h47.627M48.721 72.473h47.627"
      />
      <path
        stroke={props.color}
        strokeWidth={2}
        d="M41.14 13.754H18.894c-1.284 0-2.25-1.185-1.895-2.42 1.71-5.958 4.856-9.817 10.686-9.817M41.14 13.754c0-4.65-2.87-12.237-13.455-12.237M41.14 13.754v70.713c0 6.971 4.835 12.924 10.17 12.924m0 0h56.783c8.758 0 12.329-3.65 12.855-10.901.081-1.114-.836-2.023-1.952-2.023h-16.941M51.31 97.39c9.217 0 12.698-6.687 13.55-10.919.22-1.094 1.127-2.005 2.244-2.005h34.951m-74.37-82.95h59.856c8.095 0 14.514 6.104 14.514 14.514v68.436"
      />
      <path
        stroke={props.color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M22.375 88.038c1.689-.28 3.612-.472 5.404-.944M21.92 70.883l-2.293-16.75c-.256-2.944 1.07-4.92 2.888-5.742m0 0c2.954-1.336 7.209.377 8.083 5.935 0 0 2.151 12.53 3.322 22.679.794 6.873-2.384 9.099-6.142 10.09M22.516 48.39l9.617-14.018c4.563-6.363-5.422-11.535-8.97-6.403L11.085 46.125c-1.897 2.663-2.245 3.888-2.263 5.866l1.195 42.295c-.001 2.833.795 3.46 2.642 3.827l11.028 2.186c3.472.688 4.286.172 4.337-2.443.052-2.615-.245-10.762-.245-10.762M73.452 46.217l4.007-10.934M89.71 46.217l-4.122-10.934m-8.129 0 3.384-9.232a.674.674 0 0 1 1.263-.006l3.482 9.238m-8.129 0h8.13M67.715 52.398h27.96a.674.674 0 0 0 .673-.674V19.642a.674.674 0 0 0-.674-.674h-27.96a.674.674 0 0 0-.673.674v32.083c0 .372.301.673.674.673ZM50.173 31.554h8.433M50.173 19.28h8.433"
      />
      <path stroke={props.color} strokeWidth={2} d="M54.389 19.28v12.2" />
    </svg>
  )
}

export function openAddAccountWizard() {
  dispatchWizardEvent(true)
}
