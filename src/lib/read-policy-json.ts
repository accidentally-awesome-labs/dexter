import path from "node:path";
import fs from "fs-extra";

export async function readPolicyJsonPath(rootDir: string, relativePolicyPath: string): Promise<string> {
  const candidates = [path.join(rootDir, relativePolicyPath), path.join(process.cwd(), relativePolicyPath)];
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Policy not found: ${relativePolicyPath} (searched under ${rootDir} and ${process.cwd()})`,
  );
}

export async function readPolicyJson<T>(
  rootDir: string,
  relativePolicyPath: string,
  parse: (raw: unknown) => T,
): Promise<T> {
  const resolved = await readPolicyJsonPath(rootDir, relativePolicyPath);
  return parse(await fs.readJson(resolved));
}
