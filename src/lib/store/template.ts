import { del, get, set } from "idb-keyval";

const TEMPLATE_KEY = "ak2b:template";

export interface StoredTemplate {
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

export async function saveTemplate(name: string, bytes: Uint8Array): Promise<void> {
  const record: StoredTemplate = {
    name,
    bytes: bytes.slice().buffer as ArrayBuffer,
    savedAt: Date.now(),
  };
  await set(TEMPLATE_KEY, record);
}

export async function loadTemplate(): Promise<StoredTemplate | null> {
  const record = await get<StoredTemplate>(TEMPLATE_KEY);
  return record?.bytes instanceof ArrayBuffer ? record : null;
}

export async function clearTemplate(): Promise<void> {
  await del(TEMPLATE_KEY);
}
