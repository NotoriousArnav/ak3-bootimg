import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "../lib/bytes";
import { UploadIcon } from "./icons";

interface FileDropProps {
  step: number;
  title: string;
  hint: string;
  accept: string;
  fileName: string | null;
  fileSize: number | null;
  onFile: (file: File) => void;
  onClear: () => void;
  detail?: string | null;
  error?: string | null;
  disabled?: boolean;
}

export function FileDrop({
  step,
  title,
  hint,
  accept,
  fileName,
  fileSize,
  onFile,
  onClear,
  detail,
  error,
  disabled,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className={`drop-card ${fileName ? "has-file" : ""} ${error ? "has-error" : ""}`}>
      <div className="drop-head">
        <span className="step-badge">{step}</span>
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
      </div>

      <div
        className={`drop-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
        {fileName ? (
          <div className="file-loaded">
            <span className="file-icon">
              <UploadIcon size={18} />
            </span>
            <div className="file-meta">
              <strong>{fileName}</strong>
              <span>{fileSize !== null ? formatBytes(fileSize) : "saved in this browser"}</span>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
            >
              Replace
            </button>
          </div>
        ) : (
          <div className="drop-empty">
            <span className="drop-icon">
              <UploadIcon size={22} />
            </span>
            <div>
              <strong>Drop file or click to browse</strong>
              <span>{accept.replaceAll(",", " · ")}</span>
            </div>
          </div>
        )}
      </div>

      {detail && !error ? <p className="drop-detail">{detail}</p> : null}
      {error ? <p className="drop-error">{error}</p> : null}
    </div>
  );
}
