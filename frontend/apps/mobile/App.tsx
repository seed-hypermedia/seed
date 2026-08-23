import {StatusBar} from 'expo-status-bar'
import {NavigationContainer} from '@react-navigation/native'
import {navigationRef} from './src/components/doc-navigation'
import {SafeAreaProvider} from 'react-native-safe-area-context'
import {RootNavigator} from './src/navigation/RootNavigator'

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
