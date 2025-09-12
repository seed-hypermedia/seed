export interface UpdateAsset {
  download_url: string
  zip_url?: string
}

export interface UpdateInfo {
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

export type UpdateStatus =
  | {type: 'idle'}
  | {type: 'checking'}
  | {type: 'update-available'; updateInfo: UpdateInfo}
  | {type: 'downloading'; progress: number}
  | {type: 'restarting'}
  | {type: 'error'; error: string}
  | {type: 'flatpak-info'; message: string}
