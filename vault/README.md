# Seed Hypermedia Identity Vault

A zero-knowledge, end-to-end encrypted (E2EE) identity and data vault. This project implements a secure authentication and storage system where the server has no knowledge of the user's data.

## Features

- **Zero-Knowledge Architecture**: All encryption happens client-side; the server never sees raw user data.
- **Flexible Authentication**: Passkeys and passwords are used to derive encryption keys for the vault.
- **Secure Storage**: Vault data is encrypted with a Data Encryption Key (DEK) known only to the user.

## Getting Started

### Prerequisites

This project is built with **[Bun](https://bun.sh)**.

For the best contributor experience, we recommend installing:

1. **[mise](https://mise.jdx.dev/)**: For managing tools and runtimes (like Bun).
2. **[direnv](https://direnv.net/)**: For automatically loading environment variables and tools when you enter the directory.

Once installed, simply `cd` into the directory and allow the environment:

```bash
direnv allow .
```

This will ensure you have the correct version of Bun and other tools installed.

### Development

Start the development server with hot reloading:

```bash
bun dev
```

This will run the server, typically accessible at `http://localhost:3000` (check console output).

### Building

To build the project for production:

```bash
bun run build
```

### Linting & Testing

Run type checking and linting:

```bash
bun run check
```

Run tests:

```bash
bun test
```

## Architecture & Security

This system is designed with a **Zero-Knowledge** philosophy. The server stores opaque user IDs and encrypted blobs, but cannot decrypt user data.

The UI is an SPA built with React.

[Valtio](https://valtio.dev) is used for state management, to maintain the core of the business logic outside React. This is much easier to test and to reason about.

### Key Principles

- **Client-Side Encryption**: All encryption and decryption happen in the browser.
- **No Server-Side Knowledge**: The server never sees the Data Encryption Key (DEK) or plaintext data.

### Authentication & Keys

Users can authenticate using multiple methods, each with different capabilities regarding the encrypted vault:

1.  **Passkeys (Recommended)**:
    - Uses the **PRF extension** to deterministically derive the encryption key.
    - Allows full access: Login + Decrypt Data.
2.  **Passwords**:
    - Key derivation uses **Argon2id** with the email as the salt (client-side).
    - Allows full access: Login + Decrypt Data.
3.  **Magic Links**:
    - Used for registration, account recovery (resetting the vault), or changing email.
    - **Cannot decrypt data** (as they don't contain the key material).
4.  **Paper Keys** (coming soon):
    - High-entropy generated passwords serving as a backup.
    - Allows full access.

### Cryptography Standards

- **Encryption**: XChaCha20-Poly1305.
- **Key Derivation**: Argon2id.
