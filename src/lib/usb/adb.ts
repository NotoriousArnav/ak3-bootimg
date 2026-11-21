import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  AdbDaemonWebUsbDevice,
  AdbDefaultInterfaceFilter,
  findUsbInterface,
} from "@yume-chan/adb-daemon-webusb";

export interface AdbConnection {
  serial: string;
  /** Equivalent to `adb reboot bootloader`. */
  rebootBootloader(): Promise<void>;
  close(): Promise<void>;
}

const credentialStore = new AdbWebCredentialStore("ak3-bootimg");

/**
 * Connect to a phone that is already booted into Android with USB debugging
 * enabled. The caller keeps ownership of the underlying `USBDevice`; closing
 * the returned connection only releases the adb transport.
 */
export async function connectAdb(usb: USBDevice): Promise<AdbConnection> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    throw new Error("This browser does not support WebUSB.");
  }

  const iface = findUsbInterface(usb, AdbDefaultInterfaceFilter);
  if (!iface) {
    throw new Error("The selected device does not expose an ADB interface.");
  }

  const device = new AdbDaemonWebUsbDevice(usb, iface, navigator.usb);
  const connection = await device.connect();

  let transport: AdbDaemonTransport;
  try {
    transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore,
    });
  } catch (cause) {
    // authenticate() deliberately keeps the connection open so it can be
    // retried. Release the USB interface ourselves before giving up.
    await usb.close().catch(() => {});
    throw cause;
  }

  const adb = new Adb(transport);
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    try {
      await transport.close();
    } catch {
      // The phone may already be rebooting; closing again is unnecessary.
    }
  }

  return {
    serial: transport.serial,
    async rebootBootloader() {
      await adb.power.bootloader();
    },
    close,
  };
}
