import {Linking, Platform} from 'react-native'

/**
 * Open a URL in the system browser. On web, opens a new tab (may be blocked by
 * popup blockers — callers must always render the URL as selectable text too).
 */
export async function openURL(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank', 'noopener,noreferrer')
    return
  }
  await Linking.openURL(url)
}
