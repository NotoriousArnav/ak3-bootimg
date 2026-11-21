import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { align, concatBytes, padded, writeU32 } from "../bytes";
import { describeBootImage, parseBootImage } from "./parse";
import { packBootImage } from "./pack";
import { convertAk3 } from "../convert/convert";

const TEMPLATE = "temp/custom_boot.img";
const AK3_ZIP = "temp/wild-6.6.118-ksun.zip";

function synthV4(kernel: Uint8Array): Uint8Array {
  const pageSize = 4096;
  const header = new Uint8Array(1584);
  header.set(new TextEncoder().encode("ANDROID!"), 0);
  writeU32(header, 8, kernel.length);
  writeU32(header, 12, 0);
  writeU32(header, 16, 0);
  writeU32(header, 20, 1584);
  writeU32(header, 40, 4);
  writeU32(header, 1580, 0);
  return padded(concatBytes([padded(header, pageSize), kernel]), pageSize);
}

function synthV0(kernel: Uint8Array, ramdisk: Uint8Array): Uint8Array {
  const pageSize = 2048;
  const header = new Uint8Array(1632);
  header.set(new TextEncoder().encode("ANDROID!"), 0);
  writeU32(header, 8, kernel.length);
  writeU32(header, 12, 0x10008000);
  writeU32(header, 16, ramdisk.length);
  writeU32(header, 20, 0x11000000);
  writeU32(header, 24, 0);
  writeU32(header, 28, 0x10000100);
  writeU32(header, 32, 0x10000000);
  writeU32(header, 36, pageSize);
  writeU32(header, 40, 0);
  writeU32(header, 44, 0);
  return padded(
    concatBytes([padded(header, pageSize), padTo(kernel, pageSize), padTo(ramdisk, pageSize)]),
    pageSize,
  );
}

function padTo(bytes: Uint8Array, boundary: number): Uint8Array {
  return padded(bytes, boundary);
}

describe("v4 boot image", () => {
  it("reparses a synthetic image and preserves the exact layout", () => {
    const kernel = new Uint8Array(9000).map((_, index) => index & 0xff);
    const image = parseBootImage(synthV4(kernel));
    expect(image.headerVersion).toBe(4);
    expect(image.headerSize).toBe(1584);
    expect(image.pageSize).toBe(4096);
    expect(image.kernel).toEqual(kernel);
    expect(image.ramdisk.length).toBe(0);
    expect(image.signature).toBeNull();

    const described = describeBootImage(image);
    expect(described.fileSize).toBe(align(1584, 4096) + align(kernel.length, 4096));
    expect(described.layout.map((segment) => segment.name)).toEqual(["Header", "Kernel", "Ramdisk"]);
  });

  it("repacks an unchanged kernel byte-for-byte", async () => {
    const kernel = new Uint8Array(4096 * 3 + 17).map((_, index) => (index * 7) & 0xff);
    const original = synthV4(kernel);
    const packed = await packBootImage(parseBootImage(original), { kernel });
    expect(packed.warnings).toEqual([]);
    expect(Buffer.from(packed.bytes).equals(Buffer.from(original))).toBe(true);
  });

  it("rejects vendor_boot and plain kernel payloads", () => {
    const vendor = new Uint8Array(4096);
    vendor.set(new TextEncoder().encode("VNDRBOOT"));
    expect(() => parseBootImage(vendor)).toThrow(/vendor_boot/);

    const kernel = new Uint8Array(4096);
    kernel[0] = 0x4d;
    kernel[1] = 0x5a;
    expect(() => parseBootImage(kernel)).toThrow(/kernel Image/);
  });
});

describe("v0 boot image", () => {
  it("computes page-aligned offsets for a new kernel size", async () => {
    const kernel = new Uint8Array(5000).fill(0x41);
    const ramdisk = new Uint8Array(700).fill(0x42);
    const template = parseBootImage(synthV0(kernel, ramdisk));
    expect(template.headerVersion).toBe(0);
    expect(template.pageSize).toBe(2048);
    expect(template.ramdisk).toEqual(ramdisk);

    const biggerKernel = new Uint8Array(9000).fill(0x43);
    const packed = await packBootImage(template, { kernel: biggerKernel });
    const output = parseBootImage(packed.bytes);
    expect(output.headerVersion).toBe(0);
    expect(output.kernel).toEqual(biggerKernel);
    expect(output.ramdisk).toEqual(ramdisk);
    expect(output.fileSize % 2048).toBe(0);

    const kernelSegment = output.layout.find((segment) => segment.name === "Kernel")!;
    const ramdiskSegment = output.layout.find((segment) => segment.name === "Ramdisk")!;
    expect(kernelSegment.offset).toBe(2048);
    expect(ramdiskSegment.offset).toBe(2048 + align(biggerKernel.length, 2048));
  });
});

describe.skipIf(!existsSync(TEMPLATE) || !existsSync(AK3_ZIP))("real portov fixtures", () => {
  it("reproduces the known-good template byte-for-byte", async () => {
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    const parsed = parseBootImage(bytes);
    const packed = await packBootImage(parsed, { kernel: parsed.kernel });
    expect(Buffer.from(packed.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("converts the WildKernels AnyKernel3 zip into a v4 kernel-only image", async () => {
    const zip = new Uint8Array(readFileSync(AK3_ZIP));
    const template = new Uint8Array(readFileSync(TEMPLATE));
    const result = await convertAk3({ zip, template, zipName: "wild.zip", templateName: "custom_boot.img" });

    expect(result.report.output.headerVersion).toBe(4);
    expect(result.report.output.pageSize).toBe(4096);
    expect(result.report.output.ramdiskSize).toBe(0);
    expect(result.report.output.avb).toBe(false);
    expect(result.report.kernel.arm64).toBe(true);
    expect(result.report.kernel.linuxVersion).toMatch(/^6\.6\./);
    expect(result.bootImg.length % 4096).toBe(0);

    const reparsed = parseBootImage(result.bootImg);
    expect(reparsed.kernel.length).toBe(result.report.output.kernelSize);
    expect(reparsed.kernel.length).toBe(result.report.kernel.sourceSize);
  });
});
