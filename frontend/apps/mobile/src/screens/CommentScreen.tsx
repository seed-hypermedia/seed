import {RouteProp} from '@react-navigation/native'
import {NativeStackNavigationProp} from '@react-navigation/native-stack'
import React from 'react'
import {KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View} from 'react-native'
import {Discussions} from '../components/Discussions'
import type {RootStackParamList} from '../navigation/types'
import {hmId} from '../utils/hm-id'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Comment'>
  route: RouteProp<RootStackParamList, 'Comment'>
}

/**
 * One comment thread: the comment, the replies under it, and a box to reply
 * with the identity currently selected in the vault.
 */
export function CommentScreen({route}: Props) {
  const {uid, path, commentId, docVersion} = route.params
  const targetId = hmId(uid, path)

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="comment-thread"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View>
          <Discussions targetId={targetId} docVersion={docVersion} commentId={commentId} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F3838',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
})
