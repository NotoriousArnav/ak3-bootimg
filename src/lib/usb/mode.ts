export type UsbMode = "fastboot" | "adb" | "unknown";

const FASTBOOT_FILTER: USBDeviceFilter = {
  classCode: 0xff,
  subclassCode: 0x42,
  protocolCode: 0x03,
};

const ADB_FILTER: USBDeviceFilter = {
  classCode: 0xff,
  subclassCode: 0x42,
  protocolCode: 0x01,
};

/**
 * A phone exposes a vendor-specific interface with subclass 0x42 in both adb
 * and fastboot modes. The protocol differs: 0x01 for adb, 0x03 for fastboot.
 * Requesting both lets us tell the user which mode the phone is in instead of
 * showing an empty, fastboot-only picker when they are still booted into Android.
 */
export const USB_FILTERS: USBDeviceFilter[] = [FASTBOOT_FILTER, ADB_FILTER];

export async function pickUsbDevice(): Promise<USBDevice | null> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    throw new Error("This browser does not support WebUSB.");
  }
  const paired = await navigator.usb.getDevices();
  if (paired.length === 1) return paired[0];
  return navigator.usb.requestDevice({ filters: USB_FILTERS });
}

export function readUsbMode(device: USBDevice): UsbMode {
  let adb = false;
  for (const configuration of device.configurations) {
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        if (alternate.interfaceClass !== 0xff || alternate.interfaceSubclass !== 0x42) continue;
        if (alternate.interfaceProtocol === 0x03) return "fastboot";
        if (alternate.interfaceProtocol === 0x01) adb = true;
      }
    }
  }
  return adb ? "adb" : "unknown";
}

/**
 * Opens the device just long enough to read its interface descriptors. The
 * caller (or the subsequent fastboot connect) owns the device afterwards.
 */
export async function detectUsbMode(device: USBDevice): Promise<UsbMode> {
  let openedHere = false;
  try {
    if (!device.opened) {
      await device.open();
      openedHere = true;
    }
    return readUsbMode(device);
  } finally {
    if (openedHere) {
      await device.close().catch(() => {});
    }
  }
}
