# Dexter Dogfood Runbook

## Objective
Run multiple realistic project scenarios through Dexter and track:

- readiness pass-rate
- memory hit-rate
- repeated failure rate
- average time-to-ready

## Commands

```bash
npm run dogfood:run
npm run dogfood:metrics
```

## Artifacts

- `artifacts/release/dogfood_run_report.json`
- `artifacts/release/dogfood_metrics.json`

## Recommended cadence

- Run dogfood scenarios after each major feature wave.
- Compare metrics against previous wave before promoting defaults.
