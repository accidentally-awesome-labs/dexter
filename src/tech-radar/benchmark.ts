import path from "node:path";
import fs from "fs-extra";

interface BenchmarkRow {
  category: string;
  candidate: string;
  performance: number;
  reliability: number;
  integrationEffort: number;
  securityPosture: number;
  costEfficiency: number;
  weightedScore: number;
}

function weightedScore(row: Omit<BenchmarkRow, "weightedScore">): number {
  return (
    row.performance * 0.25 +
    row.reliability * 0.25 +
    row.integrationEffort * 0.15 +
    row.securityPosture * 0.2 +
    row.costEfficiency * 0.15
  );
}

async function main() {
  const rows: Omit<BenchmarkRow, "weightedScore">[] = [
    {
      category: "control-plane",
      candidate: "coolify",
      performance: 8.4,
      reliability: 8.3,
      integrationEffort: 8.7,
      securityPosture: 8.1,
      costEfficiency: 8.6,
    },
    {
      category: "control-plane",
      candidate: "dokploy",
      performance: 8.6,
      reliability: 8.4,
      integrationEffort: 7.8,
      securityPosture: 8.0,
      costEfficiency: 8.3,
    },
    {
      category: "memory",
      candidate: "graph+vector-hybrid",
      performance: 8.0,
      reliability: 7.8,
      integrationEffort: 6.9,
      securityPosture: 8.1,
      costEfficiency: 7.4,
    },
    {
      category: "memory",
      candidate: "vector-only",
      performance: 7.4,
      reliability: 8.2,
      integrationEffort: 8.9,
      securityPosture: 8.0,
      costEfficiency: 8.2,
    },
  ];

  const scored: BenchmarkRow[] = rows.map((row) => ({
    ...row,
    weightedScore: Number(weightedScore(row).toFixed(2)),
  }));

  const outDir = path.join(process.cwd(), "tech-radar");
  await fs.ensureDir(outDir);
  await fs.writeJson(path.join(outDir, "benchmark_results.json"), scored, { spaces: 2 });
  console.log(JSON.stringify(scored, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
