// Makes the soundtrack from building events: each building that appears in the
// frame plucks a string. The default voice is synthesized; sampler.ts supplies
// recorded instruments, and instruments.ts other voices, that play the same notes.
//
// - Time: a building sounds on the frame where its year arrives. Buildings of
//   the same year spread across that year's share of the clip, like a strum.
// - Density: a year with many buildings sounds louder and fuller, but at most
//   NOTES_PER_SECOND notes play, so that a burst of construction is a shimmer.
// - Pitch: larger buildings sound lower, on a D major pentatonic scale over
//   three octaves, so towers are bass notes and houses are the melody.
// - Tone: newer buildings sound brighter, as the colors fade toward white.
// - Pan: a building's position across the frame.
import { writeFile } from "node:fs/promises";

export const SAMPLE_RATE = 48_000;

export interface NoteEvent {
  /** Seconds from the start of the output. */
  time: number;
  /** Seconds that one year of playback lasts; a year's notes spread over most of it. */
  yearSeconds: number;
  /** Position across the frame, from 0 at the left to 1 at the right. */
  x: number;
  year: number;
  /** Floor area in square feet, or -1 when unknown. */
  sqft: number;
  /** A stable number for the building, which picks its variations. */
  seed: number;
  /** The place's ID, for exports. */
  place: string;
}

/** The most notes per second of playback, whatever the speed. */
const NOTES_PER_SECOND = 45;
/** A year with this many buildings plays at full level. */
const FULL = 200;
const SCALE = [0, 2, 4, 7, 9];
/** MIDI note 50 is D3. */
const ROOT = 50;
const DEGREES = 14;
const NOTE_SECONDS = 2.4;
/** The amplitude of the loudest possible note, for MIDI velocity. */
const MAX_AMPLITUDE = 0.5;
/** MIDI velocity 1 is this many decibels below velocity 127. */
const VELOCITY_RANGE_DB = 40;

/** Groups events that sound together: same time, same strum. */
function groups(events: NoteEvent[]): NoteEvent[][] {
  const byTime = new Map<number, NoteEvent[]>();
  for (const event of events) {
    const key = Math.round(event.time * 1000);
    const group = byTime.get(key);
    if (group) group.push(event);
    else byTime.set(key, [event]);
  }
  return [...byTime.values()];
}

export interface Note {
  /** Seconds from the start of the output, when the note sounds. */
  time: number;
  /** The frame time at which the building appears, before the strum spreads it. */
  frameTime: number;
  midi: number;
  frequency: number;
  amplitude: number;
  /** From 0 (dark) to 1 (bright). */
  brightness: number;
  /** From 0 (left) to 1 (right). */
  pan: number;
  seed: number;
  place: string;
  year: number;
  sqft: number;
  /** How many buildings appeared with this note, of which it is one voice. */
  buildings: number;
}

/**
 * Chooses the notes that the events play.
 *
 * By default, a year with FULL buildings plays at full level, and any year with
 * more buildings than the note cap plays every voice; that suits a neighborhood.
 * In a frame with thousands of buildings a year, nearly every year would reach
 * both, and the soundtrack would be a wall. With `busiest`, a year's share of
 * that many buildings (or of the busiest year in the events, for "auto") sets
 * both: the voices grow with its square root and the level with its fourth
 * root, so that a busier year has more notes as well as louder ones.
 */
export function notes(events: NoteEvent[], busiest?: number | "auto"): Note[] {
  const result: Note[] = [];
  const all = groups(events);
  const full = busiest === "auto" ? Math.max(1, ...all.map((group) => group.length)) : (busiest ?? FULL);
  for (const group of all) {
    const n = group.length;
    const { yearSeconds } = group[0];
    const cap = Math.max(1, Math.round(NOTES_PER_SECOND * yearSeconds));
    const density = Math.sqrt(Math.min(1, n / full));
    const level = busiest === undefined
      ? Math.sqrt(Math.min(1, Math.log1p(n) / Math.log1p(full)))
      : Math.sqrt(density);
    const voices = busiest === undefined ? cap : Math.max(1, Math.round(cap * density));
    // A stable choice of voices: the order of their seeds, not of the data file.
    const chosen = [...group].sort((a, b) => hash(a.seed) - hash(b.seed)).slice(0, voices);
    const amplitude = (MAX_AMPLITUDE * level) / Math.sqrt(chosen.length);
    // A crowded strum is a little darker, so that it blends.
    const crowd = n > voices ? 0.8 : 1;
    for (const event of chosen) {
      const h = hash(event.seed);
      const midi = pitch(event.sqft, h);
      result.push({
        // Leave a gap before the next year's notes.
        time: event.time + 0.9 * yearSeconds * fraction(h),
        frameTime: event.time,
        midi,
        frequency: midiFrequency(midi),
        amplitude,
        brightness: crowd * yearBrightness(event.year),
        pan: 0.1 + 0.8 * Math.min(1, Math.max(0, event.x)),
        seed: h,
        place: event.place,
        year: event.year,
        sqft: event.sqft,
        buildings: n,
      });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

function pitch(sqft: number, h: number): number {
  // Floor area from about 500 to 200,000 square feet, on a log scale.
  const size = sqft > 0 ? Math.min(1, Math.max(0, (Math.log10(sqft) - 2.7) / 2.6)) : 0.35;
  // Similar houses would all play one note; vary them by a step either way.
  const jitter = (h >>> 8) % 3 - 1;
  const degree = Math.min(DEGREES - 1, Math.max(0, Math.round((1 - size) * (DEGREES - 3)) + 1 + jitter));
  const octave = Math.floor(degree / SCALE.length);
  return ROOT + 12 * octave + SCALE[degree % SCALE.length];
}

function yearBrightness(year: number): number {
  return Math.min(1, Math.max(0, (year - 1880) / 146));
}

/** The MIDI velocity for a note's amplitude, on a decibel scale. */
export function velocity(amplitude: number, [low, high]: [number, number] = [0, 127]): number {
  const db = 20 * Math.log10(amplitude / MAX_AMPLITUDE);
  return Math.min(high, Math.max(1, low, Math.round(low + (high - low) * (1 + db / VELOCITY_RANGE_DB))));
}

export function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Adds one note to the stereo output. */
export type Voice = (note: Note, left: Float32Array, right: Float32Array) => void;

/** A place's clip in the soundtrack, for sound that follows the clip rather than its notes. */
export interface SoundSection {
  /** Seconds from the start of the output. */
  start: number;
  seconds: number;
  firstYear: number;
  lastYear: number;
  yearsPerSecond: number;
}

/** Processes the stereo output in place. */
export type Effect = (left: Float32Array, right: Float32Array) => void;

export interface Instrument {
  voice: Voice;
  /** Sound under the notes, such as a pad, which follows the sections. */
  bed?: (left: Float32Array, right: Float32Array, sections: SoundSection[]) => void;
  /** Effects on the notes and bed, in order, before the room. */
  effects?: Effect[];
  /** The level of the room reverb; 0.35 by default. */
  reverb?: number;
  /** The General MIDI program for the MIDI export; 46, Orchestral Harp, by default. */
  program?: number;
  /** The MIDI velocities of the quietest and loudest notes, for recorded layers and the MIDI export. */
  velocities?: [number, number];
}

/** Renders notes to stereo samples, with a little room reverb. */
export function render(
  noteList: Note[],
  seconds: number,
  instrument: Instrument = { voice: pluck },
  sections: SoundSection[] = [],
): [Float32Array, Float32Array] {
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const note of noteList) instrument.voice(note, left, right);
  instrument.bed?.(left, right, sections);
  for (const effect of instrument.effects ?? []) effect(left, right);
  const [wetLeft, wetRight] = reverb(left, right);
  const send = instrument.reverb ?? 0.35;
  for (let i = 0; i < length; i++) {
    left[i] = 0.8 * left[i] + send * wetLeft[i];
    right[i] = 0.8 * right[i] + send * wetRight[i];
  }
  return [left, right];
}

/**
 * A Karplus–Strong plucked string: a burst of filtered noise in a delay line
 * one period long, which a gentle low-pass loop filter decays.
 */
export function pluck(note: Note, left: Float32Array, right: Float32Array) {
  const start = Math.round(note.time * SAMPLE_RATE);
  if (start >= left.length) return;
  const period = SAMPLE_RATE / note.frequency;
  const size = Math.floor(period);
  // Averaging two neighbors delays the loop by size - 0.5 samples;
  // a first-order all-pass filter supplies the rest of the period.
  const fractionalDelay = period - size + 0.5;
  const allpass = (1 - fractionalDelay) / (1 + fractionalDelay);
  const line = new Float32Array(size);
  const random = prng(note.seed);
  // Darker notes start from smoother noise.
  const smooth = 0.75 - 0.5 * note.brightness;
  let previous = 0;
  for (let i = 0; i < size; i++) {
    previous = smooth * previous + (1 - smooth) * (random() * 2 - 1);
    line[i] = previous;
  }
  // Remove the burst's offset, which would otherwise thump.
  const mean = line.reduce((sum, value) => sum + value, 0) / size;
  for (let i = 0; i < size; i++) line[i] -= mean;

  // Lower notes ring longer, as on a real string: from 2.4 seconds to fall
  // by 60 dB at D3 to about 1.2 seconds at the top of the scale.
  const ring = 1.2 + 1.2 * Math.min(1, Math.max(0, (600 - note.frequency) / 450));
  const decay = 10 ** (-3 / (ring * note.frequency));
  const [gainLeft, gainRight] = panGains(note);
  const total = Math.min(left.length - start, Math.round(NOTE_SECONDS * SAMPLE_RATE));
  const fadeIn = Math.round(0.004 * SAMPLE_RATE);
  const fadeOut = Math.round(0.3 * SAMPLE_RATE);
  let index = 0;
  let last = 0;
  let allpassIn = 0;
  let allpassOut = 0;
  for (let n = 0; n < total; n++) {
    const current = line[index];
    const next = line[(index + 1) % size];
    const averaged = decay * 0.5 * (current + next);
    allpassOut = allpass * averaged + allpassIn - allpass * allpassOut;
    allpassIn = averaged;
    line[index] = allpassOut;
    index = (index + 1) % size;
    // A soft attack and a fade at the end of the note's time.
    let envelope = 1;
    if (n < fadeIn) envelope = n / fadeIn;
    else if (n > total - fadeOut) envelope = (total - n) / fadeOut;
    // A one-pole low-pass takes the edge off the pluck.
    last += 0.35 * (current - last);
    const sample = last * envelope;
    left[start + n] += sample * gainLeft;
    right[start + n] += sample * gainRight;
  }
}

/** Freeverb, after Jezar's public-domain design, with a small, damp room. */
function reverb(left: Float32Array, right: Float32Array): [Float32Array, Float32Array] {
  const scale = SAMPLE_RATE / 44_100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const spread = 23;
  const room = 0.78;
  const damp = 0.45;
  const channel = (input: Float32Array, offset: number) => {
    const output = new Float32Array(input.length);
    const lines = combs.map((length) => ({
      buffer: new Float32Array(Math.round((length + offset) * scale)),
      index: 0,
      filter: 0,
    }));
    for (let i = 0; i < input.length; i++) {
      const x = input[i] * 0.015;
      let sum = 0;
      for (const line of lines) {
        const y = line.buffer[line.index];
        line.filter = y * (1 - damp) + line.filter * damp;
        line.buffer[line.index] = x + line.filter * room;
        line.index = (line.index + 1) % line.buffer.length;
        sum += y;
      }
      output[i] = sum;
    }
    for (const length of allpasses) {
      const buffer = new Float32Array(Math.round((length + offset) * scale));
      let index = 0;
      for (let i = 0; i < output.length; i++) {
        const delayed = buffer[index];
        const x = output[i];
        buffer[index] = x + delayed * 0.5;
        output[i] = delayed - x;
        index = (index + 1) % buffer.length;
      }
    }
    return output;
  };
  return [channel(left, 0), channel(right, spread)];
}

export async function writeWav(file: string, [left, right]: [Float32Array, Float32Array]) {
  const frames = left.length;
  const data = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) {
    data.writeFloatLE(left[i], i * 8);
    data.writeFloatLE(right[i], i * 8 + 4);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([header, data]));
}

/** A 32-bit integer hash (lowbias32), for stable per-building choices. */
export function hash(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Equal-power gains for a note's level and pan. */
export function panGains(note: Note): [left: number, right: number] {
  return [
    note.amplitude * Math.cos((note.pan * Math.PI) / 2),
    note.amplitude * Math.sin((note.pan * Math.PI) / 2),
  ];
}

function fraction(h: number): number {
  return hash(h ^ 0x9e3779b9) / 2 ** 32;
}

/** Mulberry32, a small seeded generator, so that every render sounds the same. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
