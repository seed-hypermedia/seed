import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useGatewayHost_DEPRECATED} from '@/models/gateway-settings'
import {loadWebLinkMeta} from '@/models/web-links'
import {trpc} from '@/trpc'
import {appRouteOfId, isHttpUrl, useNavRoute} from '@/utils/navigation'
import {HYPERMEDIA_SCHEME} from '@shm/shared/constants'
import {SearchResult} from '@shm/shared/editor-types'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {NavRoute} from '@shm/shared/routes'
import {
  hmId,
  HYPERMEDIA_ENTITY_TYPES,
  isHypermediaScheme,
  packHmId,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  RecentSearchResultItem,
  SearchInput as SearchInputUI,
  SearchResultItem,
} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo, useState} from 'react'
import {XStack} from 'tamagui'

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
  const searchResults = useSearch(search, {}, true, 48 - search.length)

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
        const title = item.title || item.id.uid
        return {
          key: packHmId(item.id),
          title,
          path: item.parentNames,
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => onSelect({id: item.id, route: appRouteOfId(item.id)}),
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
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
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
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
          <SizableText size="xs" color="muted" className="uppercase">
            RECENT DOCUMENTS
          </SizableText>
        </XStack>
      ) : null}
      {activeItems.map((item, itemIndex) => {
        const isSelected = focusedIndex === itemIndex
        const sharedProps = {
          selected: isSelected,
          onFocus: () => setFocusedIndex(itemIndex),
          onMouseEnter: () => setFocusedIndex(itemIndex),
        }

        return (
          <>
            {isDisplayingRecents ? (
              <RecentSearchResultItem item={item} {...sharedProps} />
            ) : (
              <SearchResultItem item={item} {...sharedProps} />
            )}

            {itemIndex !== activeItems.length - 1 ? <Separator /> : null}
          </>
        )
      })}
    </>
  )

  if (actionPromise) {
    content = (
      <div className="flex justify-center items-center my-4">
        <Spinner />
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
      const navRoute = appRouteOfId(fullHmId)
      if (navRoute) return navRoute
      console.log('Failed to open this hypermedia content', fullHmId)
      toast.error('Failed to open this hypermedia content')
      return null
    }
    throw new Error('Failed to fetch web link')
  }
}
