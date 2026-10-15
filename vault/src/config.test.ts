import {create, flags} from '@/config'
import {describe, expect, test} from 'bun:test'

describe('vault config', () => {
  test('defaults backend http base url from relying party origin', () => {
    const defs = flags({
      SEED_VAULT_RP_ID: 'example.com',
      SEED_VAULT_RP_ORIGIN: 'https://example.com',
    })

    const cfg = create({
      'server-hostname': defs['server-hostname'].default,
      'server-port': defs['server-port'].default,
      'rp-id': defs['rp-id'].default,
      'rp-name': defs['rp-name'].default,
      'rp-origin': defs['rp-origin'].default,
      'db-path': defs['db-path'].default,
      'backend-http-base-url': defs['backend-http-base-url'].default,
      'backend-grpc-base-url': defs['backend-grpc-base-url'].default,
      'web-base-url': '',
      'smtp-host': defs['smtp-host'].default,
      'smtp-port': defs['smtp-port'].default,
      'smtp-user': defs['smtp-user'].default,
      'smtp-password': defs['smtp-password'].default,
      'smtp-sender': defs['smtp-sender'].default,
      'email-relay-url': defs['email-relay-url'].default,
      'email-relay-token': defs['email-relay-token'].default,
      'invite-only': defs['invite-only'].default,
      'admin-secret': defs['admin-secret'].default,
    })

    expect(cfg.backend.httpBaseUrl).toBe('https://example.com')
    expect(cfg.backend.grpcBaseUrl).toBe('https://example.com')
  })

  test('defaults backend grpc base url from backend http base url', () => {
    const cfg = create({
      'server-hostname': '0.0.0.0',
      'server-port': 3000,
      'rp-id': 'example.com',
      'rp-name': 'Vault',
      'rp-origin': 'https://example.com',
      'db-path': ':memory:',
      'backend-http-base-url': 'https://ipfs.example.com',
      'backend-grpc-base-url': '',
      'web-base-url': '',
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
      'email-relay-url': '',
      'email-relay-token': '',
      'invite-only': false,
      'admin-secret': '',
    })

    expect(cfg.backend.httpBaseUrl).toBe('https://ipfs.example.com')
    expect(cfg.backend.grpcBaseUrl).toBe('https://ipfs.example.com')
  })

  test('defaults notification server url to the production server', () => {
    const cfg = create({
      'server-hostname': '0.0.0.0',
      'server-port': 3000,
      'rp-id': 'vault.example.com',
      'rp-name': 'Vault',
      'rp-origin': 'https://vault.example.com',
      'db-path': ':memory:',
      'backend-http-base-url': 'https://ipfs.example.com',
      'backend-grpc-base-url': '',
      'web-base-url': '',
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
      'email-relay-url': '',
      'email-relay-token': '',
      'invite-only': false,
      'admin-secret': '',
    })

    expect(cfg.notificationServerUrl).toBe('https://hyper.media/hm/api/notify')
  })

  test('uses SEED_VAULT_DEFAULT_NOTIFY_SERVER for local development overrides', () => {
    const cfg = create(
      {
        'server-hostname': '0.0.0.0',
        'server-port': 3000,
        'rp-id': 'vault.example.com',
        'rp-name': 'Vault',
        'rp-origin': 'https://vault.example.com',
        'db-path': ':memory:',
        'backend-http-base-url': 'https://ipfs.example.com',
        'backend-grpc-base-url': '',
        'web-base-url': '',
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
        'email-relay-url': '',
        'email-relay-token': '',
        'invite-only': false,
        'admin-secret': '',
      },
      {SEED_VAULT_DEFAULT_NOTIFY_SERVER: 'http://localhost:3060'},
    )

    expect(cfg.notificationServerUrl).toBe('http://localhost:3060')
  })

  test('an empty SEED_VAULT_DEFAULT_NOTIFY_SERVER disables the notification server', () => {
    const cfg = create(
      {
        'server-hostname': '0.0.0.0',
        'server-port': 3000,
        'rp-id': 'vault.example.com',
        'rp-name': 'Vault',
        'rp-origin': 'https://vault.example.com',
        'db-path': ':memory:',
        'backend-http-base-url': 'https://ipfs.example.com',
        'backend-grpc-base-url': '',
        'web-base-url': '',
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
        'email-relay-url': '',
        'email-relay-token': '',
        'invite-only': false,
        'admin-secret': '',
      },
      {SEED_VAULT_DEFAULT_NOTIFY_SERVER: ''},
    )

    expect(cfg.notificationServerUrl).toBe('')
  })

  test('uses SEED_VAULT_DEFAULT_NOTIFY_SERVER when provided', () => {
    const cfg = create(
      {
        'server-hostname': '0.0.0.0',
        'server-port': 3000,
        'rp-id': 'vault.example.com',
        'rp-name': 'Vault',
        'rp-origin': 'https://vault.example.com',
        'db-path': ':memory:',
        'backend-http-base-url': 'https://ipfs.example.com',
        'backend-grpc-base-url': '',
        'web-base-url': '',
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
        'email-relay-url': '',
        'email-relay-token': '',
        'invite-only': false,
        'admin-secret': '',
      },
      {SEED_VAULT_DEFAULT_NOTIFY_SERVER: 'https://notify.example.com'},
    )

    expect(cfg.notificationServerUrl).toBe('https://notify.example.com')
  })

  test('uses explicit backend grpc base url when provided', () => {
    const cfg = create({
      'server-hostname': '0.0.0.0',
      'server-port': 3000,
      'rp-id': 'example.com',
      'rp-name': 'Vault',
      'rp-origin': 'https://example.com',
      'db-path': ':memory:',
      'backend-http-base-url': 'https://ipfs.example.com',
      'backend-grpc-base-url': 'https://daemon.internal.example.com',
      'web-base-url': '',
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
      'email-relay-url': '',
      'email-relay-token': '',
      'invite-only': false,
      'admin-secret': '',
    })

    expect(cfg.backend.httpBaseUrl).toBe('https://ipfs.example.com')
    expect(cfg.backend.grpcBaseUrl).toBe('https://daemon.internal.example.com')
  })

  test('rejects invalid backend grpc base url', () => {
    expect(() =>
      create({
        'server-hostname': '0.0.0.0',
        'server-port': 3000,
        'rp-id': 'example.com',
        'rp-name': 'Vault',
        'rp-origin': 'https://example.com',
        'db-path': ':memory:',
        'backend-http-base-url': 'https://ipfs.example.com',
        'backend-grpc-base-url': 'not-a-url',
        'web-base-url': '',
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
        'email-relay-url': '',
        'email-relay-token': '',
        'invite-only': false,
        'admin-secret': '',
      }),
    ).toThrow('Invalid backend gRPC base URL: not-a-url')
  })

  test('invite-only and admin-secret default to off', () => {
    const defs = flags({
      SEED_VAULT_RP_ID: 'example.com',
      SEED_VAULT_RP_ORIGIN: 'https://example.com',
    })

    expect(defs['invite-only'].default).toBe(false)
    expect(defs['admin-secret'].default).toBe('')
  })

  test('parses SEED_VAULT_INVITE_ONLY and SEED_VAULT_ADMIN_SECRET from the env', () => {
    const defs = flags({
      SEED_VAULT_RP_ID: 'example.com',
      SEED_VAULT_RP_ORIGIN: 'https://example.com',
      SEED_VAULT_INVITE_ONLY: 'true',
      SEED_VAULT_ADMIN_SECRET: 'top-secret',
    })

    expect(defs['invite-only'].default).toBe(true)
    expect(defs['admin-secret'].default).toBe('top-secret')
    expect(flags({SEED_VAULT_INVITE_ONLY: 'false'})['invite-only'].default).toBe(false)
    expect(flags({SEED_VAULT_INVITE_ONLY: '1'})['invite-only'].default).toBe(true)

    const cfg = create({
      'server-hostname': '0.0.0.0',
      'server-port': 3000,
      'rp-id': 'example.com',
      'rp-name': 'Vault',
      'rp-origin': 'https://example.com',
      'db-path': ':memory:',
      'backend-http-base-url': 'https://ipfs.example.com',
      'backend-grpc-base-url': '',
      'web-base-url': '',
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
      'email-relay-url': '',
      'email-relay-token': '',
      'invite-only': defs['invite-only'].default,
      'admin-secret': defs['admin-secret'].default,
    })

    expect(cfg.inviteOnly).toBe(true)
    expect(cfg.adminSecret).toBe('top-secret')
  })
})

describe('vault email relay config', () => {
  const base = {
    'server-hostname': '0.0.0.0',
    'server-port': 3000,
    'rp-id': 'example.com',
    'rp-name': 'Vault',
    'rp-origin': 'https://example.com',
    'db-path': ':memory:',
    'backend-http-base-url': 'https://ipfs.example.com',
    'backend-grpc-base-url': '',
    'web-base-url': '',
    'smtp-host': 'smtp.example.org',
    'smtp-port': 587,
    'smtp-user': 'u',
    'smtp-password': 'p',
    'smtp-sender': 's@example.org',
    'invite-only': false,
    'admin-secret': '',
  }

  test('reads SEED_VAULT_EMAIL_RELAY_URL and SEED_VAULT_EMAIL_RELAY_TOKEN from the env', () => {
    const defs = flags({
      SEED_VAULT_EMAIL_RELAY_URL: 'https://host.example.com/relay',
      SEED_VAULT_EMAIL_RELAY_TOKEN: 'tok',
    })
    expect(defs['email-relay-url'].default).toBe('https://host.example.com/relay')
    expect(defs['email-relay-token'].default).toBe('tok')
    expect(flags({})['email-relay-url'].default).toBe('')
  })

  test('keeps SMTP and the relay side by side; the sender decides precedence', () => {
    const cfg = create({...base, 'email-relay-url': 'https://host.example.com/relay', 'email-relay-token': 'tok'})
    expect(cfg.emailRelay).toEqual({url: 'https://host.example.com/relay', token: 'tok'})
    expect(cfg.smtp?.host).toBe('smtp.example.org')
    expect(create({...base, 'email-relay-url': '', 'email-relay-token': ''}).emailRelay).toBeNull()
  })

  test('rejects a relay URL that is not a URL, or one without a token', () => {
    expect(() => create({...base, 'email-relay-url': 'not-a-url', 'email-relay-token': 'tok'})).toThrow(
      'Invalid email relay URL: not-a-url',
    )
    expect(() =>
      create({...base, 'email-relay-url': 'https://host.example.com/relay', 'email-relay-token': ''}),
    ).toThrow(/relay token/)
  })
})
