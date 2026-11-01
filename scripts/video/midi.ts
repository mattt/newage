// Writes the soundtrack's notes as a Standard MIDI File (type 1):
// a first track with the tempo and a marker at the start of each place,
// then one track for each place, with one note for each sounding building.
import { writeFile } from "node:fs/promises";
import { velocity, type Note } from "./audio.ts";

/** At 120 beats per minute and 1000 ticks per beat, a tick is half a millisecond. */
const TICKS_PER_BEAT = 1000;
const MICROSECONDS_PER_BEAT = 500_000;
const TICKS_PER_SECOND = (TICKS_PER_BEAT * 1_000_000) / MICROSECONDS_PER_BEAT;
/** General MIDI program 47, Orchestral Harp, counted from zero. */
const HARP = 46;
/** Each note lasts this long; a plucked instrument decays on its own. */
const NOTE_SECONDS = 1.5;

export interface Section {
  id: string;
  name: string;
  /** Seconds from the start of the output. */
  start: number;
}

interface TrackEvent {
  tick: number;
  /** Note-offs sort before note-ons at the same tick. */
  order: number;
  bytes: number[];
}

export async function writeMidi(file: string, notes: Note[], sections: Section[], seconds: number) {
  const tick = (time: number) => Math.round(time * TICKS_PER_SECOND);
  const conductor: TrackEvent[] = [
    { tick: 0, order: 0, bytes: meta(0x03, "Age of the City") },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, ...bigEndian(MICROSECONDS_PER_BEAT, 3)] },
    ...sections.map((section) => ({ tick: tick(section.start), order: 1, bytes: meta(0x06, section.name) })),
  ];
  const tracks = [track(conductor, tick(seconds))];
  for (const section of sections) {
    const events: TrackEvent[] = [
      { tick: 0, order: 0, bytes: meta(0x03, section.name) },
      { tick: 0, order: 0, bytes: [0xc0, HARP] },
    ];
    // A repeated pitch ends the earlier note, so no note-off cuts a later note short.
    const sounding = new Map<number, TrackEvent>();
    for (const note of notes.filter((candidate) => candidate.place === section.id)) {
      const on = tick(note.time);
      const previous = sounding.get(note.midi);
      if (previous && previous.tick > on) previous.tick = on;
      events.push({ tick: on, order: 2, bytes: [0x90, note.midi, velocity(note.amplitude)] });
      const off = { tick: on + tick(NOTE_SECONDS), order: 1, bytes: [0x80, note.midi, 0] };
      events.push(off);
      sounding.set(note.midi, off);
    }
    tracks.push(track(events, tick(seconds)));
  }
  const header = [
    ...ascii("MThd"), ...bigEndian(6, 4),
    ...bigEndian(1, 2), ...bigEndian(tracks.length, 2), ...bigEndian(TICKS_PER_BEAT, 2),
  ];
  await writeFile(file, Buffer.from([...header, ...tracks.flat()]));
}

function track(events: TrackEvent[], end: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(...variableLength(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
  return [...ascii("MTrk"), ...bigEndian(body.length, 4), ...body];
}

function meta(type: number, text: string): number[] {
  const bytes = [...Buffer.from(text, "utf8")];
  return [0xff, type, ...variableLength(bytes.length), ...bytes];
}

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  for (value >>>= 7; value > 0; value >>>= 7) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function bigEndian(value: number, length: number): number[] {
  return Array.from({ length }, (_, i) => (value >>> (8 * (length - 1 - i))) & 0xff);
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}
