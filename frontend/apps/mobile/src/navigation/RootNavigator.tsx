import React from 'react'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import {ServerSelectScreen} from '../screens/ServerSelectScreen'
import {HomeScreen} from '../screens/HomeScreen'
import {MnemonicInputScreen} from '../screens/MnemonicInputScreen'
import {AccountScreen} from '../screens/AccountScreen'
import type {RootStackParamList} from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="ServerSelect"
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
        name="ServerSelect"
        component={ServerSelectScreen}
        options={{
          title: 'Seed',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Seed',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="MnemonicInput"
        component={MnemonicInputScreen}
        options={{
          title: 'Recovery Phrase',
          headerBackTitle: 'Back',
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
