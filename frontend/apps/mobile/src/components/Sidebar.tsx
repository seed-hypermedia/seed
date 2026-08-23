import React, {useEffect, useRef} from 'react'
import {Animated, Dimensions, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import {getCurrentServer} from '../store/server-store'
import {useAccountProfileNames, useVault} from '../screens/vault-hooks'
import {Avatar} from './Avatar'

const SIDEBAR_WIDTH = Math.min(300, Dimensions.get('window').width * 0.82)

export type SidebarNavigate = (screen: 'Home' | 'Vault' | 'Notifications' | 'MnemonicInput' | 'ServerSelect') => void

function abbreviateUid(uid: string): string {
  return `?${uid.slice(-8)}`
}

/**
 * The app sidebar — a right-side sheet opened from the header button, mirroring
 * the desktop sidebar's role: navigation plus the current account, which opens
 * the vault for identity management and switching.
 */
export function Sidebar({open, onClose, navigate}: {open: boolean; onClose: () => void; navigate: SidebarNavigate}) {
  const vault = useVault()
  const currentIdentity = vault.manager?.getCurrentIdentity() ?? null
  const profileNames = useAccountProfileNames(currentIdentity ? [currentIdentity.accountId] : [])
  const server = getCurrentServer()
  const slide = useRef(new Animated.Value(SIDEBAR_WIDTH)).current
  // Navigation requested from inside the modal. On native, pushing a screen
  // while the modal is still dismissing deadlocks touch handling (the classic
  // RN Modal + navigation freeze) — so the tap only records the destination
  // and closes the modal; navigation runs after dismissal (onDismiss on iOS,
  // a post-close effect elsewhere).
  const pendingNavigation = useRef<Parameters<SidebarNavigate>[0] | null>(null)

  useEffect(() => {
    if (open) {
      Animated.timing(slide, {toValue: 0, duration: 180, useNativeDriver: true}).start()
    } else {
      slide.setValue(SIDEBAR_WIDTH)
    }
  }, [open, slide])

  const flushPendingNavigation = () => {
    const screen = pendingNavigation.current
    pendingNavigation.current = null
    if (screen) navigate(screen)
  }

  useEffect(() => {
    // iOS fires Modal.onDismiss; web/Android need this fallback after close.
    if (!open && pendingNavigation.current && Platform.OS !== 'ios') {
      const timer = setTimeout(flushPendingNavigation, Platform.OS === 'web' ? 0 : 80)
      return () => clearTimeout(timer)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const go = (screen: Parameters<SidebarNavigate>[0]) => {
    pendingNavigation.current = screen
    onClose()
  }

  const displayName = currentIdentity
    ? profileNames[currentIdentity.accountId] ??
      (currentIdentity.name !== currentIdentity.accountId
        ? currentIdentity.name
        : abbreviateUid(currentIdentity.accountId))
    : ''

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} onDismiss={flushPendingNavigation}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="sidebar-backdrop">
        <Animated.View style={[styles.panel, {width: SIDEBAR_WIDTH, transform: [{translateX: slide}]}]}>
          <Pressable style={styles.panelInner} onPress={() => {}}>
            {/* Current account — opens the vault (identity management + switching) */}
            <TouchableOpacity testID="sidebar-account" style={styles.accountCard} onPress={() => go('Vault')}>
              {currentIdentity ? (
                <>
                  <Avatar id={currentIdentity.accountId} name={displayName} size={40} />
                  <View style={styles.accountText}>
                    <Text style={styles.accountName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={styles.accountId} numberOfLines={1}>
                      {currentIdentity.accountId}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.emptyAvatar}>
                    <Text style={styles.emptyAvatarGlyph}>👤</Text>
                  </View>
                  <View style={styles.accountText}>
                    <Text style={styles.accountName}>No identity</Text>
                    <Text style={styles.accountId}>Tap to set one up</Text>
                  </View>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.separator} />

            <SidebarItem testID="sidebar-home" label="Home" glyph="⌂" onPress={() => go('Home')} />
            <SidebarItem
              testID="sidebar-notifications"
              label="Notifications"
              glyph="🔔"
              onPress={() => go('Notifications')}
            />

            <View style={styles.separator} />

            <SidebarItem
              testID="sidebar-import-identity"
              label="Import identity"
              glyph="🔑"
              onPress={() => go('MnemonicInput')}
            />
            <SidebarItem
              testID="sidebar-change-server"
              label="Change server"
              glyph="🌐"
              onPress={() => go('ServerSelect')}
            />

            <View style={styles.footer}>
              <Text style={styles.footerLabel}>Connected to</Text>
              <Text style={styles.footerServer} numberOfLines={1}>
                {server.name}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

function SidebarItem({
  label,
  glyph,
  onPress,
  testID,
}: {
  label: string
  glyph: string
  onPress: () => void
  testID: string
}) {
  return (
    <TouchableOpacity testID={testID} style={styles.item} onPress={onPress}>
      <Text style={styles.itemGlyph}>{glyph}</Text>
      <Text style={styles.itemLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: {
    height: '100%',
  },
  panelInner: {
    flex: 1,
    backgroundColor: '#16302f',
    borderLeftWidth: 1,
    borderLeftColor: '#2a5555',
    paddingTop: 64,
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a4a4a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a5a5a',
    padding: 12,
  },
  accountText: {
    flex: 1,
    marginLeft: 12,
  },
  accountName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  accountId: {
    color: '#7fa5a5',
    fontSize: 11,
    marginTop: 2,
  },
  emptyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3a5a5a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAvatarGlyph: {
    fontSize: 18,
  },
  separator: {
    height: 1,
    backgroundColor: '#2a5555',
    marginVertical: 14,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  itemGlyph: {
    fontSize: 16,
    width: 30,
  },
  itemLabel: {
    color: '#ddd',
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    marginTop: 'auto',
  },
  footerLabel: {
    color: '#557777',
    fontSize: 11,
  },
  footerServer: {
    color: '#8fb5b5',
    fontSize: 13,
    marginTop: 2,
  },
})
