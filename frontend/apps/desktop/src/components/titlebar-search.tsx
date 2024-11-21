import {useAppContext, useGRPCClient} from '@/app-context'
import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useGatewayHost_DEPRECATED} from '@/models/gateway-settings'
import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {loadWebLinkMeta} from '@/models/web-links'
import {trpc} from '@/trpc'
import {
  appRouteOfId,
  isHttpUrl,
  resolveHmIdToAppRoute,
  useHmIdToAppRouteResolver,
} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {
  GRPCClient,
  HYPERMEDIA_ENTITY_TYPES,
  HYPERMEDIA_SCHEME,
  NavRoute,
  SearchResult,
  hmId,
  isHypermediaScheme,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '@shm/shared'
import {
  Button,
  Search,
  SearchInput,
  SearchResultItem,
  SizableText,
  Spinner,
  View,
  XStack,
  YStack,
  toast,
} from '@shm/ui'
import {useEffect, useState} from 'react'
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
      position="relative"
      gap="$2"
      w="100%"
      borderColor="$color7"
    >
      <Button
        chromeless
        size="$2"
        className="no-window-drag"
        icon={Search}
        // hoverStyle={{
        //   cursor: 'text !important',
        // }}
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
      const result = await loadWebLinkMeta(httpSearch)
      const parsedUrl = parseCustomURL(httpSearch)
      const fragment = parseFragment(parsedUrl?.fragment || '')
      const baseId = unpackHmId(result?.hypermedia_id)
      const fullHmId =
        baseId &&
        hmId(baseId.type, baseId.uid, {
          path: baseId.path,
          version: result.hypermedia_version,
          blockRef: fragment?.blockId,
        })
      if (!fullHmId) throw new Error('Failed to fetch web link')
      const queried = await resolveHmUrl(fullHmId)
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
  const gwHost = useGatewayHost_DEPRECATED()
  const handleUrl = useURLHandler()
  const recents = useRecents()
  const searchResults = useSearch(search, {})
  let queryItem: null | SearchResult = null

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
        const unpacked = unpackHmId(search)
        const searched = unpacked
          ? await resolveHmIdToAppRoute(unpacked, grpcClient)
          : null

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
      onFocus: () => {},
      onMouseEnter: () => {},
    }
  }

  const searchItems: SearchResult[] = searchResults
    ? searchResults.data
        ?.map((item) => {
          const id = unpackHmId(item.id)
          if (!id) return null
          return {
            title: item.title || item.id,
            onFocus: () => {},
            onMouseEnter: () => {},
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
    : []
  const recentItems =
    recents.data?.map(({url, title, subtitle}, index) => {
      return {
        key: url,
        title,
        subtitle,
        onFocus: () => {
          setFocusedIndex(index)
        },
        onMouseEnter: () => {
          setFocusedIndex(index)
        },
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
    <>
      {isDisplayingRecents ? (
        <XStack padding={4}>
          <SizableText fontSize={10} color="$color10">
            RECENT DOCUMENTS
          </SizableText>
        </XStack>
      ) : null}
      {activeItems?.map((item, itemIndex) => {
        return (
          <SearchResultItem
            item={item}
            key={item.key}
            selected={focusedIndex === itemIndex}
          />
        )
      })}
    </>
  )

  if (actionPromise) {
    content = (
      <YStack marginVertical="$4">
        <Spinner />
      </YStack>
    )
  }
  return (
    <>
      <View
        onPress={onClose}
        top={0}
        left={0}
        right={0}
        bottom={0}
        // @ts-ignore
        position="fixed"
        zIndex="$zIndex.8"
      />
      <YStack
        elevation="$4"
        className="no-window-drag"
        minHeight="80%"
        position="absolute"
        top={0}
        left={0}
        zi="$zIndex.8"
        width="100%"
        maxWidth={800}
        bg="$backgroundStrong"
        backgroundColor="$backgroundStrong"
        borderColor="$color7"
        borderWidth={1}
        borderRadius={6}
      >
        <SearchInput
          searchResults={activeItems || []}
          inputProps={{
            value: search,
            onChangeText: setSearch,
            disabled: !!actionPromise,
          }}
          onArrowDown={() => {
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          }}
          onArrowUp={() => {
            setFocusedIndex(
              (prev) => (prev - 1 + activeItems.length) % activeItems.length,
            )
          }}
          onEscape={() => {
            onClose()
          }}
          onEnter={() => {
            const item = activeItems[focusedIndex]
            if (item) {
              item.onSelect()
            }
          }}
          focusedIndex={focusedIndex}
        >
          {content}
        </SearchInput>
      </YStack>
    </>
  )
}
