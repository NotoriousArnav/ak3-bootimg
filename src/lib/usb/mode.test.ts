import { describe, expect, it, vi } from "vitest";
import { detectUsbMode, readUsbMode, type UsbMode } from "./mode";

function fakeDevice(protocols: number[], opened = true) {
  const device = {
    opened,
    open: vi.fn(async () => {
      device.opened = true;
    }),
    close: vi.fn(async () => {
      device.opened = false;
    }),
    configurations: [
      {
        interfaces: protocols.map((protocol) => ({
          alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: protocol }],
        })),
      },
    ],
  };
  return device as unknown as USBDevice & {
    opened: boolean;
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

describe("readUsbMode", () => {
  it("recognizes fastboot and adb interfaces", () => {
    const cases: [number[], UsbMode][] = [
      [[0x03], "fastboot"],
      [[0x01], "adb"],
      [[0x01, 0x03], "fastboot"],
      [[0x02], "unknown"],
      [[], "unknown"],
    ];
    for (const [protocols, expected] of cases) {
      expect(readUsbMode(fakeDevice(protocols))).toBe(expected);
    }
  });

  it("ignores non-Android vendor interfaces", () => {
    const device = {
      configurations: [
        {
          interfaces: [
            { alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x00, interfaceProtocol: 0x03 }] },
          ],
        },
      ],
    } as unknown as USBDevice;
    expect(readUsbMode(device)).toBe("unknown");
  });
});

describe("detectUsbMode", () => {
  it("opens a closed device only for inspection and closes it again", async () => {
    const device = fakeDevice([0x03], false);
    const mode = await detectUsbMode(device);
    expect(mode).toBe("fastboot");
    expect(device.open).toHaveBeenCalledOnce();
    expect(device.close).toHaveBeenCalledOnce();
    expect(device.opened).toBe(false);
  });

  it("leaves an already-open device open", async () => {
    const device = fakeDevice([0x01], true);
    const mode = await detectUsbMode(device);
    expect(mode).toBe("adb");
    expect(device.open).not.toHaveBeenCalled();
    expect(device.close).not.toHaveBeenCalled();
    expect(device.opened).toBe(true);
  });
});
