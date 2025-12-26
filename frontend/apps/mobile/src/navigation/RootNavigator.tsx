import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { MnemonicInputScreen } from '../screens/MnemonicInputScreen'
import { AccountScreen } from '../screens/AccountScreen'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="MnemonicInput"
      screenOptions={{
        headerStyle: {
          backgroundColor: '#1F3838',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
        },
        contentStyle: {
          backgroundColor: '#1F3838',
        },
      }}
    >
      <Stack.Screen
        name="MnemonicInput"
        component={MnemonicInputScreen}
        options={{
          title: 'Seed',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: 'Your Account',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  )
}
