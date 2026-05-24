/**
 * Point a Coolify docker-image app at a published GHCR manifest and deploy.
 *
 * Usage:
 *   npm run coolify:ghcr-wire
 *   npm run coolify:ghcr-wire -- --image-ref ghcr.io/org/dexter:run-abc --app dexter
 *   npm run coolify:ghcr-wire -- --manifest artifacts/release/REGISTRY_PUBLISH_DRILL.json
 */
import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { createCoolifyClientFromEnv } from "../providers/deployment/coolify-client.js";

dotenv.config();

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function parseImageRef(imageRef: string): { image: string; tag: string } {
  const trimmed = imageRef.trim();
  const lastColon = trimmed.lastIndexOf(":");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastColon > lastSlash) {
    return {
      image: trimmed.slice(0, lastColon),
      tag: trimmed.slice(lastColon + 1),
    };
  }
  return { image: trimmed, tag: "latest" };
}

async function resolveImageRef(rootDir: string): Promise<string> {
  const explicit = parseArg("--image-ref");
  if (explicit) {
    return explicit;
  }

  const manifestPath = parseArg("--manifest");
  if (manifestPath) {
    const manifest = (await fs.readJson(path.resolve(rootDir, manifestPath))) as {
      imageRef?: string;
      publish?: { imageRef?: string };
    };
    const ref = manifest.publish?.imageRef ?? manifest.imageRef;
    if (ref) {
      return ref;
    }
  }

  const drillPath = path.join(rootDir, "artifacts", "release", "REGISTRY_PUBLISH_DRILL.json");
  if (await fs.pathExists(drillPath)) {
    const drill = (await fs.readJson(drillPath)) as { imageRef?: string };
    if (drill.imageRef) {
      return drill.imageRef;
    }
  }

  const runsDir = path.join(rootDir, "runs");
  if (await fs.pathExists(runsDir)) {
    const entries = await fs.readdir(runsDir);
    let latest: { mtime: number; manifestPath: string } | null = null;
    for (const runId of entries) {
      const manifestPath = path.join(runsDir, runId, "deploy_manifest.json");
      if (!(await fs.pathExists(manifestPath))) {
        continue;
      }
      const manifest = (await fs.readJson(manifestPath)) as {
        imageRef?: string;
        publish?: { published?: boolean; imageRef?: string };
      };
      const ref = manifest.publish?.published ? manifest.publish.imageRef ?? manifest.imageRef : manifest.imageRef;
      if (!ref?.includes("ghcr.io/")) {
        continue;
      }
      const stat = await fs.stat(manifestPath);
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { mtime: stat.mtimeMs, manifestPath };
      }
    }
    if (latest) {
      const manifest = (await fs.readJson(latest.manifestPath)) as {
        imageRef?: string;
        publish?: { imageRef?: string };
      };
      const ref = manifest.publish?.imageRef ?? manifest.imageRef;
      if (ref) {
        return ref;
      }
    }
  }

  throw new Error(
    "No GHCR imageRef found. Publish first (npm run registry:publish-drill) or pass --image-ref.",
  );
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const appName = parseArg("--app") ?? "dexter";
  const skipDeploy = process.argv.includes("--skip-deploy");

  const client = createCoolifyClientFromEnv(rootDir);
  if (!client) {
    throw new Error("Set COOLIFY_ORIGIN and COOLIFY_API_TOKEN in .env");
  }

  const imageRef = await resolveImageRef(rootDir);
  const { image, tag } = parseImageRef(imageRef);

  const updated = await client.updateApplicationDockerImage(appName, { image, tag, rootDir });
  console.log(
    JSON.stringify(
      {
        appName,
        imageRef,
        coolifyImage: updated.docker_registry_image_name ?? image,
        coolifyTag: updated.docker_registry_image_tag ?? tag,
      },
      null,
      2,
    ),
  );

  if (skipDeploy) {
    return;
  }

  const deploy = await client.deployApplication(appName, {
    rootDir,
    force: true,
    syncManifestImage: { image, tag },
  });
  console.log(JSON.stringify({ deploy }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
