# Release Command Center

Generated at: 2026-05-22T01:27:51.171Z
Ready for promotion: true
Release decision: GO
Governance passed: true
Unresolved escalations: 0

## Steps
- [pass] ops_status: OPS_STATUS refreshed for 4f147520-ad4a-4aca-a4aa-79b81940a53f
- [pass] release_decision: decision=GO, unresolved=0
- [pass] escalation_inventory: open=0, in_progress=0, waived=0
- [pass] governance_verify: unresolved_operator_high=true; unresolved_escalations=true; promotion_history_count=true; promotion_stage_policy_promotion-local-2026-05-21-001=true; promotion_audit_trail_promotion-local-2026-05-21-001=true; promotion_stage_policy_promotion-local-2026-05-21-002=true; promotion_audit_trail_promotion-local-2026-05-21-002=true; promotion_stage_policy_promotion-local-2026-05-21-003=true; promotion_audit_trail_promotion-local-2026-05-21-003=true
- [warn] promotion_auth: Promotion blocked: canary gates failed. Resolve canary SLO breaches before prod promotion.

## Recommended Commands
- npm run release:center
- npm run ops:status
- npm run release:decision
- npm run escalation:list -- --output table
- npm run governance:verify -- --minimum-promotions 3
- npm run promotion:pipeline
