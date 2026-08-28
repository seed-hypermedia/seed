import {RouteProp} from '@react-navigation/native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React, {useCallback, useEffect, useState} from 'react'
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {IconPicker, type PickedIcon} from '../components/IconPicker'
import type {RootStackParamList} from '../navigation/types'
import {getCurrentServer} from '../store/server-store'
import {updateProfile} from '../vault'
import {hmId} from '../utils/hm-id'
import {identityDisplayName, useAccountProfileNames, useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Identity'>
  route: RouteProp<RootStackParamList, 'Identity'>
}

/** The published home document's current metadata (profile). */
type ProfileLoad =
  | {status: 'loading'}
  /** No home document published yet — saving runs the fresh-genesis path. */
  | {status: 'fresh'}
  | {status: 'loaded'; name: string; iconUrl: string | null}

type SaveState = {status: 'idle'} | {status: 'saving'} | {status: 'saved'} | {status: 'error'; message: string}

type ExportState =
  | {status: 'hidden'}
  | {status: 'confirm'}
  | {status: 'revealed'; payload: string}
  | {status: 'error'; message: string}

/** Resolve a metadata icon value ('ipfs://CID') to a servable image URL. */
function iconUrlFromMetadata(icon: string | undefined): string | null {
  if (!icon) return null
  if (icon.startsWith('ipfs://')) {
    return `${getCurrentServer().url}/hm/api/image/${icon.slice('ipfs://'.length)}`
  }
  return icon
}

export function IdentityScreen({navigation, route}: Props) {
  const {accountId} = route.params
  const {manager, identities, loadError} = useVault()
  const identity = identities.find((entry) => entry.accountId === accountId)
  const hydratedNames = useAccountProfileNames(identity ? [identity.accountId] : [])

  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [profile, setProfile] = useState<ProfileLoad>({status: 'loading'})
  const [profileName, setProfileName] = useState('')
  const [pickedIcon, setPickedIcon] = useState<PickedIcon | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({status: 'idle'})

  const [exportState, setExportState] = useState<ExportState>({status: 'hidden'})

  // Prefill the rename field with the current name (once it is known).
  const currentName = identity?.name
  useEffect(() => {
    if (currentName !== undefined) {
      setRenameValue(currentName === accountId ? '' : currentName)
    }
  }, [currentName, accountId])

  // Load the currently published profile to prefill the editor. A fresh
  // identity has no home document yet — prefill from the vault name instead.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const resource = await getSeedClient().request('Resource', hmId(accountId))
        if (cancelled) return
        if (resource.type === 'document') {
          const name = resource.document.metadata?.name ?? ''
          setProfile({status: 'loaded', name, iconUrl: iconUrlFromMetadata(resource.document.metadata?.icon)})
          setProfileName(name)
          return
        }
        setProfile({status: 'fresh'})
      } catch {
        if (!cancelled) setProfile({status: 'fresh'})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId])

  // A fresh identity prefills the profile name from its vault name.
  useEffect(() => {
    if (profile.status === 'fresh' && currentName !== undefined) {
      setProfileName(currentName === accountId ? '' : currentName)
    }
  }, [profile.status, currentName, accountId])

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

  const publishedName = profile.status === 'loaded' ? profile.name : null
  const trimmedProfileName = profileName.trim()
  const nameChanged =
    profile.status === 'loaded'
      ? trimmedProfileName !== '' && trimmedProfileName !== publishedName
      : trimmedProfileName !== ''
  const hasProfileChanges = nameChanged || pickedIcon !== null
  const profileBusy = profile.status === 'loading' || saveState.status === 'saving'

  const handleSaveProfile = useCallback(async () => {
    if (!identity || profileBusy || !hasProfileChanges) return
    setSaveState({status: 'saving'})
    try {
      // Only the changed fields are published.
      await updateProfile(getSeedClient(), identity.accountId, {
        ...(nameChanged ? {name: trimmedProfileName} : {}),
        ...(pickedIcon ? {iconBytes: pickedIcon.bytes} : {}),
      })
      setProfile((previous) => ({
        status: 'loaded',
        name: nameChanged ? trimmedProfileName : publishedName ?? trimmedProfileName,
        iconUrl: pickedIcon ? pickedIcon.uri : previous.status === 'loaded' ? previous.iconUrl : null,
      }))
      setPickedIcon(null)
      setSaveState({status: 'saved'})
    } catch (error) {
      setSaveState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [identity, profileBusy, hasProfileChanges, nameChanged, trimmedProfileName, pickedIcon, publishedName])

  const handleExportReveal = useCallback(async () => {
    if (!manager || !identity) return
    try {
      const payload = await manager.exportIdentity(identity.accountId)
      setExportState({status: 'revealed', payload})
    } catch (error) {
      setExportState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [manager, identity])

  const handleExportShare = useCallback(async () => {
    if (exportState.status !== 'revealed') return
    try {
      await Share.share({message: exportState.payload})
    } catch {
      // Share sheet unavailable (e.g. web without navigator.share) — the
      // payload stays selectable for manual copying.
    }
  }, [exportState])

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
        <Text style={styles.nameText}>{identityDisplayName(identity, hydratedNames[identity.accountId])}</Text>
        <Text style={styles.label}>Account ID</Text>
        <Text testID="identity-account-id" style={styles.accountId} selectable>
          {identity.accountId}
        </Text>
      </View>

      {/* Profile (published home document metadata) */}
      <Text style={styles.sectionTitle}>Profile</Text>
      <View style={styles.card}>
        {profile.status === 'loading' ? (
          <ActivityIndicator size="small" color="#4a9a9a" />
        ) : (
          <>
            <Text style={styles.label}>Profile name</Text>
            <TextInput
              testID="profile-name-input"
              style={styles.input}
              value={profileName}
              onChangeText={(value) => {
                setProfileName(value)
                if (saveState.status !== 'saving') setSaveState({status: 'idle'})
              }}
              placeholder="Display name"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>Icon</Text>
            <IconPicker
              currentUrl={profile.status === 'loaded' ? profile.iconUrl : null}
              picked={pickedIcon}
              onPick={(icon) => {
                setPickedIcon(icon)
                if (saveState.status !== 'saving') setSaveState({status: 'idle'})
              }}
              disabled={saveState.status === 'saving'}
            />
            {/* Wrapper keeps the pre-editor testID working (fresh publish path). */}
            <View testID="identity-publish-profile">
              <TouchableOpacity
                testID="profile-save"
                style={[styles.primaryButton, (profileBusy || !hasProfileChanges) && styles.buttonDisabled]}
                onPress={handleSaveProfile}
                disabled={profileBusy || !hasProfileChanges}
              >
                <Text style={styles.primaryButtonText}>
                  {profile.status === 'fresh' ? `Publish profile to ${serverName}` : 'Save profile'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        {saveState.status !== 'idle' && (
          <View testID="publish-status">
            <Text
              testID="profile-save-status"
              style={[styles.publishStatus, saveState.status === 'error' && styles.errorText]}
            >
              {saveState.status === 'saving'
                ? 'Saving…'
                : saveState.status === 'saved'
                  ? 'Profile updated'
                  : `Profile update failed: ${saveState.message}`}
            </Text>
          </View>
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

      {/* Export key */}
      <Text style={styles.sectionTitle}>Export key</Text>
      <View style={styles.card}>
        {exportState.status === 'hidden' && (
          <>
            <Text style={styles.helpText}>
              Export this identity as a .seedkey file that the Seed desktop app can import.
            </Text>
            <TouchableOpacity
              testID="identity-export"
              style={styles.secondaryButton}
              onPress={() => setExportState({status: 'confirm'})}
            >
              <Text style={styles.secondaryButtonText}>Export key</Text>
            </TouchableOpacity>
          </>
        )}
        {exportState.status === 'confirm' && (
          <>
            <Text style={styles.warningText}>
              The export is your unencrypted private key. Anyone who sees it can fully control this identity. Only
              reveal it in a private place.
            </Text>
            <TouchableOpacity testID="identity-export-confirm" style={styles.dangerButton} onPress={handleExportReveal}>
              <Text style={styles.dangerButtonText}>Reveal private key</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setExportState({status: 'hidden'})}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
        {exportState.status === 'revealed' && (
          <>
            <Text style={styles.warningText}>
              This is your unencrypted private key. Anyone who sees it can fully control this identity.
            </Text>
            <Text testID="identity-export-payload" style={styles.exportPayload} selectable>
              {exportState.payload}
            </Text>
            <TouchableOpacity testID="identity-export-share" style={styles.primaryButton} onPress={handleExportShare}>
              <Text style={styles.primaryButtonText}>Share…</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setExportState({status: 'hidden'})}>
              <Text style={styles.secondaryButtonText}>Hide</Text>
            </TouchableOpacity>
          </>
        )}
        {exportState.status === 'error' && (
          <>
            <Text testID="identity-export-error" style={styles.errorText}>
              {exportState.message}
            </Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setExportState({status: 'hidden'})}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </>
        )}
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
  warningText: {
    color: '#ffcf8a',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  exportPayload: {
    color: '#4a9a9a',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#1F3838',
    borderRadius: 10,
    padding: 12,
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
