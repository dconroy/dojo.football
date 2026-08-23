import type { Metadata } from "next";

import { DraftAssistant } from "@/components/draft-assistant";
import { DemoLobby } from "./lobby";

const LOBBY_TITLE = "Live fantasy draft rooms";
const LOBBY_DESCRIPTION =
  "Join a public mock or create a room. Draft Dojo rebuilds your top five after every pick — no signup required.";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}): Promise<Metadata> {
  const { room } = await searchParams;
  if (room) {
    return {
      title: "Live draft room",
      description: LOBBY_DESCRIPTION,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: LOBBY_TITLE,
    description: LOBBY_DESCRIPTION,
    alternates: { canonical: "/demo" },
    openGraph: {
      title: LOBBY_TITLE,
      description: LOBBY_DESCRIPTION,
      url: "/demo",
    },
  };
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  return room ? <DraftAssistant variant="demo" /> : <DemoLobby />;
}
