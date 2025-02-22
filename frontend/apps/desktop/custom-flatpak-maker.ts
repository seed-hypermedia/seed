import path from 'node:path'

import {MakerBase, MakerOptions} from '@electron-forge/maker-base'
import {MakerFlatpakConfig} from '@electron-forge/maker-flatpak'
import {ForgeArch, ForgePlatform} from '@electron-forge/shared-types'
import fs from 'fs-extra'

export function flatpakArch(nodeArch: ForgeArch): string {
  switch (nodeArch) {
    case 'ia32':
      return 'i386'
    case 'x64':
      return 'x86_64'
    case 'armv7l':
      return 'arm'
    case 'arm64':
      return 'aarch64'
    // arm => arm
    default:
      return nodeArch
  }
}

export default class MakerCustomFlatpak extends MakerBase<MakerFlatpakConfig> {
  name = 'flatpak'

  defaultPlatforms: ForgePlatform[] = ['linux']

  requiredExternalBinaries: string[] = ['flatpak-builder', 'eu-strip']

  isSupportedOnCurrentPlatform(): boolean {
    return this.isInstalled('@malept/electron-installer-flatpak')
  }

  async make({dir, makeDir, targetArch}: MakerOptions): Promise<string[]> {
    // eslint-disable-next-line n/no-missing-require
    const installer = require('@malept/electron-installer-flatpak')

    const arch = flatpakArch(targetArch)
    const outDir = path.resolve(makeDir, 'flatpak', arch)

    await this.ensureDirectory(outDir)
    const _config = {
      ...this.config,
      arch,
      src: dir,
      dest: outDir,
    }

    console.log(`== ~ make ~ _config:`, _config)
    const flatpakConfig = _config

    await installer(flatpakConfig)

    return (await fs.readdir(outDir))
      .filter((basename) => basename.endsWith('.flatpak'))
      .map((basename) => path.join(outDir, basename))
  }
}

export {MakerCustomFlatpak}
