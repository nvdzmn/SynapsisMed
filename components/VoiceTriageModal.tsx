"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Radio, Sparkles, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Patient, Study, VoiceReportContext, VoiceSessionResponse } from "../lib/types";

type VoiceEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
};

function encodeBase64(bytes: Uint8Array): string {
  let text = "";
  for (const item of bytes) text += String.fromCharCode(item);
  return btoa(text);
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, samples[i] ?? 0)) * 0x7fff;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function clientSecret(secret: VoiceSessionResponse["voice_secret"]): string | undefined {
  if (!secret) return undefined;
  if (typeof secret === "string") return secret;
  if (secret.value) return secret.value;
  if (typeof secret.client_secret === "string") return secret.client_secret;
  return secret.client_secret?.value;
}

async function readJson(response: Response): Promise<VoiceSessionResponse> {
  try {
    return (await response.json()) as VoiceSessionResponse;
  } catch {
    return {};
  }
}

function reportBrief(report?: VoiceReportContext): string {
  if (!report) return "";
  return [report.report_id ? `Physician report ${report.report_id}.` : "", report.sections?.question, report.sections?.literature, report.sections?.limitations, report.footer]
    .filter(Boolean)
    .join(" ");
}

type VoiceTriageModalProps = {
  patient?: Patient;
  study?: Study;
  runId?: string;
  onRunReady?: (runId: string) => void;
  onClose: () => void;
  apiUrl?: string;
};

export default function VoiceTriageModal({ patient, study, runId, onRunReady, onClose, apiUrl = "http://localhost:8000" }: VoiceTriageModalProps) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("Connect to start an encrypted Grok Voice triage session.");
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playhead = useRef(0);
  const instructions = `You are TrialLens, a spoken clinical evidence assistant. Patient: ${patient ? `${patient.name}, age ${patient.age}; diagnoses ${patient.conditions.join(", ")}; metrics ${JSON.stringify(patient.metrics)}` : "none selected"}. Current evidence: ${study?.title || "none"}. ${study?.key_findings || ""}. Discuss the evidence and uncertainty, cite the study context, and never prescribe or present medical advice as a clinician's decision. Keep answers concise.`;

  const cleanup = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    wsRef.current?.close();
    if (contextRef.current) void contextRef.current.close();
    wsRef.current = null;
    setConnected(false);
  };

  useEffect(() => cleanup, []);

  const playAudio = async (base64: string) => {
    const context = contextRef.current;
    if (!context) return;
    const raw = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / Int16Array.BYTES_PER_ELEMENT);
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    playhead.current = Math.max(playhead.current, context.currentTime);
    node.start(playhead.current);
    playhead.current += buffer.duration;
  };

  const ensureRun = async (): Promise<string> => {
    if (runId) return runId;
    setResponse("Starting a literature run so voice can use a completed report.");
    const response = await fetch(`${apiUrl}/api/runs`, { method: "POST" });
    const body = await readJson(response);
    if (!response.ok) throw new Error(body.detail || "Could not start a literature run");
    if (!body.run_id || body.status !== "complete") throw new Error(body.error || "Voice requires a completed report");
    onRunReady?.(body.run_id);
    return body.run_id;
  };

  const connect = async () => {
    try {
      setError("");
      const activeRunId = await ensureRun();
      setResponse("Requesting a Grok Voice session for this report.");
      const secretResponse = await fetch(`${apiUrl}/api/runs/${activeRunId}/voice/session`, { method: "POST" });
      const secretData = await readJson(secretResponse);
      if (!secretResponse.ok) throw new Error(secretData.detail || "Could not create xAI voice session");
      const secret = clientSecret(secretData.voice_secret);
      if (!secret) throw new Error("xAI did not return a client secret");
      const spokenInstructions = `${instructions} ${reportBrief(secretData.context?.report)}`.trim();
      const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [`xai-client-secret.${secret}`]);
      wsRef.current = ws;
      ws.onopen = async () => {
        const context = new AudioContext({ sampleRate: 24000 });
        contextRef.current = context;
        await context.resume();
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              voice: "eve",
              instructions: spokenInstructions,
              turn_detection: { type: "server_vad" },
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { language_hint: "en", keyterms: ["HFpEF", "eGFR", "SGLT2", "semaglutide", "PASI"] },
                },
                output: { format: { type: "audio/pcm", rate: 24000 } },
              },
            },
          }),
        );
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 24000, echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        const source = context.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = context.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (event) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: encodeBase64(floatToPcm16(event.inputBuffer.getChannelData(0))) }));
          }
        };
        source.connect(processor);
        processor.connect(context.destination);
        setConnected(true);
        setResponse("Listening through Grok Voice. Speak naturally; server VAD detects your turn.");
      };
      ws.onmessage = async (event) => {
        const data = JSON.parse(String(event.data)) as VoiceEvent;
        if (data.type?.includes("transcript") && data.transcript) setTranscript(data.transcript);
        if (data.type === "response.output_audio.delta" && data.delta) void playAudio(data.delta);
        if (data.type?.includes("response.output_text") && data.delta) {
          setResponse((value) => (value === "Listening through Grok Voice. Speak naturally; server VAD detects your turn." ? data.delta ?? "" : value + (data.delta ?? "")));
        }
        if (data.type === "response.done") setResponse((value) => value || "Grok Voice completed its response.");
      };
      ws.onerror = () => setError("Grok Voice connection failed. Confirm XAI_API_KEY and browser microphone permission.");
      ws.onclose = () => setConnected(false);
    } catch (cause) {
      setError(errorMessage(cause, "Unable to start voice session"));
      cleanup();
    }
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md">
        <motion.div initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} className="w-full max-w-2xl rounded-2xl border border-sky-500/35 bg-slate-900 p-5 shadow-2xl shadow-sky-950/80 md:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-sky-300">
                <Sparkles className="h-4 w-4" />
                Grok Voice clinical triage
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Live speech-to-speech · scoped xAI client secret · clinician verification required</p>
            </div>
            <button
              onClick={() => {
                cleanup();
                onClose();
              }}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
            >
              <X />
            </button>
          </div>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
            <span className="text-slate-500">Subject</span>
            <span className="mx-2 text-sky-400">/</span>
            {patient ? `${patient.name} · ${patient.id}` : "No patient selected"}
            <span className="mx-2 text-slate-600">•</span>
            <span className="text-slate-500">Evidence</span>
            <span className="ml-2">{study?.journal || "TrialLens"}</span>
          </div>
          <div className="mt-4 flex h-24 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-[#060b16] px-6">
            {[32, 55, 25, 78, 46, 92, 38, 67, 100, 45, 82, 30, 60, 40, 76, 25, 53].map((height, index) => (
              <motion.i
                key={index}
                animate={connected ? { height: [`${height * 0.35}%`, `${height}%`, `${height * 0.45}%`] } : { height: "14%" }}
                transition={{ repeat: Infinity, duration: 0.7 + index * 0.03 }}
                className={`w-1.5 rounded-full ${connected ? "bg-sky-400" : "bg-slate-700"}`}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Live transcript</p>
              <p className="text-sm text-slate-200">{transcript || "Your spoken question will appear here."}</p>
            </div>
            <div className="rounded-xl border border-sky-900/70 bg-sky-950/30 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-sky-400">
                <Volume2 className="h-3 w-3" />
                Grok Voice response
              </p>
              <p className="text-sm leading-6 text-sky-50">{response}</p>
            </div>
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
            <button
              onClick={connected ? cleanup : connect}
              disabled={!patient}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${connected ? "bg-rose-500 text-white" : "bg-sky-400 text-slate-950 hover:bg-sky-300"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {connected ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {connected ? "End live session" : "Start Grok Voice"}
            </button>
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Radio className={`h-3 w-3 ${connected ? "animate-pulse text-emerald-400" : ""}`} />
              {connected ? "Realtime connected" : "Not connected"}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
