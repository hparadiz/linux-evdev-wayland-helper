export declare function discoverEventDevices(devInputPath?: string): string[];
export declare function checkDevicePermissions(devices: string[]): Array<{
    path: string;
    readable: boolean;
    error?: string;
}>;
