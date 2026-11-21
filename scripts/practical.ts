import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { convertAk3 } from "../src/lib/convert/convert.ts";
import { parseBootImage } from "../src/lib/boot/parse.ts";
import { packBootImage } from "../src/lib/boot/pack.ts";
import { formatBytes } from "../src/lib/bytes.ts";

const zipPath = process.argv[2] ?? "temp/wild-6.6.118-ksun.zip";
const templatePath = process.argv[3] ?? "temp/custom_boot.img";
const outPath = process.argv[4] ?? "temp/out-boot.img";

if (!existsSync(zipPath) || !existsSync(templatePath)) {
  console.error(`Missing input.\n  zip: ${zipPath}\n  template: ${templatePath}`);
  process.exit(1);
}

const zip = new Uint8Array(readFileSync(zipPath));
const templateBytes = new Uint8Array(readFileSync(templatePath));

console.log(`zip      ${zipPath} (${formatBytes(zip.length)})`);
console.log(`template ${templatePath} (${formatBytes(templateBytes.length)})`);

const template = parseBootImage(templateBytes);
const identity = await packBootImage(template, { kernel: template.kernel, stripAvb: true, stripSignature: true });
const identical = Buffer.compare(Buffer.from(identity.bytes), Buffer.from(templateBytes)) === 0;
console.log(`identity repack byte-identical: ${identical}`);

const result = await convertAk3(
  { zip, template: templateBytes, zipName: zipPath.split("/").pop(), templateName: templatePath.split("/").pop() },
  (percent, message) => console.log(`  [${String(percent).padStart(3)}%] ${message}`),
);

writeFileSync(outPath, result.bootImg);
console.log(`\nwrote ${outPath} (${formatBytes(result.bootImg.length)})`);
console.log(JSON.stringify(result.report, null, 2));
