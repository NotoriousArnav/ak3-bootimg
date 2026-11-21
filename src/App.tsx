import { useEffect, useRef, useState } from "react";
import { describeBootImage, parseBootImage } from "./lib/boot/parse";
import { linuxVersion } from "./lib/boot/kernel";
import { formatBytes } from "./lib/bytes";
import type { ConvertResponse } from "./lib/convert/protocol";
import type { ConversionReport } from "./lib/convert/types";
import { clearTemplate, loadTemplate, saveTemplate, type StoredTemplate } from "./lib/store/template";
import { FileDrop } from "./components/FileDrop";
import { ReportView } from "./components/ReportView";
import {
  AlertIcon,
  BootIcon,
  CheckIcon,
  ChipIcon,
  DownloadIcon,
  GitHubIcon,
  RefreshIcon,
  ShieldIcon,
  TelegramIcon,
  UsbIcon,
} from "./components/icons";

interface TemplateInfo {
  name: string;
  size: number;
  headerVersion: number;
  pageSize: number;
  osVersion: string;
  kernelSize: number;
  ramdiskSize: number;
  signatureSize: number;
  avb: boolean;
  kernelVersion: string | null;
}

interface ConversionResult {
  bootImg: Uint8Array;
  report: ConversionReport;
  fileName: string;
}

function templateSummary(name: string, bytes: Uint8Array): TemplateInfo {
  const image = parseBootImage(bytes);
  const described = describeBootImage(image);
  return {
    name,
    size: bytes.length,
    headerVersion: described.headerVersion,
    pageSize: described.pageSize,
    osVersion: described.osVersion,
    kernelSize: described.kernelSize,
    ramdiskSize: described.ramdiskSize,
    signatureSize: described.signatureSize,
    avb: described.avb,
    kernelVersion: linuxVersion(image.kernel),
  };
}

function shortVersion(version: string | null): string {
  if (!version) return "unknown kernel";
  const cut = version.split(" #")[0];
  return cut.length > 72 ? `${cut.slice(0, 69)}…` : cut;
}

function outputName(report: ConversionReport): string {
  const version = report.kernel.linuxVersion?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
  return `boot${version ? `-${version}` : ""}.img`;
}

export default function App() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [savedTemplate, setSavedTemplate] = useState<StoredTemplate | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "working" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTemplate()
      .then(setSavedTemplate)
      .catch(() => setSavedTemplate(null));
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  function clearOutput() {
    setResult(null);
    setError(null);
    setPhase("idle");
    setProgress(0);
    setProgressMessage("");
  }

  function onZip(file: File) {
    clearOutput();
    setNotice(null);
    setZipFile(file);
  }

  async function onTemplate(file: File) {
    clearOutput();
    setNotice(null);
    setTemplateError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = templateSummary(file.name, bytes);
      setTemplateBytes(bytes);
      setTemplateInfo(info);
      try {
        await saveTemplate(file.name, bytes);
        setSavedTemplate({ name: file.name, bytes: bytes.slice().buffer as ArrayBuffer, savedAt: Date.now() });
      } catch {
        setNotice("This browser could not save the template for one-click restore (private mode?). Flashing still works.");
      }
    } catch (cause) {
      setTemplateBytes(null);
      setTemplateInfo(null);
      setTemplateError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function useSavedTemplate() {
    if (!savedTemplate) return;
    clearOutput();
    setTemplateError(null);
    try {
      const bytes = new Uint8Array(savedTemplate.bytes.slice(0));
      const info = templateSummary(savedTemplate.name, bytes);
      setTemplateBytes(bytes);
      setTemplateInfo(info);
      setNotice(null);
    } catch (cause) {
      setTemplateBytes(null);
      setTemplateInfo(null);
      setTemplateError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function clearTemplateSelection() {
    clearOutput();
    setTemplateBytes(null);
    setTemplateInfo(null);
    setTemplateError(null);
  }

  async function forgetSavedTemplate() {
    try {
      await clearTemplate();
    } finally {
      setSavedTemplate(null);
      setNotice("Saved template removed from this browser.");
    }
  }

  async function convert() {
    if (!zipFile || !templateBytes) return;
    clearOutput();
    setPhase("working");
    setProgress(1);
    setProgressMessage("Reading files");

    const zipBuffer = await zipFile.arrayBuffer();
    const templateCopy = templateBytes.slice();
    const id = Date.now();
    const worker = new Worker(new URL("./workers/convert.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ConvertResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") {
        setProgress(message.percent);
        setProgressMessage(message.message);
        return;
      }
      if (message.type === "error") {
        setError(message.message);
        setPhase("error");
        setProgress(0);
        worker.terminate();
        workerRef.current = null;
        return;
      }
      const bootImg = new Uint8Array(message.bootImg);
      setResult({ bootImg, report: message.report, fileName: outputName(message.report) });
      setPhase("idle");
      setProgress(100);
      setProgressMessage("Done");
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (event) => {
      setError(event.message || "The conversion worker crashed.");
      setPhase("error");
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage(
      {
        id,
        zip: zipBuffer,
        template: templateCopy.buffer,
        zipName: zipFile.name,
        templateName: templateInfo?.name ?? "template.img",
      },
      [zipBuffer, templateCopy.buffer],
    );
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result.bootImg as unknown as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function startOver() {
    clearOutput();
    setZipFile(null);
    setTemplateBytes(null);
    setTemplateInfo(null);
    setTemplateError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const busy = phase === "working";
  const templateDetail = templateInfo
    ? `v${templateInfo.headerVersion} · ${templateInfo.pageSize} B pages · kernel ${formatBytes(templateInfo.kernelSize)} · ramdisk ${
        templateInfo.ramdiskSize === 0 ? "empty" : formatBytes(templateInfo.ramdiskSize)
      } · ${templateInfo.avb ? "AVB present (will be stripped)" : "no AVB"}`
    : null;

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true" />

      <header className="hero">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <ChipIcon size={22} />
            </span>
            <span>
              AK3 <span className="brand-arrow">→</span> boot.img
            </span>
            <span className="badge">browser-only</span>
          </div>
          <nav className="nav-links" aria-label="External links">
            <a className="nav-link" href="https://t.me/portov_official" target="_blank" rel="noopener noreferrer">
              <TelegramIcon size={16} />
              <span>Portov Community</span>
            </a>
            <a className="nav-link" href="https://github.com/NotoriousArnav/ak3-bootimg" target="_blank" rel="noopener noreferrer">
              <GitHubIcon size={16} />
              <span>GitHub</span>
            </a>
          </nav>
        </div>

        <div className="hero-grid">
          <div>
            <h1>
              Turn an AnyKernel zip into a <span className="accent">flashable boot image</span>.
            </h1>
            <p className="lede">
              Unzip the package, swap its kernel into your stock boot header, repack, and optionally flash it straight to
              the phone with WebUSB. Everything happens in this tab — files never leave your device.
            </p>
            <div className="hero-chips">
              <span>
                <ShieldIcon size={15} /> No uploads
              </span>
              <span>
                <ChipIcon size={15} /> v0–v4 aware
              </span>
              <span>
                <UsbIcon size={15} /> Fastboot over WebUSB
              </span>
            </div>
          </div>
          <div className="how-card">
            <h3>What it does</h3>
            <ol>
              <li>
                <span>1</span> Read <code>anykernel.sh</code> and the kernel payload
              </li>
              <li>
                <span>2</span> Keep the template header, page size and ramdisk
              </li>
              <li>
                <span>3</span> Repack the kernel and verify the result
              </li>
            </ol>
            <p>AK3 normally does this on-device with magiskboot. This is the same repack, done offline.</p>
          </div>
        </div>
      </header>

      <main>
        <section className="inputs">
          <FileDrop
            step={1}
            title="AnyKernel zip"
            hint="The package the kernel developer publishes (anykernel.sh + Image in the root)."
            accept=".zip,application/zip"
            fileName={zipFile?.name ?? null}
            fileSize={zipFile?.size ?? null}
            onFile={onZip}
            onClear={() => {
              setZipFile(null);
              clearOutput();
            }}
            disabled={busy}
          />
          <FileDrop
            step={2}
            title="Template boot.img"
            hint="Stock boot.img from your exact firmware build, or a known-good custom boot image."
            accept=".img,application/octet-stream"
            fileName={templateInfo?.name ?? null}
            fileSize={templateInfo?.size ?? null}
            onFile={onTemplate}
            onClear={clearTemplateSelection}
            detail={templateDetail}
            error={templateError}
            disabled={busy}
          />
        </section>

        {savedTemplate && !templateBytes ? (
          <div className="saved-template">
            <span>
              <RefreshIcon size={16} /> Saved template: <strong>{savedTemplate.name}</strong>{" "}
              <small>{formatBytes(savedTemplate.bytes.byteLength)}</small>
            </span>
            <div>
              <button className="btn btn-secondary btn-sm" type="button" onClick={useSavedTemplate}>
                Use it
              </button>
              <button className="link-button" type="button" onClick={forgetSavedTemplate}>
                Forget
              </button>
            </div>
          </div>
        ) : null}

        {templateInfo ? (
          <div className="template-strip">
            <span className="strip-check">
              <CheckIcon size={16} />
            </span>
            <div>
              <strong>{templateInfo.name}</strong>
              <span>
                v{templateInfo.headerVersion} · {templateInfo.pageSize} B pages · kernel{" "}
                {formatBytes(templateInfo.kernelSize)} · ramdisk{" "}
                {templateInfo.ramdiskSize === 0 ? "empty" : formatBytes(templateInfo.ramdiskSize)} ·{" "}
                {templateInfo.avb ? "AVB present (stripped on repack)" : "no AVB"}
              </span>
              <code>{shortVersion(templateInfo.kernelVersion)}</code>
            </div>
          </div>
        ) : null}

        <section className="build-bar">
          <div>
            <h2>{result ? "Build another image" : "Ready to pack"}</h2>
            <p>
              {zipFile && templateInfo
                ? `Kernel from ${zipFile.name} will be packed into ${templateInfo.name}.`
                : "Add a zip and a boot image to enable the build."}
            </p>
          </div>
          <div className="build-actions">
            {result ? (
              <button className="btn btn-ghost" type="button" onClick={startOver}>
                Start over
              </button>
            ) : null}
            <button
              className="btn btn-primary btn-lg"
              type="button"
              onClick={convert}
              disabled={!zipFile || !templateBytes || busy}
            >
              <BootIcon size={19} />
              {busy ? "Packing…" : "Build boot.img"}
            </button>
          </div>
        </section>

        {busy ? (
          <div className="progress-block build-progress">
            <div className="progress-bar">
              <span style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
            <span className="progress-label">
              {progressMessage} · {Math.round(progress)}%
            </span>
          </div>
        ) : null}

        {notice ? (
          <div className="callout note">
            <div>
              <p>{notice}</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="callout danger">
            <AlertIcon size={20} />
            <div>
              <strong>Conversion failed</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <div ref={resultRef}>
          {result ? (
            <ReportView
              report={result.report}
              bootImg={result.bootImg}
              fileName={result.fileName}
              templateName={templateInfo?.name ?? null}
              templateBytes={templateBytes}
              onDownload={download}
            />
          ) : null}
        </div>

        {!result ? (
          <section className="notes-grid">
            <div className="info-card">
              <BootIcon size={20} />
              <h3>Header, not guesswork</h3>
              <p>
                The template's page size, load addresses, cmdline and OS version are preserved. Only the kernel (and its
                size) changes, which is exactly what AnyKernel does on-device.
              </p>
            </div>
            <div className="info-card">
              <ShieldIcon size={20} />
              <h3>Verified boot stays honest</h3>
              <p>
                AVB footers are stripped because they cover the kernel. An unlocked bootloader with a
                verification-disabled vbmeta is required — the tool says so instead of pretending.
              </p>
            </div>
            <div className="info-card">
              <UsbIcon size={20} />
              <h3>Flash only if supported</h3>
              <p>
                The flash button appears only when WebUSB exists. It checks the product, partition size and lock state
                before writing, and keeps your template for rollback.
              </p>
            </div>
          </section>
        ) : null}
      </main>

      <footer>
        <div className="footer-brand">
          <DownloadIcon size={15} /> Built for the AnyKernel workflow · runs entirely client-side
        </div>
        <p>
          Not affiliated with Google, Motorola, Magisk, KernelSU or the AnyKernel project. Custom kernels can brick a
          device. Keep stock firmware and a rescue tool ready. KMI compatibility is the kernel developer's job; this tool
          only repacks.
        </p>
      </footer>
    </div>
  );
}
