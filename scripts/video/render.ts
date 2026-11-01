// Renders the launch video frame by frame: for each frame, the render page
// sets the map's year range, headless Chromium captures it, and ffmpeg encodes
// the frames at a fixed rate. The soundtrack comes from the same buildings.
//
// Usage: node scripts/video/render.ts [options]
// Run with --help for the options.
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp from "sharp";
import { render as renderAudio, notes, SAMPLE_RATE, velocity, writeWav, type Note, type NoteEvent } from "./audio.ts";
import { loadBuildings } from "./buildings.ts";
import { projector } from "./frame.ts";
import { writeMidi, type Section } from "./midi.ts";
import { DEFAULT_PLACES, loadPlaces, parseSize, startYear, type OutputSize, type Place } from "./places.ts";
import { INSTRUMENTS, loadInstrument } from "./instruments.ts";
import { startServer } from "./server.ts";

const HELP = `Usage: node scripts/video/render.ts [options]

  --places FILE           places to render (default ${DEFAULT_PLACES})
  --only ID,ID            render only these places, in this order
  --size WxH              output size; repeat for more (default 1080x1920)
  --years-per-second N    playback speed (default 15)
  --hold SECONDS          time at the last year of each clip (default 2)
  --fade SECONDS          fade through the background between clips (default 0)
  --fps N                 frame rate (default 30)
  --out DIR               output directory (default renders)
  --no-labels             leave out the place name and year
  --no-unknown            leave out buildings of unknown year
  --no-audio              leave out the soundtrack
  --instrument NAME       ${INSTRUMENTS.join(", ")} (default pluck);
                          harp and marimba need scripts/video/fetch_samples.sh
  --samples DIR           samples for the instrument (default data/video/samples/NAME)
  --reuse-frames          keep frames rendered by an earlier run, to change only the sound
  --stills                render each place at its last year, and a contact sheet
  --buildings-tiles FILE  default data/regional-buildings.pmtiles
  --orientation-tiles FILE  default data/orientation.pmtiles
`;

const { values: options } = parseArgs({
  options: {
    places: { type: "string", default: DEFAULT_PLACES },
    only: { type: "string" },
    size: { type: "string", multiple: true },
    "years-per-second": { type: "string", default: "15" },
    hold: { type: "string", default: "2" },
    fade: { type: "string", default: "0" },
    fps: { type: "string", default: "30" },
    out: { type: "string", default: "renders" },
    "no-labels": { type: "boolean", default: false },
    "no-unknown": { type: "boolean", default: false },
    "no-audio": { type: "boolean", default: false },
    instrument: { type: "string", default: "pluck" },
    samples: { type: "string" },
    "reuse-frames": { type: "boolean", default: false },
    stills: { type: "boolean", default: false },
    "buildings-tiles": { type: "string", default: "data/regional-buildings.pmtiles" },
    "orientation-tiles": { type: "string", default: "data/orientation.pmtiles" },
    help: { type: "boolean", default: false },
  },
});

if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const FPS = positive("fps");
const YEARS_PER_SECOND = positive("years-per-second");
const HOLD = Number(options.hold);
const FADE = Number(options.fade);
const LOUDNESS = -16;
/** The limiter ceiling: about -2 dBFS, which leaves room for AAC overshoot. */
const LIMIT = 0.79;
const INSTRUMENT = options.instrument;
/** Outputs with another instrument than the default get its name, so they do not replace each other. */
const SUFFIX = INSTRUMENT === "pluck" ? "" : `-${INSTRUMENT}`;
const instrument = await loadInstrument(INSTRUMENT, options.samples);

function positive(name: "fps" | "years-per-second"): number {
  const value = Number(options[name]);
  if (!(value > 0)) throw new Error(`--${name} must be a positive number`);
  return value;
}

/** What the page draws for one frame. */
interface FrameState {
  center: [number, number];
  zoom: number;
  year: number;
  bounds: { earliest: number; latest: number };
  includeUnknown: boolean;
  name: string | null;
}

interface Clip {
  place: Place;
  start: number;
  end: number;
  /** The year that each frame shows. */
  years: number[];
  /** Notes, in seconds from the start of the clip. */
  events: NoteEvent[];
  seconds: number;
}

let places = await loadPlaces(options.places);
if (options.only) {
  const ids = options.only.split(",");
  places = ids.map((id) => {
    const place = places.find((candidate) => candidate.id === id);
    if (!place) throw new Error(`No place ${id} in ${options.places}`);
    return place;
  });
}
const sizes = (options.size?.length ? options.size : ["1080x1920"]).map(parseSize);
const buildings = await loadBuildings();
// The site's year bounds, so that the filter matches the site's Play.
const stats = JSON.parse(await readFile("src/data/building-stats.json", "utf8"));
const bounds = { earliest: stats.earliestYear as number, latest: stats.latestYear as number };

const server = await startServer({
  buildings: options["buildings-tiles"],
  orientation: options["orientation-tiles"],
});
const browser = await chromium.launch({
  headless: true,
  // Draw WebGL with the GPU through Metal; otherwise Chromium falls back to software.
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});

try {
  for (const size of sizes) {
    const page = await openPage(browser, size);
    const directory = join(options.out, `${size.width}x${size.height}`);
    if (options.stills) await renderStills(page, size, directory);
    else await renderVideo(page, size, directory);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

async function openPage(browser: Browser, size: OutputSize): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: Math.round(size.viewport.width), height: Math.round(size.viewport.height) },
    deviceScaleFactor: size.pixelRatio,
  });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => "video" in window);
  return page;
}

async function show(page: Page, state: FrameState): Promise<Buffer> {
  const errors = await page.evaluate(
    (state) => (window as unknown as { video: { show: (s: unknown) => Promise<string[]> } }).video.show(state),
    state,
  );
  for (const error of errors) console.error("map error:", error);
  return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

function frameState(place: Place, year: number): FrameState {
  return {
    center: place.center,
    zoom: place.zoom,
    year,
    bounds,
    includeUnknown: !options["no-unknown"],
    name: options["no-labels"] ? null : place.name,
  };
}

// Stills

async function renderStills(page: Page, size: OutputSize, directory: string) {
  const stills = join(directory, "stills");
  await mkdir(stills, { recursive: true });
  const files: string[] = [];
  for (const place of places) {
    const file = join(stills, `${place.id}.png`);
    await writeFile(file, await show(page, frameState(place, bounds.latest)));
    files.push(file);
    console.log(file);
  }
  const sheet = join(directory, "contact-sheet.png");
  await contactSheet(files, size, sheet);
  console.log(sheet);
}

/** Lays out stills in a grid, each scaled to a third of its size. */
async function contactSheet(files: string[], size: OutputSize, output: string) {
  const width = Math.round(size.width / 3);
  const height = Math.round(size.height / 3);
  const gap = 8;
  const columns = Math.min(files.length, size.width < size.height ? 6 : 4);
  const rows = Math.ceil(files.length / columns);
  const tiles = await Promise.all(
    files.map(async (file, i) => ({
      input: await sharp(file).resize(width, height).toBuffer(),
      left: gap + (i % columns) * (width + gap),
      top: gap + Math.floor(i / columns) * (height + gap),
    })),
  );
  await sharp({
    create: {
      width: gap + columns * (width + gap),
      height: gap + rows * (height + gap),
      channels: 3,
      background: "#18181b",
    },
  })
    .composite(tiles)
    .png()
    .toFile(output);
}

// Video

function planClip(place: Place, size: OutputSize): Clip {
  const project = projector(place, size.viewport);
  const inFrame: number[] = [];
  const years: number[] = [];
  for (let i = 0; i < buildings.count; i++) {
    if (buildings.year[i] <= 0 || !project(buildings.lng[i], buildings.lat[i])) continue;
    inFrame.push(i);
    years.push(buildings.year[i]);
  }
  years.sort((a, b) => a - b);
  const start = startYear(place, years);
  const end = bounds.latest;
  const runFrames = Math.round(((end - start) / YEARS_PER_SECOND) * FPS) + 1;
  const holdFrames = Math.round(HOLD * FPS);
  const frameYears: number[] = [];
  for (let f = 0; f < runFrames + holdFrames; f++) {
    frameYears.push(Math.min(end, start + Math.floor((f * YEARS_PER_SECOND) / FPS + 1e-9)));
  }
  // A building sounds on the first frame that shows its year.
  const firstFrame = new Map<number, number>();
  frameYears.forEach((year, f) => {
    if (!firstFrame.has(year)) firstFrame.set(year, f);
  });
  const events: NoteEvent[] = [];
  for (const i of inFrame) {
    const year = buildings.year[i];
    if (year <= start || year > end) continue;
    const frame = firstFrame.get(year);
    if (frame === undefined) continue;
    const [x] = project(buildings.lng[i], buildings.lat[i])!;
    events.push({
      time: frame / FPS,
      yearSeconds: 1 / YEARS_PER_SECOND,
      x,
      year,
      sqft: buildings.sqft[i],
      seed: i,
      place: place.id,
    });
  }
  return { place, start, end, years: frameYears, events, seconds: frameYears.length / FPS };
}

async function renderVideo(page: Page, size: OutputSize, directory: string) {
  const work = join(directory, "work");
  await mkdir(work, { recursive: true });
  const clips = places.map((place) => planClip(place, size));
  const timings: string[] = [];
  for (const clip of clips) {
    const began = performance.now();
    const video = join(work, `${clip.place.id}.mkv`);
    if (!(options["reuse-frames"] && (await exists(video)))) await renderFrames(page, clip, video);
    const output = join(directory, `${clip.place.id}${SUFFIX}.mp4`);
    await assemble([clip], [video], output, work);
    const seconds = (performance.now() - began) / 1000;
    timings.push(`${clip.place.id}: ${clip.seconds.toFixed(1)} s of video, ${clip.start}–${clip.end}, ` +
      `${clip.events.length} buildings sounding, rendered in ${seconds.toFixed(0)} s`);
    console.log(output);
  }
  if (clips.length > 1) {
    const output = join(directory, `sequence${SUFFIX}.mp4`);
    await assemble(clips, clips.map((clip) => join(work, `${clip.place.id}.mkv`)), output, work);
    console.log(output);
  }
  console.log(timings.join("\n"));
}

/** Captures each distinct frame once, and repeats it while the year holds. */
async function renderFrames(page: Page, clip: Clip, output: string) {
  const ffmpeg = spawn(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS),
      "-c:v", "png", "-i", "-", "-c:v", "libx264rgb", "-crf", "0", "-preset", "ultrafast", output],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = exited(ffmpeg, "ffmpeg");
  let previousYear = NaN;
  let frame: Buffer | undefined;
  for (const [f, year] of clip.years.entries()) {
    if (year !== previousYear) {
      frame = await show(page, frameState(clip.place, year));
      previousYear = year;
    }
    if (!ffmpeg.stdin.write(frame)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    if (f % FPS === 0) process.stderr.write(`\r${clip.place.id} ${year} (${f + 1}/${clip.years.length})   `);
  }
  process.stderr.write("\n");
  ffmpeg.stdin.end();
  await done;
}

/**
 * Joins clips into one file with a soundtrack: the video in H.264 for wide
 * playback, and the audio synthesized for the whole sequence, then normalized.
 */
async function assemble(clips: Clip[], videos: string[], output: string, work: string) {
  const name = output.replace(/^.*\//, "").replace(/\.mp4$/, "");
  const offsets: number[] = [];
  let total = 0;
  for (const clip of clips) {
    offsets.push(total);
    total += clip.seconds;
  }

  const inputs: string[] = [];
  for (const video of videos) inputs.push("-i", video);
  const filters: string[] = [];
  clips.forEach((clip, i) => {
    const fades = FADE > 0
      ? `,fade=t=in:d=${FADE}:c=0x050506,fade=t=out:st=${(clip.seconds - FADE).toFixed(3)}:d=${FADE}:c=0x050506`
      : "";
    filters.push(`[${i}:v]setpts=PTS-STARTPTS${fades}[v${i}]`);
  });
  filters.push(`${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${clips.length}:v=1:a=0,` +
    `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`);

  const audioArgs: string[] = [];
  if (!options["no-audio"]) {
    const events = clips.flatMap((clip, i) =>
      clip.events.map((event) => ({ ...event, time: event.time + offsets[i] })),
    );
    const raw = join(work, `${name}-raw.wav`);
    const normalized = join(work, `${name}.wav`);
    const played = notes(events);
    const soundSections = clips.map((clip, i) => ({
      start: offsets[i],
      seconds: clip.seconds,
      firstYear: clip.start,
      lastYear: clip.end,
      yearsPerSecond: YEARS_PER_SECOND,
    }));
    await writeWav(raw, renderAudio(played, total, instrument, soundSections));
    await normalize(raw, normalized);
    const sections = clips.map((clip, i) => ({ id: clip.place.id, name: clip.place.name, start: offsets[i] }));
    await exportSound(join(dirname(output), name), normalized, played, sections, total);
    inputs.push("-i", normalized);
    audioArgs.push("-map", `${clips.length}:a`, "-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE));
  }

  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs,
    "-filter_complex", filters.join(";"), "-map", "[v]", ...audioArgs,
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-r", String(FPS),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-movflags", "+faststart", "-t", total.toFixed(3), output,
  ]);
}

/**
 * Writes the soundtrack and its notes beside the video, for other instruments
 * and tools: a 24-bit WAV, a MIDI file, and the notes as JSON and CSV.
 */
async function exportSound(base: string, wav: string, played: Note[], sections: Section[], seconds: number) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "pcm_s24le", `${base}.wav`]);
  await writeMidi(`${base}.mid`, played, sections, seconds);
  const names = new Map(sections.map((section) => [section.id, section.name]));
  const rows = played.map((note) => ({
    time: round(note.time, 4),
    frame_time: round(note.frameTime, 4),
    place: names.get(note.place) ?? note.place,
    year: note.year,
    midi: note.midi,
    velocity: velocity(note.amplitude),
    pan: round(note.pan * 2 - 1, 3),
    sqft: note.sqft,
    buildings: note.buildings,
  }));
  await writeFile(`${base}-notes.json`, JSON.stringify({ sections, notes: rows }, null, 1));
  const header = Object.keys(rows[0] ?? { time: 0 });
  const csv = rows.map((row) => Object.values(row).map((value) => (typeof value === "string" ? JSON.stringify(value) : value)).join(","));
  await writeFile(`${base}-notes.csv`, [header.join(","), ...csv].join("\n") + "\n");
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Brings the soundtrack to the target integrated loudness: a gain, then a
 * limiter for the peaks, measured again and corrected until it lands.
 */
async function normalize(input: string, output: string) {
  let gain = 0;
  let measured = await loudness(input, "anull");
  for (let attempt = 0; attempt < 4 && Number.isFinite(measured); attempt++) {
    gain += LOUDNESS - measured;
    const chain = `volume=${gain.toFixed(2)}dB,alimiter=limit=${LIMIT}:attack=4:release=60:level=false`;
    measured = await loudness(input, chain);
    if (Math.abs(measured - LOUDNESS) < 0.2) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", chain,
        "-c:a", "pcm_f32le", output]);
      console.log(`${output}: ${measured.toFixed(1)} LUFS after ${gain.toFixed(1)} dB of gain`);
      return;
    }
  }
  throw new Error(`Could not bring ${input} to ${LOUDNESS} LUFS (measured ${measured})`);
}

/** Integrated loudness in LUFS after a filter chain, from ffmpeg's ebur128 filter. */
async function loudness(input: string, chain: string): Promise<number> {
  const log = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", `${chain},ebur128`,
    "-f", "null", "-"]);
  const match = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(log);
  return match ? Number(match[1]) : NaN;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => (log += chunk));
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(log) : reject(new Error(`${command} exited with ${code}:\n${log.slice(-2000)}`)),
    );
  });
}

function exited(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))));
  });
}

