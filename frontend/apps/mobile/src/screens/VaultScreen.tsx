import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React, {useCallback, useState} from 'react'
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {formattedDate} from '../utils/dates'
import {shortAccountId, useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Vault'>
}

const DEFAULT_VAULT_URL = 'https://hyper.media/vault'

export function VaultScreen({navigation}: Props) {
  const {manager, status, identities, loadError} = useVault()
  const [vaultUrl, setVaultUrl] = useState(DEFAULT_VAULT_URL)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showSeedKeyImport, setShowSeedKeyImport] = useState(false)
  const [seedKeyText, setSeedKeyText] = useState('')
  const [seedKeyError, setSeedKeyError] = useState<string | null>(null)
  const [seedKeyBusy, setSeedKeyBusy] = useState(false)

  const handleConnectStart = useCallback(async () => {
    if (!manager) return
    setConnectBusy(true)
    setConnectError(null)
    try {
      await manager.startVaultConnection(vaultUrl, {
        force: true,
        siteName: getCurrentServer().name,
      })
      navigation.navigate('VaultConnect')
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setConnectBusy(false)
    }
  }, [manager, vaultUrl, navigation])

  const handleSyncNow = useCallback(async () => {
    if (!manager) return
    setSyncBusy(true)
    try {
      await manager.forceSync()
    } catch {
      // The failure is surfaced via status.syncStatus.lastSyncError.
    } finally {
      setSyncBusy(false)
    }
  }, [manager])

  const handleSeedKeyImport = useCallback(async () => {
    if (!manager || seedKeyBusy) return
    setSeedKeyBusy(true)
    setSeedKeyError(null)
    try {
      await manager.importIdentityFromSeedKey(seedKeyText.trim())
      setSeedKeyText('')
      setShowSeedKeyImport(false)
    } catch (error) {
      setSeedKeyError(error instanceof Error ? error.message : String(error))
    } finally {
      setSeedKeyBusy(false)
    }
  }, [manager, seedKeyText, seedKeyBusy])

  const handleDisconnect = useCallback(async () => {
    if (!manager) return
    await manager.disconnect({clearLocalVault: false})
  }, [manager])

  const handleLogout = useCallback(async () => {
    if (!manager) return
    setConfirmLogout(false)
    await manager.disconnect({clearLocalVault: true})
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

  const isRemote = status.backendMode === 'remote'
  const sync = status.syncStatus

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Mode */}
      <View style={styles.card}>
        <View style={styles.modeRow}>
          <View style={[styles.modeBadge, isRemote && styles.modeBadgeRemote]}>
            <Text style={styles.modeBadgeText}>{isRemote ? 'Remote' : 'Local'}</Text>
          </View>
          <Text style={styles.modeLabel}>{isRemote ? status.remoteVaultUrl : 'Vault stored on this device'}</Text>
        </View>

        {sync && (
          <View style={styles.syncBlock}>
            <Text style={styles.syncText}>
              Versions: local {sync.localVersion} · remote {sync.remoteVersion} · synced {sync.syncedLocalVersion}
            </Text>
            <Text style={styles.syncText}>
              Last sync: {sync.lastSyncTime > 0 ? formattedDate(new Date(sync.lastSyncTime * 1000)) : 'never'}
            </Text>
            {sync.lastSyncError ? <Text style={styles.errorText}>{sync.lastSyncError}</Text> : null}
            <TouchableOpacity
              testID="vault-sync-now"
              style={[styles.secondaryButton, syncBusy && styles.buttonDisabled]}
              onPress={handleSyncNow}
              disabled={syncBusy}
            >
              <Text style={styles.secondaryButtonText}>{syncBusy ? 'Syncing…' : 'Sync now'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Identities */}
      <Text style={styles.sectionTitle}>Identities</Text>
      <View style={styles.card}>
        {identities.length === 0 && <Text style={styles.emptyText}>No identities yet.</Text>}
        {identities.map((identity) => {
          const isActive = manager?.getCurrentIdentity()?.accountId === identity.accountId
          return (
            <TouchableOpacity
              key={identity.accountId}
              testID={`identity-${identity.accountId}`}
              style={styles.identityRow}
              onPress={() => navigation.navigate('Identity', {accountId: identity.accountId})}
            >
              <View style={styles.identityText}>
                <Text style={styles.identityName}>{identity.name}</Text>
                <Text style={styles.identityId}>{shortAccountId(identity.accountId)}</Text>
              </View>
              {isActive ? (
                <Text testID="identity-active-badge" style={styles.activeBadge}>
                  ACTIVE
                </Text>
              ) : (
                <TouchableOpacity
                  testID={`identity-use-${identity.accountId}`}
                  style={styles.useButton}
                  onPress={() => manager?.setCurrentIdentity(identity.accountId)}
                >
                  <Text style={styles.useButtonText}>Use</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )
        })}
        <TouchableOpacity
          testID="vault-create-identity"
          style={styles.primaryButton}
          onPress={() => navigation.navigate('CreateIdentity')}
        >
          <Text style={styles.primaryButtonText}>Create identity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="vault-import-mnemonic"
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('MnemonicInput')}
        >
          <Text style={styles.secondaryButtonText}>Import from recovery phrase</Text>
        </TouchableOpacity>
        {!showSeedKeyImport ? (
          <TouchableOpacity
            testID="vault-import-seedkey"
            style={styles.secondaryButton}
            onPress={() => {
              setShowSeedKeyImport(true)
              setSeedKeyError(null)
            }}
          >
            <Text style={styles.secondaryButtonText}>Import key file</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.seedKeyBox}>
            <Text style={styles.helpText}>
              Paste the contents of a .seedkey file exported from the Seed desktop app. Password-protected exports are
              not supported yet.
            </Text>
            <TextInput
              testID="seedkey-input"
              style={[styles.input, styles.seedKeyInput]}
              value={seedKeyText}
              onChangeText={(value) => {
                setSeedKeyText(value)
                setSeedKeyError(null)
              }}
              placeholder='{"createTime": …, "publicKey": …, "keyB64": …}'
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            {seedKeyError && (
              <Text testID="seedkey-error" style={styles.errorText}>
                {seedKeyError}
              </Text>
            )}
            <TouchableOpacity
              testID="seedkey-submit"
              style={[styles.primaryButton, seedKeyBusy && styles.buttonDisabled]}
              onPress={handleSeedKeyImport}
              disabled={seedKeyBusy}
            >
              <Text style={styles.primaryButtonText}>{seedKeyBusy ? 'Importing…' : 'Import key'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setShowSeedKeyImport(false)
                setSeedKeyError(null)
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Connection */}
      <Text style={styles.sectionTitle}>Remote vault</Text>
      <View style={styles.card}>
        {!isRemote && (
          <>
            <Text style={styles.helpText}>Connect to a remote vault to sync your identities across devices.</Text>
            <TextInput
              testID="vault-url-input"
              style={styles.input}
              value={vaultUrl}
              onChangeText={(value) => {
                setVaultUrl(value)
                setConnectError(null)
              }}
              placeholder={DEFAULT_VAULT_URL}
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {connectError && (
              <Text testID="vault-connect-error" style={styles.errorText}>
                {connectError}
              </Text>
            )}
            {!connectError && status.lastConnectError ? (
              <Text style={styles.errorText}>{status.lastConnectError}</Text>
            ) : null}
            <TouchableOpacity
              testID="vault-connect-start"
              style={[styles.primaryButton, connectBusy && styles.buttonDisabled]}
              onPress={handleConnectStart}
              disabled={connectBusy}
            >
              <Text style={styles.primaryButtonText}>
                {status.connectionStatus === 'pending' ? 'Restart connection' : 'Connect'}
              </Text>
            </TouchableOpacity>
            {status.connectionStatus === 'pending' && (
              <TouchableOpacity
                testID="vault-connect-resume"
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('VaultConnect')}
              >
                <Text style={styles.secondaryButtonText}>Continue pending connection</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {isRemote && (
          <>
            <TouchableOpacity testID="vault-disconnect" style={styles.secondaryButton} onPress={handleDisconnect}>
              <Text style={styles.secondaryButtonText}>Switch to local</Text>
            </TouchableOpacity>
            {!confirmLogout ? (
              <TouchableOpacity
                testID="vault-logout"
                style={styles.dangerButton}
                onPress={() => setConfirmLogout(true)}
              >
                <Text style={styles.dangerButtonText}>Log out</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.helpText}>
                  Log out and clear this device? Your identities remain in your vault and on your other devices.
                </Text>
                <TouchableOpacity testID="vault-logout-confirm" style={styles.dangerButton} onPress={handleLogout}>
                  <Text style={styles.dangerButtonText}>Log out and clear this device</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setConfirmLogout(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>
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
  card: {
    backgroundColor: '#2a4a4a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeBadge: {
    backgroundColor: '#3a5a5a',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 10,
  },
  modeBadgeRemote: {
    backgroundColor: '#4a9a9a',
  },
  modeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modeLabel: {
    color: '#ccc',
    fontSize: 13,
    flex: 1,
  },
  syncBlock: {
    marginTop: 12,
  },
  syncText: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 4,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#3a5a5a',
    marginBottom: 8,
  },
  identityText: {
    flex: 1,
    marginRight: 10,
  },
  activeBadge: {
    color: '#4a9a9a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  useButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#3a5a5a',
    borderRadius: 8,
  },
  useButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  identityName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  identityId: {
    color: '#4a9a9a',
    fontSize: 12,
    fontFamily: 'Menlo',
    marginTop: 2,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    marginBottom: 12,
  },
  helpText: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  input: {
    height: 48,
    backgroundColor: '#1F3838',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#fff',
    borderWidth: 2,
    borderColor: '#3a5a5a',
    marginBottom: 12,
  },
  primaryButton: {
    height: 48,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
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
  dangerButton: {
    height: 48,
    backgroundColor: '#7a3a3a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  dangerButtonText: {
    color: '#ffb3b3',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBox: {
    marginTop: 12,
  },
  seedKeyBox: {
    marginTop: 12,
  },
  seedKeyInput: {
    height: 120,
    paddingTop: 12,
    fontSize: 12,
    fontFamily: 'Menlo',
    textAlignVertical: 'top',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginBottom: 8,
  },
})
