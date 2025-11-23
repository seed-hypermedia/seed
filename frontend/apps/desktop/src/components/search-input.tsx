import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useGatewayHost_DEPRECATED} from '@/models/gateway-settings'
import {useSelectedAccountId} from '@/selected-account'
import {trpc} from '@/trpc'
import {parseDeepLink} from '@/utils/deep-links'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {HYPERMEDIA_SCHEME} from '@shm/shared/constants'
import {SearchResult} from '@shm/shared/editor-types'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {NavRoute} from '@shm/shared/routes'
import {
  isHypermediaScheme,
  packHmId,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  appRouteOfId,
  isHttpUrl,
  useNavRoute,
} from '@shm/shared/utils/navigation'
import {
  RecentSearchResultItem,
  SearchInput as SearchInputUI,
  SearchResultItem,
} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'

export function SearchInput({
  onClose,
  onSelect,
  allowWebURL,
}: {
  onClose?: () => void
  allowWebURL?: boolean
  onSelect: ({
    id,
    route,
    webUrl,
  }: {
    id?: UnpackedHypermediaId
    route?: NavRoute
    webUrl?: string
  }) => void
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const isSearchPending = search !== deferredSearch

  const [focusedIndex, setFocusedIndex] = useState(0)
  const [actionPromise, setActionPromise] = useState<Promise<void> | null>(null)
  const gwHost = useGatewayHost_DEPRECATED()
  const handleUrl = useURLHandler()
  const recents = useRecents()
  const selectedAccountId = useSelectedAccountId()
  const triggerWindowEvent = useTriggerWindowEvent()

  const searchResults = useSearch(deferredSearch, {
    includeBody: true,
    contextSize: 48 - deferredSearch.length,
    perspectiveAccountUid: selectedAccountId ?? undefined,
  })
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  let queryItem: null | SearchResult = useMemo(() => {
    if (
      isHypermediaScheme(deferredSearch) ||
      deferredSearch.startsWith('http://') ||
      deferredSearch.startsWith('https://') ||
      deferredSearch.includes('.')
    ) {
      return {
        key: 'mtt-link',
        title: `Query ${search}`,
        onSelect: async () => {
          const deepLinkEvent = parseDeepLink(search)
          if (deepLinkEvent) {
            onClose?.()
            triggerWindowEvent(deepLinkEvent)
            return
          }

          const unpacked = unpackHmId(search)
          const appRoute = unpacked ? appRouteOfId(unpacked) : null

          if (
            (unpacked?.scheme === HYPERMEDIA_SCHEME ||
              unpacked?.hostname === gwHost) &&
            appRoute &&
            unpacked
          ) {
            onClose?.()
            onSelect({route: appRoute, id: unpacked})
          } else if (
            search.startsWith('http://') ||
            search.startsWith('https://') ||
            search.includes('.')
          ) {
            if (allowWebURL) {
              onSelect({webUrl: search})
            }

            setActionPromise(
              handleUrl(search)
                .then((navRoute) => {
                  if (navRoute) {
                    onClose?.()
                    onSelect({route: navRoute, webUrl: search})
                  }
                })
                .catch((error) => {
                  if (!allowWebURL) {
                    appError(`Launcher Error: ${error}`, {error})
                  }
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
  }, [deferredSearch, search, triggerWindowEvent])

  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.slice(0, 50) // Limit to 50 results for performance
      // ?.sort((a, b) => Number(!!b.id.latest) - Number(!!a.id.latest))
      ?.map((item, index) => {
        const title = item.title || item.id.uid
        return {
          key: packHmId(item.id),
          title,
          path: item.parentNames,
          icon: item.icon,
          onFocus: () => {
            setFocusedIndex(index)
          },
          onMouseEnter: () => {
            setFocusedIndex(index)
          },
          onSelect: () => onSelect({id: item.id, route: appRouteOfId(item.id)}),
          subtitle: 'Document',
          searchQuery: item.searchQuery,
          versionTime: item.versionTime
            ? item.versionTime.toDate().toLocaleString()
            : '',
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
          key: packHmId(id),
          title: name,
          id,
          path: id.path || [],
          subtitle: 'Document',
          onFocus: () => {
            setFocusedIndex(index)
          },
          onMouseEnter: () => {
            setFocusedIndex(index)
          },
          onSelect: () => {
            if (!id) {
              toast.error('Failed to open recent: ' + id + ' ' + name)
              return
            } else {
              onSelect({id: id, route: appRouteOfId(id)})
              setTimeout(() => onClose?.(), 100)
              return
            }
          },
        }
      }) || []
  const isDisplayingRecents = !deferredSearch.length
  const activeItems = isDisplayingRecents
    ? recentItems
    : [...(queryItem ? [queryItem] : []), ...searchItems]

  console.log(
    `🔍 Search="${search}" | Deferred="${deferredSearch}" | isPending=${isSearchPending} | isRecents=${isDisplayingRecents} | results=${
      searchResults.data?.entities?.length || 0
    } | activeItems=${activeItems.length} | SHOW_SPINNER=${
      isSearchPending && !isDisplayingRecents
    }`,
  )

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  useEffect(() => {
    const el = itemRefs.current[focusedIndex]
    if (el) {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [focusedIndex])

  let content = (
    <>
      {isDisplayingRecents ? (
        <SizableText size="xs" color="muted" className="text-sans! uppercase">
          RECENT DOCUMENTS
        </SizableText>
      ) : null}
      {activeItems.length ? (
        activeItems.map((item, itemIndex) => {
          const isSelected = focusedIndex === itemIndex
          const sharedProps = {
            selected: isSelected,
            onFocus: () => setFocusedIndex(itemIndex),
            onMouseEnter: () => setFocusedIndex(itemIndex),
          }

          return (
            <div
              ref={(el) => (itemRefs.current[itemIndex] = el)}
              key={item.key}
              className="focus:outline-none"
            >
              {isDisplayingRecents ? (
                <RecentSearchResultItem
                  item={{
                    ...item,
                    // key: item.id ? packHmId(item.id) : item.key,
                    path: item.path || [],
                    onFocus: sharedProps.onFocus,
                    onMouseEnter: sharedProps.onMouseEnter,
                    onSelect: () => item.onSelect?.(),
                  }}
                  selected={sharedProps.selected}
                />
              ) : (
                <SearchResultItem
                  item={{
                    ...item,
                    path: item.path || [],
                    onFocus: sharedProps.onFocus,
                    onMouseEnter: sharedProps.onMouseEnter,
                  }}
                  selected={sharedProps.selected}
                />
              )}
              {itemIndex !== activeItems.length - 1 ? <Separator /> : null}
            </div>
          )
        })
      ) : !isSearchPending ? (
        <div className="my-4 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No results found.</p>
        </div>
      ) : null}
    </>
  )

  return (
    <SearchInputUI
      searchResults={activeItems || []}
      inputProps={{
        value: search,
        onChangeText: setSearch,
        disabled: !!actionPromise,
      }}
      loading={searchResults.isLoading}
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
          onClose?.()
          item.onSelect?.()
        }
      }}
      focusedIndex={focusedIndex}
    >
      {content || <p>working...</p>}
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
  return async (search: string): Promise<NavRoute | null> => {
    const httpSearch = isHttpUrl(search) ? search : `https://${search}`
    connect.mutate(httpSearch)
    if (experiments.data?.webImporting) {
      const webResult = await webQuery.mutateAsync({webUrl: httpSearch})
      if (webResult.hypermedia) {
        const res = await resolveHypermediaUrl(webResult.hypermedia.url)
        const resId = res?.id ? unpackHmId(res.id) : null
        const navRoute = resId ? appRouteOfId(resId) : null
        if (navRoute) return navRoute
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
      const result = await resolveHypermediaUrl(httpSearch)
      const parsedUrl = parseCustomURL(httpSearch)
      const fragment = parseFragment(parsedUrl?.fragment || '')
      const idFragment = {
        blockRef: fragment?.blockId || null,
        blockRange:
          fragment?.start !== undefined && fragment?.end !== undefined
            ? {
                start: fragment.start,
                end: fragment.end,
              }
            : null,
      }
      if (!result) {
        toast.error('Failed to fetch web link')
        return null
      }
      let route: NavRoute | null | undefined = null
      if (
        result.type === 'Comment' &&
        result.target &&
        result.hmId &&
        result.hmId.path
      ) {
        route = {
          key: 'document',
          id: result.target,
          accessory: {
            key: 'discussions',
            openComment: `${result.hmId.uid}/${result.hmId.path.join('/')}`,
            ...idFragment,
          },
        }
      } else if (result.hmId) {
        route = appRouteOfId({
          ...result.hmId,
          ...idFragment,
        })
      }
      if (route) return route
      toast.error('Failed to open this hypermedia content')
      return null
    }
    throw new Error('Failed to fetch web link')
  }
}
