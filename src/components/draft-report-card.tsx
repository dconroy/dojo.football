import { useEffect, useMemo, useState } from "react";
import type { DraftBoardReport, TeamReportCard } from "@/domain/draft-report";
import {
  buildReportCardShareModel,
  REPORT_CARD_IMAGE_HEIGHT,
  REPORT_CARD_IMAGE_WIDTH,
  reportCardFileName,
  wrapTextLines,
  type ReportCardShareModel,
} from "@/domain/report-card-share";
import { PLAYER_POSITIONS } from "@/domain/types";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";
import { demoFetch as fetch } from "@/lib/demo-tab-session";

export function DraftReportCard({
  report,
  userSlot,
  teamLabel,
  draftId,
  onClose,
}: {
  report: DraftBoardReport;
  userSlot: number;
  teamLabel: (slot: number) => string;
  draftId?: string | null;
  onClose: () => void;
}) {
  const [openSlot, setOpenSlot] = useState(userSlot);
  const [story, setStory] = useState("");
  const [storyStatus, setStoryStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [shareStatus, setShareStatus] = useState("");
  const [fileShareSupported, setFileShareSupported] = useState(false);
  const mine = report.teams.find((team) => team.slot === userSlot);
  const shareModel = useMemo(
    () => mine
      ? buildReportCardShareModel(
          mine,
          teamLabel(mine.slot),
          report.teams.length,
          story,
        )
      : null,
    [mine, report.teams.length, story, teamLabel],
  );
  const dialogRef = useDialogAccessibility<HTMLElement>(true, onClose);

  useEffect(() => {
    if (
      typeof navigator === "undefined"
      || typeof navigator.share !== "function"
      || typeof navigator.canShare !== "function"
      || typeof File === "undefined"
    ) return;
    try {
      const probe = new File([""], "report-card.png", { type: "image/png" });
      setFileShareSupported(navigator.canShare({ files: [probe] }));
    } catch {
      setFileShareSupported(false);
    }
  }, []);

  useEffect(() => {
    if (!report.complete || userSlot < 1 || !draftId) return;
    let cancelled = false;
    setStoryStatus("loading");
    void fetch(`/api/draft/story?draftId=${encodeURIComponent(draftId)}`, {
      method: "POST",
    })
      .then((response) => response.json())
      .then((body: { story?: string | null }) => {
        if (cancelled) return;
        if (body.story) {
          setStory(body.story);
          setStoryStatus("ready");
          return;
        }
        setStoryStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStoryStatus("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [report.complete, report.totalPicks, userSlot, draftId]);

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
              {storyStatus === "loading" ? (
                <p className="report-story pending">Writing your recap…</p>
              ) : null}
              {storyStatus === "ready" && story ? (
                <div className="report-story">
                  <p className="eyebrow">Your draft story</p>
                  <p>{story}</p>
                </div>
              ) : null}
              {shareModel ? (
                <div
                  aria-label="Share report card"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "0.55rem",
                    marginTop: "0.9rem",
                  }}
                >
                  {fileShareSupported ? (
                    <button
                      type="button"
                      className="secondary report-share"
                      onClick={() => {
                        void shareReportCard(shareModel, setShareStatus);
                      }}
                    >
                      Share PNG
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary report-share"
                    onClick={() => {
                      void downloadReportCard(shareModel, setShareStatus);
                    }}
                  >
                    Download PNG
                  </button>
                  <small aria-live="polite" style={{ flexBasis: "100%" }}>
                    {shareStatus || "Share your fixed-size report card image."}
                  </small>
                </div>
              ) : null}
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
        {!mine && (
          <p
            className="report-story"
            style={{ marginTop: "0.9rem" }}
          >
            Spectators can view every grade. Image sharing is available to a
            manager from their own draft seat.
          </p>
        )}
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
                  {pick.player.chenRank ? ` · Rank ${pick.player.chenRank}` : ""}
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

async function shareReportCard(
  model: ReportCardShareModel,
  setStatus: (status: string) => void,
): Promise<void> {
  try {
    const blob = await renderReportCardPng(model);
    const file = new File([blob], reportCardFileName(model.teamName), {
      type: "image/png",
    });
    if (
      typeof navigator.share !== "function"
      || typeof navigator.canShare !== "function"
      || !navigator.canShare({ files: [file] })
    ) {
      setStatus("File sharing is not supported here. Download the PNG instead.");
      return;
    }
    await navigator.share({ files: [file] });
    setStatus("Report card shared.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setStatus("Sharing failed. You can still download the PNG.");
  }
}

async function downloadReportCard(
  model: ReportCardShareModel,
  setStatus: (status: string) => void,
): Promise<void> {
  try {
    const blob = await renderReportCardPng(model);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = reportCardFileName(model.teamName);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    setStatus("PNG downloaded.");
  } catch {
    setStatus("Could not create the PNG in this browser.");
  }
}

function renderReportCardPng(model: ReportCardShareModel): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = REPORT_CARD_IMAGE_WIDTH;
  canvas.height = REPORT_CARD_IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas is unavailable"));

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#06131f");
  gradient.addColorStop(0.62, "#0b2234");
  gradient.addColorStop(1, "#123b4d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(148, 210, 197, 0.055)";
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 60) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 60) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.fillStyle = "rgba(94, 234, 212, 0.055)";
  context.beginPath();
  context.arc(1115, 10, 245, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(10, 650, 230, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#5eead4";
  context.fillRect(60, 42, 7, 30);
  context.fillStyle = "#5eead4";
  context.font = "800 24px system-ui, -apple-system, sans-serif";
  context.fillText("DRAFT DOJO", 82, 66);
  context.fillStyle = "#9fb4c8";
  context.font = "650 15px system-ui, -apple-system, sans-serif";
  context.fillText("POST-DRAFT REPORT CARD", 82, 91);
  context.textAlign = "right";
  context.fillStyle = "#d8fff8";
  context.font = "800 20px system-ui, -apple-system, sans-serif";
  context.fillText(model.url, 1140, 61);
  context.fillStyle = "#8fa8b8";
  context.font = "650 12px system-ui, -apple-system, sans-serif";
  context.fillText("FREE MOCK DRAFTS · LIVE RECOMMENDATIONS", 1140, 84);
  context.textAlign = "left";
  context.fillStyle = "rgba(159, 180, 200, 0.24)";
  context.fillRect(60, 112, 1080, 1);

  roundedRect(context, 60, 140, 278, 302, 24);
  context.fillStyle = "rgba(3, 12, 22, 0.72)";
  context.fill();
  context.strokeStyle = "rgba(94, 234, 212, 0.42)";
  context.lineWidth = 2;
  context.stroke();

  context.fillStyle = "#d8fff8";
  context.font = "800 28px system-ui, -apple-system, sans-serif";
  drawLines(context, model.teamName, 88, 187, 222, 33, 2);
  context.fillStyle = "#ffffff";
  context.font = "900 150px system-ui, -apple-system, sans-serif";
  context.textAlign = "center";
  context.fillText(model.grade, 199, 352);
  context.fillStyle = "#5eead4";
  context.font = "850 25px system-ui, -apple-system, sans-serif";
  context.fillText(model.rankLabel.toUpperCase(), 199, 405);
  context.textAlign = "left";

  context.fillStyle = "#5eead4";
  context.font = "750 14px system-ui, -apple-system, sans-serif";
  context.fillText("THE VERDICT", 382, 159);
  context.fillStyle = "#ffffff";
  context.font = "850 34px system-ui, -apple-system, sans-serif";
  drawLines(context, model.summary, 382, 200, 744, 39, 2);
  if (model.story) {
    context.fillStyle = "#b8cbd8";
    context.font = "550 18px system-ui, -apple-system, sans-serif";
    drawLines(context, model.story, 382, 263, 744, 27, 2);
  }

  context.fillStyle = "#9fb4c8";
  context.font = "750 14px system-ui, -apple-system, sans-serif";
  context.fillText("WHY THE GRADE", 382, 332);
  context.font = "650 19px system-ui, -apple-system, sans-serif";
  model.reasons.forEach((reason, index) => {
    const y = 369 + index * 34;
    context.fillStyle = "#5eead4";
    context.beginPath();
    context.arc(389, y - 6, 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#edf7ff";
    drawLines(context, reason, 407, y, 715, 25, 1);
  });

  context.fillStyle = "rgba(2, 10, 18, 0.68)";
  context.fillRect(0, 470, canvas.width, 160);
  context.fillStyle = "#9fb4c8";
  context.font = "750 14px system-ui, -apple-system, sans-serif";
  context.fillText("FOUNDATION PICKS", 60, 504);
  const pickWidth = 206;
  model.picks.forEach((pick, index) => {
    const x = 60 + index * 218;
    roundedRect(context, x, 520, pickWidth, 83, 12);
    context.fillStyle = "rgba(255, 255, 255, 0.045)";
    context.fill();
    context.strokeStyle = "rgba(159, 180, 200, 0.18)";
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = "#5eead4";
    context.font = "800 13px system-ui, -apple-system, sans-serif";
    context.fillText(`${pick.round}  ·  ${pick.position}`, x + 14, 546);
    context.fillStyle = "#ffffff";
    context.font = "700 17px system-ui, -apple-system, sans-serif";
    drawLines(context, pick.name, x + 14, 575, pickWidth - 28, 20, 2);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    );
  });
}

function drawLines(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const lines = wrapTextLines(
    text,
    maxWidth,
    (value) => context.measureText(value).width,
    maxLines,
  );
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
