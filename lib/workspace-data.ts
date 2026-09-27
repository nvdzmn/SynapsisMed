export type MatchLevel = "CRITICAL" | "HIGH" | "MODERATE";

export type Phase = "idle" | "running" | "ready" | "empty" | "failed";

export type PanelPatient = {
  id: string;
  name: string;
  summary: string;
  level: MatchLevel;
  x: number;
  y: number;
  r: number;
  meta: string;
  fields: string[];
  mismatches: string[];
  review: string;
  /** Short next-visit checks from the cohort agent. Runs without them show `review` as one line. */
  checks?: string[];
};

export type SourceNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  citation: string;
  pmid: string;
  url?: string;
};

export type QuietDot = { x: number; y: number; r: number };

export type ConditionOption = {
  id: string;
  label: string;
  short: string;
  count: number;
};

export const PANEL_SIZE = 24;

export const PATIENTS: PanelPatient[] = [
  {
    id: "dolores",
    name: "Dolores Vance",
    summary: "EF 55%, eGFR 38, not on the drug class",
    level: "CRITICAL",
    x: 250,
    y: 250,
    r: 11,
    meta: "71 F · synthetic record",
    fields: ["LVEF 55% · echo 06/2026", "eGFR 38 · 08/2026", "NYHA class II · no SGLT2 inhibitor on med list"],
    mismatches: ["Recurrent UTIs documented, a caution in the trials"],
    review: "Review whether this drug class fits her goals. Check UTI history and volume status first.",
  },
  {
    id: "marcus",
    name: "Marcus Hale",
    summary: "EF 48%, eGFR 45",
    level: "HIGH",
    x: 640,
    y: 230,
    r: 9,
    meta: "Synthetic record",
    fields: ["LVEF 48%", "eGFR 45"],
    mismatches: [],
    review: "His ejection fraction and kidney function sit in the range the trials describe. Confirm the chart before review.",
  },
  {
    id: "imani",
    name: "Imani Brooks",
    summary: "eGFR 24, near the lower bound",
    level: "MODERATE",
    x: 560,
    y: 400,
    r: 8,
    meta: "Synthetic record",
    fields: ["eGFR 24, near the lower bound cited in the trials"],
    mismatches: ["Kidney function is close to the lower bound the trials describe"],
    review: "Confirm the latest eGFR before deciding whether this evidence applies.",
  },
];

export const SOURCES: SourceNode[] = [
  { id: "s1", label: "S1", x: 441, y: 170, citation: "EMPEROR-Preserved · NEJM 2021", pmid: "34449189" },
  { id: "s2", label: "S2", x: 571, y: 300, citation: "DELIVER · NEJM 2022", pmid: "36027570" },
  { id: "s3", label: "S3", x: 411, y: 360, citation: "EMPA-KIDNEY · NEJM 2023", pmid: "36331190" },
];

export const EDGES: { from: string; to: string; color: string }[] = [
  { from: "dolores", to: "s1", color: "var(--match-critical)" },
  { from: "dolores", to: "s3", color: "var(--match-critical)" },
  { from: "s1", to: "marcus", color: "var(--match-high)" },
  { from: "marcus", to: "s2", color: "var(--match-high)" },
  { from: "s2", to: "imani", color: "var(--match-moderate)" },
];

const QUIET_BOXES: [number, number, number][] = [
  [115, 175, 10],
  [174, 414, 12],
  [256, 136, 8],
  [293, 463, 14],
  [555, 145, 10],
  [632, 412, 16],
  [696, 206, 8],
  [754, 324, 12],
  [214, 294, 12],
  [335, 205, 10],
  [514, 454, 12],
  [595, 295, 10],
  [146, 336, 8],
  [676, 116, 8],
  [375, 515, 10],
  [793, 473, 14],
  [85, 255, 10],
  [476, 126, 8],
  [554, 534, 12],
  [256, 536, 8],
  [825, 185, 10],
];

export const QUIET_DOTS: QuietDot[] = QUIET_BOXES.map(([x, y, size]) => ({
  x: x + size / 2,
  y: y + size / 2,
  r: size / 2,
}));

export const CONDITIONS: ConditionOption[] = [
  { id: "hfpef", label: "Heart failure, preserved EF", short: "HFpEF", count: 9 },
  { id: "ckd3", label: "CKD stage 3", short: "CKD 3", count: 11 },
  { id: "t2d", label: "Type 2 diabetes", short: "T2D", count: 14 },
  { id: "htn", label: "Hypertension", short: "HTN", count: 19 },
  { id: "afib", label: "Atrial fibrillation", short: "AF", count: 6 },
];

export const DEFAULT_QUERY =
  "Does recent evidence support SGLT2 inhibitors for heart failure with preserved EF and CKD stage 3?";

export const REPORT = {
  kicker: "PANEL REPORT · RUN 26-09-28",
  title: "SGLT2 inhibitors in HFpEF with CKD",
  question:
    "Does recent evidence support SGLT2 inhibitors for patients with heart failure, preserved ejection fraction, and CKD stage 3?",
  supports: [
    "Fewer heart failure hospitalizations or cardiovascular deaths when ejection fraction is above 40%.",
    "Benefit held across eGFR down to about 20–25 in the trial populations.",
  ],
  limits: ["A mortality benefit on its own.", "Use below eGFR 20, on dialysis, or in type 1 diabetes."],
};

export const SUGGESTIONS = [
  "Any new safety signals for drugs my panel is on?",
  "Which recent trials might include my CKD patients?",
];

export const NOTE_POINTS = [
  "New studies on a heart medicine class for heart failure with kidney changes",
  "Her heart and kidney numbers are similar to people in those studies",
  "The studies did not show people lived longer from this alone",
];

export function draftFor(name: string): string {
  const first = name.split(" ")[0] || name;
  return `Hi ${first},\n\nI read some new research about a type of heart medicine that has helped people with heart failure and kidney changes like yours. Your heart and kidney numbers are similar to the people in those studies.\n\nI'd like to talk this over at your next visit. Please don't change any of your medicines before we talk.\n\nDr. Ortiz`;
}

export function conditionSummary(ids: string[]): string {
  if (ids.length === 0) return "Any";
  const picked = CONDITIONS.filter((item) => ids.includes(item.id));
  if (picked.length === 1) return picked[0]?.short || "1 selected";
  if (ids.includes("hfpef") && ids.includes("ckd3") && ids.length === 2) return "HFpEF + CKD 3";
  return `${picked.length} selected`;
}

export function matchCountLabel(ids: string[]): string {
  if (ids.includes("hfpef") && ids.includes("ckd3")) return "7 patients match both";
  if (ids.length === 0) return "All 24 patients";
  const total = CONDITIONS.filter((item) => ids.includes(item.id)).reduce((sum, item) => sum + item.count, 0);
  return `${Math.min(total, PANEL_SIZE)} patients in view`;
}

export function blockedReasons(draft: string, patientName: string, otherNames: string[] = []): string[] {
  const reasons: string[] = [];
  for (const name of otherNames) {
    if (name && name !== patientName && draft.includes(name)) reasons.push(`Another patient's name: ${name}`);
  }
  const pmid = draft.match(/PMID\s*(\d{7,8})|\b(\d{8})\b/i);
  const pmidValue = pmid?.[1] || pmid?.[2];
  if (pmidValue) reasons.push(`A PMID: ${pmidValue}`);
  if (/\bstart taking\b|\b\d+\s?mg\b/i.test(draft)) {
    reasons.push("Medication instructions: “Start taking 10 mg…”");
  }
  return reasons;
}

export function levelColors(level: MatchLevel): { bg: string; border: string; fg: string; node: string } {
  if (level === "CRITICAL") {
    return { bg: "var(--status-blocked-bg)", border: "var(--status-blocked-border)", fg: "var(--status-blocked-fg)", node: "var(--match-critical)" };
  }
  if (level === "HIGH") {
    return { bg: "var(--status-action-bg)", border: "var(--status-action-border)", fg: "var(--status-action-fg)", node: "var(--match-high)" };
  }
  return { bg: "var(--accent-surface)", border: "var(--accent-text)", fg: "var(--accent-text)", node: "var(--match-moderate)" };
}

export function pointAt(id: string): { x: number; y: number } | undefined {
  const patient = PATIENTS.find((item) => item.id === id);
  if (patient) return patient;
  return SOURCES.find((item) => item.id === id);
}
