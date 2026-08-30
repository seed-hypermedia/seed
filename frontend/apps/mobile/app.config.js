// Dynamic Expo config wrapping app.json. With no APP_VARIANT set it returns
// app.json unchanged, so EAS/production builds are unaffected.
//
// APP_VARIANT=dev produces the blue-icon "Seed Dev" build: a separate bundle id
// so it installs alongside the store app, its own `seeddev` scheme so it never
// captures production `hm://` links, and a dev-launcher pinned to "most-recent"
// so after connecting once it always reopens the same remote Metro server
// (see README, "On-the-go dev via a remote Metro server").
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'dev') return config
  return {
    ...config,
    name: 'Seed Dev',
    scheme: 'seeddev',
    icon: './assets/icon-dev.png',
    splash: {
      ...config.splash,
      image: './assets/splash-icon-dev.png',
      backgroundColor: '#1F1F38',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'media.hyper.seed.mobile.dev',
      appleTeamId: 'JJ2F38D5FA',
      infoPlist: {
        ...config.ios.infoPlist,
        CFBundleDisplayName: 'Seed Dev',
        CFBundleName: 'Seed Dev',
        // ATS blocks cleartext HTTP to the tailscale CGNAT range (100.64/10 is
        // not "local networking" to iOS), which would silently kill every
        // request to the remote Metro server. Dev build only, so allow it.
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
    },
    android: {
      ...config.android,
      package: 'media.hyper.seed.mobile.dev',
      adaptiveIcon: {
        ...config.android.adaptiveIcon,
        foregroundImage: './assets/adaptive-icon-dev.png',
        backgroundColor: '#1F1F38',
      },
    },
    web: {
      ...config.web,
      favicon: './assets/favicon-dev.png',
    },
    plugins: [...config.plugins, ['expo-dev-client', { launchMode: 'most-recent' }]],
    updates: {
      ...config.updates,
      enabled: false,
    },
  }
}
