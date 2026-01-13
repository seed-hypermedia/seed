import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { getUniversalClient } from '../client/universal-client'
import type { RootStackParamList } from '../navigation/types'
import { getCurrentServer } from '../store/server-store'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>
  route: {params: {serverUrl: string}}
}

export function HomeScreen({navigation, route}: Props) {
  const [serverName, setServerName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')

  useEffect(() => {
    const server = getCurrentServer()
    setServerName(server.name)

    // Test connection
    async function testConnection() {
      try {
        const client = getUniversalClient()
        // For now just mark as connected
        client.request('Resource', {
          uid: 'z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno'
        }).then(resource => {
          console.log('resource', resource)
        }).catch(err => {
          console.error('error', err)
        })
        // Later we can make an actual API call to verify
        setConnectionStatus('connected')
      } catch (err) {
        setConnectionStatus('error')
      } finally {
        setIsLoading(false)
      }
    }

    testConnection()
  }, [route.params.serverUrl])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.connectedTo}>Connected to</Text>
        <Text style={styles.serverName}>{serverName}</Text>
      </View>

      <View style={styles.statusContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#4a9a9a" />
        ) : connectionStatus === 'connected' ? (
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Connected</Text>
          </View>
        ) : (
          <Text style={styles.errorText}>Connection error</Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('MnemonicInput')}
        >
          <Text style={styles.actionButtonText}>Set Up Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('ServerSelect')}
        >
          <Text style={styles.secondaryButtonText}>Change Server</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.infoText}>
        Client ready. Use the universal client to make requests to {serverName}.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  connectedTo: {
    fontSize: 16,
    color: '#888',
    marginBottom: 8,
  },
  serverName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a5555',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4a9a9a',
    marginRight: 8,
  },
  statusText: {
    color: '#4a9a9a',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
  },
  actions: {
    marginBottom: 32,
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
  infoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
})
