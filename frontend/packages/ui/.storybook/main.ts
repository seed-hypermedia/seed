import type {StorybookConfig} from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  docs: {
    defaultName: 'Docs',
  },
  env: (config) => ({
    ...config,
    STORYBOOK_PLAYGROUND_URL: process.env.STORYBOOK_PLAYGROUND_URL || 'http://localhost:6007',
  }),
  viteFinal: async (config) => ({
    ...config,
    base: './',
    define: {
      ...config.define,
      'process.env': '{}',
      'process.env.STORYBOOK_PLAYGROUND_URL': JSON.stringify(
        process.env.STORYBOOK_PLAYGROUND_URL || 'http://localhost:6007',
      ),
    },
  }),
}

export default config
