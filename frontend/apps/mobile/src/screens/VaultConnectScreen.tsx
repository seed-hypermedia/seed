import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React, {useCallback, useEffect, useRef, useState} from 'react'
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {openURL} from '../vault'
import {useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VaultConnect'>
}

export function VaultConnectScreen({navigation}: Props) {
  const {manager, status, loadError} = useVault()
  const [retryError, setRetryError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  // Remember the vault URL of the pending connection so "Try again" can mint a
  // fresh token after the pending state (and its URL) is consumed or expired.
  const lastVaultUrl = useRef<string | null>(null)
  const openedBrowser = useRef(false)

  const pending = status?.pendingConnection
  if (pending) {
    lastVaultUrl.current = pending.vaultUrl
  }

  // Countdown tick while a connection is pending.
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending?.connectUrl])

  // Open the browser once per minted token; the URL always stays visible as
  // selectable text below (popup blockers, or the user is on another device).
  useEffect(() => {
    if (!pending || openedBrowser.current) return
    openedBrowser.current = true
    void openURL(pending.connectUrl).catch(() => {})
  }, [pending?.connectUrl])

  // Auto-back once connected, leaving a beat for the status to be visible.
  const connected = status?.connectionStatus === 'connected'
  useEffect(() => {
    if (!connected) return
    const timer = setTimeout(() => {
      if (navigation.isFocused()) navigation.goBack()
    }, 2000)
    return () => clearTimeout(timer)
  }, [connected, navigation])

  const handleRetry = useCallback(async () => {
    if (!manager || !lastVaultUrl.current) return
    setRetryError(null)
    openedBrowser.current = false
    try {
      await manager.startVaultConnection(lastVaultUrl.current, {
        force: true,
        siteName: getCurrentServer().name,
      })
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error))
    }
  }, [manager])

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to open the vault: {loadError}</Text>
      </View>
    )
  }

  if (!manager || !status) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4a9a9a" style={styles.loader} />
      </View>
    )
  }

  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.expireTime - now) / 1000)) : 0
  const connectError = retryError ?? status.lastConnectError

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Connect to your vault</Text>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text testID="vault-status" style={[styles.statusValue, connected && styles.statusValueConnected]}>
          {status.connectionStatus}
        </Text>
        {connected && <Text style={styles.helpText}>Connected. Returning to your vault…</Text>}
      </View>

      {pending && (
        <>
          <Text style={styles.helpText}>
            Approve this device in the browser window that just opened, or open this link on a device where you are
            signed in to your vault:
          </Text>
          <View style={styles.urlCard}>
            <Text testID="vault-connect-url" style={styles.urlText} selectable>
              {pending.connectUrl}
            </Text>
          </View>
          <TouchableOpacity
            testID="vault-connect-open"
            style={styles.secondaryButton}
            onPress={() => void openURL(pending.connectUrl).catch(() => {})}
          >
            <Text style={styles.secondaryButtonText}>Open in browser</Text>
          </TouchableOpacity>
          <Text style={styles.countdownText}>
            Link expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </Text>
          {pending.pollWarning && (
            <Text testID="vault-connect-warning" style={styles.warningText}>
              {pending.pollWarning}
            </Text>
          )}
        </>
      )}

      {!pending && !connected && connectError ? (
        <Text testID="vault-connect-error" style={styles.errorText}>
          {connectError}
        </Text>
      ) : null}

      {!connected && (
        <TouchableOpacity testID="vault-connect-retry" style={styles.primaryButton} onPress={handleRetry}>
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      )}

      {!connected && (
        <TouchableOpacity
          testID="vault-connect-cancel"
          style={styles.secondaryButton}
          onPress={() => {
            manager.cancelVaultConnection()
            navigation.goBack()
          }}
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loader: {
    marginTop: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  statusCard: {
    backgroundColor: '#2a4a4a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ccc',
  },
  statusValueConnected: {
    color: '#4a9a9a',
  },
  helpText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    marginTop: 4,
  },
  urlCard: {
    backgroundColor: '#16302f',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  urlText: {
    color: '#4a9a9a',
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  countdownText: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  primaryButton: {
    height: 48,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    height: 48,
    backgroundColor: '#3a5a5a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#ccc',
    fontSize: 15,
    fontWeight: '500',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
  },
  warningText: {
    color: '#e8b04b',
    fontSize: 13,
    marginTop: 12,
    lineHeight: 18,
  },
})
