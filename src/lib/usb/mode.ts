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

function usbSummary(device: USBDevice) {
  return {
    product: device.productName,
    manufacturer: device.manufacturerName,
    serial: device.serialNumber,
    opened: device.opened,
    configurations: device.configurations.length,
  };
}

export async function pickUsbDevice(): Promise<USBDevice | null> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    throw new Error("This browser does not support WebUSB.");
  }
  const paired = await navigator.usb.getDevices();
  console.debug("[ak3-usb] paired devices", paired.map(usbSummary));
  if (paired.length === 1) {
    console.info("[ak3-usb] reusing paired device", usbSummary(paired[0]));
    return paired[0];
  }
  console.info("[ak3-usb] requesting device", USB_FILTERS);
  const device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
  console.info("[ak3-usb] selected device", usbSummary(device));
  return device;
}

export function readUsbMode(device: USBDevice): UsbMode {
  let adb = false;
  const matches: Array<{ configuration: number; interface: number; alternate: number; class: number; subclass: number; protocol: number }> = [];
  for (const configuration of device.configurations) {
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        if (alternate.interfaceClass !== 0xff || alternate.interfaceSubclass !== 0x42) continue;
        matches.push({
          configuration: configuration.configurationValue,
          interface: iface.interfaceNumber,
          alternate: alternate.alternateSetting,
          class: alternate.interfaceClass,
          subclass: alternate.interfaceSubclass,
          protocol: alternate.interfaceProtocol,
        });
        if (alternate.interfaceProtocol === 0x03) {
          console.info("[ak3-usb] detected fastboot interface", matches.at(-1));
          return "fastboot";
        }
        if (alternate.interfaceProtocol === 0x01) adb = true;
      }
    }
  }
  console.info("[ak3-usb] interface scan", { matches, adb, configurations: device.configurations.length });
  return adb ? "adb" : "unknown";
}

/**
 * Opens the device just long enough to read its interface descriptors.
 * By default it closes the device again if it opened it. Set `keepOpen` to
 * leave it open for a caller that will immediately take over (e.g. fastboot),
 * avoiding an extra close/open/reset cycle that can trip some bootloaders.
 */
export async function detectUsbMode(device: USBDevice, options?: { keepOpen?: boolean }): Promise<UsbMode> {
  let openedHere = false;
  console.debug("[ak3-usb] detectUsbMode start", usbSummary(device), options);
  try {
    if (!device.opened) {
      console.debug("[ak3-usb] opening device for descriptor read");
      await device.open();
      openedHere = true;
      console.debug("[ak3-usb] device opened", usbSummary(device));
    }
    const mode = readUsbMode(device);
    console.info("[ak3-usb] detected mode", mode, usbSummary(device));
    return mode;
  } finally {
    if (openedHere && !options?.keepOpen) {
      console.debug("[ak3-usb] closing device after descriptor read");
      try {
        await device.close();
        console.debug("[ak3-usb] device closed after descriptor read", usbSummary(device));
      } catch (error) {
        console.warn("[ak3-usb] failed to close device after descriptor read", error);
      }
    } else if (openedHere) {
      console.debug("[ak3-usb] leaving device open after descriptor read", usbSummary(device));
    }
  }
}
