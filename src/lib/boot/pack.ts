import { align, concatBytes, padded, writeU32, writeU64 } from "../bytes";
import type { BootImage } from "./parse";

export interface PackOptions {
  kernel: Uint8Array;
  /** AVB signatures cover the whole image and cannot survive a kernel swap. */
  stripAvb?: boolean;
  /** GKI boot signatures cover the kernel too, so they are dropped by default. */
  stripSignature?: boolean;
}

export interface PackResult {
  bytes: Uint8Array;
  warnings: string[];
}

async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes as unknown as BufferSource);
  return new Uint8Array(digest);
}

/**
 * Repacks a boot image with a new kernel while preserving every device-specific
 * header field (page size, load addresses, cmdline, os version, header version).
 *
 * Layout matches mkbootimg/AK3: header page, kernel, ramdisk, second stage,
 * recovery dtbo, dtb, each page aligned.
 */
export async function packBootImage(template: BootImage, options: PackOptions): Promise<PackResult> {
  const stripAvb = options.stripAvb ?? true;
  const stripSignature = options.stripSignature ?? true;
  const warnings: string[] = [];

  if (template.avb && !stripAvb) {
    throw new Error(
      "This template has an AVB footer. It cannot be preserved after replacing the kernel — enable AVB stripping instead.",
    );
  }
  if (template.avb) {
    warnings.push(
      "The template had an AVB footer. It was removed because the signature covers the kernel. The device needs a verification-disabled vbmeta to boot this image.",
    );
  }

  const kernel = options.kernel;
  if (kernel.length === 0) throw new Error("Kernel payload is empty");

  if (template.headerVersion >= 3) {
    const pageSize = 4096;
    if (template.headerSize < 1580 || template.headerSize > pageSize) {
      throw new Error(`Invalid v${template.headerVersion} header size ${template.headerSize}`);
    }

    const header = template.headerBytes.slice();
    writeU32(header, 8, kernel.length);
    writeU32(header, 12, template.ramdisk.length);

    let signature = template.signature;
    if (template.headerVersion >= 4) {
      if (signature && stripSignature) {
        warnings.push("The template carried a GKI boot signature. It was removed because it no longer matches the kernel.");
        signature = null;
      }
      writeU32(header, 1580, signature?.length ?? 0);
    }

    const parts = [padded(header, pageSize), padded(kernel, pageSize)];
    if (template.ramdisk.length > 0) parts.push(padded(template.ramdisk, pageSize));
    if (signature) parts.push(padded(signature, pageSize));

    return { bytes: padded(concatBytes(parts), pageSize), warnings };
  }

  // v0/v1/v2: classic header with explicit load addresses.
  const pageSize = template.pageSize;
  const header = template.headerBytes.slice();
  writeU32(header, 8, kernel.length);
  writeU32(header, 16, template.ramdisk.length);
  writeU32(header, 24, template.second?.length ?? 0);

  const kernelOffset = pageSize;
  const ramdiskOffset = align(kernelOffset + kernel.length, pageSize);
  const secondOffset = align(ramdiskOffset + template.ramdisk.length, pageSize);
  const recoveryDtboOffset = align(secondOffset + (template.second?.length ?? 0), pageSize);

  if (template.headerVersion >= 1) {
    writeU32(header, 1632, template.recoveryDtbo?.length ?? 0);
    writeU64(header, 1636, recoveryDtboOffset);
  }
  if (template.headerVersion >= 2) {
    writeU32(header, 1648, template.dtb?.length ?? 0);
  }

  const hash = await sha1(
    concatBytes([
      kernel,
      template.ramdisk,
      template.second ?? new Uint8Array(0),
      template.recoveryDtbo ?? new Uint8Array(0),
      template.dtb ?? new Uint8Array(0),
    ]),
  );
  header.fill(0, 576, 608);
  header.set(hash.subarray(0, 20), 576);

  const parts = [padded(header, pageSize), padded(kernel, pageSize)];
  if (template.ramdisk.length > 0) parts.push(padded(template.ramdisk, pageSize));
  if (template.second) parts.push(padded(template.second, pageSize));
  if (template.recoveryDtbo) parts.push(padded(template.recoveryDtbo, pageSize));
  if (template.dtb) parts.push(padded(template.dtb, pageSize));

  return { bytes: padded(concatBytes(parts), pageSize), warnings };
}
