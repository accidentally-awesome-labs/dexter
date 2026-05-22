import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { loadSoakSchedulePolicy } from "../src/release/soak-schedule-policy.js";
import {
  computeNextDueAt,
  evaluateSoakScheduleDue,
  initialSoakScheduleState,
  writeSoakScheduleManifest,
  writeSoakScheduleState,
} from "../src/release/soak-schedule.js";

describe("soak schedule", () => {
  it("marks schedule due when interval elapsed", async () => {
    const policy = await loadSoakSchedulePolicy(process.cwd());
    const now = new Date("2026-05-21T12:00:00.000Z");
    const state = {
      ...initialSoakScheduleState(policy, now),
      lastRunAt: "2026-05-21T06:00:00.000Z",
      intervalMinutes: 360,
    };
    const due = evaluateSoakScheduleDue(policy, state, now);
    expect(due.due).toBe(true);
    expect(due.reason).toContain("due");
  });

  it("respects min gap between scheduled runs", async () => {
    const loaded = await loadSoakSchedulePolicy(process.cwd());
    const now = new Date("2026-05-21T12:30:00.000Z");
    const state = {
      ...initialSoakScheduleState(loaded, now),
      lastRunAt: "2026-05-21T12:10:00.000Z",
    };
    const due = evaluateSoakScheduleDue(loaded, state, now);
    expect(due.due).toBe(false);
    expect(due.reason).toContain("Minimum gap");
  });

  it("writes schedule state and manifest artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-soak-schedule-"));
    const policy = await loadSoakSchedulePolicy(process.cwd());
    const state = initialSoakScheduleState(policy);
    const statePath = await writeSoakScheduleState(rootDir, state);
    const manifestPath = await writeSoakScheduleManifest(rootDir, policy, state);
    expect(await fs.pathExists(statePath)).toBe(true);
    expect(await fs.pathExists(manifestPath)).toBe(true);
    const manifest = await fs.readFile(manifestPath, "utf8");
    expect(manifest).toContain(policy.automation.githubActionsCron);
    await fs.remove(rootDir);
  });

  it("computes next due from last run timestamp", () => {
    const next = computeNextDueAt("2026-05-21T10:00:00.000Z", 360);
    expect(next).toBe("2026-05-21T16:00:00.000Z");
  });
});
