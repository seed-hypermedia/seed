import {createElement} from 'react'
import {addons, types} from 'storybook/manager-api'

addons.register('seed/playground', () => {
  addons.add('seed/playground/link', {
    title: 'Playground',
    type: types.TOOL,
    render: () =>
      createElement(
        'a',
        {
          href: process.env.STORYBOOK_PLAYGROUND_URL || 'http://localhost:6007',
          target: '_blank',
          rel: 'noreferrer',
          title: 'Open the design playground',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 12px',
            height: 32,
            fontSize: 12,
            fontWeight: 600,
            color: 'inherit',
            textDecoration: 'none',
          },
        },
        'Playground ↗',
      ),
  })
})
