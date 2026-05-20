import { describe, expect, it } from "vitest";
import { createApprovalRecord, isApprovalValid } from "../src/policy/approval.js";

describe("signed approvals", () => {
  it("accepts valid signed approvals", () => {
    const record = createApprovalRecord("proj-a", "plan-digest-1", "key-123", { ttlMinutes: 5, approvedBy: "alice" });
    expect(isApprovalValid("proj-a", "plan-digest-1", record, "key-123")).toBe(true);
  });

  it("rejects tampered signatures", () => {
    const record = createApprovalRecord("proj-b", "plan-digest-1", "key-123", { ttlMinutes: 5, approvedBy: "alice" });
    record.signature = "bad-signature";
    expect(isApprovalValid("proj-b", "plan-digest-1", record, "key-123")).toBe(false);
  });

  it("rejects expired approvals", () => {
    const record = createApprovalRecord("proj-c", "plan-digest-1", "key-123", { ttlMinutes: -1, approvedBy: "alice" });
    expect(isApprovalValid("proj-c", "plan-digest-1", record, "key-123")).toBe(false);
  });

  it("rejects approval bound to different planning digest", () => {
    const record = createApprovalRecord("proj-d", "plan-digest-1", "key-123", { ttlMinutes: 5, approvedBy: "alice" });
    expect(isApprovalValid("proj-d", "plan-digest-2", record, "key-123")).toBe(false);
  });
});
