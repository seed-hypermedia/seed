import React, {useEffect, useMemo, useState} from 'react'
import {View, Text, StyleSheet, TouchableOpacity, Share, Platform} from 'react-native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import {RouteProp} from '@react-navigation/native'
import {deriveKeyPairFromMnemonic} from '../utils/key-derivation'
import {getVaultManager} from '../vault'
import type {RootStackParamList} from '../navigation/types'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Account'>
  route: RouteProp<RootStackParamList, 'Account'>
}

type ImportState = {status: 'importing'} | {status: 'imported'} | {status: 'error'; message: string}

export function AccountScreen({navigation, route}: Props) {
  const {mnemonic} = route.params
  const [importState, setImportState] = useState<ImportState>({status: 'importing'})

  // The account ID is derived locally so it is shown even if the vault import
  // fails — daemon-derivation parity is asserted on this value in the e2e.
  const keyPair = useMemo(() => {
    return deriveKeyPairFromMnemonic(mnemonic)
  }, [mnemonic])

  // Import the identity into the vault (idempotent per principal).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const manager = await getVaultManager()
      await manager.importIdentityFromMnemonic(mnemonic)
    })()
      .then(() => {
        if (!cancelled) setImportState({status: 'imported'})
      })
      .catch((error) => {
        if (!cancelled) {
          setImportState({status: 'error', message: error instanceof Error ? error.message : String(error)})
        }
      })
    return () => {
      cancelled = true
    }
  }, [mnemonic])

  const handleShare = async () => {
    try {
      await Share.share({
        message: keyPair.accountId,
        title: 'Account ID',
      })
    } catch (error) {
      console.error('Error sharing:', error)
    }
  }

  const handleBack = () => {
    navigation.goBack()
  }

  // Format account ID for display (show first and last parts)
  const formatAccountId = (id: string) => {
    if (id.length <= 20) return id
    return `${id.slice(0, 12)}...${id.slice(-8)}`
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🔑</Text>
        </View>

        <Text style={styles.title}>Identity Imported</Text>
        <Text style={styles.subtitle}>Your identity has been derived from your recovery phrase</Text>

        <View style={styles.accountCard}>
          <Text style={styles.accountLabel}>Account ID</Text>
          <Text testID="account-id" style={styles.accountId} selectable>
            {keyPair.accountId}
          </Text>
          <Text style={styles.accountIdShort}>{formatAccountId(keyPair.accountId)}</Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Vault</Text>
          <Text
            testID="vault-import-status"
            style={[styles.importStatus, importState.status === 'error' && styles.importStatusError]}
          >
            {importState.status === 'importing'
              ? 'Saving to your vault…'
              : importState.status === 'imported'
                ? 'Saved to your vault'
                : `Vault import failed: ${importState.message}`}
          </Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Public Key</Text>
            <Text style={styles.infoValue}>{keyPair.publicKey.length} bytes (Ed25519)</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Private Key</Text>
            <Text style={styles.infoValue}>{keyPair.privateKey.length} bytes (secured)</Text>
          </View>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          testID="account-open-vault"
          style={styles.vaultButton}
          onPress={() => navigation.navigate('Vault')}
        >
          <Text style={styles.vaultButtonText}>Open Vault</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Text style={styles.shareButtonText}>Share Account ID</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>Enter Different Phrase</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    fontSize: 64,
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
  accountCard: {
    backgroundColor: '#2a4a4a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  accountLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  accountId: {
    fontSize: 12,
    color: '#4a9a9a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
  },
  accountIdShort: {
    fontSize: 18,
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: '#2a4a4a',
    borderRadius: 16,
    padding: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  importStatus: {
    fontSize: 14,
    color: '#4a9a9a',
    marginBottom: 16,
  },
  importStatusError: {
    color: '#ff6b6b',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#888',
  },
  infoValue: {
    fontSize: 14,
    color: '#fff',
  },
  buttonContainer: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  vaultButton: {
    height: 50,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  vaultButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  shareButton: {
    height: 50,
    backgroundColor: '#3a5a5a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    height: 50,
    backgroundColor: '#2a4a4a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
  },
})
