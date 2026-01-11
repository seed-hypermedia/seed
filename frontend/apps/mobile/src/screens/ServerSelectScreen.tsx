import React, {useState, useCallback, useEffect} from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {RootStackParamList} from '../navigation/types'
import {
  getKnownServers,
  getCurrentServer,
  setCurrentServer,
  parseServerUrl,
  ServerInfo,
  removeKnownServer,
} from '../store/server-store'
import {resetUniversalClient, getUniversalClient} from '../client/universal-client'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ServerSelect'>
}

export function ServerSelectScreen({navigation}: Props) {
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [knownServers, setKnownServers] = useState<ServerInfo[]>([])
  const [currentServer, setCurrentServerState] = useState<ServerInfo | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  // Load servers on mount
  useEffect(() => {
    setKnownServers(getKnownServers())
    setCurrentServerState(getCurrentServer())
  }, [])

  const handleConnect = useCallback(async (server: ServerInfo) => {
    setIsConnecting(true)
    setError(null)

    try {
      // Set as current server
      setCurrentServer(server)
      resetUniversalClient()

      // Test connection by making a simple request
      const client = getUniversalClient()
      // Try to fetch something simple to verify connection
      // For now just navigate - real validation can come later

      setCurrentServerState(server)
      setKnownServers(getKnownServers())

      // Navigate to home/main screen
      navigation.navigate('Home', {serverUrl: server.url})
    } catch (err) {
      setError(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsConnecting(false)
    }
  }, [navigation])

  const handleAddServer = useCallback(() => {
    const parsed = parseServerUrl(urlInput)
    if (!parsed) {
      setError('Invalid URL. Enter a valid server address.')
      return
    }

    setError(null)
    handleConnect(parsed)
  }, [urlInput, handleConnect])

  const handleRemoveServer = useCallback((server: ServerInfo) => {
    Alert.alert(
      'Remove Server',
      `Remove ${server.name} from your saved servers?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeKnownServer(server.url)
            setKnownServers(getKnownServers())
          },
        },
      ],
    )
  }, [])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Connect to Server</Text>
        <Text style={styles.subtitle}>
          Enter a Hypermedia server URL or select from saved servers
        </Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.urlInput}
            placeholder="dev.hyper.media"
            placeholderTextColor="#666"
            value={urlInput}
            onChangeText={(text) => {
              setUrlInput(text)
              setError(null)
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={handleAddServer}
          />
          <TouchableOpacity
            style={[styles.connectButton, isConnecting && styles.connectButtonDisabled]}
            onPress={handleAddServer}
            disabled={isConnecting || !urlInput.trim()}
          >
            <Text style={styles.connectButtonText}>
              {isConnecting ? '...' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.sectionTitle}>Saved Servers</Text>

        {knownServers.map((server) => (
          <TouchableOpacity
            key={server.url}
            style={[
              styles.serverItem,
              currentServer?.url === server.url && styles.serverItemActive,
            ]}
            onPress={() => handleConnect(server)}
            onLongPress={() => handleRemoveServer(server)}
          >
            <View style={styles.serverInfo}>
              <Text style={styles.serverName}>{server.name}</Text>
              <Text style={styles.serverUrl}>{server.url}</Text>
            </View>
            {currentServer?.url === server.url && (
              <Text style={styles.activeLabel}>Active</Text>
            )}
          </TouchableOpacity>
        ))}

        <Text style={styles.hint}>
          Long press to remove a server
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  urlInput: {
    flex: 1,
    height: 50,
    backgroundColor: '#2a4a4a',
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 2,
    borderColor: '#3a5a5a',
    marginRight: 12,
  },
  connectButton: {
    height: 50,
    paddingHorizontal: 20,
    backgroundColor: '#4a9a9a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectButtonDisabled: {
    backgroundColor: '#3a5a5a',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ccc',
    marginTop: 24,
    marginBottom: 16,
  },
  serverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a4a4a',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#3a5a5a',
  },
  serverItemActive: {
    borderColor: '#4a9a9a',
    backgroundColor: '#2a5555',
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  serverUrl: {
    fontSize: 14,
    color: '#888',
  },
  activeLabel: {
    fontSize: 12,
    color: '#4a9a9a',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
})
