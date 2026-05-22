import { fileURLToPath } from "node:url";

export function isCliEntry(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(moduleUrl) === entry;
}
