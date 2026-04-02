import {hmId, useJoinSite} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {displayHostname, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {FloatingAccountFooter} from '@shm/ui/floating-account-footer'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {JoinButton} from '@shm/ui/join-button'
import {MobilePanelSheet} from '@shm/ui/mobile-panel-sheet'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMedia} from '@shm/ui/use-media'
import {LogOut, UserCog} from 'lucide-react'
import {ReactNode, useMemo, useState} from 'react'
import {useCreateAccount, useLocalKeyPair, LogoutDialog} from './auth'

export function useWebMenuItems(): MenuItemType[] {
  const route = useNavRoute()
  const gwUrl = DEFAULT_GATEWAY_URL
  const gatewayLink = useMemo(() => routeToUrl(route, {hostname: gwUrl}), [route, gwUrl])

  return useMemo(
    () => [
      {
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-4" />,
        onClick: () => {
          if (typeof window !== 'undefined') {
            copyUrlToClipboardWithFeedback(window.location.href, 'Link')
          }
        },
      },
      {
        key: 'copy-gateway-link',
        label: `Copy ${displayHostname(gwUrl)} Link`,
        icon: <Link className="size-4" />,
        onClick: () => {
          if (gatewayLink) {
            copyUrlToClipboardWithFeedback(gatewayLink, 'Link')
          }
        },
      },
    ],
    [gwUrl, gatewayLink],
  )
}

/**
 * Join button for the site header
 */
export function WebHeaderActions({siteUid}: {siteUid: string}) {
  const keyPair = useLocalKeyPair()

  const {content: createAccountContent, createAccount} = useCreateAccount({})

  const {isJoined, joinSite} = useJoinSite({siteUid})

  let joinButton = null
  if (keyPair) {
    if (!isJoined) {
      joinButton = <JoinButton onClick={() => joinSite()} />
    }
  } else {
    joinButton = <JoinButton onClick={() => createAccount()} />
  }

  return (
    <>
      {joinButton}
      {createAccountContent}
    </>
  )
}

/**
 * Wrapper for web pages that shows the floating account avatar in the bottom-left.
 */
export function WebAccountFooter({
  children,
  liftForPageFooter = false,
}: {
  children?: ReactNode
  siteUid?: string
  liftForPageFooter?: boolean
}) {
  const keyPair = useLocalKeyPair()
  const accountId = keyPair?.delegatedAccountUid ?? keyPair?.id
  const logoutDialog = useAppDialog(LogoutDialog)

  const myAccount = useAccount(accountId || undefined, {
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
  })

  const account = useMemo(() => {
    if (!myAccount.data?.id) return null
    return {
      id: hmId(myAccount.data.id.uid, {latest: true}),
      metadata: myAccount.data.metadata ?? undefined,
    }
  }, [myAccount.data])

  const vaultUrl = keyPair?.vaultUrl
  const media = useMedia()
  const isMobile = media.xs
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const avatarIcon = (
    <HMIcon
      id={account?.id ?? hmId(accountId!, {latest: true})}
      name={account?.metadata?.name}
      icon={account?.metadata?.icon}
      size={32}
    />
  )

  const menuItems = (
    <>
      <button
        className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
        onClick={() => {
          if (vaultUrl) {
            window.open(vaultUrl, '_blank')
          }
          setMobileMenuOpen(false)
        }}
        disabled={!vaultUrl}
      >
        <UserCog className="size-5" />
        <span className="text-sm">Manage account</span>
      </button>
      <div className="bg-border mx-4 h-px" />
      <button
        className="text-destructive hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => {
          setMobileMenuOpen(false)
          logoutDialog.open({})
        }}
      >
        <LogOut className="size-5" />
        <span className="text-sm">Log out</span>
      </button>
    </>
  )

  const accountButton = keyPair ? (
    isMobile ? (
      <>
        <button className="flex cursor-pointer rounded-full shadow-lg" onClick={() => setMobileMenuOpen(true)}>
          {avatarIcon}
        </button>
        <MobilePanelSheet isOpen={mobileMenuOpen} title="" onClose={() => setMobileMenuOpen(false)}>
          <div className="flex items-center gap-3 px-4 py-4">
            {avatarIcon}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account?.metadata?.name || 'Account'}</p>
            </div>
          </div>
          <div className="bg-border h-px" />
          {menuItems}
        </MobilePanelSheet>
      </>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex cursor-pointer rounded-full shadow-lg">{avatarIcon}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-[200px]">
          <div className="flex items-center gap-3 px-2 py-2">
            {avatarIcon}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account?.metadata?.name || 'Account'}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (vaultUrl) {
                window.open(vaultUrl, '_blank')
              }
            }}
            disabled={!vaultUrl}
          >
            <UserCog className="size-4" />
            Manage account
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => logoutDialog.open({})}>
            <LogOut className="size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  ) : null

  return (
    <FloatingAccountFooter
      floatingButton={accountButton}
      extraContent={logoutDialog.content}
      liftForPageFooter={liftForPageFooter}
    >
      {children}
    </FloatingAccountFooter>
  )
}
