import {useAppContext, useGRPCClient} from '@/app-context'
import {dialogBoxShadow} from '@/components/dialog'
import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useGatewayHost} from '@/models/gateway-settings'
import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {fetchWebLink} from '@/models/web-links'
import {trpc} from '@/trpc'
import {
  appRouteOfId,
  isHttpUrl,
  resolveHmIdToAppRoute,
  useHmIdToAppRouteResolver,
} from '@/utils/navigation'
import {NavRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {
  GRPCClient,
  HYPERMEDIA_ENTITY_TYPES,
  HYPERMEDIA_SCHEME,
  hmIdWithVersion,
  isHypermediaScheme,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '@shm/shared'
import {
  Button,
  Input,
  ScrollView,
  Search,
  SizableText,
  Spinner,
  Theme,
  XStack,
  YStack,
  toast,
} from '@shm/ui'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {AppQueryClient} from '../query-client'
import {Title} from './titlebar-title'

export function TitlebarSearch() {
  const [showLauncher, setShowLauncher] = useState(false)
  useListenAppEvent('openLauncher', () => {
    setShowLauncher(true)
  })
  return (
    <XStack
      ai="center"
      className="no-window-drag"
      position="relative"
      gap="$2"
      w="100%"
    >
      <Button
        chromeless
        size="$2"
        icon={Search}
        hoverStyle={{
          cursor: 'text !important',
        }}
        onPress={() => {
          setShowLauncher((v) => !v)
        }}
      />
      <Title />
      {showLauncher ? (
        <LauncherContent
          onClose={() => {
            console.log('closing launcher')
            setShowLauncher(false)
          }}
        />
      ) : null}
    </XStack>
  )
}

function useURLHandler() {
  const experiments = trpc.experiments.get.useQuery()
  const webQuery = trpc.webQuery.useMutation()
  const connect = useConnectPeer({
    onSuccess: () => {
      // toast.success('Connection Added')
    },
    onError: (err) => {
      console.error('Peer Connect Error:', err)
      // toast.error('Connection Error : ' + err?.rawMessage)
    },
  })
  const resolveHmUrl = useHmIdToAppRouteResolver()
  return async (
    queryClient: AppQueryClient,
    grpcClient: GRPCClient,
    search: string,
  ): Promise<NavRoute | null> => {
    const httpSearch = isHttpUrl(search) ? search : `https://${search}`

    connect.mutate(httpSearch)
    if (experiments.data?.webImporting) {
      const webResult = await webQuery.mutateAsync({webUrl: httpSearch})
      if (webResult.hypermedia) {
        const unpacked = await resolveHmUrl(webResult.hypermedia.url)
        if (unpacked?.navRoute) return unpacked.navRoute
        console.log(
          'Failed to open this hypermedia content',
          webResult.hypermedia,
        )
        toast.error('Failed to open this hypermedia content')
        return null
      }
      toast('Importing from the web')
      //   const imported = await importWebCapture(webResult, grpcClient)
      //   const documentId = imported.published.document?.id
      //   const ownerId = imported.published.document?.author
      //   if (!documentId)
      //     throw new Error('Conversion succeeded but documentId is not here')
      //   if (!ownerId)
      //     throw new Error('Conversion succeeded but ownerId is not here')
      //   return {
      //     key: 'document',
      //     documentId,
      //   }
    } else {
      const result = await fetchWebLink(queryClient, httpSearch)
      const parsedUrl = parseCustomURL(httpSearch)
      const fragment = parseFragment(parsedUrl?.fragment || '')
      const fullHmId = hmIdWithVersion(
        result?.hmId,
        result?.hmVersion,
        fragment?.blockId,
      )
      if (!fullHmId) throw new Error('Failed to fetch web link')
      const queried = await resolveHmUrl(result?.hmUrl || fullHmId)
      if (queried?.navRoute) {
        return queried?.navRoute
      }
    }
    throw new Error('Failed to fetch web link')
  }
}

type LauncherItemType = {
  key: string
  title: string
  subtitle?: string
  onSelect: () => void
}
function LauncherContent({onClose}: {onClose: () => void}) {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const grpcClient = useGRPCClient()
  const queryClient = useAppContext().queryClient
  const [actionPromise, setActionPromise] = useState<Promise<void> | null>(null)
  const gwHost = useGatewayHost()
  const handleUrl = useURLHandler()
  const recents = useRecents()
  const searchResults = useSearch(search, {})
  let queryItem: null | LauncherItemType = null
  if (
    isHypermediaScheme(search) ||
    search.startsWith('http://') ||
    search.startsWith('https://') ||
    search.includes('.')
  ) {
    queryItem = {
      key: 'mtt-link',
      title: `Query ${search}`,
      onSelect: async () => {
        const searched = await resolveHmIdToAppRoute(search, grpcClient)
        if (
          (searched?.scheme === HYPERMEDIA_SCHEME ||
            searched?.hostname === gwHost) &&
          searched?.navRoute
        ) {
          onClose()
          navigate(searched?.navRoute)
        } else if (
          search.startsWith('http://') ||
          search.startsWith('https://') ||
          search.includes('.')
        ) {
          setActionPromise(
            handleUrl(queryClient, grpcClient, search)
              .then((navRoute) => {
                if (navRoute) {
                  onClose()
                  navigate(navRoute)
                }
              })
              .catch((error) => {
                appError(`Launcher Error: ${error}`, {error})
              })
              .finally(() => {
                setActionPromise(null)
              }),
          )
        }
      },
    }
  }

  const searchItems: LauncherItemType[] =
    searchResults.data
      ?.map((item) => {
        const id = unpackHmId(item.id)
        if (!id) return null
        return {
          title: item.title || item.id,
          onSelect: () => {
            const appRoute = appRouteOfId(id)
            if (!appRoute) {
              toast.error('Failed to open recent: ' + item.id)
              return
            }
            navigate(appRoute)
            item.id
          },
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
        }
      })
      .filter(Boolean) || []
  const recentItems =
    recents.data?.map(({url, title, subtitle, type}) => {
      return {
        key: url,
        title,
        subtitle,
        onSelect: () => {
          const id = unpackHmId(url)
          if (!id) {
            toast.error('Failed to open recent: ' + url)
            return
          }
          const appRoute = appRouteOfId(id)
          if (!appRoute) {
            toast.error('Failed to open recent: ' + url)
            return
          }
          navigate(appRoute)
        },
      }
    }) || []
  const isDisplayingRecents = !search.length
  const activeItems = isDisplayingRecents
    ? recentItems
    : [...(queryItem ? [queryItem] : []), ...searchItems]

  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  useEffect(() => {
    const keyPressHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
      if (e.key === 'Enter') {
        const item = activeItems[focusedIndex]
        if (item) {
          item.onSelect()
        }
      }
      if (e.key === 'ArrowDown') {
        setFocusedIndex((prev) => (prev + 1) % activeItems.length)
      }
      if (e.key === 'ArrowUp') {
        setFocusedIndex(
          (prev) => (prev - 1 + activeItems.length) % activeItems.length,
        )
      }
    }
    window.addEventListener('keydown', keyPressHandler)
    return () => {
      window.removeEventListener('keydown', keyPressHandler)
    }
  }, [])
  let content = (
    <ScrollView minHeight={300}>
      <YStack
        gap="$2"
        paddingVertical="$3"
        paddingHorizontal="$3"
        backgroundColor={'$background'}
        borderTopStartRadius={0}
        borderTopEndRadius={0}
        borderBottomLeftRadius={6}
        borderBottomRightRadius={6}
      >
        {isDisplayingRecents ? (
          <SizableText color="$color10" marginHorizontal="$4">
            Recent Resources
          </SizableText>
        ) : null}
        {activeItems?.map((item, itemIndex) => {
          return (
            <LauncherItem
              item={item}
              key={item.key}
              selected={focusedIndex === itemIndex}
              onFocus={() => {
                setFocusedIndex(itemIndex)
              }}
              onMouseEnter={() => {
                setFocusedIndex(itemIndex)
              }}
            />
          )
        })}
      </YStack>
    </ScrollView>
  )

  if (actionPromise) {
    content = (
      <YStack marginVertical="$4">
        <Spinner />
      </YStack>
    )
  }
  return (
    <Theme inverse>
      <YStack height="80%" position="absolute" top={0} left={0} zi={10_000}>
        <YStack
          bg="$background"
          boxShadow={dialogBoxShadow}
          padding="$2"
          borderTopLeftRadius={6}
          borderTopRightRadius={6}
        >
          <XStack ai="center" gap="$2">
            <Search size={16} />
            <Input
              minWidth={240}
              autoFocus
              size="$2"
              value={search}
              onChangeText={setSearch}
              placeholder="Open Hypermedia Document..."
              disabled={!!actionPromise}
              onKeyPress={(e: any) => {
                if (e.nativeEvent.key === 'Escape') {
                  onClose()
                }
                if (e.nativeEvent.key === 'Enter') {
                  const item = activeItems[focusedIndex]
                  if (item) {
                    item.onSelect()
                  }
                }
                if (e.nativeEvent.key === 'ArrowDown') {
                  e.preventDefault()
                  setFocusedIndex((prev) => (prev + 1) % activeItems.length)
                }
                if (e.nativeEvent.key === 'ArrowUp') {
                  e.preventDefault()
                  setFocusedIndex(
                    (prev) =>
                      (prev - 1 + activeItems.length) % activeItems.length,
                  )
                }
              }}
            />
          </XStack>
        </YStack>

        {content}
      </YStack>
    </Theme>
  )
}

export function LauncherItem({item, selected = false, onFocus, onMouseEnter}) {
  const elm = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  return (
    <Button
      ref={elm}
      key={item.key}
      onPress={item.onSelect}
      backgroundColor={selected ? '$blue4' : undefined}
      hoverStyle={{
        backgroundColor: selected ? '$blue4' : undefined,
      }}
      size="$2"
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
    >
      <XStack f={1} justifyContent="space-between">
        <SizableText numberOfLines={1}>{item.title}</SizableText>

        <SizableText color="$color10">{item.subtitle}</SizableText>
      </XStack>
    </Button>
  )
}
