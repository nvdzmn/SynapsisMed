"use client";

import { useEffect, useRef, useState } from "react";
import { openVoiceSession } from "../../lib/triallens";

type VoiceEvent = { type?: string; transcript?: string; delta?: string };

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

export function useVoiceSession(runId: string | null) {
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [you, setYou] = useState("");
  const [reply, setReply] = useState("Connecting to Grok Voice…");
  const [error, setError] = useState("");
  const mutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playhead = useRef(0);

  const stop = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    wsRef.current?.close();
    if (contextRef.current) void contextRef.current.close();
    wsRef.current = null;
    streamRef.current = null;
    contextRef.current = null;
    setListening(false);
  };

  const playAudio = async (base64: string) => {
    const context = contextRef.current;
    if (!context) return;
    const raw = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / Int16Array.BYTES_PER_ELEMENT);
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

  const connect = async (patientName: string) => {
    if (!runId || wsRef.current) return;
    setError("");
    setYou("");
    setReply("Requesting a voice session for this report…");
    try {
      const session = await openVoiceSession(runId);
      const instructions = `You are SynapseMed, a spoken clinical evidence assistant. Discuss only this physician report. Do not search, draft, prescribe, or tell anyone to start or stop a medicine. Patient in focus: ${patientName}. ${session.brief} Keep answers concise.`;
      const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [`xai-client-secret.${session.secret}`]);
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
              instructions,
              turn_detection: { type: "server_vad" },
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
        setReply("Listening. Voice discusses this report only.");
      };
      ws.onmessage = async (event) => {
        const data = JSON.parse(String(event.data)) as VoiceEvent;
        if (data.type?.includes("transcript") && data.transcript) setYou(data.transcript);
        if (data.type === "response.output_audio.delta" && data.delta) void playAudio(data.delta);
        if (data.type?.includes("response.output_text") && data.delta) {
          setReply((value) => (value.startsWith("Listening") ? data.delta || "" : `${value}${data.delta || ""}`));
        }
      };
      ws.onerror = () => setError("Grok Voice could not connect. Check XAI_API_KEY and microphone permission.");
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
