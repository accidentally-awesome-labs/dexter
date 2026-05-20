export type RadarRing = "adopt" | "trial" | "assess" | "hold";

export interface RadarEntry {
  category: "runtime" | "memory" | "knowledge_base" | "observability" | "evals" | "deployment";
  tool: string;
  ring: RadarRing;
  rationale: string;
  reviewDate: string;
}

export function defaultRadarEntries(): RadarEntry[] {
  const nextQuarter = new Date();
  nextQuarter.setMonth(nextQuarter.getMonth() + 3);
  const reviewDate = nextQuarter.toISOString().slice(0, 10);

  return [
    {
      category: "runtime",
      tool: "TypeScript + Node.js LTS",
      ring: "adopt",
      rationale: "Strong ecosystem and fast iteration.",
      reviewDate,
    },
    {
      category: "memory",
      tool: "Temporal graph memory + vector recall",
      ring: "trial",
      rationale: "High upside with added operational complexity.",
      reviewDate,
    },
    {
      category: "deployment",
      tool: "Coolify adapter",
      ring: "adopt",
      rationale: "Best v1 breadth; adapter architecture preserves optionality.",
      reviewDate,
    },
  ];
}
