import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { WarRoomHero } from "@/components/landing/war-room-hero";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/config/site";

import { LiveRooms } from "./live-rooms";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
    },
    {
      "@type": "WebApplication",
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "SportsApplication",
      operatingSystem: "Any",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function LandingPage() {
  const dateline = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })
    .format(new Date())
    .toUpperCase();
  return (
    <main className={styles.landing}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={styles.broadcastBar}>
        <span>2026 DRAFT CENTER</span>
        <span>LIVE BOARDS · ROSTER-AWARE RANKS · POST-DRAFT GRADES</span>
        <span>{dateline} · 2026 SEASON</span>
      </div>

      <header className={styles.nav}>
        <Link className={styles.brand} href="/" aria-label="Draft Dojo home">
          <Image src="/brand-icon.svg" width={42} height={42} alt="" unoptimized priority />
          <span>
            <strong>DRAFT DOJO</strong>
            <small>FANTASY WAR ROOM</small>
          </span>
        </Link>
        <nav>
          <Link href="/demo">Live rooms</Link>
          <a href="#film-room">Film room</a>
          <a href="https://github.com/dconroy/dojo.football" target="_blank" rel="noreferrer">
            Source
          </a>
          <Link className={styles.navCta} href="/login">
            Sync a league
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>BUILT FOR THE 90 SECONDS THAT DECIDE YOUR SEASON</p>
          <h1>
            Your board changed.
            <br />
            <em>Your pick should too.</em>
          </h1>
          <p className={styles.heroLead}>
            Draft Dojo watches every selection, reads your roster, and rebuilds your
            best five before you&apos;re on the clock.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/demo#create">
              Enter a draft room <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.secondaryAction} href="/login">
              Connect Sleeper or Yahoo
            </Link>
          </div>
          <div className={styles.heroFacts} aria-label="Product facts">
            <span><b>01</b> No signup for public mocks</span>
            <span><b>02</b> You make every pick</span>
            <span><b>03</b> Free and MIT licensed</span>
          </div>
        </div>
        <WarRoomHero />
      </section>

      <section className={styles.liveSection} aria-labelledby="live-heading">
        <header>
          <p>PUBLIC DRAFT NETWORK</p>
          <h2 id="live-heading">A room is open. Take a seat.</h2>
        </header>
        <LiveRooms />
      </section>

      <section className={styles.filmRoom} id="film-room">
        <div className={styles.sectionHeading}>
          <p>HOW THE BOARD THINKS</p>
          <h2>One draft. Three views of the room.</h2>
          <p>
            Rankings tell you who is good. Draft Dojo tells you who fits this roster,
            at this pick, against this room.
          </p>
        </div>

        <div className={styles.proofGrid}>
          <figure className={styles.proofPrimary}>
            <div className={styles.proofLabel}>
              <span>01 / THE LIVE BOARD</span>
              <strong>Every pick in context</strong>
            </div>
            <Image
              src="/landing/draft-board.png"
              width={1280}
              height={720}
              alt="Completed 14-team snake draft board with player portraits, positions, bye weeks, and every selection by round"
              sizes="(max-width: 1200px) 100vw, 1200px"
            />
          </figure>
          <div className={styles.proofStack}>
            <figure className={styles.proofRecommendations}>
              <div className={styles.proofLabel}>
                <span>02 / THE READ</span>
                <strong>Why the board moved</strong>
              </div>
              <Image
                src="/landing/ai-insights.png"
                width={1098}
                height={1433}
                alt="Top Five recommendation list recalculated after every draft pick"
                sizes="(max-width: 700px) 100vw, 50vw"
              />
            </figure>
            <figure>
              <div className={styles.proofLabel}>
                <span>03 / THE VERDICT</span>
                <strong>Grades when the clock stops</strong>
              </div>
              <Image
                src="/landing/report-card.png"
                width={1280}
                height={720}
                alt="Post-draft leaderboard ranking all teams with letter grades, roster counts, and a concise verdict"
                sizes="(max-width: 700px) 100vw, 50vw"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className={styles.sourceSection}>
        <div>
          <p>THE WHOLE PLAYBOOK IS PUBLIC · MIT</p>
          <h2>Audit the ranking math. Change the weights. Run your own room.</h2>
        </div>
        <a href="https://github.com/dconroy/dojo.football" target="_blank" rel="noreferrer">
          View the repository <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/">
          <Image src="/brand-icon.svg" width={34} height={34} alt="" unoptimized />
          <span><strong>DRAFT DOJO</strong><small>FANTASY WAR ROOM</small></span>
        </Link>
        <p>
          You still make the pick in Sleeper or Yahoo. Not affiliated with Yahoo,
          Sleeper, or any ranking publisher.
        </p>
        <a href="https://github.com/dconroy/dojo.football" target="_blank" rel="noreferrer">
          GITHUB · MIT
        </a>
      </footer>
    </main>
  );
}
