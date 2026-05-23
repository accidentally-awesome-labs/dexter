import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { githubIssueAdapter } from "../src/intake/adapters/issue.js";
import { cliPromptAdapter } from "../src/intake/adapters/cli-prompt.js";
import { templateAdapter } from "../src/intake/adapters/template.js";
import { arePlanningEquivalent, intakePlanningFingerprint } from "../src/intake/equivalence.js";
import {
  normalizeFromCliPrompt,
  normalizeFromIssuePayload,
  normalizeFromTemplatePayload,
} from "../src/intake/normalize.js";
import { assertNoSourceLeakage, toDiscoveryBrief, toIdeaInput } from "../src/intake/planning-bridge.js";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "intake");

describe("intake source adapters", () => {
  it("maps github issue labels without leaking source-only fields", async () => {
    const issueRaw = await fs.readJson(path.join(fixturesDir, "github-issue.json"));
    const brief = githubIssueAdapter.normalize(issueRaw);

    expect(brief.source.type).toBe("issue");
    expect(brief.source.externalId).toBe("GH-123");
    expect(brief.request.labels).toEqual(["api", "security"]);
    expect(Object.keys(brief.request)).not.toContain("assignees");
    expect(Object.keys(brief.request)).not.toContain("milestone");
    expect(Object.keys(brief.request)).not.toContain("url");
    assertNoSourceLeakage(brief);
  });

  it("produces planning-equivalent briefs for cli prompt and issue sources", async () => {
    const cliRaw = await fs.readJson(path.join(fixturesDir, "cli-prompt-equivalent.json"));
    const issueRaw = await fs.readJson(path.join(fixturesDir, "github-issue.json"));

    const fromCli = cliPromptAdapter.normalize(cliRaw);
    const fromIssue = githubIssueAdapter.normalize({
      project: issueRaw.project,
      title: issueRaw.title,
      body: issueRaw.body,
      number: issueRaw.number,
      constraints: issueRaw.constraints,
      targetUsers: issueRaw.targetUsers,
      labels: [],
    });

    expect(arePlanningEquivalent(fromCli, fromIssue)).toBe(true);
    expect(intakePlanningFingerprint(fromCli)).toEqual(intakePlanningFingerprint(fromIssue));
    expect(fromIssue.source.type).toBe("issue");
    expect(fromCli.source.type).toBe("cli-prompt");
  });

  it("normalizes template adapter into the same contract", () => {
    const brief = templateAdapter.normalize({
      project: "billing-api",
      templateId: "api-endpoint",
      variables: {
        method: "POST",
        path: "/invoices/export",
        resource: "invoice export",
      },
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });

    expect(brief.source.type).toBe("template");
    expect(brief.request.labels).toContain("api");
    expect(brief.request.acceptanceSignals.length).toBeGreaterThan(0);
    assertNoSourceLeakage(brief);
  });

  it("bridges intake brief to planning input without source metadata", () => {
    const brief = normalizeFromIssuePayload({
      project: "billing-api",
      title: "Add invoice export endpoint",
      body: "Expose CSV export for monthly invoices with role-based access control.",
      labels: ["api"],
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
      externalId: "GH-123",
      number: 123,
    });

    const idea = toIdeaInput(brief);
    expect(idea).toEqual({
      project: "billing-api",
      idea: brief.request.description,
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });
    expect(JSON.stringify(idea)).not.toContain("GH-123");
    expect(JSON.stringify(idea)).not.toContain("github");

    const discovery = toDiscoveryBrief(brief);
    expect(discovery).toContain("invoice export");
    expect(discovery).not.toContain("assignees");
  });

  it("keeps backward-compatible normalize helpers", () => {
    const cli = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Build an internal billing API with audit logs.",
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });
    const issue = normalizeFromIssuePayload({
      project: "billing-api",
      title: "Build an internal billing API",
      body: "with audit logs.",
      constraints: ["SOC2"],
      targetUsers: ["finance-ops"],
    });
    const template = normalizeFromTemplatePayload({
      project: "billing-api",
      templateId: "bugfix",
      variables: { component: "billing-api", symptom: "duplicate charge" },
    });

    expect(cli.source.type).toBe("cli-prompt");
    expect(issue.source.type).toBe("issue");
    expect(template.source.type).toBe("template");
    assertNoSourceLeakage(cli);
    assertNoSourceLeakage(issue);
    assertNoSourceLeakage(template);
  });
});
