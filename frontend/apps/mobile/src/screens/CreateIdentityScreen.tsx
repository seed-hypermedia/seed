import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React, {useCallback, useState} from 'react'
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native'
import type {RootStackParamList} from '../navigation/types'
import {useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateIdentity'>
}

const KEY_NAME_FORMAT = /^[a-zA-Z0-9_-]+$/

export function CreateIdentityScreen({navigation}: Props) {
  const {manager, loadError} = useVault()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!manager || busy) return
    const trimmed = name.trim()
    if (trimmed && !KEY_NAME_FORMAT.test(trimmed)) {
      setError('Names may only contain letters, numbers, dashes and underscores.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await manager.createIdentity(trimmed || undefined)
      // Return to the Vault screen so the new identity is visible in the list
      // (and one tap away from its Identity screen).
      navigation.goBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [manager, name, busy, navigation])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create identity</Text>
      <Text style={styles.subtitle}>
        A new signing key is generated and stored in your vault. The name is optional and only visible to you.
      </Text>

      <TextInput
        testID="create-identity-name-input"
        style={styles.input}
        value={name}
        onChangeText={(value) => {
          setName(value)
          setError(null)
        }}
        placeholder="Name (optional)"
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error && (
        <Text testID="create-identity-error" style={styles.errorText}>
          {error}
        </Text>
      )}

      <TouchableOpacity
        testID="create-identity-submit"
        style={[styles.primaryButton, (busy || !manager || !!loadError) && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={busy || !manager || !!loadError}
      >
        <Text style={styles.primaryButtonText}>{busy ? 'Creating…' : 'Create identity'}</Text>
      </TouchableOpacity>

      {loadError && <Text style={styles.errorText}>Failed to open the vault: {loadError}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
    padding: 20,
    paddingTop: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#aaa',
    lineHeight: 20,
    marginBottom: 24,
  },
  input: {
    height: 48,
    backgroundColor: '#2a4a4a',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 2,
    borderColor: '#3a5a5a',
    marginBottom: 12,
  },
  primaryButton: {
    height: 50,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: '#3a5a5a',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginBottom: 8,
    marginTop: 8,
  },
})
