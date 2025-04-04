import appError from '@/errors'
import {grpcClient} from '@/grpc-client'
import {useConnectPeer} from '@/models/contacts'
import {useGatewayHost_DEPRECATED} from '@/models/gateway-settings'
import {loadWebLinkMeta} from '@/models/web-links'
import {trpc} from '@/trpc'
import {
  isHttpUrl,
  resolveHmIdToAppRoute,
  useHmIdToAppRouteResolver,
  useNavRoute,
} from '@/utils/navigation'
import {HYPERMEDIA_SCHEME} from '@shm/shared/constants'
import {SearchResult} from '@shm/shared/editor-types'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {NavRoute} from '@shm/shared/routes'
import {
  hmId,
  HYPERMEDIA_ENTITY_TYPES,
  isHypermediaScheme,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  SearchInput as SearchInputUI,
  SearchResultItem,
} from '@shm/ui/search-input'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo, useState} from 'react'
import {Separator, SizableText, XStack, YStack} from 'tamagui'

export function SearchInput({
  onClose,
  onSelect,
}: {
  onClose?: () => void
  onSelect: ({id, route}: {id?: UnpackedHypermediaId; route?: NavRoute}) => void
}) {
  const [search, setSearch] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [actionPromise, setActionPromise] = useState<Promise<void> | null>(null)
  const gwHost = useGatewayHost_DEPRECATED()
  const handleUrl = useURLHandler()
  const recents = useRecents()
  const searchResults = useSearch(search, {})

  // const [entities, setEntities] = useState([])

  // useEffect(() => {
  //   if (searchResults.data) {
  //     // @ts-ignore
  //     setEntities(
  //       useEntities(searchResults.data.entities.map((item) => item.id)),
  //     )
  //   }
  // }, [searchResults])

  // const entities = searchResults.data?.entities.length
  //   ? useEntities(searchResults?.data?.entities.map((item) => item.id))
  //   : []

  // useEffect(() => {
  //   console.log(entities)
  // }, [entities])

  let queryItem: null | SearchResult = useMemo(() => {
    if (
      isHypermediaScheme(search) ||
      search.startsWith('http://') ||
      search.startsWith('https://') ||
      search.includes('.')
    ) {
      return {
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
            onClose?.()
            onSelect({route: searched?.navRoute})
          } else if (
            search.startsWith('http://') ||
            search.startsWith('https://') ||
            search.includes('.')
          ) {
            setActionPromise(
              handleUrl(search)
                .then((navRoute) => {
                  if (navRoute) {
                    onClose?.()
                    onSelect({route: navRoute})
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
        onFocus: () => {
          setFocusedIndex(0)
        },
        onMouseEnter: () => {
          setFocusedIndex(0)
        },
      }
    }
    return null
  }, [search])

  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        // console.log(item)
        return {
          title: item.title || item.id.uid,
          key: item.id.uid,
          path: item.id.path,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => onSelect({id: item.id}),
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
        }
      })
      .filter(Boolean) ?? []

  const route = useNavRoute()
  const docRoute = route?.key === 'document' ? route : null
  const recentItems =
    recents.data
      ?.filter(({id}) => {
        return !docRoute || id.id !== docRoute.id.id
      })
      .map(({id, name}, index) => {
        return {
          key: id.id,
          title: name,
          subtitle: undefined,
          onFocus: () => {
            setFocusedIndex(index)
          },
          onMouseEnter: () => {
            setFocusedIndex(index)
          },
          onSelect: () => {
            if (!id) {
              toast.error('Failed to open recent: ' + id.id)
              return
            } else {
              onSelect({id})
            }
          },
        }
      }) || []
  const isDisplayingRecents = !search.length
  const activeItems = isDisplayingRecents
    ? recentItems
    : [...(queryItem ? [queryItem] : []), ...searchItems]

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  useEffect(() => {
    const keyPressHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.()
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
        // console.log(item)
        return (
          <>
            <SearchResultItem
              item={item}
              key={item.key}
              selected={focusedIndex === itemIndex}
            />
            {itemIndex === activeItems.length - 1 ? undefined : <Separator />}
          </>
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
    <SearchInputUI
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
        onClose?.()
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
    </SearchInputUI>
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
  return async (search: string): Promise<NavRoute | null> => {
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
