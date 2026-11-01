// Plays the soundtrack's notes on a recorded instrument, from a directory of
// WAV files named with their notes, such as KSHarp_A4_mf.wav.
// scripts/video/fetch_samples.sh downloads the harp from VSCO 2 CE (CC0).
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { panGains, SAMPLE_RATE, type Note, type Voice } from "./audio.ts";

/** How long a note may ring before it fades out; a harp rings for many seconds. */
const NOTE_SECONDS = 3.5;
const FADE_SECONDS = 0.8;
/** The level that every sample's attack is matched to, as RMS of the first 100 ms. */
const ATTACK_LEVEL = 0.1;

interface Sample {
  midi: number;
  left: Float32Array;
  right: Float32Array;
}

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Returns the MIDI note in a file name such as KSHarp_A4_mf.wav, or null. */
export function noteInName(name: string): number | null {
  const match = /_([A-G])(#|b)?(-?\d)_/.exec(name);
  if (!match) return null;
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + NAMES[match[1]] + accidental;
}

export async function loadSampler(directory: string): Promise<Voice> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".wav"));
  const samples: Sample[] = [];
  for (const name of files) {
    const midi = noteInName(name);
    if (midi === null) continue;
    samples.push({ midi, ...prepare(await decode(join(directory, name))) });
  }
  if (samples.length === 0) throw new Error(`No samples named with notes in ${directory}`);
  samples.sort((a, b) => a.midi - b.midi);

  return (note: Note, left: Float32Array, right: Float32Array) => {
    const sample = nearest(samples, note.midi);
    const rate = 2 ** ((note.midi - sample.midi) / 12);
    const start = Math.round(note.time * SAMPLE_RATE);
    const total = Math.min(
      left.length - start,
      Math.round(NOTE_SECONDS * SAMPLE_RATE),
      Math.floor((sample.left.length - 1) / rate),
    );
    const fade = Math.round(FADE_SECONDS * SAMPLE_RATE);
    const [gainLeft, gainRight] = panGains(note);
    // Newer buildings sound brighter: a low-pass from 2.5 kHz for the oldest
    // to 12 kHz for the newest.
    const cutoff = 2500 * (12000 / 2500) ** note.brightness;
    const smoothing = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
    let lastLeft = 0;
    let lastRight = 0;
    for (let n = 0; n < total; n++) {
      const position = n * rate;
      const i = Math.floor(position);
      const t = position - i;
      const l = sample.left[i] + (sample.left[i + 1] - sample.left[i]) * t;
      const r = sample.right[i] + (sample.right[i + 1] - sample.right[i]) * t;
      lastLeft += smoothing * (l - lastLeft);
      lastRight += smoothing * (r - lastRight);
      const envelope = n > total - fade ? (total - n) / fade : 1;
      left[start + n] += lastLeft * gainLeft * envelope;
      right[start + n] += lastRight * gainRight * envelope;
    }
  };
}

function nearest(samples: Sample[], midi: number): Sample {
  let best = samples[0];
  for (const sample of samples) {
    if (Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
  }
  return best;
}

/** Decodes a file to 48 kHz stereo floating-point samples with ffmpeg. */
async function decode(file: string): Promise<{ left: Float32Array; right: Float32Array }> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2",
      "-ar", String(SAMPLE_RATE), "-"], { stdio: ["ignore", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg could not decode ${file}`))));
  });
  const interleaved = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = interleaved.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = interleaved[2 * i];
    right[i] = interleaved[2 * i + 1];
  }
  return { left, right };
}

/**
 * Starts a sample at its attack, so that the note sounds on its frame,
 * and scales it so that every note's attack has the same level.
 * The recordings start from 0 to 70 ms before the string sounds,
 * and their levels differ by more than 10 dB.
 */
function prepare({ left, right }: { left: Float32Array; right: Float32Array }) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  let onset = 0;
  while (onset < left.length && Math.max(Math.abs(left[onset]), Math.abs(right[onset])) < 0.05 * peak) onset++;
  // Keep a millisecond before the attack.
  onset = Math.max(0, onset - Math.round(0.001 * SAMPLE_RATE));
  const trimmedLeft = left.slice(onset);
  const trimmedRight = right.slice(onset);
  const window = Math.min(trimmedLeft.length, Math.round(0.1 * SAMPLE_RATE));
  let sum = 0;
  for (let i = 0; i < window; i++) sum += (trimmedLeft[i] ** 2 + trimmedRight[i] ** 2) / 2;
  const scale = ATTACK_LEVEL / Math.sqrt(sum / window || 1);
  for (let i = 0; i < trimmedLeft.length; i++) {
    trimmedLeft[i] *= scale;
    trimmedRight[i] *= scale;
  }
  return { left: trimmedLeft, right: trimmedRight };
}
