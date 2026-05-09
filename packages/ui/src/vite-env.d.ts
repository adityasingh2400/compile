/// <reference types="vite/client" />

/**
 * Type declarations for Vite's `?raw` query suffix — lets us
 * `import txt from "./file.jsonl?raw"` and get the file contents as
 * a string. Vite ships these in `vite/client` but we redeclare here
 * for safety in environments that don't pick up the reference.
 */
declare module "*.jsonl?raw" {
  const content: string;
  export default content;
}

declare module "*.json?raw" {
  const content: string;
  export default content;
}

declare module "*.txt?raw" {
  const content: string;
  export default content;
}
