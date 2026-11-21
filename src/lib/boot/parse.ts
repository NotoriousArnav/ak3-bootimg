import { align, cString, formatBytes, readU32, readU64, trimZeros } from "../bytes";

export interface AvbFooter {
  present: true;
  footerOffset: number;
  versionMajor: number;
  versionMinor: number;
  originalImageSize: number;
  vbmetaOffset: number;
  vbmetaSize: number;
}

export interface Segment {
  name: string;
  offset: number;
  size: number;
}

export interface BootImage {
  headerVersion: number;
  headerSize: number;
  pageSize: number;
  osVersion: number;
  osText: string;
  cmdline: string;
  name: string;
  kernel: Uint8Array;
  ramdisk: Uint8Array;
  second: Uint8Array | null;
  recoveryDtbo: Uint8Array | null;
  dtb: Uint8Array | null;
  signature: Uint8Array | null;
  headerBytes: Uint8Array;
  id: Uint8Array | null;
  avb: AvbFooter | null;
  fileSize: number;
  layout: Segment[];
  isV4: boolean;
}

export function osVersionText(value: number): string {
  if (!value) return "unset";
  const major = (value >> 25) & 0x7f;
  const minor = (value >> 18) & 0x7f;
  const patch = (value >> 11) & 0x7f;
  const year = ((value >> 4) & 0x7f) + 2000;
  const month = value & 0xf;
  return `${major}.${minor}.${patch} (patch ${year}-${String(month).padStart(2, "0")})`;
}

export function parseAvbFooter(bytes: Uint8Array): AvbFooter | null {
  if (bytes.length < 64) return null;
  const offset = bytes.length - 64;
  if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== "AVBf") return null;
  return {
    present: true,
    footerOffset: offset,
    versionMajor: readU32(bytes, offset + 4),
    versionMinor: readU32(bytes, offset + 8),
    originalImageSize: readU64(bytes, offset + 12),
    vbmetaOffset: readU64(bytes, offset + 20),
    vbmetaSize: readU64(bytes, offset + 28),
  };
}

function slice(bytes: Uint8Array, offset: number, size: number, label: string): Uint8Array {
  if (size === 0) return new Uint8Array(0);
  if (offset < 0 || size < 0 || offset + size > bytes.length) {
    throw new Error(
      `${label} extends past the end of the image (offset ${offset}, size ${size}, file ${bytes.length})`,
    );
  }
  return bytes.subarray(offset, offset + size);
}

function optional(bytes: Uint8Array, offset: number, size: number, label: string): Uint8Array | null {
  return size > 0 ? slice(bytes, offset, size, label) : null;
}

export function parseBootImage(bytes: Uint8Array): BootImage {
  if (bytes.length < 48) throw new Error("File is too small to be an Android boot image");
  const magic = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (magic === "VNDRBOOT") {
    throw new Error(
      "This is a vendor_boot.img, not a boot.img. For GKI devices the kernel lives in boot.img; vendor_boot carries the vendor ramdisk and DTB and is flashed separately.",
    );
  }
  if (magic.startsWith("AVB0")) {
    throw new Error("This is a vbmeta image, not a boot image.");
  }
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
    throw new Error(
      "This looks like a kernel Image (PE/MZ executable), not a boot image. Step 2 needs the stock or known-good boot.img that the kernel will be packed into.",
    );
  }
  if (magic !== "ANDROID!") {
    throw new Error(
      "Not an Android boot image (expected the ANDROID! magic). Extract boot.img from your firmware package — vendor_boot and init_boot are different images.",
    );
  }

  const headerVersion = readU32(bytes, 40);
  if (headerVersion > 4) throw new Error(`Unsupported boot header version ${headerVersion}`);

  const avb = parseAvbFooter(bytes);
  const layout: Segment[] = [];

  if (headerVersion >= 3) {
    const pageSize = 4096;
    const headerSize = readU32(bytes, 20);
    const kernelSize = readU32(bytes, 8);
    const ramdiskSize = readU32(bytes, 12);
    const signatureSize = headerVersion >= 4 ? readU32(bytes, 1580) : 0;

    const kernelOffset = pageSize;
    const ramdiskOffset = align(kernelOffset + kernelSize, pageSize);
    const signatureOffset = align(ramdiskOffset + ramdiskSize, pageSize);

    const kernel = slice(bytes, kernelOffset, kernelSize, "Kernel");
    const ramdisk = slice(bytes, ramdiskOffset, ramdiskSize, "Ramdisk");
    const signature = optional(bytes, signatureOffset, signatureSize, "Boot signature");

    layout.push(
      { name: "Header", offset: 0, size: headerSize },
      { name: "Kernel", offset: kernelOffset, size: kernelSize },
      { name: "Ramdisk", offset: ramdiskOffset, size: ramdiskSize },
    );
    if (signatureSize > 0) layout.push({ name: "Boot signature", offset: signatureOffset, size: signatureSize });

    return {
      headerVersion,
      headerSize,
      pageSize,
      osVersion: readU32(bytes, 16),
      osText: osVersionText(readU32(bytes, 16)),
      cmdline: cString(bytes, 44, 1536),
      name: "",
      kernel,
      ramdisk,
      second: null,
      recoveryDtbo: null,
      dtb: null,
      signature,
      headerBytes: bytes.slice(0, Math.max(headerSize, 48)),
      id: null,
      avb,
      fileSize: bytes.length,
      layout,
      isV4: headerVersion >= 4,
    };
  }

  const pageSize = readU32(bytes, 36);
  if (![2048, 4096, 8192, 16384].includes(pageSize)) {
    throw new Error(`Invalid page size ${pageSize} in boot header`);
  }

  const kernelSize = readU32(bytes, 8);
  const ramdiskSize = readU32(bytes, 16);
  const secondSize = readU32(bytes, 24);
  const headerSize = headerVersion === 0 ? 1632 : readU32(bytes, 1644);
  const recoveryDtboSize = headerVersion >= 1 ? readU32(bytes, 1632) : 0;
  const dtbSize = headerVersion >= 2 ? readU32(bytes, 1648) : 0;

  const kernelOffset = pageSize;
  const ramdiskOffset = align(kernelOffset + kernelSize, pageSize);
  const secondOffset = align(ramdiskOffset + ramdiskSize, pageSize);
  const recoveryDtboOffset =
    headerVersion >= 1 ? readU64(bytes, 1636) || align(secondOffset + secondSize, pageSize) : 0;
  const dtbOffset = align(recoveryDtboOffset + recoveryDtboSize, pageSize);

  const kernel = slice(bytes, kernelOffset, kernelSize, "Kernel");
  const ramdisk = slice(bytes, ramdiskOffset, ramdiskSize, "Ramdisk");
  const second = optional(bytes, secondOffset, secondSize, "Second stage");
  const recoveryDtbo = optional(bytes, recoveryDtboOffset, recoveryDtboSize, "Recovery DTBO");
  const dtb = optional(bytes, dtbOffset, dtbSize, "DTB");
  const id = bytes.slice(576, 608);
  const cmdline = `${cString(bytes, 64, 512)} ${cString(bytes, 608, 1024)}`.trim();

  layout.push(
    { name: "Header", offset: 0, size: headerSize },
    { name: "Kernel", offset: kernelOffset, size: kernelSize },
    { name: "Ramdisk", offset: ramdiskOffset, size: ramdiskSize },
  );
  if (secondSize) layout.push({ name: "Second stage", offset: secondOffset, size: secondSize });
  if (recoveryDtboSize) layout.push({ name: "Recovery DTBO", offset: recoveryDtboOffset, size: recoveryDtboSize });
  if (dtbSize) layout.push({ name: "DTB", offset: dtbOffset, size: dtbSize });

  return {
    headerVersion,
    headerSize,
    pageSize,
    osVersion: readU32(bytes, 44),
    osText: osVersionText(readU32(bytes, 44)),
    cmdline,
    name: cString(bytes, 48, 16),
    kernel,
    ramdisk,
    second,
    recoveryDtbo,
    dtb,
    signature: null,
    headerBytes: bytes.slice(0, headerSize),
    id,
    avb,
    fileSize: bytes.length,
    layout,
    isV4: false,
  };
}

export function describeBootImage(image: BootImage) {
  return {
    headerVersion: image.headerVersion,
    headerSize: image.headerSize,
    pageSize: image.pageSize,
    osVersion: image.osText,
    cmdline: image.cmdline,
    kernelSize: image.kernel.length,
    ramdiskSize: image.ramdisk.length,
    signatureSize: image.signature?.length ?? 0,
    avb: image.avb !== null,
    avbOriginalSize: image.avb?.originalImageSize ?? null,
    fileSize: image.fileSize,
    fileSizeText: formatBytes(image.fileSize),
    layout: image.layout,
    isV4: image.isV4,
    kernelIsEmpty: image.kernel.length === 0,
    ramdiskIsEmpty: image.ramdisk.length === 0,
    id: image.id ? Array.from(image.id.subarray(0, 20)).map((b) => b.toString(16).padStart(2, "0")).join("") : null,
  };
}

export function stripTrailingZeros(bytes: Uint8Array): Uint8Array {
  return trimZeros(bytes);
}
