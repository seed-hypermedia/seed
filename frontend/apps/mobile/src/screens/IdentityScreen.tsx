import {RouteProp} from '@react-navigation/native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React, {useCallback, useEffect, useState} from 'react'
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {publishProfile} from '../vault'
import {useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Identity'>
  route: RouteProp<RootStackParamList, 'Identity'>
}

type PublishState =
  | {status: 'idle'}
  | {status: 'publishing'}
  | {status: 'published'}
  | {status: 'error'; message: string}

export function IdentityScreen({navigation, route}: Props) {
  const {accountId} = route.params
  const {manager, identities, loadError} = useVault()
  const identity = identities.find((entry) => entry.accountId === accountId)

  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [publishState, setPublishState] = useState<PublishState>({status: 'idle'})

  // Prefill the rename field with the current name (once it is known).
  const currentName = identity?.name
  useEffect(() => {
    if (currentName !== undefined) {
      setRenameValue(currentName === accountId ? '' : currentName)
    }
  }, [currentName, accountId])

  const handleRename = useCallback(async () => {
    if (!manager || !identity || renameBusy) return
    setRenameBusy(true)
    setRenameError(null)
    try {
      await manager.renameIdentity(identity.name, renameValue.trim())
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error))
    } finally {
      setRenameBusy(false)
    }
  }, [manager, identity, renameValue, renameBusy])

  const handleDelete = useCallback(async () => {
    if (!manager || !identity) return
    setConfirmDelete(false)
    await manager.deleteIdentity(identity.accountId)
    navigation.goBack()
  }, [manager, identity, navigation])

  const handlePublishProfile = useCallback(async () => {
    if (!identity || publishState.status === 'publishing') return
    setPublishState({status: 'publishing'})
    try {
      await publishProfile(getSeedClient(), identity.accountId, identity.name)
      setPublishState({status: 'published'})
    } catch (error) {
      setPublishState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [identity, publishState.status])

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to open the vault: {loadError}</Text>
      </View>
    )
  }

  if (!manager) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4a9a9a" style={styles.loader} />
      </View>
    )
  }

  if (!identity) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>This identity is no longer in the vault.</Text>
      </View>
    )
  }

  const serverName = getCurrentServer().name

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.nameText}>{identity.name}</Text>
        <Text style={styles.label}>Account ID</Text>
        <Text testID="identity-account-id" style={styles.accountId} selectable>
          {identity.accountId}
        </Text>
      </View>

      {/* Publish profile */}
      <View style={styles.card}>
        <TouchableOpacity
          testID="identity-publish-profile"
          style={[styles.primaryButton, publishState.status === 'publishing' && styles.buttonDisabled]}
          onPress={handlePublishProfile}
          disabled={publishState.status === 'publishing'}
        >
          <Text style={styles.primaryButtonText}>Publish profile to {serverName}</Text>
        </TouchableOpacity>
        {publishState.status !== 'idle' && (
          <Text
            testID="publish-status"
            style={[styles.publishStatus, publishState.status === 'error' && styles.errorText]}
          >
            {publishState.status === 'publishing'
              ? 'Publishing…'
              : publishState.status === 'published'
                ? 'Published successfully'
                : `Publish failed: ${publishState.message}`}
          </Text>
        )}
      </View>

      {/* Rename */}
      <Text style={styles.sectionTitle}>Rename</Text>
      <View style={styles.card}>
        <TextInput
          testID="identity-rename-input"
          style={styles.input}
          value={renameValue}
          onChangeText={(value) => {
            setRenameValue(value)
            setRenameError(null)
          }}
          placeholder="New name"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {renameError && (
          <Text testID="identity-rename-error" style={styles.errorText}>
            {renameError}
          </Text>
        )}
        <TouchableOpacity
          testID="identity-rename-submit"
          style={[styles.secondaryButton, renameBusy && styles.buttonDisabled]}
          onPress={handleRename}
          disabled={renameBusy}
        >
          <Text style={styles.secondaryButtonText}>{renameBusy ? 'Renaming…' : 'Rename'}</Text>
        </TouchableOpacity>
      </View>

      {/* Delete */}
      <Text style={styles.sectionTitle}>Danger zone</Text>
      <View style={styles.card}>
        {!confirmDelete ? (
          <TouchableOpacity testID="identity-delete" style={styles.dangerButton} onPress={() => setConfirmDelete(true)}>
            <Text style={styles.dangerButtonText}>Delete identity</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.helpText}>
              This removes the identity from this device and records a deletion that propagates to your other connected
              devices. This cannot be undone.
            </Text>
            <TouchableOpacity testID="identity-delete-confirm" style={styles.dangerButton} onPress={handleDelete}>
              <Text style={styles.dangerButtonText}>Delete permanently</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setConfirmDelete(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
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
  label: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  nameText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  accountId: {
    fontSize: 12,
    color: '#4a9a9a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  input: {
    height: 48,
    backgroundColor: '#1F3838',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
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
  },
  dangerButtonText: {
    color: '#ffb3b3',
    fontSize: 15,
    fontWeight: '600',
  },
  helpText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  publishStatus: {
    color: '#4a9a9a',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 8,
  },
})
