import type { ConversionReport } from "./types";

export interface ConvertRequest {
  id: number;
  zip: ArrayBuffer;
  template: ArrayBuffer;
  zipName: string;
  templateName: string;
}

export type ConvertResponse =
  | { id: number; type: "progress"; percent: number; message: string }
  | { id: number; type: "done"; bootImg: ArrayBuffer; report: ConversionReport }
  | { id: number; type: "error"; message: string };
