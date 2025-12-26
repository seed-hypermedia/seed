// Mock key-derivation module to avoid complex crypto dependencies
jest.mock('./src/utils/key-derivation', () => ({
  validateMnemonic: jest.fn((mnemonic) => mnemonic.split(' ').length === 12),
  deriveAccountIdFromMnemonic: jest.fn(() => 'z6MkmockAccountIdForTesting'),
  deriveKeyPairFromMnemonic: jest.fn(() => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    accountId: 'z6MkmockAccountIdForTesting',
  })),
}))

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native')
  return {
    SafeAreaProvider: ({ children }) => View ? require('react').createElement(View, null, children) : children,
    SafeAreaView: ({ children }) => View ? require('react').createElement(View, null, children) : children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  }
})

// Mock react-native-screens
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
  screensEnabled: jest.fn(() => true),
  NativeScreen: 'View',
  NativeScreenContainer: 'View',
  NativeScreenNavigationContainer: 'View',
  NativeScreenStack: 'View',
  NativeScreenStackHeaderConfig: 'View',
  SearchBarCommands: {},
  ScreenContainer: 'View',
  Screen: 'View',
  FullWindowOverlay: 'View',
}))

// Mock @react-navigation/native
jest.mock('@react-navigation/native', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    NavigationContainer: ({ children }) => React.createElement(View, { testID: 'navigation-container' }, children),
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
    }),
    useRoute: () => ({
      params: {},
    }),
  }
})

// Mock @react-navigation/native-stack
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children, initialRouteName }) => {
        // Only render the initial route screen for testing
        const childrenArray = React.Children.toArray(children)
        const initialScreen = childrenArray.find(child => child.props?.name === initialRouteName)
        if (initialScreen) {
          const Component = initialScreen.props.component
          return React.createElement(View, { testID: 'stack-navigator' },
            React.createElement(Component, { navigation: { navigate: jest.fn() } })
          )
        }
        return React.createElement(View, { testID: 'stack-navigator' }, children)
      },
      Screen: ({ component, name }) => null, // Screens are handled by Navigator
    }),
  }
})
