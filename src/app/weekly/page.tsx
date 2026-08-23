import type { Metadata } from "next";
import { WeeklyHq } from "@/components/weekly-hq";

export const metadata: Metadata = {
  title: "Weekly HQ",
  description: "Lineup alerts and start-sit reads for the league you synced.",
  robots: { index: false, follow: false },
};

export default function WeeklyPage() {
  return <WeeklyHq />;
}
