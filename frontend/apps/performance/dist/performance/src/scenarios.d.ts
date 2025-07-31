import { PerformanceScenario } from "./perf-utils";
/**
 * Collection of performance test scenarios
 */
export declare const appStartupScenario: PerformanceScenario;
export declare const libraryScenario: PerformanceScenario;
export declare const navigationScenario: PerformanceScenario;
export declare const heavyOperationScenario: PerformanceScenario;
export declare const ipcCommunicationScenario: PerformanceScenario;
export declare const memoryUsageScenario: PerformanceScenario;
export declare const windowManagementScenario: PerformanceScenario;
export declare const largeContentScenario: PerformanceScenario;
export declare const allScenarios: PerformanceScenario[];
export declare function getScenarioByName(name: string): PerformanceScenario | undefined;
