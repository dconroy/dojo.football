import { useState } from "react";
import type { DraftBoardReport, TeamReportCard } from "@/domain/draft-report";
import { PLAYER_POSITIONS } from "@/domain/types";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";

export function DraftReportCard({
  report,
  userSlot,
  teamLabel,
  onClose,
}: {
  report: DraftBoardReport;
  userSlot: number;
  teamLabel: (slot: number) => string;
  onClose: () => void;
}) {
  const [openSlot, setOpenSlot] = useState(userSlot);
  const mine = report.teams.find((team) => team.slot === userSlot);
  const dialogRef = useDialogAccessibility<HTMLElement>(true, onClose);

  return (
    <div className="launcher-overlay" onClick={onClose}>
      <section
        ref={dialogRef}
        className="launcher report-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-card-title"
        tabIndex={-1}
      >
        <header className="launcher-head">
          <div>
            <p className="eyebrow">
              {report.complete ? "Final grades" : "Draft in progress"}
            </p>
            <h2 id="report-card-title">Draft report card</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {mine && (
          <div className={`report-hero grade-${mine.grade[0]}`}>
            <div className="report-hero-grade">
              <strong>{mine.grade}</strong>
              <small>{ordinal(mine.rank)} of {report.teams.length}</small>
            </div>
            <div className="report-hero-body">
              <p className="report-hero-team">
                {teamLabel(mine.slot)} · your team
              </p>
              <p className="report-hero-summary">{mine.summary}</p>
              <ul className="report-reasons">
                {mine.reasons.map((reason, index) => (
                  <li key={index} className={`tone-${reason.tone}`}>
                    {reason.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <ol className="report-board">
          {report.teams.map((team) => (
            <TeamRow
              key={team.slot}
              team={team}
              label={teamLabel(team.slot)}
              mine={team.slot === userSlot}
              expanded={team.slot === openSlot}
              onToggle={() =>
                setOpenSlot((current) =>
                  current === team.slot ? -1 : team.slot,
                )
              }
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

function TeamRow({
  team,
  label,
  mine,
  expanded,
  onToggle,
}: {
  team: TeamReportCard;
  label: string;
  mine: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`report-row grade-${team.grade[0]} ${mine ? "mine" : ""} ${expanded ? "open" : ""}`}>
      <button type="button" className="report-row-head" onClick={onToggle}>
        <span className="report-rank">{team.rank}</span>
        <span className="report-grade">{team.grade}</span>
        <span className="report-row-copy">
          <b>
            {label}
            {mine ? " · you" : ""}
          </b>
          <small>{team.summary}</small>
        </span>
        <span className="report-pos">
          {PLAYER_POSITIONS.map((position) => (
            <i
              key={position}
              className={team.positionCounts[position] === 0 ? "zero" : ""}
            >
              {team.positionCounts[position]}
              {position}
            </i>
          ))}
        </span>
        <span className="report-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="report-detail">
          <ul className="report-reasons">
            {team.reasons.map((reason, index) => (
              <li key={index} className={`tone-${reason.tone}`}>
                {reason.text}
              </li>
            ))}
          </ul>
          <ol className="report-roster">
            {team.picks.map((pick) => (
              <li key={`${pick.overall}-${pick.player.id}`}>
                <em>
                  {pick.round}.{pick.slot}
                </em>
                <b>{pick.player.name}</b>
                <small>
                  {pick.player.position}
                  {pick.player.chenRank ? ` · Chen ${pick.player.chenRank}` : ""}
                  {pick.player.byeWeek ? ` · Bye ${pick.player.byeWeek}` : ""}
                </small>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
