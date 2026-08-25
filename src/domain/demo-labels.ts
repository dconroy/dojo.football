/** Stable identity for unfilled demo seats — never "T6" / "Seat 5". */
export const RP_BOT_NAMES = [
  "Hurts So Good",
  "Tua Legit",
  "Allen Family",
  "Lamar the Merrier",
  "Mahomes Alone",
  "Burrowed Treasure",
  "Maye Day",
  "Love at First Down",
  "Stroud Nine",
  "Goff and Running",
  "Dak to the Future",
  "Baker's Dozen",
  "Purdy Good",
  "Herbert Alert",
  "Bo Knows TDs",
  "Caleb's Kingdom",
  "Jayden Victory",
  "Dart Board",
  "Bijan Mustard",
  "Gibbs Me a Break",
  "Run CMC",
  "Barkley Up a Tree",
  "Hall or Nothing",
  "Achane Reaction",
  "Taylor Made",
  "Cookin' with James",
  "Walker Ranger",
  "King Henry",
  "Kyren Up My Heart",
  "ETN Phone Home",
  "Chuba Libre",
  "Mixon It Up",
  "Bucky the System",
  "Jeanty Fresh",
  "Hampton Roads",
  "Skattebo Board",
  "Chase-ing Points",
  "Puka Shells",
  "CeeDee Later",
  "Jet Set Jefferson",
  "Amon a Mission",
  "London Calling",
  "Brown Baggers",
  "Nico Time",
  "Waddle House",
  "Be My Nabers",
  "Worthy Cause",
  "Marvin's Room",
  "JSN the City",
  "Rice Rice Baby",
  "Flower Power",
  "Pickens Grinnin'",
  "McConkey Kong",
  "Odunze Upon a Time",
  "Egbuka Bazooka",
  "Tet Set Go",
  "Addison Wonderland",
  "Davante's Inferno",
  "Evans Almighty",
  "BTJ Phone Home",
  "Reed Between Lines",
  "Shakir It Off",
  "Sutton Impact",
  "Ridley Believe It",
  "Kelce Grammar",
  "Kittle Corn",
  "McBride and Seek",
  "Bowers Hour",
  "Hock and Roll",
  "Andrews Air Force",
  "LaPorta Authority",
  "Goedert Done",
  "Kmet Me Halfway",
  "Kraft Work",
  "Fannin the Flames",
  "Loveland Security",
  "Warren Peace",
  "Tight End Zone",
  "Sunday Scaries",
  "Bye Week Bandits",
  "Waiver Wizards",
  "Red Zone Rascals",
  "Gridiron Gremlins",
  "Fourth and Petty",
  "Punt Intended",
  "End Zone Empire",
  "Two Minute Menace",
  "Snap Decisions",
  "Audible Chaos",
  "Roster Imposters",
  "Flex Appeal",
  "Full Send Fourth",
  "First Down Problems",
  "Clock Mismanagement",
  "Monday Regrets",
  "Game Time Decision",
  "Hail Mary Heroes",
  "Draft Delinquents",
  "Victory Formation",
  "False Start Club",
] as const;

export type DemoSeatKind = "human" | "rp-bot" | "open";

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rpBotTeamName(slot: number, roomSeed = ""): string {
  const index = Math.max(0, slot - 1);
  const normalizedSeed = roomSeed.replace(/^mock\.demo\./, "demo:");
  const offset = normalizedSeed
    ? stableHash(normalizedSeed) % RP_BOT_NAMES.length
    : 0;
  const name = RP_BOT_NAMES[(offset + index * 37) % RP_BOT_NAMES.length];
  return `🤖 ${name}`;
}

export function humanTeamFallback(): string {
  return "Human";
}

export function demoSeatKind(
  slot: number,
  humanSlots: Iterable<number>,
  options: { started: boolean; complete?: boolean } = { started: true },
): DemoSeatKind {
  const humans = humanSlots instanceof Set ? humanSlots : new Set(humanSlots);
  if (humans.has(slot)) return "human";
  if (options.complete || options.started) return "rp-bot";
  return "open";
}

export function demoSeatKindLabel(kind: DemoSeatKind): string {
  if (kind === "human") return "Human";
  if (kind === "rp-bot") return "RP Bot";
  return "Open";
}
