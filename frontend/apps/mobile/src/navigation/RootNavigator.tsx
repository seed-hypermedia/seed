import React from 'react'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import {ServerSelectScreen} from '../screens/ServerSelectScreen'
import {MnemonicInputScreen} from '../screens/MnemonicInputScreen'
import {AccountScreen} from '../screens/AccountScreen'
import {VaultScreen} from '../screens/VaultScreen'
import {VaultConnectScreen} from '../screens/VaultConnectScreen'
import {CreateIdentityScreen} from '../screens/CreateIdentityScreen'
import {IdentityScreen} from '../screens/IdentityScreen'
import {CommentScreen} from '../screens/CommentScreen'
import {DocumentScreen} from '../screens/DocumentScreen'
import {AgentsScreen} from '../agents/screens/AgentsScreen'
import {AgentScreen} from '../agents/screens/AgentScreen'
import {AgentSessionScreen} from '../agents/screens/AgentSessionScreen'
import {NotificationsScreen} from '../screens/NotificationsScreen'
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
      <Stack.Screen
        name="Vault"
        component={VaultScreen}
        options={{
          title: 'Vault',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="VaultConnect"
        component={VaultConnectScreen}
        options={{
          title: 'Connect Vault',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="CreateIdentity"
        component={CreateIdentityScreen}
        options={{
          title: 'Create Identity',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Identity"
        component={IdentityScreen}
        options={{
          title: 'Identity',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Document"
        component={DocumentScreen}
        options={({route}) => ({
          title: route.params?.title || 'Document',
          headerBackTitle: 'Back',
        })}
      />
      <Stack.Screen
        name="Comment"
        component={CommentScreen}
        options={{
          title: 'Comment',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Agents"
        component={AgentsScreen}
        options={{
          title: 'Agents',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Agent"
        component={AgentScreen}
        options={({route}) => ({
          title: route.params?.title || 'Agent',
          headerBackTitle: 'Agents',
        })}
      />
      <Stack.Screen
        name="AgentSession"
        component={AgentSessionScreen}
        options={({route}) => ({
          title: route.params?.title || 'Conversation',
          headerBackTitle: 'Back',
        })}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: 'Notifications',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  )
}
