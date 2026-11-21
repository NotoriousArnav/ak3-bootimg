// android-fastboot bundles an old zip.js that references Node's `url` module in
// a dead branch (`typeof document === 'undefined'`). In the browser that branch
// never runs; this shim keeps the bundler quiet and provides a valid `URL`.
export const URL = globalThis.URL;
export default { URL };
