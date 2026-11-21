declare module "android-fastboot" {
  export class FastbootDevice {
    constructor();
    readonly isConnected: boolean;
    connect(): Promise<void>;
    runCommand(command: string): Promise<string>;
    getVariable(name: string): Promise<string | null>;
    flashBlob(partition: string, blob: Blob, onProgress?: (progress: number) => void): Promise<void>;
    reboot(target?: string, wait?: boolean, onReconnect?: () => void): Promise<void>;
  }
  export class FastbootError extends Error {}
  export class UsbError extends Error {}
  export class TimeoutError extends Error {}
  export function setDebugLevel(level: number): void;
}
