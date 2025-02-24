// src/types/update.ts
export interface UpdateAsset {
    download_url: string;
    zip_url?: string;
  }
  
  export interface UpdateInfo {
    name: string;
    tag_name: string;
    release_notes: string;
    assets: {
      linux?: {
        deb?: UpdateAsset;
        rpm?: UpdateAsset;
      };
      macos?: {
        x64?: UpdateAsset;
        arm64?: UpdateAsset;
      };
      win32?: {
        x64?: UpdateAsset;
      };
    };
  }