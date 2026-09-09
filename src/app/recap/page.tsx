import type { Metadata } from "next";

import data from "./recap-data.json";
import { RecapClient } from "./recap-client";

export const metadata: Metadata = {
  title: "Full Contact 2026 · Chen 0.5 PPR report card",
  description: data.dek,
  alternates: { canonical: "/recap" },
  openGraph: {
    title: data.headline,
    description: data.dek,
    url: "/recap",
  },
};

export default function RecapPage() {
  return <RecapClient />;
}
