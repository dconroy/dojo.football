import Image from "next/image";

import styles from "@/app/landing.module.css";

const boardPicks = [
  { pick: "1.01", initials: "BR", position: "RB", active: false },
  { pick: "1.02", initials: "JC", position: "WR", active: false },
  { pick: "1.03", initials: "BH", position: "RB", active: false },
  { pick: "1.04", initials: "PN", position: "WR", active: false },
  { pick: "1.05", initials: "AS", position: "WR", active: false },
  { pick: "1.06", initials: "JJ", position: "WR", active: false },
  { pick: "1.07", initials: "YOU", position: "", active: true },
  { pick: "1.08", initials: "—", position: "", active: false },
  { pick: "1.09", initials: "—", position: "", active: false },
  { pick: "1.10", initials: "—", position: "", active: false },
] as const;

const recommendations = [
  {
    rank: 1,
    name: "Bijan Robinson",
    detail: "Last Tier 1 RB",
    position: "RB",
    move: "↑ 2",
    image: "https://sleepercdn.com/content/nfl/players/9509.jpg",
  },
  {
    rank: 2,
    name: "Breece Hall",
    detail: "Scarcity before the turn",
    position: "RB",
    move: "↑ 1",
    image: "https://sleepercdn.com/content/nfl/players/8155.jpg",
  },
  {
    rank: 3,
    name: "Puka Nacua",
    detail: "Value holds at 1.07",
    position: "WR",
    move: "—",
    image: "https://sleepercdn.com/content/nfl/players/9493.jpg",
  },
] as const;

export function WarRoomHero() {
  return (
    <div className={styles.warRoom}>
      <div className={styles.warRoomTopline}>
        <span className={styles.clockLabel}>RD 1 · PICK 07</span>
        <span className={styles.clockTime}>00:42</span>
        <span className={styles.clockStatus}>YOU&apos;RE ON THE CLOCK</span>
      </div>

      <div className={styles.draftTrack}>
        <svg
          className={styles.draftTrackLine}
          viewBox="0 0 1000 130"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M 30 35 H 930 Q 970 35 970 65 Q 970 95 930 95 H 30" />
          <path d="M 30 35 H 625" />
        </svg>
        <ol className={styles.draftNodes}>
          {boardPicks.map((item) => (
            <li
              key={item.pick}
              className={item.active ? styles.activeDraftNode : styles.draftNode}
            >
              <small>{item.pick}</small>
              <strong>{item.initials}</strong>
              {item.position ? <span>{item.position}</span> : null}
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.warRoomBody}>
        <div className={styles.boardCallout}>
          <span className={styles.annotationLine} aria-hidden="true" />
          <p>Jefferson went at 1.06</p>
          <strong>RB scarcity just changed your board.</strong>
        </div>

        <section className={styles.shortlist} aria-label="Recalculated player shortlist">
          <header>
            <div>
              <span>YOUR BOARD</span>
              <strong>Recalculated at pick 1.07</strong>
            </div>
            <b>LIVE</b>
          </header>
          <ol>
            {recommendations.map((player) => (
              <li key={player.name}>
                <span className={styles.shortlistRank}>0{player.rank}</span>
                <Image
                  src={player.image}
                  width={58}
                  height={58}
                  alt=""
                  unoptimized
                />
                <span className={styles.shortlistPlayer}>
                  <strong>{player.name}</strong>
                  <small>{player.detail}</small>
                </span>
                <span className={styles.shortlistPosition}>{player.position}</span>
                <span className={player.move === "—" ? styles.moveFlat : styles.moveUp}>
                  {player.move}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className={styles.warRoomFooter}>
        <span>CHEN CONSENSUS · HALF PPR</span>
        <span>ROSTER: 0 QB · 0 RB · 0 WR</span>
        <strong>BOARD UPDATED 2s AGO</strong>
      </div>
    </div>
  );
}
