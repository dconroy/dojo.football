import type { Metadata } from "next";
import dynamic from "next/dynamic";

const ScribeBoard = dynamic(
  () =>
    import("@/components/scribe-board").then((mod) => ({
      default: mod.ScribeBoard,
    })),
  { loading: () => <div className="loading">Opening the Chen scribe…</div> },
);

export const metadata: Metadata = {
  title: "Local Chen scribe",
  description:
    "Record a live Yahoo draft by name and get Boris Chen 0.5 PPR recommendations for slot 6.",
  robots: { index: false, follow: false },
};

export default function ScribePage() {
  return <ScribeBoard />;
}
