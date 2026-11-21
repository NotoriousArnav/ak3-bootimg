export const RAMDISK_HELPERS = [
  "replace_string",
  "replace_section",
  "remove_section",
  "insert_line",
  "replace_line",
  "remove_line",
  "prepend_file",
  "insert_file",
  "append_file",
  "replace_file",
  "patch_fstab",
  "patch_cmdline",
  "patch_prop",
  "patch_ueventd",
  "backup_file",
  "restore_file",
  "set_perm",
  "set_perm_recursive",
] as const;

export type TargetPartition =
  | "boot"
  | "init_boot"
  | "vendor_boot"
  | "vendor_kernel_boot"
  | "recovery"
  | "unknown";

export interface AnyKernelInfo {
  kernelString: string | null;
  devices: string[];
  deviceCheck: boolean;
  modules: boolean;
  systemless: boolean;
  block: string | null;
  targetPartition: TargetPartition;
  isSlotDevice: string | null;
  ramdiskCompression: string | null;
  noMagiskCheck: boolean;
  ramdiskEdits: string[];
  hasSplitBoot: boolean;
  hasFlashBoot: boolean;
  hasWriteBoot: boolean;
  hasUnpackRamdisk: boolean;
  hasRepackRamdisk: boolean;
}

function stripLineComments(script: string): string {
  return script
    .split("\n")
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === "'" && !inDouble) inSingle = !inSingle;
        else if (char === '"' && !inSingle) inDouble = !inDouble;
        else if (char === "#" && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

function parseProperties(script: string): Record<string, string> {
  const props: Record<string, string> = {};
  const block = script.match(/properties\s*\(\)\s*\{\s*'([\s\S]*?)'\s*;?\s*\}/);
  const body = block?.[1] ?? "";
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (!match) continue;
    props[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return props;
}

function simpleAssignment(script: string, name: string): string | null {
  const match = script.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*;?\\s*$`, "im"));
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function normalizePartition(block: string | null): TargetPartition {
  if (!block) return "unknown";
  const base = block.split(/\s+/)[0].split("/").pop()?.replace(/;+$/, "").toLowerCase() ?? "";
  if (base.startsWith("$") || base.includes("block")) return "unknown";
  if (base === "boot" || base === "init_boot" || base === "vendor_boot" || base === "vendor_kernel_boot") {
    return base;
  }
  if (base.includes("init_boot")) return "init_boot";
  if (base.includes("vendor_kernel_boot")) return "vendor_kernel_boot";
  if (base.includes("vendor_boot")) return "vendor_boot";
  if (base.includes("recovery")) return "recovery";
  if (base.includes("boot")) return "boot";
  return "unknown";
}

export function parseAnyKernel(script: string): AnyKernelInfo {
  const props = parseProperties(script);
  const code = stripLineComments(script);

  const devices: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const name = (props[`device.name${i}`] ?? "").trim();
    if (name) devices.push(name);
  }

  const edits = new Set<string>();
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    for (const helper of RAMDISK_HELPERS) {
      if (new RegExp(`^${helper}\\b`).test(trimmed)) edits.add(helper);
    }
  }

  const block = simpleAssignment(script, "BLOCK") ?? simpleAssignment(script, "block");
  return {
    kernelString: props["kernel.string"]?.trim() || null,
    devices,
    deviceCheck: (props["do.devicecheck"] ?? "0") === "1",
    modules: (props["do.modules"] ?? "0") === "1",
    systemless: (props["do.systemless"] ?? "0") === "1",
    block,
    targetPartition: normalizePartition(block),
    isSlotDevice: simpleAssignment(script, "is_slot_device") ?? simpleAssignment(script, "IS_SLOT_DEVICE"),
    ramdiskCompression:
      simpleAssignment(script, "ramdisk_compression") ?? simpleAssignment(script, "RAMDISK_COMPRESSION"),
    noMagiskCheck:
      (simpleAssignment(script, "no_magisk_check") ?? simpleAssignment(script, "NO_MAGISK_CHECK") ?? "0") === "1",
    ramdiskEdits: [...edits].sort(),
    hasSplitBoot: /\bsplit_boot\b/.test(code),
    hasFlashBoot: /\bflash_boot\b/.test(code),
    hasWriteBoot: /\bwrite_boot\b/.test(code),
    hasUnpackRamdisk: /\bunpack_ramdisk\b/.test(code),
    hasRepackRamdisk: /\brepack_ramdisk\b/.test(code),
  };
}
