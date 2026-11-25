import {describe, expect, it} from 'vitest'
import {siteAgentMountsFromDocuments} from '../site-agents'

/** A space's agents are its mount documents; the listing is read straight off them. */
const AGENT = 'hm://hyper.media/agent'

describe('siteAgentMountsFromDocuments', () => {
  it('keeps agent-typed documents with a mountable server, in path order, named by the document', () => {
    const mounts = siteAgentMountsFromDocuments([
      {
        account: 'z6space',
        path: '/zed',
        metadata: {type: AGENT, agentServerUrl: 'https://agents.example', name: 'Zed'},
      },
      {account: 'z6space', path: '/about', metadata: {name: 'About'}},
      {
        account: 'z6space',
        path: '/alpha',
        metadata: {type: AGENT, agentServerUrl: 'http://localhost:3051', name: '  Alpha '},
      },
      {account: 'z6space', path: '/team/unnamed', metadata: {type: AGENT, agentServerUrl: 'https://agents.example'}},
    ])
    expect(mounts).toEqual([
      {agentId: 'hm://z6space/alpha', serverUrl: 'http://localhost:3051', name: 'Alpha', path: '/alpha'},
      {
        agentId: 'hm://z6space/team/unnamed',
        serverUrl: 'https://agents.example',
        name: 'unnamed',
        path: '/team/unnamed',
      },
      {agentId: 'hm://z6space/zed', serverUrl: 'https://agents.example', name: 'Zed', path: '/zed'},
    ])
  })

  it('skips documents that only advertise a server, name an unusable one, or sit at the home path', () => {
    expect(
      siteAgentMountsFromDocuments([
        {account: 'z6space', path: '', metadata: {type: AGENT, agentServerUrl: 'https://agents.example'}},
        {account: 'z6space', path: '/about', metadata: {agentServerUrl: 'https://agents.example'}},
        {account: 'z6space', path: '/bad', metadata: {type: AGENT, agentServerUrl: 'file:///agents'}},
        {account: 'z6space', path: '/creds', metadata: {type: AGENT, agentServerUrl: 'https://u:p@agents.example'}},
        {account: 'z6space', path: '/none', metadata: {type: AGENT}},
        {account: 'z6space', path: '/null', metadata: null},
      ]),
    ).toEqual([])
  })
})
