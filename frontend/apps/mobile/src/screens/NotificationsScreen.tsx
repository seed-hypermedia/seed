import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import type {NotificationStateSnapshot} from '@shm/shared/models/notification-state'
import React, {useCallback, useEffect, useRef, useState} from 'react'
import {ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native'
import {applyNotificationMutations, fetchNotificationState, resolveNotifyHost} from '../notifications/notify'
import type {RootStackParamList} from '../navigation/types'
import {formattedDate} from '../utils/dates'
import {useVault} from './vault-hooks'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'>
}

type LoadState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'loaded'; snapshot: NotificationStateSnapshot; host: string}

const REASON_LABELS: Record<string, string> = {
  mention: 'mentioned you',
  reply: 'replied to you',
  discussion: 'started a discussion',
  'site-new-discussion': 'new discussion on your site',
  'site-doc-update': 'updated a document',
  'user-comment': 'commented',
}

export function NotificationsScreen({navigation}: Props) {
  const vault = useVault()
  const currentIdentity = vault.manager?.getCurrentIdentity() ?? null
  const accountId = currentIdentity?.accountId ?? null

  const [state, setState] = useState<LoadState>({status: 'loading'})
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    try {
      const host = await resolveNotifyHost()
      const snapshot = await fetchNotificationState(accountId, host)
      setState({status: 'loaded', snapshot, host})
    } catch (error) {
      setState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [accountId])

  useEffect(() => {
    setState({status: 'loading'})
    void load()
  }, [load])

  // Poll faster while an email is awaiting verification (web/desktop parity).
  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current)
    if (state.status !== 'loaded') return
    const {config} = state.snapshot
    if (config.email && !config.verifiedTime) {
      pollTimer.current = setInterval(() => void load(), 3000)
      return () => {
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    }
    return undefined
  }, [state, load])

  const mutate = useCallback(
    async (actions: Parameters<typeof applyNotificationMutations>[1]) => {
      if (!accountId) return
      setSaving(true)
      setActionError(null)
      try {
        const host = state.status === 'loaded' ? state.host : await resolveNotifyHost()
        const snapshot = await applyNotificationMutations(accountId, actions, host)
        setState({status: 'loaded', snapshot, host})
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      } finally {
        setSaving(false)
      }
    },
    [accountId, state],
  )

  if (!accountId) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No identity selected</Text>
          <Text style={styles.emptyText}>Notifications are tied to your identity. Set one up in your vault first.</Text>
          <TouchableOpacity
            testID="notifications-open-vault"
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Vault')}
          >
            <Text style={styles.primaryButtonText}>Open Vault</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const config = state.status === 'loaded' ? state.snapshot.config : null
  const emailStatus = !config?.email ? 'none' : config.verifiedTime ? 'verified' : 'pending'

  return (
    <View style={styles.container}>
      <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>Email notifications</Text>
        <Text style={styles.settingsHint}>
          Get an email when someone mentions you, replies to you, or starts a discussion.
        </Text>

        {state.status === 'loading' && <ActivityIndicator color="#4a9a9a" style={styles.loader} />}
        {state.status === 'error' && (
          <Text testID="notif-error" style={styles.errorText}>
            {state.message}
          </Text>
        )}

        {config && (
          <>
            <Text testID="notif-status" style={styles.statusLine}>
              {emailStatus === 'none'
                ? 'No email configured'
                : emailStatus === 'verified'
                  ? `Verified: ${config.email}`
                  : `Pending verification: ${config.email}${config.verificationExpired ? ' (link expired)' : ''}`}
            </Text>

            <View style={styles.emailRow}>
              <TextInput
                testID="notif-email-input"
                style={styles.emailInput}
                placeholder={config.email ?? 'you@example.com'}
                placeholderTextColor="#666"
                value={emailInput}
                onChangeText={setEmailInput}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity
                testID="notif-email-save"
                style={[styles.saveButton, (saving || !emailInput.trim()) && styles.buttonDisabled]}
                disabled={saving || !emailInput.trim()}
                onPress={() => {
                  void mutate([{type: 'set-config', email: emailInput.trim(), createdAtMs: Date.now()}])
                  setEmailInput('')
                }}
              >
                <Text style={styles.saveButtonText}>{config.email ? 'Change' : 'Enable'}</Text>
              </TouchableOpacity>
            </View>

            {emailStatus === 'pending' && (
              <TouchableOpacity
                testID="notif-resend"
                style={styles.linkButton}
                disabled={saving}
                onPress={() => void mutate([{type: 'resend-config-verification', createdAtMs: Date.now()}])}
              >
                <Text style={styles.linkButtonText}>Resend verification email</Text>
              </TouchableOpacity>
            )}
            {emailStatus !== 'none' && (
              <TouchableOpacity
                testID="notif-remove"
                style={styles.linkButton}
                disabled={saving}
                onPress={() => void mutate([{type: 'remove-config'}])}
              >
                <Text style={[styles.linkButtonText, styles.destructiveText]}>Turn off email notifications</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {actionError && (
          <Text testID="notif-action-error" style={styles.errorText}>
            {actionError}
          </Text>
        )}
      </View>

      {state.status === 'loaded' && (
        <>
          <View style={styles.inboxHeader}>
            <Text style={styles.sectionTitle}>Inbox</Text>
            {state.snapshot.inbox.notifications.length > 0 && (
              <TouchableOpacity
                testID="notif-mark-all-read"
                disabled={saving}
                onPress={() => void mutate([{type: 'mark-all-read', markAllReadAtMs: Date.now()}])}
              >
                <Text style={styles.linkButtonText}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            testID="notif-inbox"
            data={state.snapshot.inbox.notifications}
            keyExtractor={(item) => item.feedEventId}
            ListEmptyComponent={<Text style={styles.emptyText}>Nothing yet — you're all caught up.</Text>}
            renderItem={({item}) => {
              const read = isNotificationEventRead({
                readState: state.snapshot.readState,
                eventId: item.feedEventId,
                eventAtMs: item.eventAtMs,
              })
              return (
                <TouchableOpacity
                  testID="notif-inbox-item"
                  style={styles.inboxRow}
                  onPress={() =>
                    void mutate([{type: 'mark-event-read', eventId: item.feedEventId, eventAtMs: item.eventAtMs}])
                  }
                >
                  <View style={styles.inboxRowText}>
                    <Text style={[styles.inboxTitle, !read && styles.inboxTitleUnread]} numberOfLines={1}>
                      {item.author?.name || 'Someone'} {REASON_LABELS[item.reason] ?? item.reason}
                    </Text>
                    {!!item.target?.name && (
                      <Text style={styles.inboxTarget} numberOfLines={1}>
                        {item.target.name}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.inboxTime}>{formattedDate(new Date(item.eventAtMs))}</Text>
                </TouchableOpacity>
              )
            }}
          />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
    padding: 16,
  },
  settingsCard: {
    backgroundColor: '#2a4a4a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a5a5a',
    padding: 14,
    marginBottom: 18,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  settingsHint: {
    color: '#8fb5b5',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 10,
  },
  loader: {
    marginVertical: 10,
  },
  statusLine: {
    color: '#7fa5a5',
    fontSize: 13,
    marginBottom: 8,
  },
  emailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emailInput: {
    flex: 1,
    height: 42,
    backgroundColor: '#1F3838',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a5a5a',
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 14,
  },
  saveButton: {
    height: 42,
    paddingHorizontal: 16,
    backgroundColor: '#4a9a9a',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 10,
  },
  linkButtonText: {
    color: '#4a9a9a',
    fontSize: 13,
    fontWeight: '600',
  },
  destructiveText: {
    color: '#ff6b6b',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 8,
  },
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#233f3f',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  inboxRowText: {
    flex: 1,
    marginRight: 10,
  },
  inboxTitle: {
    color: '#ccc',
    fontSize: 14,
  },
  inboxTitleUnread: {
    color: '#fff',
    fontWeight: '700',
  },
  inboxTarget: {
    color: '#7fa5a5',
    fontSize: 12,
    marginTop: 2,
  },
  inboxTime: {
    color: '#557777',
    fontSize: 11,
  },
  emptyBox: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    color: '#8fb5b5',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryButton: {
    height: 46,
    paddingHorizontal: 24,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
})
