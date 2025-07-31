import { Page } from '@playwright/test';
import { ElectronAppInfo } from './types';
/**
 * Find the latest build and start monokle app for testing
 */
export declare function startApp(): Promise<{
    getWindow: () => Promise<Page>;
    appInfo: ElectronAppInfo;
    app: import("playwright-core").ElectronApplication;
    appWindow: Page;
}>;
/**
 * Parses the `out` directory to find the latest build.
 * Use `npm run package` (or similar) to build your app prior to testing.
 * @returns path to the most recently modified build directory
 */
export declare function findLatestBuild(): string;
/**
 * Given a directory containing an Electron app build,
 * return the path to the app's executable and the path to the app's main file.
 */
export declare function parseElectronApp(buildDir: string): ElectronAppInfo;
export declare const deleteApplicationConfig: (platform: string) => void;
