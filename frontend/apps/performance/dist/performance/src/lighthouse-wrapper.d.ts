/**
 * Lighthouse wrapper that uses the CLI version to avoid ESM import issues
 */
/**
 * Launches Chrome with debugging enabled
 */
export declare function launchChromeForLighthouse(): Promise<void>;
/**
 * Automatically starts the Electron app and returns the port to use
 */
export declare function launchElectronForLighthouse(): Promise<number>;
/**
 * Cleanup Chrome process on exit
 */
export declare function cleanupChrome(): void;
/**
 * Cleanup Electron app if it was launched
 */
export declare function cleanupElectron(): void;
/**
 * Run Lighthouse audit using the CLI with a properly configured target URL
 */
export declare function runLighthouse(url: string, options: any): Promise<any>;
