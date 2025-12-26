import React, { useState, useCallback, useRef, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as bip39 from 'bip39'
import * as Crypto from 'expo-crypto'
import { validateMnemonic } from '../utils/key-derivation'
import type { RootStackParamList } from '../navigation/types'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'MnemonicInput'>
}

const WORD_COUNT = 12

// Get valid BIP39 wordlist
const validWords = new Set(bip39.wordlists.english)

export function MnemonicInputScreen({ navigation }: Props) {
  const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(''))
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<(TextInput | null)[]>([])

  // Track which words are invalid
  const invalidWordIndices = useMemo(() => {
    const indices: number[] = []
    words.forEach((word, index) => {
      if (word.length > 0 && !validWords.has(word)) {
        indices.push(index)
      }
    })
    return indices
  }, [words])

  const handleWordChange = useCallback((index: number, value: string) => {
    // Handle paste of full mnemonic (space or comma separated)
    const trimmedValue = value.trim()
    if (trimmedValue.includes(' ') || trimmedValue.includes(',')) {
      const pastedWords = trimmedValue
        .split(/[\s,]+/)
        .map(w => w.toLowerCase().trim())
        .filter(Boolean)

      if (pastedWords.length >= 1) {
        const newWords = [...words]
        // Fill starting from current index
        for (let i = 0; i < pastedWords.length && index + i < WORD_COUNT; i++) {
          newWords[index + i] = pastedWords[i]
        }
        setWords(newWords)
        setError(null)

        // Focus the next empty field or last filled field
        const nextEmptyIndex = newWords.findIndex((w, i) => i >= index && w === '')
        const focusIndex = nextEmptyIndex !== -1 ? nextEmptyIndex : Math.min(index + pastedWords.length, WORD_COUNT - 1)
        setTimeout(() => inputRefs.current[focusIndex]?.focus(), 50)
        return
      }
    }

    // Single word input - only allow valid characters (letters)
    const cleanValue = value.toLowerCase().replace(/[^a-z]/g, '')

    const newWords = [...words]
    newWords[index] = cleanValue
    setWords(newWords)
    setError(null)

    // Auto-advance to next input when a valid word is completed
    if (cleanValue.length > 0 && validWords.has(cleanValue) && index < WORD_COUNT - 1) {
      // Only auto-advance if this appears to be a complete word (user typed it, not just navigating)
      // We check if the previous value was shorter
      if (cleanValue.length > words[index].length) {
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50)
      }
    }
  }, [words])

  const handleSubmitEditing = useCallback((index: number) => {
    if (index < WORD_COUNT - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }, [])

  const isComplete = words.every((word) => word.length > 0)
  const hasInvalidWords = invalidWordIndices.length > 0
  const canContinue = isComplete && !hasInvalidWords

  const handleContinue = useCallback(() => {
    if (hasInvalidWords) {
      const invalidPositions = invalidWordIndices.map(i => i + 1).join(', ')
      setError(`Words at positions ${invalidPositions} are not valid BIP39 words.`)
      return
    }

    const mnemonic = words.join(' ')

    // Try validation with explicit wordlist
    let isValid = false
    let validationError = ''
    try {
      isValid = bip39.validateMnemonic(mnemonic, bip39.wordlists.english)
    } catch (e) {
      validationError = e instanceof Error ? e.message : String(e)
      console.error('Mnemonic validation error:', e)
    }
    console.log('Mnemonic validation:', { mnemonic, isValid, validationError, hasBuffer: typeof Buffer !== 'undefined' })

    if (!isValid) {
      const errorMsg = validationError
        ? `Validation error: ${validationError}`
        : 'Invalid mnemonic checksum. The 12th word must match the checksum of the first 11 words.'
      setError(errorMsg)
      return
    }

    navigation.navigate('Account', { mnemonic })
  }, [words, navigation, hasInvalidWords, invalidWordIndices])

  const handleClear = useCallback(() => {
    setWords(Array(WORD_COUNT).fill(''))
    setError(null)
    inputRefs.current[0]?.focus()
  }, [])

  const handleGenerateRandom = useCallback(() => {
    // Generate 128 bits (16 bytes) of entropy using expo-crypto
    const entropy = Crypto.getRandomBytes(16)
    const mnemonic = bip39.entropyToMnemonic(entropy, bip39.wordlists.english)
    const newWords = mnemonic.split(' ')
    setWords(newWords)
    setError(null)
  }, [])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Enter Recovery Phrase</Text>
        <Text style={styles.subtitle}>
          Enter your 12-word recovery phrase to restore your account
        </Text>

        <View style={styles.wordsContainer}>
          {words.map((word, index) => {
            const isInvalid = invalidWordIndices.includes(index)
            const isValid = word.length > 0 && !isInvalid
            return (
              <View key={index} style={styles.wordInputContainer}>
                <Text style={styles.wordNumber}>{index + 1}</Text>
                <TextInput
                  ref={(ref) => (inputRefs.current[index] = ref)}
                  style={[
                    styles.wordInput,
                    isValid && styles.wordInputValid,
                    isInvalid && styles.wordInputInvalid,
                  ]}
                  value={word}
                  onChangeText={(value) => handleWordChange(index, value)}
                  onSubmitEditing={() => handleSubmitEditing(index)}
                  placeholder="word"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType={index === WORD_COUNT - 1 ? 'done' : 'next'}
                  blurOnSubmit={false}
                />
              </View>
            )
          })}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleClear}
          >
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleGenerateRandom}
          >
            <Text style={styles.secondaryButtonText}>Random</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.continueButton,
            !canContinue && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!canContinue}
        >
          <Text
            style={[
              styles.continueButtonText,
              !canContinue && styles.continueButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 40,
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
  wordsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  wordInputContainer: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  wordNumber: {
    width: 24,
    fontSize: 14,
    color: '#888',
    textAlign: 'right',
    marginRight: 8,
  },
  wordInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#2a4a4a',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 2,
    borderColor: '#3a5a5a',
  },
  wordInputValid: {
    borderColor: '#4a9a9a',
    backgroundColor: '#2a5555',
  },
  wordInputInvalid: {
    borderColor: '#ff6b6b',
    backgroundColor: '#4a3a3a',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#3a5a5a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  secondaryButtonText: {
    color: '#ccc',
    fontSize: 15,
    fontWeight: '500',
  },
  continueButton: {
    height: 50,
    backgroundColor: '#4a9a9a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: '#3a5a5a',
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  continueButtonTextDisabled: {
    color: '#888',
  },
})
