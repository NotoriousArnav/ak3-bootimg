import { formatBytes, sha256 } from "../bytes";
import { readAk3Zip } from "../ak3/zip";
import { normalizeKernelPayload, linuxVersion } from "../boot/kernel";
import { describeBootImage, parseBootImage } from "../boot/parse";
import { packBootImage } from "../boot/pack";
import type { ConversionReport, ConvertInput, ConvertResult, ProgressFn } from "./types";

function kernelTriple(version: string | null): { base: string; android: number | null } | null {
  if (!version) return null;
  const match = version.match(/(\d+\.\d+\.\d+)(?:-android(\d+))?/);
  if (!match) return null;
  return { base: match[1], android: match[2] ? Number(match[2]) : null };
}

function summarize(image: ReturnType<typeof parseBootImage>): ConversionReport["template"] {
  const described = describeBootImage(image);
  return {
    headerVersion: described.headerVersion,
    headerSize: described.headerSize,
    pageSize: described.pageSize,
    osVersion: described.osVersion,
    cmdline: described.cmdline,
    kernelSize: described.kernelSize,
    ramdiskSize: described.ramdiskSize,
    signatureSize: described.signatureSize,
    avb: described.avb,
    fileSize: described.fileSize,
    layout: described.layout,
  };
}

export async function convertAk3(
  input: ConvertInput,
  onProgress: ProgressFn = () => {},
): Promise<ConvertResult> {
  const started = performance.now();
  const warnings: string[] = [];
  const notes: string[] = [];

  onProgress(4, "Reading AnyKernel zip");
  const pkg = await readAk3Zip(input.zip, input.zipName);

  onProgress(24, "Parsing template boot image");
  const template = parseBootImage(input.template);
  const templateKernelVersion = linuxVersion(template.kernel);

  onProgress(40, "Checking payload");
  if (template.isV4 && !pkg.kernel.arm64) {
    throw new Error(
      `The zip payload (${pkg.kernel.name}) is not an arm64 Image, but the template is a GKI v4 boot image. This zip targets a different device family.`,
    );
  }
  if (!pkg.kernel.arm64 && !pkg.kernel.arm32) {
    throw new Error(
      `The zip payload (${pkg.kernel.name}) does not look like an arm64 Image or an arm32 zImage. Refusing to pack it.`,
    );
  }

  onProgress(52, "Preparing kernel");
  const normalized = await normalizeKernelPayload(pkg.kernel.bytes, pkg.kernel.compression);
  if (normalized.note) notes.push(normalized.note);
  if (pkg.kernel.name.endsWith("-dtb") && template.isV4) {
    warnings.push(
      `The zip payload (${pkg.kernel.name}) is a combined kernel + DTB. On header v4 devices the DTB belongs in vendor_boot, so the combined image may not boot. Prefer a zip that ships a plain Image.`,
    );
  }

  onProgress(66, "Packing boot image");
  const packed = await packBootImage(template, {
    kernel: normalized.bytes,
    stripAvb: true,
    stripSignature: true,
  });
  warnings.push(...packed.warnings);

  onProgress(84, "Verifying output");
  const reparsed = parseBootImage(packed.bytes);
  if (reparsed.headerVersion !== template.headerVersion) {
    throw new Error("Internal error: output header version changed during packing");
  }
  if (reparsed.kernel.length !== normalized.bytes.length) {
    throw new Error("Internal error: output kernel size does not match the payload");
  }
  if (reparsed.ramdisk.length !== template.ramdisk.length) {
    throw new Error("Internal error: ramdisk changed during packing");
  }
  if (packed.bytes.length % reparsed.pageSize !== 0) {
    throw new Error("Internal error: output is not page aligned");
  }

  const outputSha256 = await sha256(packed.bytes);
  onProgress(94, "Building report");

  const ak3 = pkg.anykernel;
  if (ak3.ramdiskEdits.length > 0) {
    warnings.push(
      `This zip modifies the ramdisk (${ak3.ramdiskEdits.join(", ")}). Those edits are NOT applied by this build — the template ramdisk is preserved unchanged. If the kernel depends on them, it may not boot.`,
    );
  }
  if (pkg.ramdiskFiles.length > 0) {
    warnings.push(
      `This zip adds ${pkg.ramdiskFiles.length} file(s) under /ramdisk. They are NOT injected in this build.`,
    );
  }
  if (ak3.modules || pkg.moduleFiles.length > 0) {
    warnings.push(
      "This zip ships kernel modules. A standalone boot image cannot install them; modules are normally flashed to /data or vendor_dlkm by AK3.",
    );
  }
  if (pkg.extras.length > 0) {
    notes.push(
      `The zip also contains ${pkg.extras.map((extra) => extra.name).join(", ")}. These are separate partitions and are not included in boot.img.`,
    );
  }
  if (pkg.hasVendorRamdisk) {
    notes.push("The zip contains vendor_ramdisk files. They are ignored for this boot image.");
  }
  if (ak3.targetPartition === "init_boot" && template.isV4 && template.kernel.length > 0) {
    warnings.push(
      "anykernel.sh targets init_boot, but the template looks like a boot.img (it contains a kernel). Use the stock init_boot.img as the template for this zip.",
    );
  }
  if (
    ak3.targetPartition === "vendor_boot" ||
    ak3.targetPartition === "vendor_kernel_boot" ||
    ak3.targetPartition === "recovery"
  ) {
    warnings.push(
      `anykernel.sh targets ${ak3.targetPartition}, but this tool only builds boot.img / init_boot.img. The kernel may be packed into the wrong header layout. Do not flash the result unless you are certain it matches your device.`,
    );
  }
  if (ak3.targetPartition === "unknown" && ak3.block) {
    notes.push(`Could not determine the target partition from BLOCK=${ak3.block}. Defaulting to boot.img semantics.`);
  }
  if (!ak3.deviceCheck) {
    notes.push("This zip performs no device check (do.devicecheck=0). Confirm the output is for your exact device.");
  } else if (ak3.devices.length > 0) {
    notes.push(`Zip supports: ${ak3.devices.join(", ")}.`);
  }
  if (template.ramdisk.length > 0) {
    notes.push("Template ramdisk preserved unchanged.");
  }
  if (template.isV4 && template.ramdisk.length === 0) {
    notes.push("Template is a kernel-only GKI v4 boot image; the generic ramdisk stays in init_boot.img.");
  }

  const before = kernelTriple(templateKernelVersion);
  const after = kernelTriple(pkg.kernel.linuxVersion);
  if (before && after) {
    if (before.base !== after.base) {
      warnings.push(
        `Kernel version changed: template ${before.base} → payload ${after.base}. Make sure the payload matches your device's KMI (GKI branch).`,
      );
    } else if (before.android !== after.android) {
      notes.push(`Kernel patch level changed within the same KMI: ${before.base} → ${after.base}.`);
    }
  } else if (!templateKernelVersion) {
    notes.push("Could not read a Linux version string from the template kernel.");
  }

  if (packed.bytes.length > template.fileSize) {
    notes.push(
      `Output is ${formatBytes(packed.bytes.length - template.fileSize)} larger than the template file. This is normal when the new kernel is larger; the boot partition is checked again before flashing.`,
    );
  }

  return {
    bootImg: packed.bytes,
    report: {
      template: summarize(template),
      output: summarize(reparsed),
      kernel: {
        sourceName: pkg.kernel.name,
        sourceSize: pkg.kernel.bytes.length,
        compression: pkg.kernel.compression,
        linuxVersion: pkg.kernel.linuxVersion,
        arm64: pkg.kernel.arm64,
        sha256: pkg.kernel.sha256,
      },
      templateKernel: {
        linuxVersion: templateKernelVersion,
        sha256: await sha256(template.kernel),
      },
      ak3: {
        kernelString: ak3.kernelString,
        devices: ak3.devices,
        deviceCheck: ak3.deviceCheck,
        block: ak3.block,
        targetPartition: ak3.targetPartition,
        ramdiskEdits: ak3.ramdiskEdits,
        modules: ak3.modules,
        systemless: ak3.systemless,
        ramdiskFiles: pkg.ramdiskFiles,
        moduleFiles: pkg.moduleFiles,
        extraImages: pkg.extras,
        hasVendorRamdisk: pkg.hasVendorRamdisk,
        hasPatchDir: pkg.hasPatchDir,
      },
      warnings,
      notes,
      outputSha256,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
