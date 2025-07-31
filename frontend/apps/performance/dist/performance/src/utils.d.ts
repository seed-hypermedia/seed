export declare function findLatestBuild(): string;
export declare function startApp(): Promise<{
    getWindow: () => Promise<any>;
    appInfo: import("../../desktop/test/types").ElectronAppInfo;
    app: any;
    appWindow: any;
}>;
