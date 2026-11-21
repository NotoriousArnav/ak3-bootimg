import { describe, expect, it } from "vitest";
import { parseAnyKernel } from "./anykernel";

const SCRIPT = `# AnyKernel3 Ramdisk Mod Script
# osm0sis @ xda-developers

## AnyKernel setup
properties() { '
kernel.string=WildKernels test
do.devicecheck=1
do.modules=0
do.systemless=0
do.cleanup=1
do.cleanuponabort=0
device.name1=portov
device.name2=
device.name3=
device.name4=
device.name5=
supported.versions=
supported.patchlevels=
supported.vendorpatchlevels=
'; } # end properties

## AnyKernel methods (DO NOT CHANGE)
# import patching functions
. $AKHOME/tools/ak3-core.sh;

## AnyKernel install
split_boot;
flash_boot;
`;

describe("parseAnyKernel", () => {
  it("reads properties and partition targeting", () => {
    const info = parseAnyKernel(SCRIPT);
    expect(info.kernelString).toBe("WildKernels test");
    expect(info.deviceCheck).toBe(true);
    expect(info.devices).toEqual(["portov"]);
    expect(info.targetPartition).toBe("unknown");
    expect(info.hasSplitBoot).toBe(true);
    expect(info.hasFlashBoot).toBe(true);
    expect(info.hasUnpackRamdisk).toBe(false);
    expect(info.ramdiskEdits).toEqual([]);
  });

  it("ignores ramdisk helpers that only appear in comments", () => {
    const info = parseAnyKernel(`properties() { '
do.devicecheck=0
'; }
# replace_string init.rc foo bar
# insert_line default.prop something
BLOCK=/dev/block/by-name/boot;
`);
    expect(info.ramdiskEdits).toEqual([]);
    expect(info.deviceCheck).toBe(false);
    expect(info.targetPartition).toBe("boot");
    expect(info.block).toBe("/dev/block/by-name/boot");
  });

  it("detects real ramdisk edits and init_boot targets", () => {
    const info = parseAnyKernel(`properties() { '
do.devicecheck=1
device.name1=portov
'; }
BLOCK=/dev/block/by-name/init_boot;
replace_string init.rc "ro.foo=1" "ro.foo=2";
insert_line default.prop "ro.bar=1";
`);
    expect(info.ramdiskEdits).toEqual(["insert_line", "replace_string"]);
    expect(info.targetPartition).toBe("init_boot");
  });
});
