# AK3 → boot.img

A browser-only converter that turns an **AnyKernel3** zip into a standalone, flashable `boot.img`, and optionally flashes it over **WebUSB fastboot**.

The zip's kernel is swapped into the header of a boot image you provide (stock firmware or a known-good custom image), exactly like `magiskboot` repacking inside AnyKernel. Nothing is uploaded: all parsing, repacking, and flashing happens in the tab.

## Why

AnyKernel3 is an on-device installer. It needs a rooted Android system with `magiskboot` to unpack and repack `boot.img`. If you have a kernel zip but no root, a broken recovery, or you just want a plain `boot.img` to flash with fastboot, you need the repack to happen somewhere else.

This tool does the repack offline:

1. Read `anykernel.sh` and the kernel payload from the zip.
2. Parse the template `boot.img` header (v0–v4).
3. Replace only the kernel, preserving page size, load addresses, cmdline, OS version, ramdisk, and header version.
4. Verify the result by re-parsing it and report every change and warning.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL, drop in:

- **AnyKernel zip** — the package the kernel developer publishes (`anykernel.sh` + `Image` at the zip root).
- **Template boot.img** — the stock `boot.img` from your exact firmware build, or a known-good custom boot image for the same device.

Then press **Build boot.img** and download the result.

For a CLI run against local files:

```bash
npm run practical -- path/to/kernel.zip path/to/template-boot.img out-boot.img
```

## Scope and limits (v1)

Supported:

- Boot header versions **0, 1, 2, 3, and 4** for parsing; packing preserves the template version.
- Raw arm64 `Image` and arm32 `zImage` payloads.
- Gzip payloads (`Image.gz`) via the browser's `DecompressionStream`.
- Kernel-only installs: `flash_boot` / `write_boot` style packages with no ramdisk edits.
- AVB footer detection and stripping (a kernel swap invalidates the signature).
- GKI v4 boot signatures are dropped because they no longer match the kernel.

Not applied (reported as warnings/notes):

- Ramdisk edits (`replace_string`, `insert_line`, `patch_fstab`, …). The template ramdisk is preserved unchanged.
- Files under `ramdisk/`, `modules/`, `patch/`, or `vendor_ramdisk*`.
- Extra images such as `dtbo.img`, `vendor_dlkm.img`, `system_dlkm.img`.
- LZ4, zstd, xz, bzip2, and LZMA kernel compression (a `magiskboot.wasm` engine is the planned path for these).

A standalone `boot.img` cannot install kernel modules, patch the ramdisk, or carry extra partitions. If the zip depends on any of those, the result may not boot even though the repack itself is valid.

## Flashing

The flash panel appears only when the browser exposes WebUSB (Chrome, Edge, Brave on desktop). It will:

- Connect to the phone whether it is booted into Android with USB debugging or sitting in the bootloader, then report which mode it detected.
- If the phone is in Android/adb mode, show the commands to switch: `adb devices`, `adb reboot bootloader`, `fastboot devices` (or power off and hold power + volume down).
- Read `product`, `slot-count`, `current-slot`, `unlocked`, and `partition-size:boot` before writing.
- Refuse to flash when the bootloader reports locked, when the image is larger than the partition, or when the zip declares a different device (unless you explicitly type the product name).
- Default to the **active slot only**. Flashing both slots is opt-in.
- Keep the template in IndexedDB so you can flash it back from the same panel.

If WebUSB is unavailable, download the image and use platform-tools:

```bash
fastboot flash boot boot.img
```

### Safety

- Keep the stock `boot.img` and a rescue method (Motorola rescue tool / fastboot firmware package) available.
- A kernel swap removes AVB. The device needs an unlocked bootloader and a verification-disabled `vbmeta`. **Never flash vbmeta from this tool.**
- KMI compatibility is the kernel developer's responsibility. A `6.6.x` kernel is not automatically valid for every `6.6.x` device; check the vendor branch.
- Flash the active slot first and keep the other slot stock so you have a rollback path.
- First boot after a kernel change can take longer than usual.

## How it works

```
src/lib/boot/parse.ts       boot_img_hdr v0–v4 parser, AVB footer detection
src/lib/boot/pack.ts        header-preserving repacker (page-aligned, mkbootimg layout)
src/lib/boot/kernel.ts      compression sniffing, arm64/arm32 validation, gzip
src/lib/ak3/zip.ts          AnyKernel zip analysis (payload, modules, extras)
src/lib/ak3/anykernel.ts    anykernel.sh properties and ramdisk-helper detection
src/lib/convert/convert.ts  pipeline, verification, report and warnings
src/workers/convert.worker.ts  keeps the big buffers off the UI thread
src/components/FlashPanel.tsx  WebUSB fastboot flow and guards
```

The packer reproduces a known-good GKI v4 image byte-for-byte when the kernel is unchanged, and packs a new kernel into the same layout: header page, kernel, ramdisk, signature — each page aligned.

## Tests

```bash
npm test
```

Unit tests cover synthetic v0 and v4 images, malformed input rejection, and `anykernel.sh` parsing. If `temp/custom_boot.img` and `temp/wild-6.6.118-ksun.zip` are present, the suite also checks the real template identity repack and a full AK3 conversion.

## License

MIT. `android-fastboot` is MIT. A future `magiskboot`/WASM engine would bring GPL-3.0 obligations and will be documented here before it ships.
