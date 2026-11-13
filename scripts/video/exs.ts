// Plays the soundtrack's notes on a Logic Pro sampler instrument (.exs), read
// from Logic Pro's sound library in ~/Music. Apple's AUSampler cannot play the
// library's current instruments, whose samples are packed into "consolidated"
// CAF files, so this reads the instrument's zones itself and decodes only the
// parts of the CAF that the notes need.
//
// The EXS layout is undocumented. Each chunk has an 84-byte header (its kind in
// the top byte of the first word, its size in the second, and its name from byte
// 20) and a body. A zone's body holds its root key (byte 1), fine tune (2), key
// range (6–7), velocity range (9–10), start and end frames in the sample file
// (12, 16), group (88), and sample file (92); a group's body holds its level in
// dB (byte 0) and velocity range (5–6).
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { velocity, type Note, type Voice } from "./audio.ts";
import { decode, play, prepare, type PlayOptions, type Recording } from "./sampler.ts";

export const LOGIC_LIBRARY = join(homedir(), "Music/Logic Pro Library.bundle");
const SAMPLE_RATE_IN_FILES = 44_100;

interface Zone {
  root: number;
  /** Cents. */
  fine: number;
  keyLow: number;
  keyHigh: number;
  velocityLow: number;
  velocityHigh: number;
  start: number;
  end: number;
  group: number;
  sample: number;
}

interface Group {
  name: string;
  velocityLow: number;
  velocityHigh: number;
}

interface Instrument {
  zones: Zone[];
  groups: Group[];
  /** File names of the sample files, in the order zones refer to them. */
  samples: string[];
}

export function parseExs(data: Buffer): Instrument {
  if (data.toString("latin1", 16, 20) !== "TBOS") throw new Error("Not a little-endian EXS file");
  const zones: Zone[] = [];
  const groups: Group[] = [];
  const samples: string[] = [];
  for (let position = 0; position + 84 <= data.length; ) {
    const kind = data.readUInt32LE(position) & 0x0f000000;
    const size = data.readUInt32LE(position + 4);
    const name = data.toString("latin1", position + 20, position + 84).split("\0")[0];
    const body = data.subarray(position + 84, position + 84 + size);
    if (kind === 0x01000000 && body.length >= 96) {
      zones.push({
        root: body[1],
        fine: body.readInt8(2),
        keyLow: body[6],
        keyHigh: body[7],
        velocityLow: body[9],
        velocityHigh: body[10],
        start: body.readInt32LE(12),
        end: body.readInt32LE(16),
        group: body.readInt32LE(88),
        sample: body.readInt32LE(92),
      });
    } else if (kind === 0x02000000 && body.length >= 7) {
      groups.push({ name, velocityLow: body[5], velocityHigh: body[6] });
    } else if (kind === 0x03000000) {
      samples.push(name);
    }
    position += 84 + size;
  }
  return { zones, groups, samples };
}

export interface ExsOptions extends PlayOptions {
  /** Plays only zones in groups whose names match, such as the sustained notes of a piano. */
  groups?: RegExp;
  /** The notes that will be played, so that only their zones are decoded. */
  keys: [low: number, high: number];
  /** MIDI velocities for the quietest and loudest notes, which choose the recorded layer. */
  velocities: [low: number, high: number];
}

/** Loads a Logic Pro sampler instrument, from a path relative to its Sampler settings. */
export async function loadExs(instrument: string, options: ExsOptions): Promise<Voice> {
  const file = join(LOGIC_LIBRARY, "Plug-In Settings/Sampler", instrument);
  const { zones, groups, samples } = parseExs(await readFile(file));
  const paths = await Promise.all(samples.map((name) => findSample(name)));
  const [low, high] = options.keys;
  const playable = zones.filter((zone) => {
    const group = groups[zone.group];
    return (
      group !== undefined &&
      (!options.groups || options.groups.test(group.name)) &&
      zone.keyHigh >= low &&
      zone.keyLow <= high &&
      zone.end > zone.start
    );
  });
  if (playable.length === 0) throw new Error(`No zones to play in ${file}`);

  // Decode each zone once, only as long as a note may ring.
  const recordings = new Map<Zone, Recording>();
  const queue = [...playable];
  const workers = Array.from({ length: 8 }, async () => {
    for (let zone = queue.shift(); zone; zone = queue.shift()) {
      const frames = Math.min(zone.end - zone.start, Math.ceil((options.noteSeconds + 0.5) * SAMPLE_RATE_IN_FILES));
      const recording = await decode(paths[zone.sample], zone.start / SAMPLE_RATE_IN_FILES, frames / SAMPLE_RATE_IN_FILES);
      recordings.set(zone, prepare(recording));
    }
  });
  await Promise.all(workers);

  return (note: Note, left: Float32Array, right: Float32Array) => {
    // The note's level chooses the recorded layer; its amplitude sets the gain,
    // since prepare() matched every layer's attack level.
    const layer = velocity(note.amplitude, options.velocities);
    const candidates = playable.filter((zone) => {
      const group = groups[zone.group];
      return (
        zone.keyLow <= note.midi &&
        note.midi <= zone.keyHigh &&
        Math.max(zone.velocityLow, group.velocityLow) <= layer &&
        layer <= Math.min(zone.velocityHigh, group.velocityHigh)
      );
    });
    if (candidates.length === 0) return;
    // Several zones can share a key and layer, such as round robins; the note's seed picks one.
    const zone = candidates[note.seed % candidates.length];
    play(note, recordings.get(zone)!, note.midi - zone.root - zone.fine / 100, options, left, right);
  };
}

/** Finds a sample file by name anywhere in Logic Pro's library. */
async function findSample(name: string): Promise<string> {
  const root = join(LOGIC_LIBRARY, "Samples");
  for (const entry of await readdir(root, { recursive: true })) {
    if (entry.endsWith(`/${name}`) || entry === name) return join(root, entry);
  }
  throw new Error(`No sample ${name} in ${root}; is Logic Pro's sound library installed?`);
}
