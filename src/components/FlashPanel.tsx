import { useMemo, useRef, useState } from "react";
import { FastbootDevice } from "android-fastboot";
import { formatBytes } from "../lib/bytes";
import type { ConversionReport } from "../lib/convert/types";
import { AlertIcon, CheckIcon, ChipIcon, LockIcon, RefreshIcon, UsbIcon } from "./icons";

interface FlashPanelProps {
  bootImg: Uint8Array;
  fileName: string;
  report: ConversionReport;
  templateName: string | null;
  templateBytes: Uint8Array | null;
}

interface DeviceSummary {
  product: string | null;
  slotCount: number;
  currentSlot: string | null;
  partitionSize: number | null;
  unlocked: boolean | null;
  isUserspace: boolean;
}

type Phase = "idle" | "connecting" | "connected" | "flashing" | "done" | "error";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

function parseFastbootSize(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const parsed = /^0x/i.test(trimmed) ? parseInt(trimmed, 16) : Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getVar(device: FastbootDevice, name: string): Promise<string | null> {
  try {
    return await device.getVariable(name);
  } catch {
    return null;
  }
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no device|not found|notfound/i.test(message)) {
    return "No fastboot device was selected. Reboot the phone to the bootloader (usually power + volume down) and try again.";
  }
  if (/access denied|permission|unable to open/i.test(message)) {
    return "USB access was denied. On Linux add a udev rule for the bootloader; on Windows install the Android bootloader / WinUSB driver. On macOS it usually just works.";
  }
  if (/cancel/i.test(message)) return "Device selection was cancelled.";
  if (/timeout/i.test(message)) return "The bootloader did not answer in time. Reconnect the cable and try again.";
  return message;
}

export function FlashPanel({ bootImg, fileName, report, templateName, templateBytes }: FlashPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [bothSlots, setBothSlots] = useState(false);
  const [typedProduct, setTypedProduct] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const deviceRef = useRef<FastbootDevice | null>(null);

  const supported = typeof navigator !== "undefined" && "usb" in navigator;
  const partitionSupported =
    report.ak3.targetPartition === "boot" ||
    report.ak3.targetPartition === "init_boot" ||
    report.ak3.targetPartition === "unknown";
  const partition = report.ak3.targetPartition === "init_boot" ? "init_boot" : "boot";
  const expectedDevices = report.ak3.devices.map((name) => name.toLowerCase());
  const product = device?.product ?? null;
  const productMismatch =
    expectedDevices.length > 0 &&
    !!product &&
    !expectedDevices.some((name) => name === product.toLowerCase() || product.toLowerCase().includes(name));
  const locked = device?.unlocked === false;
  const imageTooLarge = !!device?.partitionSize && bootImg.length > device.partitionSize;
  const productAcknowledged =
    !productMismatch || typedProduct.trim().toLowerCase() === product?.toLowerCase();

  const targets = useMemo(() => {
    if (!device) return [];
    if (bothSlots && device.slotCount === 2) return [`${partition}_a`, `${partition}_b`];
    if (device.slotCount === 2 && device.currentSlot) return [`${partition}_${device.currentSlot}`];
    return [partition];
  }, [bothSlots, device, partition]);

  function appendLog(line: string) {
    setLog((previous) => [...previous, `${new Date().toLocaleTimeString()}  ${line}`]);
  }

  async function connect() {
    setPhase("connecting");
    setError(null);
    setDevice(null);
    setConfirmed(false);
    setTypedProduct("");
    try {
      appendLog("Requesting a WebUSB device (fastboot mode)…");
      const fastboot = new FastbootDevice();
      await fastboot.connect();
      deviceRef.current = fastboot;

      const [productValue, slotCountValue, currentSlot, unlockedValue, userspaceValue] = await Promise.all([
        getVar(fastboot, "product"),
        getVar(fastboot, "slot-count"),
        getVar(fastboot, "current-slot"),
        getVar(fastboot, "unlocked"),
        getVar(fastboot, "is-userspace"),
      ]);
      const partitionSize = parseFastbootSize(
        await getVar(
          fastboot,
          `partition-size:${
            Number(slotCountValue) === 2 && currentSlot ? `${partition}_${currentSlot}` : partition
          }`,
        ),
      );
      const slotCount = Number(slotCountValue ?? "1");

      const summary: DeviceSummary = {
        product: productValue,
        slotCount: Number.isFinite(slotCount) && slotCount > 0 ? slotCount : 1,
        currentSlot,
        partitionSize,
        unlocked: unlockedValue === null ? null : unlockedValue.trim().toLowerCase() === "yes",
        isUserspace: (userspaceValue ?? "").toLowerCase() === "yes",
      };
      setDevice(summary);
      setPhase("connected");
      appendLog(
        `Connected: product=${summary.product ?? "?"} slots=${summary.slotCount} current=${summary.currentSlot ?? "?"} ${partition}=${
          summary.partitionSize ? formatBytes(summary.partitionSize) : "unknown"
        }`,
      );
    } catch (cause) {
      const message = friendlyError(cause);
      setError(message);
      setPhase("error");
      appendLog(`ERROR ${message}`);
    }
  }

  async function refreshDevice() {
    const fastboot = deviceRef.current;
    if (!fastboot) return;
    const [productValue, slotCountValue, currentSlot, unlockedValue] = await Promise.all([
      getVar(fastboot, "product"),
      getVar(fastboot, "slot-count"),
      getVar(fastboot, "current-slot"),
      getVar(fastboot, "unlocked"),
    ]);
    const slotCount = Number(slotCountValue ?? "1");
    const activePartition =
      Number.isFinite(slotCount) && slotCount === 2 && currentSlot ? `${partition}_${currentSlot}` : partition;
    const partitionSizeValue = await getVar(fastboot, `partition-size:${activePartition}`);
    setDevice((previous) =>
      previous
        ? {
            ...previous,
            product: productValue,
            slotCount: Number.isFinite(slotCount) && slotCount > 0 ? slotCount : 1,
            currentSlot,
            unlocked: unlockedValue === null ? null : unlockedValue.trim().toLowerCase() === "yes",
            partitionSize: parseFastbootSize(partitionSizeValue),
          }
        : previous,
    );
    appendLog("Device info refreshed");
  }

  async function flash(bytes: Uint8Array, action: "flash" | "restore") {
    const fastboot = deviceRef.current;
    if (!fastboot || !device) return;
    setPhase("flashing");
    setError(null);
    setProgress(0);
    setProgressLabel("");
    try {
      const blob = new Blob([bytes as unknown as BlobPart]);
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        appendLog(`${action === "restore" ? "Restoring" : "Flashing"} ${target} · ${formatBytes(bytes.length)}`);
        await fastboot.flashBlob(target, blob, (fraction) => {
          setProgress((index + fraction) / targets.length);
          setProgressLabel(`${target} · ${(fraction * 100).toFixed(1)}%`);
        });
        appendLog(`${target} written`);
      }
      setProgress(1);
      setProgressLabel("complete");
      setPhase("done");
      appendLog("Flash complete. Reboot when ready.");
    } catch (cause) {
      const message = friendlyError(cause);
      setError(message);
      setPhase("error");
      appendLog(`ERROR ${message}`);
    }
  }

  async function reboot() {
    const fastboot = deviceRef.current;
    if (!fastboot) return;
    try {
      appendLog("Rebooting to system…");
      await fastboot.reboot();
      setPhase("idle");
      setDevice(null);
      deviceRef.current = null;
    } catch (cause) {
      const message = friendlyError(cause);
      setError(message);
      appendLog(`ERROR ${message}`);
    }
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(log.join("\n"));
      appendLog("Log copied to clipboard");
    } catch {
      appendLog("Could not copy the log");
    }
  }

  return (
    <section className="panel flash-panel">
      <div className="panel-title">
        <span className="panel-icon">
          <ChipIcon size={20} />
        </span>
        <div>
          <h3>Flash with fastboot</h3>
          <p>WebUSB talks directly to the bootloader from this tab. No adb, no drivers on macOS.</p>
        </div>
        <span className="badge">WebUSB</span>
      </div>

      {!supported ? (
        <div className="callout note">
          <div>
            <strong>Flashing is not available in this browser</strong>
            <p>
              Use Chrome, Edge, or Brave on desktop (or Chrome on Android with a USB-OTG adapter). Firefox and Safari do
              not support WebUSB. You can still download {fileName} and flash it with the platform-tools fastboot.
            </p>
            <pre className="snippet">fastboot flash {partition} {fileName}</pre>
          </div>
        </div>
      ) : (
        <>
          <div className="device-row">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={connect}
              disabled={phase === "connecting" || phase === "flashing"}
            >
              <UsbIcon size={18} />
              {phase === "connecting" ? "Waiting for device…" : device ? "Reconnect device" : "Connect fastboot device"}
            </button>
            {device ? (
              <button className="btn btn-ghost" type="button" onClick={refreshDevice} disabled={phase === "flashing"}>
                <RefreshIcon size={16} />
                Refresh
              </button>
            ) : null}
            <span className="device-hint">
              Phone must be in bootloader / fastboot mode, not Android.
            </span>
          </div>

          {device ? (
            <div className="device-card">
              <div className="device-head">
                <span className="live-dot" />
                <strong>{device.product ?? "unknown product"}</strong>
                <span className="device-sub">
                  {device.slotCount === 2 ? `A/B · current slot ${device.currentSlot ?? "?"}` : "single slot"}
                  {device.isUserspace ? " · fastbootd" : ""}
                </span>
              </div>
              <div className="device-grid">
                <Stat label={`${partition} partition`} value={device.partitionSize ? formatBytes(device.partitionSize) : "unknown"} />
                <Stat label="Image size" value={formatBytes(bootImg.length)} />
                <Stat
                  label="Bootloader"
                  value={device.unlocked === null ? "unknown" : device.unlocked ? "unlocked" : "locked"}
                  tone={locked ? "warn" : "good"}
                />
                <Stat label="Flash target" value={targets.join(", ") || partition} />
              </div>

              {locked ? (
                <div className="callout danger">
                  <LockIcon size={18} />
                  <div>
                    <strong>Bootloader reports locked</strong>
                    <p>Unlock the bootloader in developer options / Motorola's unlock portal before flashing a custom image.</p>
                  </div>
                </div>
              ) : null}

              {!partitionSupported ? (
                <div className="callout danger">
                  <AlertIcon size={18} />
                  <div>
                    <strong>This zip targets {report.ak3.targetPartition}</strong>
                    <p>
                      This tool only flashes boot.img or init_boot.img. Download the image and flash it with the
                      partition name the kernel developer documents.
                    </p>
                  </div>
                </div>
              ) : null}

              {imageTooLarge ? (
                <div className="callout danger">
                  <AlertIcon size={18} />
                  <div>
                    <strong>Image is larger than the partition</strong>
                    <p>
                      The image is {formatBytes(bootImg.length)} but {partition} is{" "}
                      {formatBytes(device.partitionSize!)}. Do not force it — the bootloader will reject or truncate it.
                    </p>
                  </div>
                </div>
              ) : null}

              {productMismatch ? (
                <div className="callout warn">
                  <AlertIcon size={18} />
                  <div>
                    <strong>The zip declares different devices</strong>
                    <p>
                      Zip supports: {expectedDevices.join(", ")}. Connected device reports <code>{product}</code>. Type the
                      product name to continue:
                    </p>
                    <input
                      className="text-input"
                      value={typedProduct}
                      onChange={(event) => setTypedProduct(event.target.value)}
                      placeholder={product ?? "device codename"}
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : (
                <p className="fineprint">
                  {expectedDevices.length > 0
                    ? `Device matches the zip's supported list.`
                    : "This zip does not declare a device check. Confirm the product above is your device before flashing."}
                </p>
              )}

              {device.slotCount === 2 ? (
                <label className="check-row">
                  <input type="checkbox" checked={bothSlots} onChange={(event) => setBothSlots(event.target.checked)} />
                  <span>
                    Flash both slots (A/B)
                    <small>Safer for OTA consistency, but leaves no stock slot for rollback.</small>
                  </span>
                </label>
              ) : null}

              <label className="check-row">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>
                  I understand this can brick the device and I have a way to restore stock firmware.
                  <small>Keep the stock boot.img and Motorola rescue tool available.</small>
                </span>
              </label>

              <div className="flash-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!confirmed || locked || imageTooLarge || !productAcknowledged || !partitionSupported || phase === "flashing"}
                  onClick={() => flash(bootImg, "flash")}
                >
                  <UsbIcon size={18} />
                  {phase === "flashing" ? "Flashing…" : `Flash ${targets.join(" + ") || partition}`}
                </button>
                {phase === "done" ? (
                  <button className="btn btn-secondary" type="button" onClick={reboot}>
                    Reboot to system
                  </button>
                ) : null}
              </div>

              {device.slotCount === 2 && !bothSlots ? (
                <p className="fineprint">
                  Only the active slot is flashed. Flash the other slot later if you want the same kernel on both.
                </p>
              ) : null}

              {templateBytes && templateName ? (
                <details className="restore">
                  <summary>Restore the saved template ({templateName})</summary>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={restoreConfirmed}
                      onChange={(event) => setRestoreConfirmed(event.target.checked)}
                    />
                    <span>Yes, flash the template back to {targets.join(" + ") || partition}.</span>
                  </label>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={!restoreConfirmed || locked || !partitionSupported || phase === "flashing"}
                    onClick={() => flash(templateBytes, "restore")}
                  >
                    <RefreshIcon size={16} />
                    Restore {formatBytes(templateBytes.length)}
                  </button>
                </details>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="callout danger">
              <AlertIcon size={18} />
              <div>
                <strong>Fastboot error</strong>
                <p>{error}</p>
              </div>
            </div>
          ) : null}

          {phase === "flashing" || (progress > 0 && progress < 1) ? (
            <div className="progress-block">
              <div className="progress-bar">
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="progress-label">{progressLabel}</span>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="callout good">
              <CheckIcon size={18} />
              <div>
                <strong>Image written successfully</strong>
                <p>Leave the cable connected and reboot. The first boot after a kernel change can take longer.</p>
              </div>
            </div>
          ) : null}

          {log.length > 0 ? (
            <details className="log" open>
              <summary>
                <span>Log</span>
                <button className="link-button" type="button" onClick={copyLog}>
                  Copy
                </button>
              </summary>
              <pre>{log.join("\n")}</pre>
            </details>
          ) : null}
        </>
      )}

      {supported ? (
        <p className="fineprint">
          Windows may need the Android bootloader / WinUSB driver. Linux may need a udev rule. Use a data-capable cable
          and keep the phone charged.
        </p>
      ) : null}
    </section>
  );
}
