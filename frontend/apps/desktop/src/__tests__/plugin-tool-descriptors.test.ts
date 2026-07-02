import type {PluginManifest} from '@shm/ui/plugin-manifest'
import {describe, expect, it} from 'vitest'
import {buildPluginToolDescriptors, type PluginToolSource} from '../plugins/plugin-tool-descriptors'

function manifest(name: string, actions: PluginManifest['actions']): PluginManifest {
  return {schema: {'/': 'bafySchema'}, name, code: {'/': 'bafyCode'}, actions}
}

describe('buildPluginToolDescriptors', () => {
  it('builds one descriptor per action with a namespaced tool name', () => {
    const sources: PluginToolSource[] = [
      {
        cid: 'bafyPlugin',
        manifest: manifest('word-count', [
          {name: 'count_words', title: 'Count Words', description: 'Counts words.'},
          {name: 'count_chars', title: 'Count Characters'},
        ]),
        inputSchemas: {count_words: {type: 'object', properties: {text: {type: 'string'}}}},
      },
    ]
    const descriptors = buildPluginToolDescriptors(sources)
    expect(descriptors).toEqual([
      {
        toolName: 'plugin_word-count__count_words',
        pluginCid: 'bafyPlugin',
        actionName: 'count_words',
        description: 'Counts words.',
        inputSchema: {type: 'object', properties: {text: {type: 'string'}}},
      },
      {
        // no compiled schema → permissive object fallback; description falls
        // back to the title
        toolName: 'plugin_word-count__count_chars',
        pluginCid: 'bafyPlugin',
        actionName: 'count_chars',
        description: 'Count Characters',
        inputSchema: {type: 'object'},
      },
    ])
  })

  it('falls back to the action name when neither description nor title is set', () => {
    const sources: PluginToolSource[] = [{cid: 'c', manifest: manifest('p', [{name: 'go'}]), inputSchemas: {}}]
    expect(buildPluginToolDescriptors(sources)[0]!.description).toBe('go')
  })

  it('caps descriptions at 1024 characters', () => {
    const long = 'x'.repeat(2000)
    const sources: PluginToolSource[] = [
      {cid: 'c', manifest: manifest('p', [{name: 'go', description: long}]), inputSchemas: {}},
    ]
    expect(buildPluginToolDescriptors(sources)[0]!.description).toHaveLength(1024)
  })

  it('drops duplicate tool names across sources, keeping the first', () => {
    const sources: PluginToolSource[] = [
      {cid: 'c1', manifest: manifest('p', [{name: 'go', description: 'first'}]), inputSchemas: {}},
      {cid: 'c2', manifest: manifest('p', [{name: 'go', description: 'second'}]), inputSchemas: {}},
    ]
    const descriptors = buildPluginToolDescriptors(sources)
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({pluginCid: 'c1', description: 'first'})
  })

  it('returns an empty list for no sources', () => {
    expect(buildPluginToolDescriptors([])).toEqual([])
  })
})
