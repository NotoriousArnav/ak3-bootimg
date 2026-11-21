import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { sha256 } from "../bytes";
import { detectCompression, isArm32ZImage, isArm64Image, linuxVersion, type Compression } from "../boot/kernel";
import { parseAnyKernel, type AnyKernelInfo } from "./anykernel";

const KERNEL_PRIORITY = [
  "Image",
  "Image.gz-dtb",
  "Image.gz",
  "Image.lz4",
  "Image.zst",
  "Image.bz2",
  "Image.lzo",
  "Image.lzma",
  "Image.xz",
  "Image.fit",
  "zImage-dtb",
  "zImage",
  "kernel",
];

const EXTRA_IMAGE_NAMES = [
  "dtbo.img",
  "dtbo",
  "dtb.img",
  "dtb",
  "vendor_dlkm.img",
  "vendor_dlkm",
  "system_dlkm.img",
  "system_dlkm",
  "recovery_dtbo",
  "vendor_boot.img",
];

export interface KernelPayload {
  name: string;
  bytes: Uint8Array;
  compression: Compression;
  sha256: string;
  arm64: boolean;
  arm32: boolean;
  linuxVersion: string | null;
}

export interface ExtraImage {
  name: string;
  size: number;
}

export interface Ak3Package {
  fileName: string;
  entryCount: number;
  anykernel: AnyKernelInfo;
  script: string;
  kernel: KernelPayload;
  extras: ExtraImage[];
  ramdiskFiles: string[];
  moduleFiles: string[];
  hasVendorRamdisk: boolean;
  hasPatchDir: boolean;
  banner: string | null;
}

export async function readAk3Zip(data: Uint8Array, fileName = "package.zip"): Promise<Ak3Package> {
  const reader = new ZipReader(new BlobReader(new Blob([data as unknown as BlobPart])));
  const entries = await reader.getEntries();
  const files = entries.filter((entry) => !entry.directory);
  const names = files.map((entry) => entry.filename);
  const nameSet = new Set(names);

  const scriptEntry = files.find((entry) => entry.filename === "anykernel.sh");
  if (!scriptEntry) {
    await reader.close();
    throw new Error(
      "This does not look like an AnyKernel zip: anykernel.sh is missing at the root. (Kernel images and boot.img files are not zips.)",
    );
  }

  const kernelName = KERNEL_PRIORITY.find((name) => nameSet.has(name));
  if (!kernelName) {
    await reader.close();
    throw new Error(
      "No kernel payload found in the zip root. Expected one of Image, Image.gz, Image.lz4, Image.zst, zImage, or kernel.",
    );
  }

  const script = await scriptEntry.getData!(new TextWriter());
  const kernelEntry = files.find((entry) => entry.filename === kernelName)!;
  const kernelBytes = await kernelEntry.getData!(new Uint8ArrayWriter());

  const bannerEntry = files.find((entry) => entry.filename === "banner");
  const banner = bannerEntry ? (await bannerEntry.getData!(new TextWriter())).trim() : null;

  const packageFiles = {
    fileName,
    entryCount: files.length,
    anykernel: parseAnyKernel(script),
    script,
    kernel: {
      name: kernelName,
      bytes: kernelBytes,
      compression: detectCompression(kernelBytes),
      sha256: await sha256(kernelBytes),
      arm64: isArm64Image(kernelBytes),
      arm32: isArm32ZImage(kernelBytes),
      linuxVersion: linuxVersion(kernelBytes),
    },
    extras: files
      .filter((entry) => EXTRA_IMAGE_NAMES.includes(entry.filename))
      .map((entry) => ({ name: entry.filename, size: entry.uncompressedSize })),
    ramdiskFiles: names.filter((name) => name.startsWith("ramdisk/")),
    moduleFiles: names.filter((name) => name.startsWith("modules/")),
    hasVendorRamdisk: names.some((name) => name.startsWith("vendor_ramdisk")),
    hasPatchDir: names.some((name) => name.startsWith("patch/")),
    banner,
  };

  await reader.close();
  return packageFiles;
}
