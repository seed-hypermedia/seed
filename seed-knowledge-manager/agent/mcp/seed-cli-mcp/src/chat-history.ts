/**
 * Per-Telegram-chat conversation history. Append-only JSONL files, one
 * per chat-id, capped to the last N turns when read. Survives process
 * restarts. Bounded so a runaway chat can't grow logs forever.
 */

import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ChatTurn} from './reply-engine.js'

const MAX_TURNS_RETURNED = 10
const ROTATE_BYTES = 256 * 1024 // rotate file after 256KB

export class ChatHistory {
  private readonly dir: string

  constructor(stateDir: string) {
    this.dir = join(stateDir, 'telegram-history')
    if (!existsSync(this.dir)) mkdirSync(this.dir, {recursive: true, mode: 0o700})
  }

  /** Returns the last MAX_TURNS_RETURNED turns for the chat, oldest first. */
  read(chatId: number): ChatTurn[] {
    const path = this.pathFor(chatId)
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    const turns: ChatTurn[] = []
    for (const line of lines) {
      try {
        const t = JSON.parse(line) as ChatTurn
        if ((t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') turns.push(t)
      } catch {
        /* skip */
      }
    }
    return turns.slice(-MAX_TURNS_RETURNED)
  }

  append(chatId: number, turns: ChatTurn[]): void {
    if (turns.length === 0) return
    const path = this.pathFor(chatId)
    // Rotate when the file gets large.
    if (existsSync(path)) {
      const stat = require('node:fs').statSync(path) as {size: number}
      if (stat.size > ROTATE_BYTES) {
        const recent = this.read(chatId)
        writeFileSync(path, recent.map((t) => JSON.stringify(t)).join('\n') + '\n', {mode: 0o600})
      }
    }
    const lines = turns.map((t) => JSON.stringify(t)).join('\n') + '\n'
    appendFileSync(path, lines)
  }

  private pathFor(chatId: number): string {
    return join(this.dir, `${chatId}.jsonl`)
  }
}
