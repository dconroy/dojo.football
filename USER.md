# Draft Dojo — user guide

**Recalculates your top five after every pick.**

Site: [dojo.football](https://dojo.football)

Draft Dojo is a second-screen draft room. It watches the draft, does the math, and tells you who to take. **You still make the real pick in Sleeper or Yahoo.** This app never submits a pick for you.

---

## Three ways in

| Path | Who it’s for | Account? |
|---|---|---|
| **[Try a live demo](https://dojo.football/demo)** | Anyone who wants to click around | No |
| **Connect Sleeper** | Follow a Sleeper draft | Sleeper username |
| **Continue with Yahoo** | Follow a Yahoo draft | Yahoo login |

There is no password gate and nobody has to approve you.

---

## Try the demo

1. Open [dojo.football/demo](https://dojo.football/demo).
2. Choose a listed public draft, select one of its open seats, and click **Join**.
3. Or create a room: choose Standard/Half PPR/Full PPR, 8–14 rosters, 10–16 rounds, and your draft slot.
4. Copy the unique invite link and send it to friends. They open the link and choose any remaining seat.
5. Robots fill empty seats. The room **pauses on your turn** until you confirm.
6. If you sit on the clock for about 30 seconds, the room auto-drafts best-available so it doesn’t stall.

You can leave and come back — your browser remembers the room for a few hours. Use
**Copy invite link** on the board at any time, or **Back to lobby** to find another draft
without resetting the shared room.

---

## Connect your league

### Sleeper

1. Open [dojo.football/login](https://dojo.football/login).
2. Type your Sleeper username and click **Find my drafts**.
3. Pick the 2026 draft you want to follow.
4. Draft in the **Sleeper app**. This board pulls picks and keeps your Top five current.

Anyone can type a username — Sleeper has no official “sign in” for apps. That’s fine for a follow-along board. It does not let someone pick for you in Sleeper.

### Yahoo

1. Open [dojo.football/login](https://dojo.football/login).
2. Click **Continue with Yahoo** and approve access.
3. You’re on your own board immediately.
4. On draft night, an admin (or you, on your board) hits **Start a draft… → Draft night — live**, pastes the league key (looks like `461.l.12345`), and arms the board.
5. Draft in the **Yahoo app**. This board follows `draftresults` and refreshes Top five.

Yahoo live sync only works after Yahoo has approved the app for Fantasy Sports. If the board doesn’t see picks, record them here by hand — recommendations still work.

---

## First thing on the board

Set **your draft slot** (top left). If you pick 8th, choose 8. Every recommendation is based on that seat.

Type a team name in Strategy if you want. Pins, avoids, and sliders are yours alone.

---

## The Top five

The left rail is the product. After **every** pick it recalculates the five best players for *your* roster.

Each card has a reason and a score. When in doubt, take #1. “Why #1?” compares that pick to the next two.

**Expert** (next to Best available) swaps the ranking source:

| Expert | What it is |
|---|---|
| **Boris Chen** | Weekly tiers (default). Best if you already trust Chen. |
| **FantasyPros ECR** | Expert consensus. Needs a FantasyPros **HOF** API key (MVP is not enough). |
| **Sleeper ADP** | Sleeper market ADP, not an analyst ranking. Tiers are grouped from ADP gaps. |

**Scoring** is separate: **0.5 PPR** (default), **PPR**, or **standard**. Switching lists remaps ranks. It does not wipe picks.

If a mock sits overnight and your last pick is already in, Top five still shows remaining board value. When the draft is done, open the **report card**.

---

## You’re on the clock

The top bar turns green and the tab flashes 🚨. Confirm the green button on your turn.

That confirm is **local** — it records the pick on this board. In a live Sleeper or Yahoo draft, also click the player in that app. The footer reminder is there on purpose.

---

## Start a draft

On your own board (or the house league if you’re the admin):

| Mode | What happens | When to use it |
|---|---|---|
| **Practice mock** | Robots take empty seats on a timer and pause at every human slot. | Group rehearsal |
| **Draft night — live** | Follows a real Yahoo league key (or a connected Sleeper draft). | The actual draft |

Practice mocks pause at every claimed seat. Unclaimed seats are robots. On the demo page, a human who doesn’t confirm in 30 seconds gets auto-drafted so the room keeps moving. That auto-draft does **not** happen on live draft night.

---

## Live draft night

1. Everyone opens Draft Dojo **and** Sleeper or Yahoo.
2. Connect the league / arm live sync.
3. Set every manager’s **slot** so it matches the real draft order.
4. Pick in Sleeper or Yahoo. Watch Top five here.
5. When you’re on the clock in the real app, take the #1 here (or argue with it), then click there.

This app does not and cannot submit a Yahoo or Sleeper pick.

---

## Weekly HQ

The **Weekly HQ** link (signed-in Yahoo boards) shows:

- Best lineup for the week, with concrete “bench X, start Y” swaps
- Injury and bye alarms
- Waiver targets and league activity

Same rule: it advises, you click in Yahoo.

---

## What this never does

- Submit a pick, add, drop, or lineup change
- Share your pins, avoids, or strategy sliders
- Pretend an LLM ranked the board — every reason comes from the factor math (Chen/ECR/ADP rank, tiers, need, scarcity, and so on)

---

## FAQ

**Do I need an account for the demo?** No.

**Does connecting Sleeper prove I own that account?** No. It’s a username lookup. Don’t treat it as a lock on someone else’s team.

**Why is my Yahoo name “Yahoo ABC123”?** Yahoo didn’t send a real display name. Type a team name in Strategy.

**I’m on the clock here but not in Sleeper/Yahoo.** Your slot dropdown is wrong. Fix it.

**The live board isn’t seeing picks.** Yahoo may not have approved Fantasy Sports API access yet, or the league key is a mock/test league that isn’t moving. You can still confirm picks on this board by hand.

**Can someone else reset my demo?** No. Demo users return to the lobby instead of wiping a shared room. Everyone in the room can still make picks for their own seat. Your Yahoo or Sleeper board is yours.

**Where do I go?** [dojo.football](https://dojo.football)
