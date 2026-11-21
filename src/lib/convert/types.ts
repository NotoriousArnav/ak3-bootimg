import type { Compression } from "../boot/kernel";
import type { Segment } from "../boot/parse";

export interface HeaderSummary {
  headerVersion: number;
  headerSize: number;
  pageSize: number;
  osVersion: string;
  cmdline: string;
  kernelSize: number;
  ramdiskSize: number;
  signatureSize: number;
  avb: boolean;
  fileSize: number;
  layout: Segment[];
}

export interface ConversionReport {
  template: HeaderSummary;
  output: HeaderSummary;
  kernel: {
    sourceName: string;
    sourceSize: number;
    compression: Compression;
    linuxVersion: string | null;
    arm64: boolean;
    sha256: string;
  };
  templateKernel: {
    linuxVersion: string | null;
    sha256: string;
  };
  ak3: {
    kernelString: string | null;
    devices: string[];
    deviceCheck: boolean;
    block: string | null;
    targetPartition: string;
    ramdiskEdits: string[];
    modules: boolean;
    systemless: boolean;
    ramdiskFiles: string[];
    moduleFiles: string[];
    extraImages: { name: string; size: number }[];
    hasVendorRamdisk: boolean;
    hasPatchDir: boolean;
  };
  warnings: string[];
  notes: string[];
  outputSha256: string;
  durationMs: number;
}

export interface ConvertResult {
  bootImg: Uint8Array;
  report: ConversionReport;
}

export interface ConvertInput {
  zip: Uint8Array;
  template: Uint8Array;
  zipName?: string;
  templateName?: string;
}

export type ProgressFn = (percent: number, message: string) => void;
