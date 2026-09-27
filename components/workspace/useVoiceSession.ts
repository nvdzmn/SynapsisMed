"use client";

import { useEffect, useRef, useState } from "react";
import { openVoiceSession } from "../../lib/triallens";

type VoiceEvent = { type?: string; transcript?: string; delta?: string; name?: string; arguments?: string; call_id?: string };

/** What a voice tool reports back to the model: whether it worked, and what to tell the physician. */
export type VoiceToolResult = { ok: boolean; detail: string };
export type VoiceToolHandler = (name: string, args: Record<string, unknown>) => Promise<VoiceToolResult>;

/** Voice can prepare work for the physician. There is deliberately no tool that approves or sends a message. */
const VOICE_TOOLS = [
  {
    type: "function",
    name: "draft_message",
    description: "Draft, or redraft, a message to one flagged patient and put it on screen for the physician to review. By default it explains the report's findings in plain language; it can also be a personal message with no findings. The message is never sent by this tool.",
    parameters: {
      type: "object",
      properties: {
        patient_name: { type: "string", description: "Name of a flagged patient in this report." },
        instruction: { type: "string", description: "What the physician wants the message to say or how they want it written, in their own words. Pass everything they said; do not add details of your own." },
        include_findings: { type: "boolean", description: "Whether the message explains this report's findings. Set false when the physician wants a message that is only about something else, such as a personal note, or asks to leave the medical content out. Leave it out when redrafting unless the physician asks to change this." },
      },
      required: ["patient_name"],
    },
  },
  {
    type: "function",
    name: "save_note",
    description: "Save a private note for the physician about one flagged patient. Use the physician's own words. Only the physician sees it.",
    parameters: {
      type: "object",
      properties: {
        patient_name: { type: "string", description: "Name of a flagged patient in this report." },
        text: { type: "string", description: "The note, as the physician said it." },
      },
      required: ["patient_name", "text"],
    },
  },
];

function encodeBase64(bytes: Uint8Array): string {
  let text = "";
  for (const item of bytes) text += String.fromCharCode(item);
  return btoa(text);
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    out[index] = Math.max(-1, Math.min(1, samples[index] ?? 0)) * 0x7fff;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export function useVoiceSession(runId: string | null, onTool?: VoiceToolHandler) {
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [you, setYou] = useState("");
  const [reply, setReply] = useState("Connecting to Mishti…");
  const [error, setError] = useState("");
  const mutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playhead = useRef(0);
  // The socket outlives the render that opened it, so tools go through a ref to the latest handler.
  const toolRef = useRef(onTool);
  toolRef.current = onTool;

  const stop = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    wsRef.current?.close();
    if (contextRef.current) void contextRef.current.close();
    wsRef.current = null;
    streamRef.current = null;
    contextRef.current = null;
    // A new session gets a new audio context whose clock starts at zero, so the schedule must too.
    playhead.current = 0;
    setListening(false);
  };

  const playAudio = async (base64: string) => {
    const context = contextRef.current;
    if (!context) return;
    const raw = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const sampleCount = Math.floor(raw.byteLength / Int16Array.BYTES_PER_ELEMENT);
    if (sampleCount === 0) return;
    // Drop a trailing odd byte rather than throwing away the whole chunk.
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, sampleCount);
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = (pcm[index] ?? 0) / 32768;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    playhead.current = Math.max(playhead.current, context.currentTime);
    node.start(playhead.current);
    playhead.current += buffer.duration;
  };

  /** `subject` is a patient name (or joined names) to focus on, or null to cover the whole report. */
  const connect = async (subject: string | null) => {
    if (!runId || wsRef.current) return;
    setError("");
    setYou("");
    setReply("Requesting a voice session for this report…");
    // Create and resume the audio context synchronously, inside the click that started voice.
    // Safari only unlocks audio output from within a user gesture; doing this later leaves it silent.
    const context = new AudioContext({ sampleRate: 24000 });
    contextRef.current = context;
    playhead.current = 0;
    void context.resume();
    try {
      const session = await openVoiceSession(runId);
      const instructions = `You are Mishti, the spoken clinical evidence assistant in SynapseMed. If asked who or what you are, you are Mishti, SynapseMed's AI assistant; do not name the model or the company behind you. Discuss only this physician report. Do not search, prescribe, or tell anyone to start or stop a medicine. When the physician asks, you can draft a patient message with draft_message and save a private note with save_note; call the tool first, and only once it has answered say in a few words what happened. You cannot approve or send a message, and you must say so if asked: only the physician can, on screen. ${subject ? `Patient in focus: ${subject}.` : "Cover the whole panel report: the question it asked, what the literature supports and does not support, and each flagged patient in turn. Do not single out one patient unless asked."} ${session.brief} Keep answers concise.`;
      const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [`xai-client-secret.${session.secret}`]);
      wsRef.current = ws;
      ws.onopen = async () => {
        if (context.state !== "running") await context.resume();
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              voice: "eve",
              instructions,
              turn_detection: { type: "server_vad" },
              tools: toolRef.current ? VOICE_TOOLS : [],
              tool_choice: "auto",
              audio: {
                input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { language_hint: "en" } },
                output: { format: { type: "audio/pcm", rate: 24000 } },
              },
            },
          }),
        );
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        streamRef.current = stream;
        const source = context.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = context.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (event) => {
          if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: encodeBase64(floatToPcm16(event.inputBuffer.getChannelData(0))) }));
        };
        source.connect(processor);
        processor.connect(context.destination);
        setListening(true);
        setReply("Listening. Mishti discusses this report, and can draft a message or save a note.");
      };
      ws.onmessage = async (event) => {
        const data = JSON.parse(String(event.data)) as VoiceEvent;
        if (data.type?.includes("transcript") && data.transcript) setYou(data.transcript);
        if (data.type === "response.output_audio.delta" && data.delta) void playAudio(data.delta);
        if (data.type === "response.function_call_arguments.done" && data.name && data.call_id) {
          let result: VoiceToolResult = { ok: false, detail: "That action is not available." };
          try {
            const args = JSON.parse(data.arguments || "{}") as Record<string, unknown>;
            if (toolRef.current) result = await toolRef.current(data.name, args);
          } catch (cause) {
            result = { ok: false, detail: cause instanceof Error && cause.message ? cause.message : "That did not work." };
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: data.call_id, output: JSON.stringify(result) } }));
          ws.send(JSON.stringify({ type: "response.create" }));
          return;
        }
        if (data.type?.includes("response.output_text") && data.delta) {
          setReply((value) => (value.startsWith("Listening") ? data.delta || "" : `${value}${data.delta || ""}`));
        }
      };
      ws.onerror = () => setError("Mishti could not connect. Check the voice service key on the server and microphone permission.");
      ws.onclose = () => setListening(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Unable to start voice");
      stop();
    }
  };

  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);

  const toggleMuted = () => {
    setMuted((current) => {
      mutedRef.current = !current;
      return !current;
    });
  };

  return { muted, listening, you, reply, error, connect, stop, toggleMuted };
}
