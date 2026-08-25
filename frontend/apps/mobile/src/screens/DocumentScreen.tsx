import {RouteProp} from '@react-navigation/native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import React, {useCallback, useEffect, useLayoutEffect, useState} from 'react'
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {resolveSiteHomeUid} from '../client/site-home'
import {BlockNodeView} from '../components/BlockNodeView'
import {Discussions} from '../components/Discussions'
import {Sidebar} from '../components/Sidebar'
import {UnreferencedChildren} from '../components/UnreferencedChildren'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {radius, theme} from '../theme'
import {hmId} from '../utils/hm-id'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Document'>
  route: RouteProp<RootStackParamList, 'Document'>
}

type DocState = {status: 'loading'} | {status: 'error'; message: string} | {status: 'loaded'; document: HMDocument}

type Tab = 'content' | 'comments'

/**
 * The one document page, used for every hypermedia document — the server's own
 * site home included. There is no separate "server" screen: connecting to a
 * server resolves its registered site and opens that document here, so the home
 * document gets the same content rendering, the same Comments tab and the same
 * sidebar as any other page.
 */
export function DocumentScreen({navigation, route}: Props) {
  const {uid, path, title, isSiteHome} = route.params
  const targetId = hmId(uid, path)
  const [state, setState] = useState<DocState>({status: 'loading'})
  const [tab, setTab] = useState<Tab>('content')
  const [commentCount, setCommentCount] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const load = useCallback(async () => {
    setState({status: 'loading'})
    try {
      const resource = await getSeedClient().request('Resource', targetId)
      if (resource.type !== 'document') {
        setState({status: 'error', message: `Document unavailable (${resource.type}).`})
        return
      }
      setState({status: 'loaded', document: resource.document})
    } catch (error) {
      setState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [targetId.id])

  useEffect(() => {
    void load()
  }, [load])

  // The comment count drives the tab badge, like the web's InteractionSummary.
  useEffect(() => {
    let cancelled = false
    getSeedClient()
      .request('InteractionSummary', {id: targetId})
      .then((summary) => {
        if (!cancelled) setCommentCount(summary?.comments ?? 0)
      })
      .catch(() => {
        if (!cancelled) setCommentCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [targetId.id])

  const documentName = state.status === 'loaded' ? state.document.metadata?.name : undefined
  useLayoutEffect(() => {
    navigation.setOptions({
      title: documentName || title || 'Document',
      // The sidebar lives in the header of every document page, so the current
      // account and the app's navigation are one tap away wherever you are.
      headerRight: () => (
        <TouchableOpacity testID="open-sidebar" style={styles.menuButton} onPress={() => setSidebarOpen(true)}>
          <Text style={styles.menuButtonGlyph}>☰</Text>
        </TouchableOpacity>
      ),
    })
  }, [navigation, documentName, title])

  const goToSiteHome = useCallback(async () => {
    const server = getCurrentServer()
    try {
      const homeUid = await resolveSiteHomeUid(server.url)
      navigation.reset({
        index: 1,
        routes: [{name: 'ServerSelect'}, {name: 'Document', params: {uid: homeUid, path: [], isSiteHome: true}}],
      })
    } catch {
      navigation.navigate('ServerSelect')
    }
  }, [navigation])

  return (
    <View style={styles.container} testID={isSiteHome ? 'site-home' : 'document-screen'}>
      <View style={styles.tabBar}>
        <TabButton label="Content" active={tab === 'content'} onPress={() => setTab('content')} testID="tab-content" />
        <TabButton
          label="Comments"
          count={commentCount ?? undefined}
          active={tab === 'comments'}
          onPress={() => setTab('comments')}
          testID="tab-comments"
        />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="document-content">
        {tab === 'content' ? (
          <>
            {state.status === 'loading' && <ActivityIndicator size="large" color={theme.brand} style={styles.loader} />}
            {state.status === 'error' && (
              <View style={styles.errorBox}>
                <Text testID="document-error" style={styles.errorText}>
                  {state.message}
                </Text>
                <TouchableOpacity testID="document-retry" style={styles.retryButton} onPress={load}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {state.status === 'loaded' && (
              <>
                <Text testID="document-title" style={styles.title}>
                  {state.document.metadata?.name || title || uid}
                </Text>
                {state.document.content.map((node, index) => (
                  <BlockNodeView key={node.block?.id ?? index} node={node} />
                ))}
                {state.document.content.length === 0 && <Text style={styles.emptyText}>This page is empty.</Text>}
                <UnreferencedChildren uid={uid} path={path} content={state.document.content} />
              </>
            )}
          </>
        ) : (
          <Discussions targetId={targetId} />
        )}
      </ScrollView>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        navigate={(screen) => {
          if (screen === 'SiteHome') void goToSiteHome()
          else navigation.navigate(screen)
        }}
      />
    </View>
  )
}

function TabButton({
  label,
  count,
  active,
  onPress,
  testID,
}: {
  label: string
  count?: number
  active: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <TouchableOpacity testID={testID} style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
        {count != null && count > 0 ? ` ${count}` : ''}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  menuButton: {
    width: 34,
    height: 34,
    borderRadius: radius.lg,
    backgroundColor: '#2a5555',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonGlyph: {
    color: '#8fd5d5',
    fontSize: 16,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  tab: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: theme.accent,
  },
  tabLabel: {
    color: theme.mutedForeground,
    fontSize: 14,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: theme.accentForeground,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  loader: {
    marginTop: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  errorBox: {
    marginTop: 32,
    alignItems: 'center',
  },
  errorText: {
    color: theme.danger,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3a5a5a',
    borderRadius: radius.lg,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: theme.mutedForeground,
    fontSize: 14,
  },
})
