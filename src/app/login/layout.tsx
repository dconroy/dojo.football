import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Connect Sleeper or Yahoo";
const DESCRIPTION =
  "Sync a Sleeper or Yahoo league for a live draft board, or jump into a public mock without an account.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/login" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/login",
  },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
