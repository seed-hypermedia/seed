import React, { useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RouteProp } from '@react-navigation/native'
import { deriveKeyPairFromMnemonic } from '../utils/key-derivation'
import { saveMnemonic } from '../store/secure-storage'
import type { RootStackParamList } from '../navigation/types'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Account'>
  route: RouteProp<RootStackParamList, 'Account'>
}

export function AccountScreen({ navigation, route }: Props) {
  const { mnemonic } = route.params
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  const keyPair = useMemo(() => {
    return deriveKeyPairFromMnemonic(mnemonic)
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

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveMnemonic(mnemonic)
      setIsSaved(true)
      Alert.alert('Saved', 'Key saved securely to device')
    } catch (error) {
      console.error('Error saving:', error)
      Alert.alert('Error', 'Failed to save key')
    } finally {
      setIsSaving(false)
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

        <Text style={styles.title}>Account Ready</Text>
        <Text style={styles.subtitle}>
          Your account has been derived from your recovery phrase
        </Text>

        <View style={styles.accountCard}>
          <Text style={styles.accountLabel}>Account ID</Text>
          <Text style={styles.accountId} selectable>
            {keyPair.accountId}
          </Text>
          <Text style={styles.accountIdShort}>
            {formatAccountId(keyPair.accountId)}
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Key Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Public Key</Text>
            <Text style={styles.infoValue}>
              {keyPair.publicKey.length} bytes (Ed25519)
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Private Key</Text>
            <Text style={styles.infoValue}>
              {keyPair.privateKey.length} bytes (secured)
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaved && styles.saveButtonSaved]}
          onPress={handleSave}
          disabled={isSaving || isSaved}
        >
          <Text style={styles.saveButtonText}>
            {isSaved ? 'Key Saved' : isSaving ? 'Saving...' : 'Save Key'}
          </Text>
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
    marginBottom: 16,
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
  saveButton: {
    height: 50,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  saveButtonSaved: {
    backgroundColor: '#3a7a7a',
  },
  saveButtonText: {
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
