import { asciiRunAfter, readU32 } from "../bytes";

export type Compression = "raw" | "gzip" | "lz4" | "zstd" | "xz" | "bzip2" | "lzma" | "unknown";

export function detectCompression(bytes: Uint8Array): Compression {
  if (bytes.length < 4) return "unknown";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return "zstd";
  if (bytes[0] === 0x04 && bytes[1] === 0x22 && bytes[2] === 0x4d && bytes[3] === 0x18) return "lz4";
  if (bytes[0] === 0x02 && bytes[1] === 0x21 && bytes[2] === 0x4c && bytes[3] === 0x18) return "lz4";
  if (bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a && bytes[3] === 0x58) return "xz";
  if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) return "bzip2";
  if (bytes[0] === 0x5d && bytes[1] === 0x00 && bytes[2] === 0x00) return "lzma";
  return "raw";
}

export function isArm64Image(bytes: Uint8Array): boolean {
  return bytes.length > 60 && readU32(bytes, 56) === 0x644d5241;
}

export function isArm32ZImage(bytes: Uint8Array): boolean {
  return bytes.length > 40 && readU32(bytes, 0x24) === 0x016f2818;
}

export function linuxVersion(bytes: Uint8Array): string | null {
  return asciiRunAfter(bytes, "Linux version ");
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress gzip payloads. Use a zip with a raw Image payload.");
  }
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function normalizeKernelPayload(
  bytes: Uint8Array,
  compression: Compression,
): Promise<{ bytes: Uint8Array; compression: Compression; note: string | null }> {
  if (compression === "raw") return { bytes, compression, note: null };
  if (compression === "gzip") {
    const out = await gunzip(bytes);
    return {
      bytes: out,
      compression: "gzip",
      note: "Kernel payload was gzip-compressed and has been decompressed before packing.",
    };
  }
  throw new Error(
    `Kernel payload uses ${compression} compression, which is not supported yet. Use a zip that ships a raw Image, or wait for the magiskboot.wasm engine.`,
  );
}
