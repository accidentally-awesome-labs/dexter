# v1.0.0-rc1 Release Candidate

## Scope freeze

- Freeze new feature development.
- Allow only hardening, bug fixes, and release-readiness changes.

## Required checks

- Full validation command sequence passes.
- Pilot batch completed with metrics report.
- `GO_NO_GO.md` generated with explicit decision and criteria.

## Promotion criteria

- Readiness pass rate >= 0.95
- Memory hit rate >= 0.80
- Repeated failure rate <= 0.05
- Avg time to ready <= 5000 ms

## Notes

- Git branch/tagging step is pending if repository is initialized with git.
