import {queryKeys} from '@/models/query-keys'
import {
  API_FILE_URL,
  DocumentChange,
  eventStream,
  HMDraft,
  hmId,
  packHmId,
} from '@shm/shared'
import {
  Button,
  CheckboxField,
  Copy,
  copyTextToClipboard,
  Dialog,
  Field,
  Input,
  Link,
  Onboarding,
  Reload,
  SizableText,
  TextArea,
  toast,
  XStack,
  YStack,
} from '@shm/ui'
import {useMutation} from '@tanstack/react-query'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {
  NamedKey,
  useMnemonics,
  useMyAccountIds,
  useRegisterKey,
} from '../models/daemon'
import {trpc} from '../trpc'
import {useOpenDraft} from '../utils/open-draft'
import {AvatarForm} from './avatar-form'

const onboardingColor = '#755EFF'

export const [dispatchWizardEvent, wizardEvents] = eventStream<boolean>()
export const [dispatchNewKeyEvent, newKeyEvent] = eventStream<boolean>()

type AccountStep = 'type' | 'create' | 'name' | 'members' | 'complete'

export function AccountWizardDialog() {
  const accounts = useMyAccountIds()
  const createDraft = trpc.drafts.write.useMutation()
  const invalidate = useQueryInvalidator()
  const [open, setOpen] = useState(false)
  const [newAccount, setNewAccount] = useState<null | boolean>(true)
  const [step, setStep] = useState<AccountStep>('type')
  const [existingWords, setExistingWords] = useState<string>('')
  const [thumbnail, setThumbnail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [accountType, setAccountType] = useState<'author' | 'publisher' | null>(
    null,
  )
  const [isSaveWords, setSaveWords] = useState<null | boolean>(true)
  const [isUserSavingWords, setUserSaveWords] = useState<null | boolean>(null)
  const [isExistingWordsSave, setExistingWordsSave] = useState<boolean>(false)
  const [createdAccount, setCreatedAccount] = useState<NamedKey | null>(null)
  const openDraft = useOpenDraft('push')
  const inputWords = useRef<HTMLTextAreaElement | null>(null)

  const saveWords = trpc.secureStorage.write.useMutation()
  const grpcClient = useGRPCClient()

  const {data: genWords, refetch: refetchWords} = useMnemonics()

  const register = useRegisterKey()

  useEffect(() => {
    wizardEvents.subscribe((val) => {
      setOpen(val)
    })
  }, [])

  useEffect(() => {
    console.log('accounts.data?.keys', accounts.data?.keys)
    if (accounts.data?.length == 0) {
      setAccountType('author')
      setStep('create')
    }
  }, [accounts.data])

  useEffect(() => {
    if (step == 'create' && !newAccount) {
      // Focus the textarea when changing to this step (better UX!)
      inputWords.current?.focus()
    }
  }, [step, newAccount])

  const addExistingAccount = useMutation({
    mutationFn: async () => {
      let input = []

      let error = isInputValid(words as string)

      if (typeof error == 'string') {
        // this means is an error
        throw Error(`Invalid mnemonics: ${error}`)
      } else {
        input = extractWords(words as string)
      }

      if (input.length == 0) {
        throw Error('No mnemonics')
      }
      let res = await register.mutateAsync({
        mnemonic: input,
        name,
      })
      return res
    },
  })

  async function handleAccountCreation() {
    const hasAccounts = accounts.data?.length != 0
    const name = `temp${accountType}${nanoid(8)}`
    try {
      const createdAccount = await register.mutateAsync({
        mnemonic: words as Array<string>,
        name,
      })

      const renamedKey = await grpcClient.daemon.updateKey({
        currentName: name,
        newName: createdAccount.accountId,
      })

      if (isSaveWords) {
        saveWords.mutate({key: name, value: words})
      }

      await createDraft.mutateAsync({
        id: createdAccount.accountId,
        draft: {
          signingAccount: createdAccount.accountId,
          content: [],
          metadata: {
            accountType,
          },
          members: [],
          previousId: null,
          deps: [],
        } as HMDraft,
      })
      invalidate([queryKeys.LOCAL_ACCOUNT_ID_LIST])
      setCreatedAccount(renamedKey)

      setStep('name')
    } catch (error) {
      toast.error(`REGISTER ERROR: ${error}`)
    }
  }

  async function handleDocEdit() {
    // TODO: horacio create home document with name and thumbnail data
    if (!name) {
      toast.error('Name is required. Please add one')
    } else {
      console.log('== KEYS', createdAccount, accounts)
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

        if (thumbnail) {
          changes.push(
            new DocumentChange({
              op: {
                case: 'setMetadata',
                value: {
                  key: 'thumbnail',
                  value: `ipfs://${thumbnail}`,
                },
              },
            }),
          )
        }

        const doc = await grpcClient.documents.createDocumentChange({
          account: createdAccount?.accountId,
          signingKeyName: createdAccount?.publicKey,
          changes,
        })

        if (doc) {
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
      return existingWords
    }
  }, [genWords, existingWords, newAccount])

  return (
    <Dialog
      open={open}
      onOpenChange={(val: boolean) => {
        setNewAccount(true)
        setStep('type')
        dispatchWizardEvent(val)
      }}
      defaultValue={false}
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
          {step == 'type' ? (
            <Onboarding.Wrapper>
              <Onboarding.MainSection>
                <Onboarding.Title>
                  What account type you want to create?
                </Onboarding.Title>
                <YStack gap="$2">
                  <Button
                    onPress={() => {
                      setAccountType('author')
                      setStep('create')
                      refetchWords()
                    }}
                  >
                    Author
                  </Button>
                  <Button
                    onPress={() => {
                      setAccountType('publisher')
                      setStep('create')
                      refetchWords()
                    }}
                  >
                    Publisher
                  </Button>
                </YStack>
              </Onboarding.MainSection>
            </Onboarding.Wrapper>
          ) : null}
          {step == 'create' && newAccount ? (
            <Onboarding.Wrapper>
              <MarketingSection />
              <Onboarding.MainSection>
                <Onboarding.Title>{`Create your new ${
                  accountType == 'author'
                    ? 'Author'
                    : accountType == 'publisher'
                    ? 'Publisher'
                    : ''
                } Account`}</Onboarding.Title>
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
                <YStack gap="$2" marginTop="auto">
                  <Button
                    bg={onboardingColor}
                    color="$color1"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: '$color1',
                      borderColor: '$colorTransparent',
                    }}
                    color="$color1"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: '$color1',
                      borderColor: '$colorTransparent',
                    }}
                    f={1}
                    disabled={!isSaveWords && !isUserSavingWords}
                    opacity={!isSaveWords && !isUserSavingWords ? 0.4 : 1}
                    onPress={handleAccountCreation}
                  >
                    Create new Account
                  </Button>
                  <XStack ai="center">
                    <SizableText size="$2">Have an account?</SizableText>
                    <Button
                      color={onboardingColor}
                      bg="$colorTransparent"
                      chromeless
                      size="$2"
                      p={0}
                      fontWeight="bold"
                      onPress={() => setNewAccount(false)}
                    >
                      Add Existing account.
                    </Button>
                  </XStack>
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
                  I have my words save somewhere
                </CheckboxField>
                <YStack gap="$2" marginTop="auto">
                  <Button
                    bg={onboardingColor}
                    color="$color1"
                    borderColor="$colorTransparent"
                    hoverStyle={{
                      bg: onboardingColor,
                      color: '$color1',
                      borderColor: '$colorTransparent',
                    }}
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
                      addExistingAccount.mutateAsync().then((res) => {
                        invalidate([queryKeys.LOCAL_ACCOUNT_ID_LIST])
                        setCreatedAccount(res)
                        setStep('complete')
                      })
                    }}
                  >
                    Add Existing account
                  </Button>

                  <XStack ai="center">
                    <SizableText size="$2">Don't have an account?</SizableText>
                    <Button
                      color={onboardingColor}
                      bg="$colorTransparent"
                      chromeless
                      size="$2"
                      p={0}
                      fontWeight="bold"
                      onPress={() => setNewAccount(true)}
                    >
                      Create a new account.
                    </Button>
                  </XStack>
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
                  <AvatarForm
                    url={`${API_FILE_URL}/thumbnail`}
                    onAvatarUpload={(d) => {
                      console.log('avatar upload, ', d)
                      setThumbnail(d)
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
                        setStep('type')
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
                        copyTextToClipboard(
                          packHmId(hmId('d', createdAccount.accountId)),
                        ).then(() => {
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

function isInputValid(input: string): string | boolean {
  let res = extractWords(input)

  if (!res.length) {
    return `Can't extract words from input. malformed input => ${input}`
  }
  if (res.length == 12) {
    return false
  } else {
    return `input does not have a valid words amount, please add a 12 mnemonics word. current input is ${res.length}`
  }
}

function extractWords(input: string): Array<string> {
  const delimiters = [',', ' ', '.', ';', ':', '\n', '\t']
  let wordSplitting = [input]
  delimiters.forEach((delimiter) => {
    wordSplitting = wordSplitting.flatMap((word) => word.split(delimiter))
  })
  let words = wordSplitting.filter((word) => word.length > 0)
  return words
}

function MarketingSection() {
  return (
    <Onboarding.AccentSection>
      <Onboarding.Title color="$color2">
        Getting started with Seed Hypermedia
      </Onboarding.Title>
      <Onboarding.Text color="$color8">
        Dive into our collaborative documents and join a community that's
        passionate about innovation and shared knowledge.
      </Onboarding.Text>
    </Onboarding.AccentSection>
  )
}
