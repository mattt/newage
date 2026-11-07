// The instruments that can play the soundtrack's notes. Every one keeps the
// mapping in audio.ts: size to pitch, position to pan, newer buildings brighter.
//
// - pluck: the synthesized plucked string (Karplus–Strong).
// - harp: the recorded harp from VSCO 2 CE (CC0).
// - analog: two detuned saws through a resonant low-pass with a short
//   envelope, like an early-1980s polysynth, with chorus and a soft tape delay.
// - bells: a two-operator FM bell with long tails, like glass.
// - analog-pad: analog over a quiet pad whose chord changes with each place
//   and whose brightness follows the years of the clip.
// - marimba: the recorded marimba from VSCO 2 CE, doubled softly with a sine.
// - piano: Logic Pro's Studio Grand Piano, its sustained notes, read by exs.ts.
// - vibraphone: Logic Pro's Vibraphone, read by exs.ts.
import { join } from "node:path";
import { panGains, pluck, SAMPLE_RATE, type Instrument, type Note, type SoundSection, type Voice } from "./audio.ts";
import { loadExs } from "./exs.ts";
import { loadSampler } from "./sampler.ts";

export const INSTRUMENTS = ["pluck", "harp", "analog", "bells", "analog-pad", "marimba", "piano", "vibraphone"] as const;

/** The notes that the soundtrack plays, D3 to A5, with a margin; Logic instruments decode only these. */
const LOGIC_KEYS: [number, number] = [48, 84];

export async function loadInstrument(name: string, samples?: string): Promise<Instrument> {
  const directory = (instrument: string) => samples ?? join("data/video/samples", instrument);
  switch (name) {
    case "pluck":
      return { voice: pluck };
    case "harp":
      return { voice: await loadSampler(directory("harp")) };
    case "analog":
      return { voice: analog, effects: [chorus, tapeDelay], reverb: 0.25 };
    case "bells":
      return { voice: bell, reverb: 0.4 };
    case "analog-pad":
      return { voice: analog, bed: pad, effects: [chorus, tapeDelay], reverb: 0.3 };
    // Logic Pro's newest grand piano, its sustained notes only, with five velocity layers.
    case "piano":
      return {
        voice: await loadExs("z_Internal/Studio Piano/Studio Grand Piano (One Mic).exs", {
          groups: /^Sustain/,
          keys: LOGIC_KEYS,
          velocities: [30, 100],
          noteSeconds: 7,
          fadeSeconds: 2,
          cutoff: [3000, 16000],
        }),
        reverb: 0.3,
        program: 0,
        velocities: [30, 100],
      };
    case "vibraphone":
      return {
        voice: await loadExs("Mallet/Vibraphone.exs", {
          keys: LOGIC_KEYS,
          velocities: [40, 110],
          noteSeconds: 5,
          fadeSeconds: 1.2,
          cutoff: [3000, 14000],
        }),
        reverb: 0.35,
        program: 11,
        velocities: [40, 110],
      };
    case "marimba": {
      // VSCO 2 CE names its marimba samples an octave below the pitch they sound.
      const marimba = await loadSampler(directory("marimba"), { nameOffset: 12 });
      return { voice: doubled(marimba, glow), reverb: 0.35 };
    }
    default:
      throw new Error(`Unknown instrument ${name}; expected one of ${INSTRUMENTS.join(", ")}`);
  }
}

// Building blocks

/** A sawtooth with PolyBLEP corrections, which keep it from aliasing. */
function saw(phase: number, increment: number): number {
  let value = 2 * phase - 1;
  if (phase < increment) {
    const t = phase / increment;
    value -= t + t - t * t - 1;
  } else if (phase > 1 - increment) {
    const t = (phase - 1) / increment;
    value -= t * t + t + t + 1;
  }
  return value;
}

/** A state-variable low-pass filter (Simper's trapezoidal form), stable while its cutoff moves. */
class LowPass {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  private readonly q: number;

  constructor(q: number) {
    this.q = q;
  }

  set(cutoff: number) {
    const g = Math.tan((Math.PI * Math.min(cutoff, 0.45 * SAMPLE_RATE)) / SAMPLE_RATE);
    const k = 1 / this.q;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(input: number): number {
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
}

/** A starting phase from the note's seed, so that stacked notes do not cancel. */
function startPhase(seed: number, salt: number): number {
  return (((seed ^ salt) >>> 0) % 10_000) / 10_000;
}

/** Runs a mono note generator and adds it to the output with the note's pan. */
function addNote(
  note: Note,
  left: Float32Array,
  right: Float32Array,
  seconds: number,
  fadeSeconds: number,
  sample: (n: number, t: number) => number,
) {
  const start = Math.round(note.time * SAMPLE_RATE);
  const total = Math.min(left.length - start, Math.round(seconds * SAMPLE_RATE));
  const fade = Math.round(fadeSeconds * SAMPLE_RATE);
  const [gainLeft, gainRight] = panGains(note);
  for (let n = 0; n < total; n++) {
    const envelope = n > total - fade ? (total - n) / fade : 1;
    const value = sample(n, n / SAMPLE_RATE) * envelope;
    left[start + n] += value * gainLeft;
    right[start + n] += value * gainRight;
  }
}

// Voices

/**
 * Two saws 7 cents apart through a resonant low-pass. The filter opens at the
 * attack and closes over 120 ms; newer buildings start from a higher cutoff.
 */
const analog: Voice = (note, left, right) => {
  const detune = 2 ** (7 / 1200);
  const increments = [note.frequency * detune, note.frequency / detune].map((f) => f / SAMPLE_RATE);
  const phases = [startPhase(note.seed, 1), startPhase(note.seed, 2)];
  const filter = new LowPass(1.8);
  const base = Math.max(1.5 * note.frequency, 350 * (2200 / 350) ** note.brightness);
  // Lower notes sustain a little longer.
  const decay = 0.35 + 0.35 * Math.min(1, 220 / note.frequency);
  addNote(note, left, right, 2.5, 0.3, (n, t) => {
    if (n % 32 === 0) filter.set(base * (1 + 3 * Math.exp(-t / 0.12)));
    let value = 0;
    for (let i = 0; i < 2; i++) {
      value += saw(phases[i], increments[i]);
      phases[i] += increments[i];
      if (phases[i] >= 1) phases[i] -= 1;
    }
    const attack = Math.min(1, t / 0.004);
    return 0.3 * filter.process(value) * attack * Math.exp(-t / decay);
  });
};

/**
 * A two-operator FM bell: a modulator at twice the note's frequency, whose
 * depth fades over the note, so that each bell starts bright and rings pure.
 */
const bell: Voice = (note, left, right) => {
  const carrier = (2 * Math.PI * note.frequency) / SAMPLE_RATE;
  const modulator = 2 * carrier;
  const depth = 0.6 + 2.2 * note.brightness;
  const decay = 0.7 + 0.8 * Math.min(1, 220 / note.frequency);
  const phase = 2 * Math.PI * startPhase(note.seed, 3);
  addNote(note, left, right, 4, 0.6, (n, t) => {
    const index = depth * Math.exp(-t / 0.5);
    const value = Math.sin(phase + carrier * n + index * Math.sin(modulator * n));
    const attack = Math.min(1, t / 0.002);
    return 0.55 * value * attack * Math.exp(-t / decay);
  });
};

/** A soft sine with a slow attack, under the marimba, so that it glows a little. */
const glow: Voice = (note, left, right) => {
  const step = (2 * Math.PI * note.frequency) / SAMPLE_RATE;
  const phase = 2 * Math.PI * startPhase(note.seed, 4);
  const second = 0.2 * note.brightness;
  addNote(note, left, right, 2.5, 0.4, (n, t) => {
    const value = Math.sin(phase + step * n) + second * Math.sin(2 * (phase + step * n));
    const attack = Math.min(1, t / 0.02);
    return 0.2 * value * attack * Math.exp(-t / 0.9);
  });
};

function doubled(first: Voice, second: Voice): Voice {
  return (note, left, right) => {
    first(note, left, right);
    second(note, left, right);
  };
}

// Sound beds

/** Chords from the D major pentatonic scale, as MIDI notes; each place takes the next. */
const CHORDS = [
  [50, 57, 64, 66], // D3 A3 E4 F♯4
  [47, 54, 57, 62], // B2 F♯3 A3 D4
  [52, 59, 62, 66], // E3 B3 D4 F♯4
  [45, 52, 57, 66], // A2 E3 A3 F♯4
];
const PAD_LEVEL = 0.03;
/** Chords cross-fade over this long, centered on the cut. */
const PAD_CROSSFADE = 2;

/**
 * A quiet pad of detuned saws through a gentle low-pass. Its chord changes
 * with each place, and its filter opens as the clip's years advance,
 * from dark at 1880 to brighter at the last year.
 */
function pad(left: Float32Array, right: Float32Array, sections: SoundSection[]) {
  const half = PAD_CROSSFADE / 2;
  sections.forEach((section, index) => {
    const chord = CHORDS[index % CHORDS.length];
    const first = index === 0;
    const last = index === sections.length - 1;
    const from = Math.max(0, Math.round((section.start - (first ? 0 : half)) * SAMPLE_RATE));
    const to = Math.min(left.length, Math.round((section.start + section.seconds + (last ? 0 : half)) * SAMPLE_RATE));
    chord.forEach((midi, voiceIndex) => {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const detune = 2 ** (5 / 1200);
      const increments = [frequency * detune, frequency / detune].map((f) => f / SAMPLE_RATE);
      const phases = [startPhase(midi, 5 + index), startPhase(midi, 9 + index)];
      const filter = new LowPass(0.7);
      const pan = 0.3 + (0.4 * voiceIndex) / (chord.length - 1);
      const gainLeft = PAD_LEVEL * Math.cos((pan * Math.PI) / 2);
      const gainRight = PAD_LEVEL * Math.sin((pan * Math.PI) / 2);
      for (let i = from; i < to; i++) {
        const t = i / SAMPLE_RATE;
        if ((i - from) % 64 === 0) {
          const year = Math.min(section.lastYear, section.firstYear + Math.max(0, t - section.start) * section.yearsPerSecond);
          const brightness = Math.min(1, Math.max(0, (year - 1880) / 146));
          filter.set(250 * (1400 / 250) ** brightness);
        }
        let value = 0;
        for (let j = 0; j < 2; j++) {
          value += saw(phases[j], increments[j]);
          phases[j] += increments[j];
          if (phases[j] >= 1) phases[j] -= 1;
        }
        // Raised-cosine fades at each end; the first place fades in over two seconds.
        const inFade = first ? Math.min(1, t / PAD_CROSSFADE) : rise((t - (section.start - half)) / PAD_CROSSFADE);
        const outFade = last ? 1 : 1 - rise((t - (section.start + section.seconds - half)) / PAD_CROSSFADE);
        const shaped = filter.process(value) * inFade * outFade;
        left[i] += shaped * gainLeft;
        right[i] += shaped * gainRight;
      }
    });
  });
}

function rise(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

// Effects

/** A two-voice chorus, like a 1980s polysynth's: each side slowly modulates a short delay. */
function chorus(left: Float32Array, right: Float32Array) {
  const run = (channel: Float32Array, offset: number) => {
    const size = Math.round(0.02 * SAMPLE_RATE);
    const buffer = new Float32Array(size);
    let write = 0;
    for (let i = 0; i < channel.length; i++) {
      buffer[write] = channel[i];
      const delay = (0.007 + 0.0025 * Math.sin(2 * Math.PI * 0.4 * (i / SAMPLE_RATE) + offset)) * SAMPLE_RATE;
      const read = write - delay + size;
      const j = Math.floor(read);
      const t = read - j;
      const wet = buffer[j % size] * (1 - t) + buffer[(j + 1) % size] * t;
      channel[i] = 0.8 * channel[i] + 0.5 * wet;
      write = (write + 1) % size;
    }
  };
  run(left, 0);
  run(right, Math.PI);
}

/**
 * A soft tape echo: a different delay on each side, a little wow, and a
 * low-pass in the feedback, so that each repeat is darker than the last.
 */
function tapeDelay(left: Float32Array, right: Float32Array) {
  const run = (channel: Float32Array, seconds: number, offset: number) => {
    const size = Math.round(0.6 * SAMPLE_RATE);
    const buffer = new Float32Array(size);
    let write = 0;
    let tone = 0;
    const smoothing = 1 - Math.exp((-2 * Math.PI * 2800) / SAMPLE_RATE);
    for (let i = 0; i < channel.length; i++) {
      const delay = (seconds + 0.001 * Math.sin(2 * Math.PI * 0.35 * (i / SAMPLE_RATE) + offset)) * SAMPLE_RATE;
      const read = write - delay + size;
      const j = Math.floor(read);
      const t = read - j;
      const echo = buffer[j % size] * (1 - t) + buffer[(j + 1) % size] * t;
      tone += smoothing * (echo - tone);
      buffer[write] = channel[i] + 0.32 * tone;
      channel[i] += 0.25 * tone;
      write = (write + 1) % size;
    }
  };
  run(left, 0.375, 0);
  run(right, 0.455, 1.3);
}
