import type { Metadata } from "next";

import { StatsDashboardClient } from "@/components/stats-dashboard-client";

export const metadata: Metadata = {
  title: "Stats Dashboard | LLM Battle",
  description: "Compare and sort historical build-off results across past runs.",
};

export default function StatsPage() {
  return <StatsDashboardClient />;
}
