import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useExperiments} from '@/models/experiments'
import {useGatewayHost_DEPRECATED} from '@/models/gateway-settings'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {parseDeepLink} from '@/utils/deep-links'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {HYPERMEDIA_SCHEME} from '@shm/shared/constants'
import {SearchResult} from '@shm/shared/editor-types'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {createDocumentNavRoute, NavRoute} from '@shm/shared/routes'
import {
  extractViewTermFromUrl,
  isHypermediaScheme,
  packHmId,
  parseCustomURL,
  parseFragment,
  unpackHmId,
  viewTermToRouteKey,
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
import {useMutation} from '@tanstack/react-query'
import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface SearchInputHandle {
  handleArrowUp: () => void
  handleArrowDown: () => void
  handleEnter: () => void
}

export const SearchInput = forwardRef<
  SearchInputHandle,
  {
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
    /** When provided, use this value instead of internal state */
    externalSearch?: string
    /** Callback when search changes (for controlled mode) */
    onExternalSearchChange?: (value: string) => void
    /** Hide the input field (for when input is rendered externally) */
    hideInput?: boolean
  }
>(function SearchInput(
  {
    onClose,
    onSelect,
    allowWebURL,
    externalSearch,
    onExternalSearchChange,
    hideInput = false,
  },
  ref,
) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch !== undefined ? externalSearch : internalSearch
  const setSearch = onExternalSearchChange || setInternalSearch
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

  // Expose keyboard handlers via ref
  const handleArrowUp = useCallback(() => {
    setFocusedIndex(
      (prev) => (prev - 1 + activeItems.length) % activeItems.length,
    )
  }, [activeItems.length])

  const handleArrowDown = useCallback(() => {
    setFocusedIndex((prev) => (prev + 1) % activeItems.length)
  }, [activeItems.length])

  const handleEnter = useCallback(() => {
    const item = activeItems[focusedIndex]
    if (item) {
      onClose?.()
      item.onSelect?.()
    }
  }, [activeItems, focusedIndex, onClose])

  useImperativeHandle(
    ref,
    () => ({
      handleArrowUp,
      handleArrowDown,
      handleEnter,
    }),
    [handleArrowUp, handleArrowDown, handleEnter],
  )

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

  // When hideInput is true, just render the results without the input wrapper
  if (hideInput) {
    return (
      <div className="flex h-full w-full flex-col gap-2">
        <div className="max-h-[200px] min-h-0 flex-1 overflow-y-auto">
          {content || <p>working...</p>}
        </div>
      </div>
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
})

/**
 * Apply view term to a resolved route (e.g., /:directory -> open Directory page)
 */
function applyViewTermToRoute(
  route: NavRoute,
  routeKey: ReturnType<typeof viewTermToRouteKey>,
): NavRoute {
  if (!routeKey) return route
  if (route.key === 'document') {
    // Return first-class page route, not panel
    return {key: routeKey, id: route.id}
  }
  return route
}

function useURLHandler() {
  const experiments = useExperiments()
  const webQuery = useMutation({
    mutationFn: (input: {webUrl: string}) => client.webQuery.mutate(input),
  })
  const connect = useConnectPeer({
    onSuccess: () => {},
    onError: (err) => {
      console.error('Peer Connect Error:', err)
    },
  })

  return async (search: string): Promise<NavRoute | null> => {
    const httpSearch = isHttpUrl(search) ? search : `https://${search}`

    // Extract view term (e.g., /:activity) before making request
    const {url: cleanUrl, viewTerm} = extractViewTermFromUrl(httpSearch)
    const routeKey = viewTermToRouteKey(viewTerm)

    connect.mutate(cleanUrl)

    if (experiments.data?.webImporting) {
      const webResult = await webQuery.mutateAsync({webUrl: cleanUrl})
      if (webResult.hypermedia) {
        const res = await resolveHypermediaUrl(webResult.hypermedia.url)
        const resId = res?.id ? unpackHmId(res.id) : null
        const navRoute = resId ? appRouteOfId(resId) : null
        if (navRoute) return applyViewTermToRoute(navRoute, routeKey)
        console.log(
          'Failed to open this hypermedia content',
          webResult.hypermedia,
        )
        toast.error('Failed to open this hypermedia content')
        return null
      }
      toast('Importing from the web')
    } else {
      const result = await resolveHypermediaUrl(cleanUrl)
      const parsedUrl = parseCustomURL(cleanUrl)
      const fragment = parseFragment(parsedUrl?.fragment || '')
      const idFragment = {
        blockRef: fragment?.blockId || null,
        blockRange:
          fragment?.start !== undefined && fragment?.end !== undefined
            ? {start: fragment.start, end: fragment.end}
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
          panel: {
            key: 'discussions',
            id: result.target,
            openComment: `${result.hmId.uid}/${result.hmId.path.join('/')}`,
            ...idFragment,
          },
        }
      } else if (result.hmId) {
        // Check for panel query param and use createDocumentNavRoute if present
        if (result.panel) {
          route = createDocumentNavRoute(
            {...result.hmId, ...idFragment},
            null,
            result.panel,
          )
        } else {
          route = appRouteOfId({...result.hmId, ...idFragment})
        }
      }
      if (route) return applyViewTermToRoute(route, routeKey)
      toast.error('Failed to open this hypermedia content')
      return null
    }
    throw new Error('Failed to fetch web link')
  }
}
