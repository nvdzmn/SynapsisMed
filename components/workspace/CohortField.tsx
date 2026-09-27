"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useReducedMotion, type MotionValue } from "framer-motion";
import type { GraphEdge } from "../../lib/triallens";
import { QUIET_DOTS, levelColors, type PanelPatient, type Phase, type QuietDot, type SourceNode } from "../../lib/workspace-data";
import { button } from "./ui";

type CohortFieldProps = {
  phase: Phase;
  /** Which part of a run is in flight, so the graph can show what is happening. */
  stage?: RunStage;
  patients: PanelPatient[];
  quiet: QuietDot[];
  sources: SourceNode[];
  edges: GraphEdge[];
  report?: { title: string; kicker: string } | null;
  selectedId: string | null;
  showCard: boolean;
  showVoice: boolean;
  muted: boolean;
  voiceYou: string;
  voiceReply: string;
  voiceError: string;
  onSelect: (id: string) => void;
  onTalk: () => void;
  onDraft: () => void;
  onNotes: () => void;
  /** Saved physician notes per patient id, shown on the Notes button. */
  noteCounts?: Record<string, number>;
  onEndVoice: () => void;
  onToggleMute: () => void;
  onDismissCard?: () => void;
  onTalkGroup?: (names: string[]) => void;
  onTalkReport?: () => void;
  /** What the live voice session is about: a name, joined names, or null for the whole report. */
  voiceSubject?: string | null;
};

const SNAP = 46;
const MAX_GROUP = 3;
const SIGNALS: [RegExp, string][] = [
  [/lvef|ejection fraction|heart.?failure|hfpef/i, "Heart failure / LVEF"],
  [/egfr|kidney|ckd/i, "Kidney function / eGFR"],
  [/eosinophil|asthma/i, "Eosinophils / asthma"],
  [/pasi|psoriasis/i, "Psoriasis / PASI"],
  [/sglt2|empagliflozin|dapagliflozin/i, "SGLT2 inhibitor"],
  [/enrollment|criteria/i, "Enrollment criteria unclear"],
];

function signalsOf(patient: PanelPatient): string[] {
  const text = [patient.summary, ...patient.fields, ...patient.mismatches, patient.review];
  return SIGNALS.filter(([pattern]) => text.some((line) => pattern.test(line))).map(([, label]) => label);
}

const W = 920;
const H = 689;
const CX = W / 2;
const CY = H / 2;
const HUB_R = 54;
const SOURCE_RING = 150;
const PATIENT_RING = 252;
const QUIET_RING = 322;
const MIN_K = 0.55;
const MAX_K = 3.2;
const MAX_STRETCH = 1.7;
/** Room kept at each side of the canvas for the names beside the outermost nodes. */
const SIDE_ROOM = 112;
const FOCUS_K = 1.9;
const SPRING = { type: "spring", stiffness: 160, damping: 24 } as const;
const WAVE = [6, 12, 20, 14, 26, 18, 10, 22, 30, 16, 8, 20, 12, 24, 14, 6, 18, 10, 4, 12, 8];

type Placed<T> = T & { px: number; py: number };
export type RunStage = "literature" | "contrast";
type Ripple = { id: number; x: number; y: number; r: number; color: string };

/** Places items round the report. `stretch` widens the ring into an ellipse so a wide canvas is filled, not just its middle. */
function ring<T>(items: T[], radius: number, offset: number, wobble = 0, stretch = 1): Placed<T>[] {
  return items.map((item, index) => {
    const angle = offset + (index / Math.max(items.length, 1)) * Math.PI * 2;
    const jitter = wobble ? ((index * 7919) % (wobble * 2)) - wobble : 0;
    const r = radius + jitter;
    return { ...item, px: CX + Math.cos(angle) * r * stretch, py: CY + Math.sin(angle) * r };
  });
}

function wrapTitle(text: string, max = 15, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  const shown = out.slice(0, lines);
  if (shown.length && shown.join(" ").length < words.join(" ").length) {
    const last = shown[shown.length - 1] ?? "";
    shown[shown.length - 1] = `${last.slice(0, max - 1).trimEnd()}…`;
  }
  return shown;
}

const clamp = (value: number) => Math.min(MAX_K, Math.max(MIN_K, value));

export default function CohortField({
  phase,
  stage = "literature",
  patients,
  quiet,
  sources,
  edges,
  report,
  selectedId,
  showCard,
  showVoice,
  muted,
  voiceYou,
  voiceReply,
  voiceError,
  onSelect,
  onTalk,
  onDraft,
  onNotes,
  noteCounts,
  onEndVoice,
  onToggleMute,
  onDismissCard,
  onTalkGroup,
  onTalkReport,
  voiceSubject = null,
}: CohortFieldProps) {
  const still = useReducedMotion() ?? false;
  // How much wider the canvas is than the graph's own shape. The layout stretches sideways by this much to use the room.
  const [stretch, setStretch] = useState(1);
  // The rings widen until the outer one reaches the side room, so the nodes use the width and their names still fit.
  const spread = Math.max(1, ((W * stretch) / 2 - SIDE_ROOM) / QUIET_RING);
  const svgRef = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const vx = useMotionValue(0);
  const vy = useMotionValue(0);
  const vk = useMotionValue(1);
  const transform = useMotionTemplate`translate(${vx} ${vy}) scale(${vk})`;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const measure = () => {
      if (!field.clientWidth || !field.clientHeight) return;
      const next = Math.min(MAX_STRETCH, Math.max(1, field.clientWidth / field.clientHeight / (W / H)));
      setStretch((current) => (Math.abs(current - next) < 0.01 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Applied as an SVG attribute on purpose: a CSS transform would use a fill-box origin and break the pan maths.
    const apply = (value: string) => viewportRef.current?.setAttribute("transform", value);
    apply(transform.get());
    return transform.on("change", apply);
  }, [transform]);
  const running = useRef<ReturnType<typeof animate>[]>([]);
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number; unit: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const skipNextFocus = useRef(true);
  const [dragging, setDragging] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  // Canvas state: patients the physician has dragged, and the proximity groups they formed.
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [groups, setGroups] = useState<string[][]>([]);
  const [magnetId, setMagnetId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const nodeDrag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; unit: number; moved: boolean } | null>(null);

  const graphReady = phase === "ready";
  const showSources = (phase === "ready" || phase === "running" || phase === "empty") && sources.length > 0;
  const placedSources = ring(sources, SOURCE_RING, -Math.PI / 2 + 0.4, 0, spread);
  const placedPatients = ring(graphReady ? patients : [], PATIENT_RING, -Math.PI / 2, 22, spread).map((patient) => {
    const moved = positions[patient.id];
    return moved ? { ...patient, px: moved.x, py: moved.y } : patient;
  });
  const placedRef = useRef(placedPatients);
  placedRef.current = placedPatients;
  const placedQuiet = ring(quiet.length ? quiet : QUIET_DOTS, QUIET_RING, 0.45, 34, spread);
  const selected = placedPatients.find((patient) => patient.id === selectedId) ?? null;
  const runKey = `${phase}:${patients.map((patient) => patient.id).join("|")}:${sources.length}`;
  const activeGroup = selected ? groups.find((group) => group.includes(selected.id)) ?? null : null;
  const groupMembers = activeGroup ? activeGroup.map((id) => placedPatients.find((patient) => patient.id === id)).filter((patient): patient is Placed<PanelPatient> => Boolean(patient)) : [];

  const nearestPatient = (id: string, x: number, y: number) => {
    let best: { patient: Placed<PanelPatient>; distance: number } | null = null;
    for (const other of placedRef.current) {
      if (other.id === id) continue;
      const distance = Math.hypot(other.px - x, other.py - y);
      if (distance <= SNAP && (!best || distance < best.distance)) best = { patient: other, distance };
    }
    return best?.patient ?? null;
  };

  const clusterOf = (members: Placed<PanelPatient>[]) => {
    const cx = members.reduce((sum, member) => sum + member.px, 0) / Math.max(members.length, 1);
    const cy = members.reduce((sum, member) => sum + member.py, 0) / Math.max(members.length, 1);
    const reach = members.reduce((max, member) => Math.max(max, Math.hypot(member.px - cx, member.py - cy) + member.r * 1.3), 0);
    return { cx, cy, r: reach + 18 };
  };

  const stopAnimations = () => {
    running.current.forEach((control) => control.stop());
    running.current = [];
  };

  const zoomTo = (wx: number, wy: number, k: number) => {
    stopAnimations();
    const next = clamp(k);
    running.current = [animate(vk, next, SPRING), animate(vx, CX - next * wx, SPRING), animate(vy, CY - next * wy, SPRING)];
  };

  const reset = () => zoomTo(CX, CY, 1);

  const zoomBy = (factor: number) => {
    const k = vk.get();
    const next = clamp(k * factor);
    stopAnimations();
    running.current = [animate(vk, next, SPRING), animate(vx, CX - (CX - vx.get()) * (next / k), SPRING), animate(vy, CY - (CY - vy.get()) * (next / k), SPRING)];
  };

  const svgPoint = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  };

  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = svgPoint(event.clientX, event.clientY);
      if (!point) return;
      stopAnimations();
      const k = vk.get();
      const next = clamp(k * Math.exp(-event.deltaY * 0.0016));
      vx.set(point.x - (point.x - vx.get()) * (next / k));
      vy.set(point.y - (point.y - vy.get()) * (next / k));
      vk.set(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    skipNextFocus.current = true;
    setPositions({});
    setGroups([]);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    if (skipNextFocus.current) {
      skipNextFocus.current = false;
      return;
    }
    // Switching between grouped patients keeps the current view; only a lone patient pulls the camera in.
    if (selected && !groups.some((group) => group.includes(selected.id))) zoomTo(selected.px, selected.py, FOCUS_K);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => () => stopAnimations(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-interactive]")) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    stopAnimations();
    const unit = 1 / Math.min(rect.width / W, rect.height / H);
    dragRef.current = { startX: event.clientX, startY: event.clientY, vx: vx.get(), vy: vy.get(), unit, moved: false };
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        setDragging(true);
      }
      if (drag.moved) {
        vx.set(drag.vx + dx * drag.unit);
        vy.set(drag.vy + dy * drag.unit);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (drag?.moved) {
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        return;
      }
      // A plain tap on the canvas background closes the detail panel.
      if (showCard && onDismissCard) onDismissCard();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ripple = (x: number, y: number, r: number, color: string) => {
    setRipples((current) => [...current.slice(-6), { id: Date.now() + Math.random(), x, y, r, color }]);
  };

  const clickPatient = (patient: Placed<PanelPatient>) => {
    if (suppressClick.current) return;
    ripple(patient.px, patient.py, patient.r, levelColors(patient.level).node);
    onSelect(patient.id);
    zoomTo(patient.px, patient.py, FOCUS_K);
  };

  /** Drop a dragged patient: leave any old group, then join whichever patient it landed on. */
  const dropNode = (id: string, x: number, y: number) => {
    const near = nearestPatient(id, x, y);
    if (near) {
      const angle = Math.atan2(y - near.py, x - near.px);
      const snapped = { x: near.px + Math.cos(angle) * 34, y: near.py + Math.sin(angle) * 34 };
      setPositions((current) => ({ ...current, [id]: snapped }));
      ripple(snapped.x, snapped.y, 12, "var(--action-primary)");
    }
    setGroups((current) => {
      const without = current.map((group) => group.filter((member) => member !== id)).filter((group) => group.length > 1);
      if (!near) return without;
      const index = without.findIndex((group) => group.includes(near.id));
      if (index === -1) return [...without, [near.id, id]];
      const target = without[index] ?? [];
      if (target.length >= MAX_GROUP) return without;
      return without.map((group, at) => (at === index ? [...group, id] : group));
    });
    if (id !== selectedId) skipNextFocus.current = true;
    onSelect(id);
  };

  const ungroup = (ids: string[]) => setGroups((current) => current.filter((group) => !group.some((member) => ids.includes(member))));

  const startNodeDrag = (event: ReactPointerEvent<SVGGElement>, patient: Placed<PanelPatient>) => {
    if (event.button !== 0) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const unit = 1 / Math.min(rect.width / W, rect.height / H);
    nodeDrag.current = { id: patient.id, startX: event.clientX, startY: event.clientY, ox: patient.px, oy: patient.py, unit, moved: false };
    const move = (moveEvent: PointerEvent) => {
      const drag = nodeDrag.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        setDraggingNode(drag.id);
      }
      if (!drag.moved) return;
      const k = vk.get();
      const x = drag.ox + (dx * drag.unit) / k;
      const y = drag.oy + (dy * drag.unit) / k;
      setPositions((current) => ({ ...current, [drag.id]: { x, y } }));
      setMagnetId(nearestPatient(drag.id, x, y)?.id ?? null);
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const drag = nodeDrag.current;
      nodeDrag.current = null;
      setDraggingNode(null);
      setMagnetId(null);
      if (!drag?.moved) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const k = vk.get();
      dropNode(drag.id, drag.ox + ((upEvent.clientX - drag.startX) * drag.unit) / k, drag.oy + ((upEvent.clientY - drag.startY) * drag.unit) / k);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const clickHub = () => {
    if (suppressClick.current) return;
    ripple(CX, CY, HUB_R, "var(--action-primary)");
    if (showCard && onDismissCard) onDismissCard();
    reset();
  };

  const clickSource = (source: Placed<SourceNode>) => {
    if (suppressClick.current) return;
    ripple(source.px, source.py, 10, "var(--source-ink)");
    if (showCard && onDismissCard) onDismissCard();
    zoomTo(source.px, source.py, 1.6);
  };

  const hubFill = phase === "failed" ? "var(--status-blocked-fg)" : phase === "idle" ? "var(--neutral-400)" : "var(--action-primary)";
  const hubKicker = phase === "running" ? (stage === "literature" ? "READING" : "REVIEWING") : phase === "failed" ? "RUN FAILED" : phase === "idle" ? "NO RUN YET" : (report?.kicker ?? "PANEL REPORT").split("·")[0]?.trim() || "PANEL REPORT";
  const hubTitle = wrapTitle(phase === "ready" || phase === "empty" ? report?.title || "Panel report" : phase === "running" ? (stage === "literature" ? "Searching the literature" : "Checking each chart") : phase === "failed" ? "No report" : "Start a run");
  const selectedEdges = selected ? edges.filter((edge) => edge.from === selected.id || edge.to === selected.id) : [];
  const panelIds = new Set<string>((showCard || showVoice) && selected ? (activeGroup ?? [selected.id]) : []);
  // While a patient card is open, the rest of the graph steps back so the card's subject stands out.
  const focusIds = showCard && !showVoice && !draggingNode ? panelIds : new Set<string>();
  const focusSources = new Set(selectedEdges.flatMap((edge) => [edge.from, edge.to]));
  const fade = (focused: boolean) => ({ opacity: focusIds.size > 0 && !focused ? 0.28 : 1, transition: "opacity 220ms ease" });
  const panelAnchor = groupMembers.length > 1 ? (({ cx, cy, r }) => ({ px: cx, py: cy, r }))(clusterOf(groupMembers)) : selected ? { px: selected.px, py: selected.py, r: selected.r * 1.3 } : { px: CX, py: CY, r: HUB_R };

  return (
    <div
      ref={fieldRef}
      className={`relative min-h-[420px] flex-1 select-none overflow-hidden rounded-xl border border-line bg-surface ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-interactive]")) return;
        reset();
      }}
    >
      <svg ref={svgRef} viewBox={`${(W - W * stretch) / 2} 0 ${W * stretch} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Patient cohort map centred on the panel report">
        <defs>
          <radialGradient id="hub-glow">
            <stop offset="0%" stopColor="var(--action-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--action-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g ref={viewportRef}>
          <g key={runKey}>
            <g style={fade(false)}>
              <ellipse cx={CX} cy={CY} rx={QUIET_RING * spread} ry={QUIET_RING} fill="none" stroke="var(--border-default)" strokeDasharray="3 7" opacity="0.7" />
              <ellipse cx={CX} cy={CY} rx={PATIENT_RING * spread} ry={PATIENT_RING} fill="none" stroke="var(--border-default)" strokeDasharray="3 7" opacity="0.55" />
              <ellipse cx={CX} cy={CY} rx={SOURCE_RING * spread} ry={SOURCE_RING} fill="none" stroke="var(--border-default)" strokeDasharray="3 7" opacity="0.45" />
            </g>

            {placedQuiet.map((dot, index) => (
              <motion.line
                key={`q-${index}`}
                style={fade(false)}
                x1={CX}
                y1={CY}
                x2={dot.px}
                y2={dot.py}
                stroke="var(--border-default)"
                strokeWidth="0.8"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.6 }}
                transition={{ delay: 0.05 + index * 0.02, duration: 0.7, ease: "easeOut" }}
              />
            ))}
            {showSources &&
              placedSources.map((source, index) => (
                <motion.line
                  key={`se-${source.id}`}
                  style={fade(focusSources.has(source.id))}
                  x1={CX}
                  y1={CY}
                  x2={source.px}
                  y2={source.py}
                  stroke="var(--border-strong)"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.9 }}
                  transition={{ delay: 0.2 + index * 0.05, duration: 0.6, ease: "easeOut" }}
                />
              ))}
            {placedPatients.map((patient, index) => {
              const active = selectedId === patient.id || hoverId === patient.id;
              return (
                <g key={`pe-${patient.id}`} style={fade(focusIds.has(patient.id))}>
                  <motion.line
                    x1={CX}
                    y1={CY}
                    x2={patient.px}
                    y2={patient.py}
                    stroke={levelColors(patient.level).node}
                    initial={{ pathLength: 0, opacity: 0, strokeWidth: 1.5 }}
                    animate={{ pathLength: 1, opacity: active ? 1 : 0.75, strokeWidth: active ? 3 : 1.5 }}
                    transition={{ pathLength: { delay: 0.35 + index * 0.07, duration: 0.7, ease: "easeOut" }, opacity: { duration: 0.2 }, strokeWidth: { duration: 0.2 } }}
                  />
                </g>
              );
            })}
            {selectedEdges.map((edge) => {
              const from = placedPatients.find((patient) => patient.id === edge.from) ?? placedSources.find((source) => source.id === edge.from);
              const to = placedPatients.find((patient) => patient.id === edge.to) ?? placedSources.find((source) => source.id === edge.to);
              if (!from || !to) return null;
              return (
                <motion.line
                  key={`x-${edge.from}-${edge.to}`}
                  x1={from.px}
                  y1={from.py}
                  x2={to.px}
                  y2={to.py}
                  stroke={edge.color}
                  strokeWidth="1.2"
                  strokeDasharray="2 5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.6 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                />
              );
            })}

            {/* Quiet patients: connected to the report but not matched. Purely visual, so no hit area. */}
            {placedQuiet.map((dot, index) => (
              <g key={`qd-${index}`} transform={`translate(${dot.px} ${dot.py})`} style={{ pointerEvents: "none", ...fade(false) }}>
                <motion.path
                  d="M0,-5.5 L5,3.5 L-5,3.5 Z"
                  fill="var(--action-primary)"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: index % 3 === 0 ? 0.85 : 0.55 }}
                  transition={{ ...SPRING, delay: 0.1 + index * 0.02 }}
                />
              </g>
            ))}

            {phase === "running" && <RunActivity stage={stage} charts={placedQuiet} sources={showSources ? placedSources : []} still={still} stretch={spread} />}

            <g data-interactive onClick={clickHub} className="cursor-pointer" style={fade(false)}>
              <circle cx={CX} cy={CY} r={HUB_R * 2.4} fill="url(#hub-glow)" style={{ pointerEvents: "none" }} />
              <motion.circle
                cx={CX}
                cy={CY}
                fill="none"
                stroke={hubFill}
                strokeWidth="1.5"
                initial={{ r: HUB_R + 10, opacity: 0.45 }}
                animate={{ r: [HUB_R + 10, HUB_R + 22, HUB_R + 10], opacity: [0.45, 0, 0.45] }}
                transition={{ duration: phase === "running" ? 1.4 : 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.circle cx={CX} cy={CY} fill={hubFill} initial={{ r: 0 }} animate={{ r: hoverId === "hub" ? HUB_R + 4 : HUB_R }} transition={SPRING} onHoverStart={() => setHoverId("hub")} onHoverEnd={() => setHoverId(null)} />
              <text x={CX} y={CY - 14} textAnchor="middle" fill="var(--text-on-primary)" fontFamily="var(--font-mono), monospace" fontSize="9" fontWeight="500" opacity="0.85" letterSpacing="0.6" style={{ pointerEvents: "none" }}>
                {hubKicker}
              </text>
              <text x={CX} y={CY + 4} textAnchor="middle" fill="var(--text-on-primary)" fontFamily="var(--font-jakarta), sans-serif" fontSize="12.5" fontWeight="600" style={{ pointerEvents: "none" }}>
                {hubTitle.map((line, index) => (
                  <tspan key={line + index} x={CX} dy={index === 0 ? 0 : 15}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>

            {showSources &&
              placedSources.map((source, index) => {
                const hovered = hoverId === source.id;
                return (
                  <g key={source.id} data-interactive transform={`translate(${source.px} ${source.py})`} className="cursor-pointer" style={fade(focusSources.has(source.id) || hovered)} onClick={() => clickSource(source)} onPointerEnter={() => setHoverId(source.id)} onPointerLeave={() => setHoverId(null)}>
                    <motion.rect
                      x="-8"
                      y="-8"
                      width="16"
                      height="16"
                      rx="3"
                      fill={hovered ? "var(--action-primary)" : "var(--source-ink)"}
                      initial={{ scale: 0, rotate: 45 }}
                      animate={{ scale: hovered ? 1.3 : 1, rotate: hovered ? 135 : 45 }}
                      transition={{ ...SPRING, delay: hovered ? 0 : 0.25 + index * 0.05 }}
                    />
                    <text x="14" y="4" fill="var(--text-secondary)" fontFamily="var(--font-mono), monospace" fontSize="11" fontWeight="500" style={{ pointerEvents: "none" }}>
                      {source.label}
                    </text>
                    {hovered && (
                      <motion.text x="14" y="18" fill="var(--text-muted)" fontFamily="var(--font-inter), Inter, sans-serif" fontSize="9.5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 18 }} style={{ pointerEvents: "none" }}>
                        {source.citation.length > 46 ? `${source.citation.slice(0, 45)}…` : source.citation}
                      </motion.text>
                    )}
                  </g>
                );
              })}

            {groups.map((group) => {
              const members = group.map((id) => placedPatients.find((patient) => patient.id === id)).filter((patient): patient is Placed<PanelPatient> => Boolean(patient));
              if (members.length < 2) return null;
              const cluster = clusterOf(members);
              return (
                <g key={`group-${group.join("+")}`} style={{ pointerEvents: "none", ...fade(group.some((id) => focusIds.has(id))) }}>
                  <motion.circle cx={cluster.cx} cy={cluster.cy} fill="var(--action-primary)" stroke="var(--action-primary)" strokeWidth="1.2" strokeDasharray="5 5" initial={{ r: 0, fillOpacity: 0, strokeOpacity: 0 }} animate={{ r: cluster.r, fillOpacity: 0.08, strokeOpacity: 0.55 }} transition={SPRING} />
                  {members.map((member, memberIndex) =>
                    members.slice(memberIndex + 1).map((other) => (
                      <motion.line key={`${member.id}-${other.id}`} x1={member.px} y1={member.py} x2={other.px} y2={other.py} stroke="var(--action-primary)" strokeWidth="2" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.7 }} transition={{ duration: 0.4 }} />
                    )),
                  )}
                  <text x={cluster.cx} y={cluster.cy - cluster.r - 6} textAnchor="middle" fill="var(--action-primary)" fontFamily="var(--font-mono), monospace" fontSize="9" fontWeight="500" letterSpacing="0.6">
                    COMPARING {members.length}
                  </text>
                </g>
              );
            })}

            {placedPatients.map((patient, index) => {
              const colors = levelColors(patient.level);
              const isSelected = selectedId === patient.id;
              const hovered = hoverId === patient.id;
              const isMagnet = magnetId === patient.id;
              const isDragging = draggingNode === patient.id;
              const onRight = patient.px >= CX;
              return (
                <g
                  key={patient.id}
                  data-interactive
                  transform={`translate(${patient.px} ${patient.py})`}
                  className={isDragging ? "cursor-grabbing" : "cursor-grab"}
                  style={fade(focusIds.has(patient.id) || hovered)}
                  onClick={() => clickPatient(patient)}
                  onPointerDown={(event) => startNodeDrag(event, patient)}
                  onPointerEnter={() => setHoverId(patient.id)}
                  onPointerLeave={() => setHoverId(null)}
                >
                  {isSelected && !isDragging && (
                    <motion.circle fill="none" stroke="var(--action-primary)" strokeWidth="1.5" initial={{ r: patient.r }} animate={{ r: [patient.r + 8, patient.r + 15, patient.r + 8], opacity: [0.9, 0.3, 0.9] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
                  )}
                  {isMagnet && <motion.circle fill="var(--action-primary)" fillOpacity="0.12" stroke="var(--action-primary)" strokeWidth="2" strokeDasharray="4 3" initial={{ r: patient.r }} animate={{ r: patient.r + 18 }} transition={SPRING} />}
                  <motion.circle fill={colors.node} opacity="0.18" initial={{ r: 0 }} animate={{ r: hovered || isSelected || isDragging ? patient.r * 2.4 : patient.r * 1.8 }} transition={SPRING} />
                  <motion.circle fill={colors.node} stroke="var(--bg-surface)" strokeWidth="2" initial={{ r: 0 }} animate={{ r: hovered || isSelected || isDragging ? patient.r * 1.3 : patient.r }} transition={{ ...SPRING, delay: hovered || isDragging ? 0 : 0.4 + index * 0.07 }} />
                  <motion.g initial={{ opacity: 0 }} animate={{ opacity: panelIds.has(patient.id) ? 0 : 1 }} transition={{ delay: panelIds.size ? 0 : 0.55 + index * 0.07 }} style={{ pointerEvents: "none" }}>
                    <text x={onRight ? patient.r + 12 : -(patient.r + 12)} y="4" textAnchor={onRight ? "start" : "end"} fill="var(--text-primary)" fontFamily="var(--font-inter), Inter, sans-serif" fontSize="12" fontWeight={isSelected ? 600 : 500}>
                      {patient.name}
                    </text>
                    {(hovered || isSelected) && (
                      <motion.text x={onRight ? patient.r + 12 : -(patient.r + 12)} y="18" textAnchor={onRight ? "start" : "end"} fill="var(--text-muted)" fontFamily="var(--font-inter), Inter, sans-serif" fontSize="9.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        {patient.summary.length > 44 ? `${patient.summary.slice(0, 43)}…` : patient.summary}
                      </motion.text>
                    )}
                  </motion.g>
                </g>
              );
            })}

            {ripples.map((item) => (
              <motion.circle
                key={item.id}
                cx={item.x}
                cy={item.y}
                fill="none"
                stroke={item.color}
                initial={{ r: item.r, opacity: 0.75, strokeWidth: 3 }}
                animate={{ r: item.r * 5 + 24, opacity: 0, strokeWidth: 0.5 }}
                transition={{ duration: 0.75, ease: "easeOut" }}
                onAnimationComplete={() => setRipples((current) => current.filter((ripple) => ripple.id !== item.id))}
                style={{ pointerEvents: "none" }}
              />
            ))}
          </g>
        </g>
      </svg>

      <div data-interactive className="absolute right-4 top-4 flex overflow-hidden rounded-lg border border-line bg-surface text-sm font-semibold text-ink shadow-[0_6px_20px_rgba(18,25,51,0.06)]">
        <button type="button" onClick={() => zoomBy(1.35)} className={`${button.icon} rounded-none`} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.35)} className={`${button.icon} rounded-none border-l border-line`} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
          }}
          className="h-8 border-l border-line px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-canvas hover:text-ink"
        >
          Fit
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-5 left-4 right-60 truncate text-[11px] tracking-[0.055px] text-muted">Drag the canvas to pan · scroll to zoom · drop a patient onto another to compare · click the report to reset</p>
      {(phase === "ready" || phase === "empty") && (
        <button
          type="button"
          data-interactive
          onClick={showVoice ? onEndVoice : (onTalkReport ?? onTalk)}
          className={`${button.primary} absolute bottom-4 right-4 shadow-[0_10px_28px_rgba(111,75,209,0.35)]`}
        >
          <span className={`h-2 w-2 rounded-full bg-white ${showVoice ? "animate-pulse" : "opacity-70"}`} />
          {showVoice ? `Voice live · ${voiceSubject ?? "whole report"}` : "Voice · discuss report"}
        </button>
      )}
      <AnimatePresence>
        {showCard && selected && !showVoice && !draggingNode && groupMembers.length > 1 && (
          <AnchoredPanel key={`group-${activeGroup?.join("+")}`} anchor={panelAnchor} accent="var(--action-primary)" transform={transform} svgRef={svgRef} fieldRef={fieldRef} vx={vx} vy={vy} vk={vk} width={380}>
            <GroupPanel members={groupMembers} selectedId={selected.id} sources={sources} onFocus={onSelect} onTalk={() => (onTalkGroup ? onTalkGroup(groupMembers.map((member) => member.name)) : onTalk())} onDraft={onDraft} onNotes={onNotes} noteCounts={noteCounts} onUngroup={() => ungroup(groupMembers.map((member) => member.id))} onClose={onDismissCard} />
          </AnchoredPanel>
        )}
        {showCard && selected && !showVoice && !draggingNode && groupMembers.length <= 1 && (
          <AnchoredPanel key={`card-${selected.id}`} anchor={panelAnchor} accent={levelColors(selected.level).node} transform={transform} svgRef={svgRef} fieldRef={fieldRef} vx={vx} vy={vy} vk={vk} width={320}>
            <PatientCard patient={selected} noteCount={noteCounts?.[selected.id] ?? 0} onTalk={onTalk} onDraft={onDraft} onNotes={onNotes} onClose={onDismissCard} />
          </AnchoredPanel>
        )}
        {showVoice && (
          <AnchoredPanel key={`voice-${voiceSubject ?? "report"}`} anchor={voiceSubject === null ? { px: CX, py: CY, r: HUB_R } : panelAnchor} accent="var(--action-primary)" transform={transform} svgRef={svgRef} fieldRef={fieldRef} vx={vx} vy={vy} vk={vk} width={360}>
            <VoicePanel patientName={voiceSubject ?? "the whole report"} muted={muted} you={voiceYou} reply={voiceReply} error={voiceError} onToggleMute={onToggleMute} onEnd={onEndVoice} />
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

const within = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

type AnchoredPanelProps = {
  anchor: { px: number; py: number; r: number };
  accent: string;
  transform: MotionValue<string>;
  svgRef: RefObject<SVGSVGElement | null>;
  fieldRef: RefObject<HTMLDivElement | null>;
  vx: MotionValue<number>;
  vy: MotionValue<number>;
  vk: MotionValue<number>;
  width: number;
  children: ReactNode;
};

/** Floats an HTML panel next to a graph node and keeps it attached while the graph pans and zooms. */
function AnchoredPanel({ anchor, accent, transform, svgRef, fieldRef, vx, vy, vk, width, children }: AnchoredPanelProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cardX = useMotionValue(0);
  const cardY = useMotionValue(0);
  const nodeX = useMotionValue(0);
  const nodeY = useMotionValue(0);
  const edgeX = useMotionValue(0);
  const edgeY = useMotionValue(0);
  const originX = useMotionValue(0.5);
  const originY = useMotionValue(0.5);

  useLayoutEffect(() => {
    const place = () => {
      const svg = svgRef.current;
      const field = fieldRef.current;
      const card = cardRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !field || !card || !ctm) return;
      const k = vk.get();
      const point = new DOMPoint(vx.get() + k * anchor.px, vy.get() + k * anchor.py).matrixTransform(ctm);
      const rect = field.getBoundingClientRect();
      const ax = point.x - rect.left;
      const ay = point.y - rect.top;
      const radius = anchor.r * k * ctm.a;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const fw = field.clientWidth;
      const fh = field.clientHeight;
      const pad = 12;
      const gap = radius + 40;
      const fitsRight = ax + gap + cw <= fw - pad;
      const fitsLeft = ax - gap - cw >= pad;
      const preferRight = anchor.px >= CX;
      const right = preferRight ? fitsRight || !fitsLeft : !fitsLeft;
      const left = within(right ? ax + gap : ax - gap - cw, pad, fw - cw - pad);
      const top = within(ay - ch / 2, pad, fh - ch - pad);
      cardX.set(left);
      cardY.set(top);
      nodeX.set(ax);
      nodeY.set(ay);
      edgeX.set(within(ax, left, left + cw));
      edgeY.set(within(ay, top, top + ch));
      originX.set(right ? 0 : 1);
      originY.set(within((ay - top) / Math.max(ch, 1), 0, 1));
    };
    place();
    const stop = transform.on("change", place);
    const observer = new ResizeObserver(place);
    if (cardRef.current) observer.observe(cardRef.current);
    if (fieldRef.current) observer.observe(fieldRef.current);
    return () => {
      stop();
      observer.disconnect();
    };
  }, [anchor.px, anchor.py, anchor.r, transform, svgRef, fieldRef, vx, vy, vk, cardX, cardY, nodeX, nodeY, edgeX, edgeY, originX, originY]);

  return (
    <>
      <motion.svg className="pointer-events-none absolute inset-0 h-full w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
        <motion.line x1={nodeX} y1={nodeY} x2={edgeX} y2={edgeY} stroke={accent} strokeWidth="1.5" strokeDasharray="3 4" />
        <motion.circle cx={edgeX} cy={edgeY} r="3.5" fill={accent} />
      </motion.svg>
      <motion.div
        ref={cardRef}
        data-interactive
        className="absolute left-0 top-0 cursor-default"
        style={{ x: cardX, y: cardY, width, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflowY: "auto", borderRadius: 12, originX, originY }}
        initial={{ opacity: 0, scale: 0.86 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
        transition={SPRING}
      >
        {children}
      </motion.div>
    </>
  );
}

/** The trailing wedge of the sweep: from the leading edge back through `span` degrees. */
function sector(span: number): string {
  const angle = (-span * Math.PI) / 180;
  return `M ${CX} ${CY} L ${CX + QUIET_RING} ${CY} A ${QUIET_RING} ${QUIET_RING} 0 0 0 ${CX + Math.cos(angle) * QUIET_RING} ${CY + Math.sin(angle) * QUIET_RING} Z`;
}

/**
 * What the graph does while a run is in flight. Reading the literature is a sweep out from the report;
 * checking the charts is each chart lighting up in turn and sending its reading in to the report.
 */
function RunActivity({ stage, charts, sources, still, stretch }: { stage: RunStage; charts: Placed<QuietDot>[]; sources: Placed<SourceNode>[]; still: boolean; stretch: number }) {
  const accent = "var(--action-primary)";
  const orbit = 2 * Math.PI * (HUB_R + 7);
  if (still) return <circle cx={CX} cy={CY} r={HUB_R + 7} fill="none" stroke={accent} strokeWidth="2" strokeDasharray="4 6" opacity="0.6" style={{ pointerEvents: "none" }} />;
  const step = 0.2;
  const cycle = Math.max(charts.length * step, 2.4);
  const flight = (index: number) => ({ duration: 1.5, delay: index * step + 0.15, repeat: Infinity, repeatDelay: cycle - 1.5, ease: "easeIn" as const });
  return (
    <g style={{ pointerEvents: "none" }}>
      {stage === "literature" && (
        <g transform={`translate(${CX} 0) scale(${stretch} 1) translate(${-CX} 0)`}>
          {[0, 1, 2].map((index) => (
            <motion.circle key={`wave-${index}`} cx={CX} cy={CY} fill="none" stroke={accent} strokeWidth="1.2" initial={{ r: HUB_R, opacity: 0 }} animate={{ r: [HUB_R, QUIET_RING], opacity: [0.5, 0] }} transition={{ duration: 3, delay: index, repeat: Infinity, ease: "easeOut" }} />
          ))}
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <g>
              {[64, 38, 16].map((span) => (
                <path key={span} d={sector(span)} fill={accent} opacity="0.07" />
              ))}
              <line x1={CX} y1={CY} x2={CX + QUIET_RING} y2={CY} stroke={accent} strokeWidth="1.5" opacity="0.55" />
              <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="4.5s" repeatCount="indefinite" />
            </g>
          </motion.g>
        </g>
      )}
      {stage === "contrast" && (
        <>
          {sources.map((source, index) => (
            <motion.circle key={`read-${source.id}`} cx={source.px} cy={source.py} fill="none" stroke="var(--source-ink)" strokeWidth="1.2" initial={{ r: 10, opacity: 0 }} animate={{ r: [10, 24], opacity: [0.55, 0] }} transition={{ duration: 1.8, delay: index * 0.45, repeat: Infinity, ease: "easeOut" }} />
          ))}
          {charts.map((chart, index) => (
            <g key={`chart-${index}`}>
              <motion.circle cx={chart.px} cy={chart.py} fill={accent} initial={{ r: 4, opacity: 0 }} animate={{ r: [4, 15], opacity: [0.45, 0] }} transition={{ duration: 1.1, delay: index * step, repeat: Infinity, repeatDelay: cycle - 1.1, ease: "easeOut" }} />
              <motion.circle r="2.6" fill={accent} initial={{ cx: chart.px, cy: chart.py, opacity: 0 }} animate={{ cx: [chart.px, CX], cy: [chart.py, CY], opacity: [0, 1, 1, 0] }} transition={{ ...flight(index), opacity: { ...flight(index), ease: "linear", times: [0, 0.15, 0.8, 1] } }} />
            </g>
          ))}
        </>
      )}
      <g>
        <circle cx={CX} cy={CY} r={HUB_R + 7} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${orbit * 0.22} ${orbit * 0.78}`} />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur={stage === "literature" ? "1.6s" : "1.1s"} repeatCount="indefinite" />
      </g>
    </g>
  );
}

function CloseButton({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null;
  return (
    <button type="button" onClick={onClose} aria-label="Close panel" className={`${button.icon} text-lg leading-none`}>
      ×
    </button>
  );
}

/** One labelled section of a patient card. A single item reads as a line; several read as a bullet list. */
function Bullets({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 text-[11px] leading-4 tracking-[0.055px]">
      <p className="text-muted">{title}</p>
      {items.length === 1 ? (
        <p className={tone}>{items[0]}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className={`flex gap-1.5 ${tone}`}>
              <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PatientCard({ patient, noteCount, onTalk, onDraft, onNotes, onClose }: { patient: PanelPatient; noteCount: number; onTalk: () => void; onDraft: () => void; onNotes: () => void; onClose?: () => void }) {
  const colors = levelColors(patient.level);
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-violet bg-surface p-4 shadow-[0_18px_48px_rgba(111,75,209,0.18)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold leading-5 text-ink">{patient.name}</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">{patient.meta}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded px-2 py-0.5 text-xs font-medium tracking-[0.06px]" style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
            {patient.level}
          </span>
          <CloseButton onClose={onClose} />
        </div>
      </header>
      <Bullets title="CHART FIELDS USED" items={patient.fields} tone="text-ink" />
      <Bullets title="MISMATCHES" items={patient.mismatches} tone="text-caution-fg" />
      <Bullets title={patient.checks?.length ? "CHECK AT NEXT VISIT" : "CLINICIAN REVIEW NOTE"} items={patient.checks?.length ? patient.checks : [patient.review]} tone="text-ink" />
      <button type="button" onClick={onTalk} className={button.primary}>
        ● Talk about {patient.name.split(" ")[0]}
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onNotes} className={`${button.secondary} flex-1`}>
          {noteCount ? `My notes · ${noteCount}` : "Add a note"}
        </button>
        <button type="button" onClick={onDraft} className={`${button.secondary} flex-1`}>
          Draft a message
        </button>
      </div>
    </article>
  );
}

type GroupPanelProps = {
  members: PanelPatient[];
  selectedId: string;
  sources: SourceNode[];
  onFocus: (id: string) => void;
  onTalk: () => void;
  onDraft: () => void;
  onNotes: () => void;
  noteCounts?: Record<string, number>;
  onUngroup: () => void;
  onClose?: () => void;
};

/** Side-by-side view of grouped patients, with the overlaps and differences the physician may want to connect. */
function GroupPanel({ members, selectedId, sources, onFocus, onTalk, onDraft, onNotes, noteCounts, onUngroup, onClose }: GroupPanelProps) {
  const signals = members.map((member) => signalsOf(member));
  const shared = (signals[0] ?? []).filter((label) => signals.every((set) => set.includes(label)));
  const levels = new Set(members.map((member) => member.level));
  const active = members.find((member) => member.id === selectedId) ?? members[0];
  const activeIndex = Math.max(0, members.findIndex((member) => member.id === active?.id));
  const unique = (signals[activeIndex] ?? []).filter((label) => !shared.includes(label));
  const first = (name: string) => name.split(" ")[0] || name;
  if (!active) return null;
  const colors = levelColors(active.level);
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-violet bg-surface p-3.5 shadow-[0_18px_48px_rgba(111,75,209,0.18)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-5 text-ink">Comparing {members.length} patients</h2>
          <p className="truncate text-[11px] tracking-[0.055px] text-secondary">{members.map((member) => first(member.name)).join(" · ")} · against this run&apos;s sources</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onUngroup} className={button.small}>
            Ungroup
          </button>
          <CloseButton onClose={onClose} />
        </div>
      </header>
      <div className="rounded-lg border border-cleared-border bg-cleared-bg px-3 py-2 text-[11px] leading-4 tracking-[0.055px]">
        <p className="text-muted">CONNECTIONS</p>
        <p className="mt-0.5 text-cleared-fg">{levels.size === 1 ? `All ${members.length} flagged ${[...levels][0]}.` : members.map((member) => `${first(member.name)} ${member.level}`).join(" · ")}</p>
        <p className="text-cleared-fg">{shared.length ? `${members.length === 2 ? "Both" : "All"} flagged on ${shared.join(", ")}.` : "No shared chart signal. The overlap is the evidence, not the chart."}</p>
      </div>
      <div className="flex gap-1 rounded-lg bg-canvas p-1" role="tablist">
        {members.map((member) => {
          const tabColors = levelColors(member.level);
          const isActive = member.id === active.id;
          return (
            <button key={member.id} type="button" role="tab" aria-selected={isActive} onClick={() => onFocus(member.id)} className={`flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold ${isActive ? "bg-surface text-ink shadow-[0_1px_2px_rgba(18,25,51,0.08)]" : "text-secondary hover:text-ink"}`}>
              <span className="truncate">{first(member.name)}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tabColors.node }} />
            </button>
          );
        })}
      </div>
      <div className="space-y-2 text-[11px] leading-4 tracking-[0.055px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold leading-5 text-ink">{active.name}</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-[0.06px]" style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
            {active.level}
          </span>
        </div>
        <Bullets title="CHART FIELDS" items={active.fields} tone="text-ink" />
        <Bullets title="MISMATCHES" items={active.mismatches} tone="text-caution-fg" />
        {unique.length > 0 && (
          <p className="text-secondary">
            Only {first(active.name)}: {unique.join(", ")}.
          </p>
        )}
      </div>
      {sources.length > 0 && (
        <p className="truncate text-[11px] leading-4 tracking-[0.055px] text-secondary">
          <span className="text-muted">AGAINST </span>
          {sources.map((source) => `${source.label} ${source.citation.split(" · ")[0]}`).join(" · ")}
        </p>
      )}
      <button type="button" onClick={onTalk} className={button.primary}>
        ● Talk about {members.length === 2 ? "both" : "all"}
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onNotes} className={`${button.secondary} min-w-0 flex-1`}>
          {noteCounts?.[active.id] ? `Notes · ${noteCounts[active.id]}` : "Add a note"} · {first(active.name)}
        </button>
        <button type="button" onClick={onDraft} className={`${button.secondary} min-w-0 flex-1`}>
          Message · {first(active.name)}
        </button>
      </div>
    </section>
  );
}

function VoicePanel({ patientName, muted, you, reply, error, onToggleMute, onEnd }: { patientName: string; muted: boolean; you: string; reply: string; error: string; onToggleMute: () => void; onEnd: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border-[1.5px] border-violet bg-surface p-4 shadow-[0_18px_48px_rgba(111,75,209,0.18)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold leading-5 text-ink">Mishti</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">Discussing {patientName} · briefed on this report</p>
        </div>
        <span className="pt-2 text-xs font-medium tracking-[0.06px] text-cleared-fg">{muted ? "Muted" : "Listening"}</span>
      </header>
      <div className="flex h-[38px] items-center gap-[3px]" aria-hidden>
        {WAVE.map((height, index) => (
          <span
            key={index}
            className="w-1 rounded-sm bg-violet"
            style={{
              height,
              transformOrigin: "center",
              opacity: muted ? 0.35 : 0.9,
              animation: muted ? undefined : `voice-bar 1.1s ease-in-out ${index * 0.05}s infinite`,
            }}
          />
        ))}
      </div>
      <div>
        <p className="text-[11px] tracking-[0.055px] text-muted">You</p>
        <p className="text-sm leading-5 text-ink">{you || "Your question will appear here."}</p>
      </div>
      <div>
        <p className="text-[11px] tracking-[0.055px] text-muted">Mishti</p>
        <p className="text-sm leading-5 text-ink">{error || reply}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onToggleMute} className={`${button.secondary} flex-1`}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={onEnd} className={`${button.secondary} flex-1`}>
          End voice
        </button>
      </div>
      <p className="text-[11px] leading-4 tracking-[0.055px] text-muted">Mishti discusses the report, and can draft a message or save a note. She can&apos;t search or send.</p>
    </section>
  );
}
