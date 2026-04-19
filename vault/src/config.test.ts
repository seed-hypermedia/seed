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
      'smtp-host': defs['smtp-host'].default,
      'smtp-port': defs['smtp-port'].default,
      'smtp-user': defs['smtp-user'].default,
      'smtp-password': defs['smtp-password'].default,
      'smtp-sender': defs['smtp-sender'].default,
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
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
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
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
    })

    expect(cfg.notificationServerUrl).toBe('https://notify.seed.hyper.media')
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
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
      },
      {SEED_VAULT_DEFAULT_NOTIFY_SERVER: 'http://localhost:3060'},
    )

    expect(cfg.notificationServerUrl).toBe('http://localhost:3060')
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
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
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
      'smtp-host': '',
      'smtp-port': 587,
      'smtp-user': '',
      'smtp-password': '',
      'smtp-sender': '',
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
        'smtp-host': '',
        'smtp-port': 587,
        'smtp-user': '',
        'smtp-password': '',
        'smtp-sender': '',
      }),
    ).toThrow('Invalid backend gRPC base URL: not-a-url')
  })
})
