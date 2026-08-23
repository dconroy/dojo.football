import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0a120d",
    theme_color: "#0f2d1d",
    icons: [
      {
        src: "/brand-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/dojo-mark.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
