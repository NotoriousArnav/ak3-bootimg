import { formatBytes } from "../lib/bytes";
import type { ConversionReport } from "../lib/convert/types";
import { FlashPanel } from "./FlashPanel";
import { AlertIcon, CheckIcon, DownloadIcon, ShieldIcon } from "./icons";

interface ReportViewProps {
  report: ConversionReport;
  bootImg: Uint8Array;
  fileName: string;
  templateName: string | null;
  templateBytes: Uint8Array | null;
  onDownload: () => void;
}

function shortVersion(version: string | null): string {
  if (!version) return "unknown";
  const cut = version.split(" #")[0];
  return cut.length > 110 ? `${cut.slice(0, 107)}…` : cut;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return (
    <tr className={changed ? "changed" : undefined}>
      <td>{label}</td>
      <td>{before}</td>
      <td>{after}</td>
    </tr>
  );
}

export function ReportView({
  report,
  bootImg,
  fileName,
  templateName,
  templateBytes,
  onDownload,
}: ReportViewProps) {
  const target = report.ak3.targetPartition === "unknown" ? "boot" : report.ak3.targetPartition;

  return (
    <section className="result" id="result">
      <div className="result-head">
        <div className="result-title">
          <span className="result-check">
            <CheckIcon size={22} />
          </span>
          <div>
            <h2>boot.img ready</h2>
            <p>
              {formatBytes(bootImg.length)} · SHA-256 <code>{report.outputSha256.slice(0, 16)}…</code>
            </p>
          </div>
        </div>
        <button className="btn btn-primary" type="button" onClick={onDownload}>
          <DownloadIcon size={18} />
          Download {fileName}
        </button>
      </div>

      {report.warnings.length > 0 ? (
        <div className="callout warn">
          <AlertIcon size={20} />
          <div>
            <strong>Read before flashing</strong>
            <ul>
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="callout good">
          <ShieldIcon size={20} />
          <div>
            <strong>No compatibility warnings</strong>
            <p>This is a clean kernel-only repack. Device and partition checks still apply before flashing.</p>
          </div>
        </div>
      )}

      {report.notes.length > 0 ? (
        <div className="callout note">
          <div>
            <strong>Notes</strong>
            <ul>
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="stats">
        <Stat label="Header" value={`v${report.output.headerVersion} · ${report.output.pageSize} B pages`} />
        <Stat label="Kernel" value={formatBytes(report.output.kernelSize)} />
        <Stat
          label="Ramdisk"
          value={report.output.ramdiskSize === 0 ? "empty (init_boot)" : formatBytes(report.output.ramdiskSize)}
        />
        <Stat label="AVB" value={report.output.avb ? "present" : "stripped / none"} tone={report.output.avb ? "warn" : "good"} />
        <Stat label="Target" value={target} />
        <Stat label="Kernel version" value={shortVersion(report.kernel.linuxVersion)} />
        <Stat label="Compression" value={report.kernel.compression} />
        <Stat label="Build time" value={`${(report.durationMs / 1000).toFixed(1)} s`} />
      </div>

      <details className="panel" open>
        <summary>
          <span>What changed</span>
          <span className="summary-hint">template → output</span>
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Template</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              <DiffRow
                label="Header"
                before={`v${report.template.headerVersion} (${report.template.headerSize} B)`}
                after={`v${report.output.headerVersion} (${report.output.headerSize} B)`}
              />
              <DiffRow label="Page size" before={String(report.template.pageSize)} after={String(report.output.pageSize)} />
              <DiffRow
                label="Kernel"
                before={formatBytes(report.template.kernelSize)}
                after={formatBytes(report.output.kernelSize)}
              />
              <DiffRow
                label="Ramdisk"
                before={formatBytes(report.template.ramdiskSize)}
                after={formatBytes(report.output.ramdiskSize)}
              />
              <DiffRow
                label="Boot signature"
                before={formatBytes(report.template.signatureSize)}
                after={formatBytes(report.output.signatureSize)}
              />
              <DiffRow label="AVB footer" before={report.template.avb ? "yes" : "no"} after={report.output.avb ? "yes" : "no"} />
              <DiffRow label="OS version" before={report.template.osVersion} after={report.output.osVersion} />
              <DiffRow label="File size" before={formatBytes(report.template.fileSize)} after={formatBytes(report.output.fileSize)} />
            </tbody>
          </table>
        </div>
        <p className="fineprint">
          Kernel: <code>{report.kernel.sourceName}</code> · payload SHA-256{" "}
          <code>{report.kernel.sha256.slice(0, 16)}…</code> · template kernel{" "}
          <code>{report.templateKernel.sha256.slice(0, 12)}…</code>
        </p>
      </details>

      <details className="panel">
        <summary>
          <span>AnyKernel package</span>
          <span className="summary-hint">{report.ak3.kernelString ?? "no kernel.string"}</span>
        </summary>
        <div className="kv-grid">
          <Stat label="Target partition" value={report.ak3.block ?? "unknown"} />
          <Stat label="Device check" value={report.ak3.deviceCheck ? report.ak3.devices.join(", ") || "enabled" : "disabled"} />
          <Stat label="Modules" value={report.ak3.modules || report.ak3.moduleFiles.length > 0 ? "yes" : "no"} />
          <Stat label="Systemless" value={report.ak3.systemless ? "yes" : "no"} />
          <Stat
            label="Ramdisk edits"
            value={report.ak3.ramdiskEdits.length > 0 ? report.ak3.ramdiskEdits.join(", ") : "none"}
          />
          <Stat
            label="Extra images"
            value={report.ak3.extraImages.length > 0 ? report.ak3.extraImages.map((image) => image.name).join(", ") : "none"}
          />
        </div>
      </details>

      <details className="panel">
        <summary>
          <span>Packed layout</span>
          <span className="summary-hint">{formatBytes(bootImg.length)}</span>
        </summary>
        <div className="layout-list">
          {report.output.layout
            .filter((segment) => segment.size > 0)
            .map((segment) => (
              <div className="layout-row" key={`${segment.name}-${segment.offset}`}>
                <span>{segment.name}</span>
                <code>@ 0x{segment.offset.toString(16)}</code>
                <span>{formatBytes(segment.size)}</span>
              </div>
            ))}
        </div>
      </details>

      <FlashPanel
        bootImg={bootImg}
        fileName={fileName}
        report={report}
        templateName={templateName}
        templateBytes={templateBytes}
      />
    </section>
  );
}
