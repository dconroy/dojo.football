import type { Metadata } from "next";

import { DraftAssistant } from "@/components/draft-assistant";

export const metadata: Metadata = {
  title: "Draft board",
  description: "Live recommendations for the league you synced.",
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <DraftAssistant />;
}
