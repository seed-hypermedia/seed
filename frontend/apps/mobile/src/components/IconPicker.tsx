/**
 * Profile icon picker: lets the user choose an image and hands the raw bytes
 * to the caller (for client-side IPFS blob encoding — no daemon involved).
 *
 * Platform split (same pattern as src/store/storage.ts):
 * - web: a hidden DOM `<input type="file">` (react-native-web renders raw DOM
 *   children fine). The input carries data-testid="profile-icon-input" so
 *   Playwright can drive it with page.setInputFiles().
 * - native: expo-image-picker (needs a prebuild / pod install to run on device).
 */

import {Buffer} from 'buffer'
import React, {useCallback, useRef, useState} from 'react'
import {Image, Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native'

export type PickedIcon = {
  /** Raw image file bytes, ready for fileToIpfsBlobs. */
  bytes: Uint8Array
  /** Display URI for previewing the pick (blob: URL on web, file URI on native). */
  uri: string
}

type IconPickerProps = {
  /** URL of the currently published icon, shown until a new image is picked. */
  currentUrl?: string | null
  picked: PickedIcon | null
  onPick: (icon: PickedIcon) => void
  disabled?: boolean
}

export function IconPicker({currentUrl, picked, onPick, disabled}: IconPickerProps) {
  const [pickError, setPickError] = useState<string | null>(null)
  const webInputRef = useRef<HTMLInputElement | null>(null)

  const handleWebFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // Allow re-picking the same file later.
      event.target.value = ''
      if (!file) return
      setPickError(null)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        onPick({bytes, uri: URL.createObjectURL(file)})
      } catch (error) {
        setPickError(error instanceof Error ? error.message : String(error))
      }
    },
    [onPick],
  )

  const handleNativePick = useCallback(async () => {
    setPickError(null)
    try {
      // Lazy require: the native module is absent until a prebuild ran, and
      // must never load in the web bundle (storage.ts pattern).
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker')
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        base64: true,
      })
      if (result.canceled) return
      const asset = result.assets?.[0]
      if (!asset?.base64) {
        throw new Error('The selected image has no data.')
      }
      onPick({bytes: new Uint8Array(Buffer.from(asset.base64, 'base64')), uri: asset.uri})
    } catch (error) {
      setPickError(error instanceof Error ? error.message : String(error))
    }
  }, [onPick])

  const handlePress = useCallback(() => {
    if (Platform.OS === 'web') {
      webInputRef.current?.click()
    } else {
      void handleNativePick()
    }
  }, [handleNativePick])

  const previewUri = picked?.uri ?? currentUrl ?? null

  return (
    <View style={styles.row}>
      <View style={styles.preview}>
        {previewUri ? (
          <Image testID="profile-icon-preview" source={{uri: previewUri}} style={styles.previewImage} />
        ) : (
          <Text style={styles.previewPlaceholder}>—</Text>
        )}
      </View>
      <View style={styles.controls}>
        <TouchableOpacity
          testID="profile-icon-pick"
          style={[styles.pickButton, disabled && styles.pickButtonDisabled]}
          onPress={handlePress}
          disabled={disabled}
        >
          <Text style={styles.pickButtonText}>{previewUri ? 'Change icon' : 'Choose icon'}</Text>
        </TouchableOpacity>
        {pickError && <Text style={styles.errorText}>{pickError}</Text>}
      </View>
      {Platform.OS === 'web' && (
        <input
          ref={webInputRef}
          type="file"
          accept="image/*"
          data-testid="profile-icon-input"
          style={{display: 'none'}}
          onChange={handleWebFile}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  preview: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#1F3838',
    borderWidth: 2,
    borderColor: '#3a5a5a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    color: '#666',
    fontSize: 18,
  },
  controls: {
    flex: 1,
  },
  pickButton: {
    height: 40,
    backgroundColor: '#3a5a5a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickButtonDisabled: {
    opacity: 0.5,
  },
  pickButtonText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 6,
  },
})
