export function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

export function readU64(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Number(view.getBigUint64(offset, true));
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

export function writeU64(bytes: Uint8Array, offset: number, value: number | bigint): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, BigInt(value), true);
}

export function align(value: number, boundary: number): number {
  if (boundary <= 1) return value;
  return Math.ceil(value / boundary) * boundary;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function padded(bytes: Uint8Array, boundary: number): Uint8Array {
  const length = align(bytes.length, boundary);
  if (length === bytes.length) return bytes;
  const out = new Uint8Array(length);
  out.set(bytes);
  return out;
}

export function trimZeros(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.subarray(0, end);
}

export function cString(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end++;
  return new TextDecoder()
    .decode(slice.subarray(0, end))
    .replace(/\u0000/g, "")
    .trim();
}

export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  if (needle.length === 0) return start;
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Reads a printable ASCII run after a marker, e.g. the kernel version string. */
export function asciiRunAfter(bytes: Uint8Array, marker: string, maxLength = 260): string | null {
  const needle = new TextEncoder().encode(marker);
  const index = indexOfBytes(bytes, needle);
  if (index < 0) return null;
  const start = index + needle.length;
  let end = start;
  while (end < bytes.length && end - start < maxLength) {
    const code = bytes[end];
    if (code === 0 || code === 10 || code === 13) break;
    if (code < 0x20 || code > 0x7e) break;
    end++;
  }
  return end > start ? new TextDecoder("latin1").decode(bytes.subarray(start, end)) : null;
}

export function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return hex(new Uint8Array(digest));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
