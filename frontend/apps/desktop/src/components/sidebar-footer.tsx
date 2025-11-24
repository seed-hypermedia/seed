import {useMyAccountIds, useMyAccounts} from '@/models/daemon'
import {useNavigate} from '@/utils/useNavigate'
import {hmId, useUniversalAppContext} from '@shm/shared'
import {useStream} from '@shm/shared/use-stream'
import {Button} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'

import {LinkDeviceDialog} from '@/components/link-device-dialog'
import {useResources} from '@shm/shared/models/entity'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {useHighlighter} from '@shm/ui/highlight-context'
import {HMIcon} from '@shm/ui/hm-icon'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {KeySquare, Plus, Settings} from 'lucide-react'
import {useEffect, useState} from 'react'
import {dispatchOnboardingDialog} from './onboarding'

export function SidebarFooter({
  isSidebarVisible = false,
}: {
  isSidebarVisible?: boolean
}) {
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccounts = useMyAccountIds()
  const myAccountResources = useResources(
    myAccounts.data?.map((a) => hmId(a)) || [],
  )

  const accountOptions = myAccounts.data
    ?.map((a) => {
      const resourceData = myAccountResources.find((r) => r.data?.id?.uid === a)
        ?.data
      if (!resourceData) return null
      if (resourceData.type !== 'document') return null
      if (typeof resourceData.document?.metadata === 'undefined') return null
      return resourceData
    })
    .filter((d) => !!d)

  useEffect(() => {
    // Check if current selected account is valid (exists in accountOptions)
    const isSelectedAccountInvalid =
      !!myAccounts.data &&
      !myAccounts.data.some((option) => option === selectedIdentityValue)

    // Get the first valid account from the filtered options
    const firstValidAccount = myAccounts.data?.[0]

    // Set selected identity if:
    // 1. No account is selected, OR
    // 2. The selected account is not in the valid options list
    if (
      setSelectedIdentity &&
      firstValidAccount &&
      (!selectedIdentityValue || isSelectedAccountInvalid)
    ) {
      setSelectedIdentity(firstValidAccount)
    }
  }, [setSelectedIdentity, myAccounts.data])
  const selectedAccount = myAccountResources.find(
    (a) => a.data?.id?.uid === selectedIdentityValue,
  )
  const selectedAccountDoc =
    selectedAccount?.data?.type === 'document'
      ? selectedAccount.data.document
      : undefined
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (typeof isSidebarVisible == 'boolean' && isOpen && !isSidebarVisible) {
      setIsOpen(false)
    }
  }, [isSidebarVisible])
  const highlighter = useHighlighter()

  if (!selectedIdentityValue) {
    return (
      <div className="flex w-full flex-row items-center justify-between gap-3 rounded-sm bg-white p-1 shadow-sm">
        <CreateAccountButton />
        <AppSettingsButton />
      </div>
    )
  }
  return (
    <div className="dark:bg-background border-border bg-background mb-2 flex w-full items-center rounded-md border transition-all duration-200 ease-in-out">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          className="flex w-full min-w-0 items-center justify-start gap-2 rounded-md bg-transparent px-1 py-1 pr-3"
          {...highlighter(hmId(selectedIdentityValue))}
        >
          <>
            {/* <Button className="justify-start items-center pr-3 pl-2 w-full min-w-0 bg-transparent bg-blue-500 rounded-sm hover:bg-gray-200"> */}
            {selectedAccount?.data ? (
              <HMIcon
                key={selectedAccount.data?.id?.uid}
                id={selectedAccount.data?.id}
                name={selectedAccountDoc?.metadata?.name}
                icon={selectedAccountDoc?.metadata?.icon}
                size={24}
              />
            ) : null}

            <p className="truncate text-sm select-none">
              {selectedAccountDoc?.metadata?.name ||
                `?${selectedIdentityValue?.slice(-8) || 'Unknown'}`}
            </p>

            {/* </Button> */}
          </>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          className="z-[51] flex h-full max-h-[500px] flex-col items-stretch gap-2 p-2"
          align="end"
        >
          <ScrollArea className="h-full flex-1 overflow-y-auto">
            {accountOptions?.map((option) =>
              option ? (
                <div
                  key={option.id.uid}
                  className={cn(
                    'hover:bg-sidebar-accent flex flex-row items-center gap-4 rounded-md p-2',
                    selectedAccount?.data?.id?.uid === option.id.uid
                      ? 'bg-sidebar-accent'
                      : '',
                  )}
                  onClick={() => {
                    setSelectedIdentity?.(option.id.uid || null)
                    setIsOpen(false)
                  }}
                  {...highlighter(option.id)}
                >
                  {option.id ? (
                    <HMIcon
                      id={option?.id}
                      name={option?.document?.metadata?.name}
                      icon={option?.document?.metadata?.icon}
                    />
                  ) : null}
                  {option?.document?.metadata?.name}
                </div>
              ) : null,
            )}
          </ScrollArea>
          <CreateAccountButton />
        </PopoverContent>
      </Popover>
      <LinkKeyButton />
      <AppSettingsButton />
    </div>
  )
}

function LinkKeyButton() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccounts = useMyAccounts()
  const linkDevice = useAppDialog(LinkDeviceDialog)

  const selectedAccount = myAccounts?.find(
    (a) => a.data?.id?.uid === selectedIdentityValue,
  )
  const selectedAccountDoc =
    selectedAccount?.data?.type === 'document'
      ? selectedAccount.data.document
      : undefined

  const accountName = selectedAccountDoc?.metadata?.name || 'Account'

  return (
    <>
      <Tooltip content="Link Key">
        <Button
          size="icon"
          className="hover:bg-muted active:bg-muted shrink-none h- flex h-8 w-8 items-center justify-center rounded-md"
          onClick={() => {
            if (selectedIdentityValue) {
              linkDevice.open({
                accountUid: selectedIdentityValue,
                accountName,
              })
            }
          }}
        >
          <KeySquare className="size-4" />
        </Button>
      </Tooltip>
      {linkDevice.content}
    </>
  )
}

function CreateAccountButton({className}: {className?: string}) {
  return (
    <Button
      variant="default"
      className={cn('flex-1 border-none', className)}
      onClick={() => {
        dispatchOnboardingDialog(true)
      }}
    >
      <Plus className="size-4" />
      Create Account
    </Button>
  )
}

function AppSettingsButton() {
  const navigate = useNavigate()
  return (
    <Tooltip content="App Settings">
      <Button
        size="icon"
        className="hover:bg-muted active:bg-muted shrink-none flex h-8 w-8 items-center justify-center rounded-md"
        onClick={(e) => {
          e.preventDefault()
          navigate({key: 'settings'})
        }}
      >
        <Settings className="size-4" />
      </Button>
    </Tooltip>
  )
}

export const useIsWindowFocused = ({
  onFocus,
  onBlur,
}: {
  onFocus?: () => void
  onBlur?: () => void
}): boolean => {
  const [isFocused, setIsFocused] = useState(document.hasFocus())
  useEffect(() => {
    const handleFocus = () => {
      onFocus?.()
      setIsFocused(true)
    }
    const handleBlur = () => {
      onBlur?.()
      setIsFocused(false)
    }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])
  return isFocused
}
