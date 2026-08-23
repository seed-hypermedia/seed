import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import React, {useCallback, useEffect, useState} from 'react'
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {fetchSiteConfig} from '../client/site-config'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {hmId} from '../utils/hm-id'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>
  route: {params: {serverUrl: string}}
}

type HomeState = {status: 'loading'} | {status: 'error'; message: string} | {status: 'loaded'; document: HMDocument}

export function HomeScreen({navigation, route}: Props) {
  const [serverName, setServerName] = useState('')
  const [state, setState] = useState<HomeState>({status: 'loading'})

  const loadHomeDocument = useCallback(async () => {
    setState({status: 'loading'})
    const server = getCurrentServer()
    setServerName(server.name)

    try {
      // The site config tells us which account's home document this server hosts
      const config = await fetchSiteConfig(server.url)
      if (!config.registeredAccountUid) {
        setState({status: 'error', message: 'This server has no registered site.'})
        return
      }

      const client = getSeedClient()
      const resource = await client.request('Resource', hmId(config.registeredAccountUid))
      if (resource.type !== 'document') {
        setState({status: 'error', message: `Home document unavailable (${resource.type}).`})
        return
      }
      setState({status: 'loaded', document: resource.document})
    } catch (err) {
      console.error('Failed to load home page:', err)
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to load home page',
      })
    }
  }, [])

  useEffect(() => {
    loadHomeDocument()
  }, [loadHomeDocument, route.params.serverUrl])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.serverName}>{serverName}</Text>
        {state.status === 'loaded' ? (
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text testID="connection-status" style={styles.statusText}>
              Connected
            </Text>
          </View>
        ) : state.status === 'error' ? (
          <Text testID="connection-status" style={styles.errorBadge}>
            Connection error
          </Text>
        ) : null}
      </View>

      <View style={styles.docContainer}>
        {state.status === 'loading' && <ActivityIndicator size="large" color="#4a9a9a" style={styles.loader} />}

        {state.status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{state.message}</Text>
            <TouchableOpacity testID="retry-home" style={styles.retryButton} onPress={loadHomeDocument}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.status === 'loaded' && (
          <>
            <Text testID="home-doc-title" style={styles.docTitle}>
              {state.document.metadata?.name || serverName}
            </Text>
            <ScrollView testID="home-doc-content" style={styles.docScroll} contentContainerStyle={styles.docContent}>
              {state.document.content.map((node, index) => (
                <BlockNodeView key={node.block?.id ?? index} node={node} depth={0} />
              ))}
              {state.document.content.length === 0 && <Text style={styles.emptyText}>This page is empty.</Text>}
            </ScrollView>
          </>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          testID="setup-account"
          style={styles.actionButton}
          onPress={() => navigation.navigate('MnemonicInput')}
        >
          <Text style={styles.actionButtonText}>Set Up Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="change-server"
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('ServerSelect')}
        >
          <Text style={styles.secondaryButtonText}>Change Server</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// Minimal hypermedia block renderer: text-bearing blocks with indented children
function BlockNodeView({node, depth}: {node: HMBlockNode; depth: number}) {
  const block = node.block
  const text = block && 'text' in block ? block.text : null
  return (
    <View style={{marginLeft: depth > 0 ? 12 : 0}}>
      {text != null && text !== '' && (
        <Text
          style={[
            styles.blockText,
            block?.type === 'Heading' && styles.headingText,
            block?.type === 'Code' && styles.codeText,
          ]}
        >
          {text}
        </Text>
      )}
      {node.children?.map((child, index) => (
        <BlockNodeView key={child.block?.id ?? index} node={child} depth={depth + 1} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  serverName: {
    fontSize: 14,
    color: '#888',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a5555',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4a9a9a',
    marginRight: 6,
  },
  statusText: {
    color: '#4a9a9a',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBadge: {
    color: '#ff6b6b',
    fontSize: 12,
    fontWeight: '600',
  },
  docContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  loader: {
    marginTop: 48,
  },
  errorBox: {
    marginTop: 32,
    alignItems: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3a5a5a',
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  docTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  docScroll: {
    flex: 1,
  },
  docContent: {
    paddingBottom: 24,
  },
  blockText: {
    fontSize: 16,
    color: '#ddd',
    marginBottom: 10,
    lineHeight: 22,
  },
  headingText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  codeText: {
    fontFamily: 'Menlo',
    fontSize: 14,
    backgroundColor: '#16302f',
    padding: 8,
    borderRadius: 6,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
  },
  actions: {
    padding: 20,
  },
  actionButton: {
    height: 50,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    height: 50,
    backgroundColor: '#3a5a5a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '500',
  },
})
