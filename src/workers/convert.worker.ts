import { convertAk3 } from "../lib/convert/convert";
import type { ConvertRequest, ConvertResponse } from "../lib/convert/protocol";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (message: ConvertResponse, transfer?: Transferable[]) => void;
};

ctx.onmessage = async (event) => {
  const { id, zip, template, zipName, templateName } = event.data;
  const post = (message: ConvertResponse, transfer?: Transferable[]) => ctx.postMessage(message, transfer ?? []);

  try {
    const result = await convertAk3(
      { zip: new Uint8Array(zip), template: new Uint8Array(template), zipName, templateName },
      (percent, message) => post({ id, type: "progress", percent, message }),
    );
    const output = result.bootImg.slice();
    post({ id, type: "done", bootImg: output.buffer as ArrayBuffer, report: result.report }, [output.buffer as ArrayBuffer]);
  } catch (error) {
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
