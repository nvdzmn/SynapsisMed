"use client";

import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import type { CohortMatch, Patient, Study } from "../lib/types";

type PatientNodeData = {
  patient: Patient;
  index: number;
  match?: CohortMatch;
  position: [number, number, number];
};

function StudyCore({ title }: { title?: string }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const core = ref.current;
    if (!core) return;
    const t = clock.getElapsedTime();
    core.rotation.y = t * 0.32;
    core.scale.setScalar(1 + Math.sin(t * 2.4) * 0.055);
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[1.05, 32, 32]} />
        <meshStandardMaterial color="#7dd3fc" emissive="#0284c7" emissiveIntensity={2.3} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#38bdf8" emissiveIntensity={3} />
      </mesh>
      <Html position={[0, -1.65, 0]} center distanceFactor={9}>
        <div className="w-48 rounded-lg border border-sky-400/40 bg-slate-950/90 px-2 py-1.5 text-center text-[9px] font-medium text-sky-200 shadow-xl">
          <span className="mb-0.5 block font-mono text-[8px] uppercase tracking-[.15em] text-sky-500">Active literature node</span>
          {title?.slice(0, 48) || "New clinical study"}
        </div>
      </Html>
    </group>
  );
}

function PatientNode({ data, onSelect }: { data: PatientNodeData; onSelect: (patient: Patient) => void }) {
  const ref = useRef<Mesh>(null);
  const matched = Boolean(data.match);
  useFrame(({ clock }) => {
    if (matched && ref.current) {
      ref.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 4 + data.index) * 0.12);
    }
  });
  const color = data.match?.risk_level === "CRITICAL" ? "#fb7185" : matched ? "#fbbf24" : "#475569";
  const inverted: [number, number, number] = [-data.position[0], -data.position[1], -data.position[2]];
  return (
    <group position={data.position}>
      {matched && (
        <Line points={[[0, 0, 0], inverted]} color={color} transparent opacity={0.68} lineWidth={1.5} dashed dashScale={18} dashSize={0.35} gapSize={0.18} />
      )}
      <mesh ref={ref} onClick={() => onSelect(data.patient)}>
        <sphereGeometry args={[matched ? 0.42 : 0.3, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={matched ? 1.7 : 0.15} />
      </mesh>
      <Html position={[0, matched ? 0.62 : 0.46, 0]} center distanceFactor={10}>
        <button
          onClick={() => onSelect(data.patient)}
          className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-medium transition hover:scale-105 ${matched ? "border-white/20 bg-slate-950/90 text-slate-100" : "border-slate-600 bg-slate-900/90 text-slate-400"}`}
        >
          {data.patient.name}
        </button>
      </Html>
    </group>
  );
}

type NetworkProps = {
  patients: Patient[];
  matches: CohortMatch[];
  onSelectPatient: (patient: Patient) => void;
  study: Study;
};

function Network({ patients, matches, onSelectPatient, study }: NetworkProps) {
  const nodes = useMemo(
    () =>
      patients.map((patient, index) => {
        const angle = (index / patients.length) * Math.PI * 2;
        const radius = 4.4 + (index % 2) * 0.75;
        const node: PatientNodeData = {
          patient,
          index,
          match: matches.find((item) => item.patient.id === patient.id),
          position: [Math.cos(angle) * radius, ((index % 3) - 1) * 1.15, Math.sin(angle) * radius],
        };
        return node;
      }),
    [patients, matches],
  );
  return (
    <>
      <ambientLight intensity={0.45} />
      <pointLight position={[4, 6, 6]} intensity={35} color="#38bdf8" />
      <pointLight position={[-6, -4, 2]} intensity={18} color="#a855f7" />
      <Stars radius={35} depth={15} count={650} factor={2} saturation={0} fade speed={0.4} />
      <StudyCore title={study.title} />
      {nodes.map((node) => (
        <PatientNode key={node.patient.id} data={node} onSelect={onSelectPatient} />
      ))}
      <OrbitControls enablePan={false} minDistance={7} maxDistance={15} autoRotate autoRotateSpeed={0.32} />
    </>
  );
}

type Visualizer3DProps = NetworkProps;

export default function Visualizer3D({ patients, matches, onSelectPatient, study }: Visualizer3DProps) {
  const critical = matches.filter((match) => match.risk_level === "CRITICAL").length;
  return (
    <div className="relative h-[390px] overflow-hidden rounded-2xl border border-slate-800 bg-[#070e1d] shadow-2xl shadow-sky-950/30 md:h-[440px]">
      <div className="pointer-events-none absolute inset-0 z-10 grid-bg opacity-80" />
      <div className="absolute left-4 top-4 z-20 rounded-xl border border-slate-700/80 bg-slate-950/75 px-3 py-2 backdrop-blur">
        <p className="font-mono text-[9px] uppercase tracking-[.18em] text-sky-400">Neural cohort field</p>
        <p className="mt-1 text-xs text-slate-300">
          <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-400" />
          {matches.length} patients matched · {critical} critical
        </p>
      </div>
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg bg-slate-950/70 px-2.5 py-1.5 font-mono text-[9px] text-slate-400 backdrop-blur">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />
          Evidence
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />
          Review
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400" />
          Critical
        </span>
      </div>
      <Canvas className="relative z-0" camera={{ position: [0, 4.5, 10.5], fov: 48 }} dpr={[1, 1.5]}>
        <Network patients={patients} matches={matches} onSelectPatient={onSelectPatient} study={study} />
      </Canvas>
    </div>
  );
}
