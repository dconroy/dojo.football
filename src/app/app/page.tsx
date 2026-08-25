import type { Metadata } from "next";
import dynamic from "next/dynamic";

const DraftAssistant = dynamic(
  () =>
    import("@/components/draft-assistant").then((mod) => ({
      default: mod.DraftAssistant,
    })),
  { loading: () => <div className="loading">Opening the board…</div> },
);

export const metadata: Metadata = {
  title: "Draft board",
  description: "Live recommendations for the league you synced.",
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <DraftAssistant />;
}
