/** Platform download URLs and optional integrity digests from latest.json. */
export interface UpdateAsset {
  download_url: string
  zip_url?: string
  /** SHA-256 of download_url, as hexadecimal. */
  sha256?: string
  /** SHA-256 of zip_url; macOS installs the ZIP rather than the DMG. */
  zip_sha256?: string
}

/** Release metadata and browser policy advertised by the update manifest. */
export interface UpdateInfo {
  /** Base64 Ed25519 signature of canonical JSON with this field omitted. */
  signature?: string
  /** Old manifests may omit the minimum supported Chromium version. */
  minimumChromium?: string
  /** Release timestamp of the manifest's Chromium; does not reset the bundled runtime's age. */
  chromiumReleasedAt?: string
  name: string
  tag_name: string
  release_notes: string
  assets: {
    linux?: {
      deb?: UpdateAsset
      rpm?: UpdateAsset
    }
    macos?: {
      x64?: UpdateAsset
      arm64?: UpdateAsset
    }
    win32?: {
      x64?: UpdateAsset
    }
  }
}

/** Update progress sent from the main process to the renderer. */
export type UpdateStatus =
  | {type: 'idle'}
  | {type: 'up-to-date'}
  | {type: 'checking'}
  | {type: 'update-available'; updateInfo: UpdateInfo}
  | {type: 'downloading'; progress: number}
  | {type: 'restarting'}
  | {type: 'error'; error: string}
  | {type: 'flatpak-info'; message: string}
