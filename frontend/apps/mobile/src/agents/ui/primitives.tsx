/**
 * The small React Native component kit the agents screens are built from.
 *
 * The shared agents package ships its views as web components (Radix, Tailwind, lucide-react), so
 * mobile rewrites the view layer. These are the pieces that would otherwise be re-inlined in every
 * screen — spelled with the same `theme.ts` tokens the document surfaces use, so agents look like
 * the rest of the app rather than like a port.
 */

import React, {type ReactNode} from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import {radius, theme} from '../../theme'

// ─── Text ────────────────────────────────────────────────────────────────────

type TextTone = 'default' | 'muted' | 'danger' | 'brand'
type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const TONE_COLOR: Record<TextTone, string> = {
  default: theme.foreground,
  muted: theme.mutedForeground,
  danger: theme.danger,
  brand: theme.brand,
}

const SIZE_STYLE: Record<TextSize, TextStyle> = {
  xs: {fontSize: 11, lineHeight: 15},
  sm: {fontSize: 13, lineHeight: 18},
  md: {fontSize: 15, lineHeight: 21},
  lg: {fontSize: 18, lineHeight: 24},
  xl: {fontSize: 22, lineHeight: 28},
}

export function Label({
  children,
  tone = 'default',
  size = 'md',
  weight,
  style,
  numberOfLines,
  selectable,
}: {
  children: ReactNode
  tone?: TextTone
  size?: TextSize
  weight?: TextStyle['fontWeight']
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  selectable?: boolean
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[SIZE_STYLE[size], {color: TONE_COLOR[tone]}, weight ? {fontWeight: weight} : null, style]}
    >
      {children}
    </Text>
  )
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  children,
  onPress,
  variant = 'secondary',
  disabled,
  busy,
  size = 'md',
  style,
  testID,
}: {
  children: ReactNode
  onPress?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  /** Shows a spinner in place of the label and blocks presses. */
  busy?: boolean
  size?: 'sm' | 'md'
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const inert = disabled || busy
  return (
    <Pressable
      testID={testID}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      style={({pressed}) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        VARIANT_STYLE[variant],
        pressed && !inert && styles.buttonPressed,
        inert && styles.buttonDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? theme.accentForeground : theme.foreground} />
      ) : (
        <Text style={[styles.buttonText, size === 'sm' && styles.buttonTextSm, VARIANT_TEXT_STYLE[variant]]}>
          {children}
        </Text>
      )}
    </Pressable>
  )
}

const VARIANT_STYLE: Record<ButtonVariant, ViewStyle> = {
  primary: {backgroundColor: theme.brand, borderColor: theme.brand},
  secondary: {backgroundColor: theme.muted, borderColor: theme.border},
  ghost: {backgroundColor: 'transparent', borderColor: 'transparent'},
  danger: {backgroundColor: 'transparent', borderColor: theme.danger},
}

const VARIANT_TEXT_STYLE: Record<ButtonVariant, TextStyle> = {
  primary: {color: theme.accentForeground},
  secondary: {color: theme.foreground},
  ghost: {color: theme.mutedForeground},
  danger: {color: theme.danger},
}

// ─── Containers ──────────────────────────────────────────────────────────────

export function Card({
  children,
  onPress,
  style,
  testID,
}: {
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.card, style]}>
        {children}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({pressed}) => [styles.card, pressed && styles.cardPressed, style]}
    >
      {children}
    </Pressable>
  )
}

export function Section({title, action, children}: {title: string; action?: ReactNode; children: ReactNode}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Label size="xs" tone="muted" weight="700" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Label>
        {action}
      </View>
      {children}
    </View>
  )
}

/** Centered loading, empty, or error state for a whole pane. */
export function StatePanel({
  loading,
  title,
  detail,
  action,
}: {
  loading?: boolean
  title?: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <View style={styles.statePanel}>
      {loading ? <ActivityIndicator color={theme.brand} /> : null}
      {title ? (
        <Label size="md" weight="600" style={styles.stateText}>
          {title}
        </Label>
      ) : null}
      {detail ? (
        <Label size="sm" tone="muted" style={styles.stateText}>
          {detail}
        </Label>
      ) : null}
      {action}
    </View>
  )
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type StatusTone = 'idle' | 'active' | 'waiting' | 'error' | 'done'

const STATUS_COLOR: Record<StatusTone, string> = {
  idle: theme.mutedForeground,
  active: theme.brand,
  waiting: '#e0a33e',
  error: theme.danger,
  done: '#4ade80',
}

export function StatusDot({tone, size = 8}: {tone: StatusTone; size?: number}) {
  return (
    <View
      style={{width: size, height: size, borderRadius: size / 2, backgroundColor: STATUS_COLOR[tone]}}
      accessibilityLabel={`status: ${tone}`}
    />
  )
}

export function Badge({children, tone = 'idle'}: {children: ReactNode; tone?: StatusTone}) {
  return (
    <View style={[styles.badge, {borderColor: STATUS_COLOR[tone]}]}>
      <Text style={[styles.badgeText, {color: STATUS_COLOR[tone]}]}>{children}</Text>
    </View>
  )
}

// ─── Form fields ─────────────────────────────────────────────────────────────

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  autoCapitalize = 'none',
  multiline,
  hint,
  keyboardType,
  testID,
}: {
  label?: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  secure?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words'
  multiline?: boolean
  hint?: string
  keyboardType?: 'default' | 'url' | 'email-address'
  testID?: string
}) {
  return (
    <View style={styles.field}>
      {label ? (
        <Label size="sm" tone="muted" weight="600">
          {label}
        </Label>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedForeground}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
      {hint ? (
        <Label size="xs" tone="muted">
          {hint}
        </Label>
      ) : null}
    </View>
  )
}

/** A single-select list of options, used wherever the web UI opens a dropdown. */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  emptyText,
}: {
  options: {value: T; label: string; detail?: string}[]
  value: T | undefined
  onChange: (value: T) => void
  emptyText?: string
}) {
  if (options.length === 0) {
    return (
      <Label size="sm" tone="muted">
        {emptyText || 'Nothing to choose from'}
      </Label>
    )
  }
  return (
    <View style={styles.optionList}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({pressed}) => [styles.option, selected && styles.optionSelected, pressed && styles.cardPressed]}
          >
            <View style={styles.optionRadio}>{selected ? <View style={styles.optionRadioDot} /> : null}</View>
            <View style={styles.optionBody}>
              <Label size="sm" weight={selected ? '600' : '400'}>
                {option.label}
              </Label>
              {option.detail ? (
                <Label size="xs" tone="muted" numberOfLines={1}>
                  {option.detail}
                </Label>
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

/**
 * Bottom sheet standing in for the web UI's dialogs.
 *
 * A phone has no room for a centered modal with a form in it, and the platform convention is a
 * sheet — so the create-agent and provider flows slide up from the bottom and scroll internally
 * rather than being transplanted as dialogs.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Label size="lg" weight="700">
              {title}
            </Label>
            <Button variant="ghost" size="sm" onPress={onClose}>
              Close
            </Button>
          </View>
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  )
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export function Spinner({size = 'small'}: {size?: 'small' | 'large'}) {
  return <ActivityIndicator size={size} color={theme.brand} />
}

export function ErrorNote({children}: {children: ReactNode}) {
  return (
    <View style={styles.errorNote}>
      <Label size="sm" tone="danger">
        {children}
      </Label>
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSm: {minHeight: 30, paddingHorizontal: 10, borderRadius: radius.md},
  buttonPressed: {opacity: 0.7},
  buttonDisabled: {opacity: 0.4},
  buttonText: {fontSize: 15, fontWeight: '600'},
  buttonTextSm: {fontSize: 13},

  card: {
    backgroundColor: theme.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    gap: 8,
  },
  cardPressed: {opacity: 0.75},

  section: {gap: 10},
  sectionHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28},
  sectionTitle: {letterSpacing: 0.8},

  statePanel: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32},
  stateText: {textAlign: 'center'},

  badge: {borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2},
  badgeText: {fontSize: 11, fontWeight: '600'},

  field: {gap: 6},
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.foreground,
    backgroundColor: theme.background,
    fontSize: 15,
  },
  inputMultiline: {minHeight: 96, textAlignVertical: 'top'},

  optionList: {gap: 6},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  optionSelected: {borderColor: theme.brand, backgroundColor: theme.accent},
  optionRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.mutedForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRadioDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: theme.brand},
  optionBody: {flex: 1, gap: 2},

  sheetBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end'},
  sheetDismissArea: {flex: 1},
  sheet: {
    maxHeight: '85%',
    backgroundColor: theme.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  sheetBody: {flexGrow: 0},
  sheetBodyContent: {padding: 16, gap: 14},
  sheetFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },

  errorNote: {
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: radius.lg,
    padding: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
})
