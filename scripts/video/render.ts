// Renders the launch video frame by frame: for each frame, the render page
// sets the map's year range, headless Chromium captures it, and ffmpeg encodes
// the frames at a fixed rate. The soundtrack comes from the same buildings.
//
// Usage: node scripts/video/render.ts [options]
// Run with --help for the options.
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp from "sharp";
import { render as renderAudio, notes, SAMPLE_RATE, velocity, writeWav, type Note, type NoteEvent } from "./audio.ts";
import { loadBuildings, NDJSON } from "./buildings.ts";
import { projector } from "./frame.ts";
import { normalize, run } from "./loudness.ts";
import { writeMidi, type Section } from "./midi.ts";
import {
  cameraFor,
  DEFAULT_PLACES,
  loadPlaces,
  parseSize,
  SHORT_SIDE,
  startYear,
  type OutputSize,
  type Place,
} from "./places.ts";
import { INSTRUMENTS, loadInstrument } from "./instruments.ts";
import { startServer } from "./server.ts";

const HELP = `Usage: node scripts/video/render.ts [options]

  --places FILE           places to render (default ${DEFAULT_PLACES}); repeat to join
                          several files into one sequence, in order
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
  --supersample N         draw the map at N times the output size and scale it down,
                          at a zoom N times closer, so the map loads finer tiles
  --downscale linear|srgb how supersampled frames average their pixels (default linear)
  --lift N                multiply the levels of supersampled frames by N after the
                          downscale, keeping the background where it is (default 1)
  --busiest N|auto        let note count and level keep rising with density up to
                          N buildings in one year, or the busiest year in view (auto),
                          instead of reaching the note cap at a few buildings
  --stills                render each place at its last year, and a contact sheet
  --sequence-only         write only the joined sequence, not a file for each place
  --dry-run               print each clip's years and length, and the total, then stop
  --maxrate MBPS          cap the H.264 bitrate, for playback from a laptop (default none)
  --buildings-tiles FILE  default data/regional-buildings.pmtiles
  --orientation-tiles FILE  default data/orientation.pmtiles
  --buildings-data FILE   building footprints as NDJSON (default ${NDJSON})
  --stats FILE            the data's year bounds (default src/data/building-stats.json)

A place in a places file can set its own yearsPerSecond, hold, lift, and busiest,
and raster: the short side in pixels at which its map is drawn before it is scaled
down to the output, which sets its supersampling for any output size.
`;

const { values: options } = parseArgs({
  options: {
    places: { type: "string", multiple: true },
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
    supersample: { type: "string", default: "0" },
    downscale: { type: "string", default: "linear" },
    lift: { type: "string", default: "1" },
    busiest: { type: "string" },
    stills: { type: "boolean", default: false },
    "sequence-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    maxrate: { type: "string" },
    "buildings-data": { type: "string", default: NDJSON },
    stats: { type: "string", default: "src/data/building-stats.json" },
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
const MAXRATE = options.maxrate === undefined ? undefined : Number(options.maxrate);
const FADE = Number(options.fade);
const INSTRUMENT = options.instrument;
/** Outputs with another instrument than the default get its name, so they do not replace each other. */
const SUFFIX = INSTRUMENT === "pluck" ? "" : `-${INSTRUMENT}`;
const instrument = await loadInstrument(INSTRUMENT, options.samples);
const SUPERSAMPLE = Number(options.supersample);
if (!(SUPERSAMPLE >= 0)) throw new Error("--supersample must be 0 or more");
if (!["linear", "srgb"].includes(options.downscale)) throw new Error("--downscale must be linear or srgb");
const LIFT = Number(options.lift);
if (!(LIFT > 0)) throw new Error("--lift must be a positive number");
const BUSIEST = options.busiest === undefined ? undefined : options.busiest === "auto" ? "auto" : Number(options.busiest);
if (typeof BUSIEST === "number" && !(BUSIEST > 0)) throw new Error("--busiest must be a positive number or auto");

function positive(name: "fps" | "years-per-second"): number {
  const value = Number(options[name]);
  if (!(value > 0)) throw new Error(`--${name} must be a positive number`);
  return value;
}

/** The red and green of the map's background, #050506, which a level lift leaves in place. */
const BACKGROUND_LEVEL = 5;

/** What the page draws for one frame. */
interface FrameState {
  center: [number, number];
  zoom: number;
  year: number;
  bounds: { earliest: number; latest: number };
  includeUnknown: boolean;
  name: string | null;
  /** The label's size relative to a frame whose short side is 540 CSS pixels. */
  labelScale: number;
  /** Dims the label to offset a later level lift, so that it keeps its color. */
  labelOpacity: number;
}

/** A place's own settings, or the run's. */
function settingsFor(place: Place) {
  const busiest = place.busiest ?? BUSIEST;
  return {
    yearsPerSecond: place.yearsPerSecond ?? YEARS_PER_SECOND,
    hold: place.hold ?? HOLD,
    lift: place.lift ?? LIFT,
    busiest: busiest === "auto" || busiest === undefined ? busiest : Number(busiest),
  };
}

/** How the page draws frames for an output size. */
interface Capture {
  /** The page's size in CSS pixels. */
  width: number;
  height: number;
  deviceScaleFactor: number;
  /** Added to each place's zoom, which assumes a short side of 540 CSS pixels. */
  zoomOffset: number;
  /** Whether the screenshot is larger than the output and needs scaling down. */
  downscale: boolean;
}

/**
 * By default, the page's short side is 540 CSS pixels at the pixel ratio that
 * fills the output. With supersampling, the page is N times the output size at
 * a pixel ratio of 1, and every zoom grows to match, so the map loads the finer
 * tiles of a closer zoom; the frames are then scaled down.
 */
function captureFor(size: OutputSize, place?: Place): Capture {
  const supersample = place?.raster ? Math.ceil(place.raster / Math.min(size.width, size.height)) : SUPERSAMPLE;
  if (supersample === 0) {
    return {
      width: Math.round(size.viewport.width),
      height: Math.round(size.viewport.height),
      deviceScaleFactor: size.pixelRatio,
      zoomOffset: 0,
      downscale: false,
    };
  }
  const width = Math.round(size.width * supersample);
  const height = Math.round(size.height * supersample);
  return {
    width,
    height,
    deviceScaleFactor: 1,
    zoomOffset: Math.log2(Math.min(width, height) / SHORT_SIDE),
    downscale: supersample > 1,
  };
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
  yearsPerSecond: number;
  busiest: number | "auto" | undefined;
}

const placeFiles = options.places?.length ? options.places : [DEFAULT_PLACES];
let places = (await Promise.all(placeFiles.map((file) => loadPlaces(file)))).flat();
if (options.only) {
  const ids = options.only.split(",");
  places = ids.map((id) => {
    const place = places.find((candidate) => candidate.id === id);
    if (!place) throw new Error(`No place ${id} in ${placeFiles.join(", ")}`);
    return place;
  });
}
const sizes = (options.size?.length ? options.size : ["1080x1920"]).map(parseSize);
const buildings = await loadBuildings(options["buildings-data"]);
// The data's year bounds, as the site reads them, so that the filter matches the site's Play.
const stats = JSON.parse(await readFile(options.stats, "utf8"));
const bounds = { earliest: stats.earliestYear as number, latest: stats.latestYear as number };

if (options["dry-run"]) {
  for (const size of sizes) {
    let total = 0;
    for (const place of places) {
      const clip = planClip(place, size);
      total += clip.seconds;
      console.log(`${size.name} ${place.id}: ${clip.start}–${clip.end} at ${clip.yearsPerSecond} years/s, ` +
        `${clip.seconds.toFixed(2)} s, ${clip.events.length} buildings sounding`);
    }
    const minutes = Math.floor(total / 60);
    console.log(`${size.name} total: ${total.toFixed(2)} s (${minutes}:${(total - minutes * 60).toFixed(1).padStart(4, "0")})`);
  }
  process.exit(0);
}

const server = await startServer({
  buildings: options["buildings-tiles"],
  orientation: options["orientation-tiles"],
});
const browser = await chromium.launch({
  headless: true,
  // Draw WebGL with the GPU through Metal; otherwise Chromium falls back to software.
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});

/** One page for each page size and pixel ratio, since a page cannot change its pixel ratio. */
const pages = new Map<string, Page>();

async function pageFor(size: OutputSize, place: Place): Promise<Page> {
  const capture = captureFor(size, place);
  const key = `${capture.width}x${capture.height}@${capture.deviceScaleFactor}`;
  let page = pages.get(key);
  if (!page) {
    page = await openPage(browser, capture);
    pages.set(key, page);
  }
  return page;
}

try {
  for (const size of sizes) {
    const directory = join(options.out, `${size.width}x${size.height}`);
    if (options.stills) await renderStills(size, directory);
    else await renderVideo(size, directory);
  }
} finally {
  await browser.close();
  await server.close();
}

async function openPage(browser: Browser, capture: Capture): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: capture.width, height: capture.height },
    deviceScaleFactor: capture.deviceScaleFactor,
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

/** Captures a frame at the output size. */
async function captureFrame(place: Place, size: OutputSize, year: number): Promise<Buffer> {
  const frame = await show(await pageFor(size, place), frameState(place, size, year));
  return captureFor(size, place).downscale ? shrink(frame, size, settingsFor(place).lift) : frame;
}

/**
 * Scales a supersampled frame down. Most buildings at city scale are smaller
 * than an output pixel, so each output pixel averages a building with the black
 * around it. In linear light that average matches the light the building gives
 * off; in sRGB values, it comes out darker, which mutes the colors.
 */
async function shrink(frame: Buffer, size: OutputSize, lift: number): Promise<Buffer> {
  const image = sharp(frame);
  if (options.downscale === "linear") image.pipelineColourspace("scrgb").toColourspace("srgb");
  const small = await image.resize(size.width, size.height, { kernel: "lanczos3" }).removeAlpha().png().toBuffer();
  if (lift === 1) return small;
  // A separate step, so that the gain applies to sRGB values, around the background.
  return sharp(small).linear(lift, -(lift - 1) * BACKGROUND_LEVEL).png().toBuffer();
}

function frameState(place: Place, size: OutputSize, year: number): FrameState {
  const camera = cameraFor(place, size);
  const capture = captureFor(size, place);
  return {
    center: camera.center,
    zoom: camera.zoom + capture.zoomOffset,
    year,
    bounds,
    includeUnknown: !options["no-unknown"],
    name: options["no-labels"] ? null : place.name,
    labelScale: 2 ** capture.zoomOffset,
    labelOpacity: capture.downscale ? 1 / settingsFor(place).lift : 1,
  };
}

// Stills

async function renderStills(size: OutputSize, directory: string) {
  const stills = join(directory, "stills");
  await mkdir(stills, { recursive: true });
  const files: string[] = [];
  for (const place of places) {
    const file = join(stills, `${place.id}.png`);
    await writeFile(file, await captureFrame(place, size, bounds.latest));
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
  const project = projector(cameraFor(place, size), size.viewport);
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
  const { yearsPerSecond, hold, busiest } = settingsFor(place);
  const runFrames = Math.round(((end - start) / yearsPerSecond) * FPS) + 1;
  const holdFrames = Math.round(hold * FPS);
  const frameYears: number[] = [];
  for (let f = 0; f < runFrames + holdFrames; f++) {
    frameYears.push(Math.min(end, start + Math.floor((f * yearsPerSecond) / FPS + 1e-9)));
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
      yearSeconds: 1 / yearsPerSecond,
      x,
      year,
      sqft: buildings.sqft[i],
      seed: i,
      place: place.id,
    });
  }
  return {
    place,
    start,
    end,
    years: frameYears,
    events,
    seconds: frameYears.length / FPS,
    yearsPerSecond,
    busiest,
  };
}

async function renderVideo(size: OutputSize, directory: string) {
  const work = join(directory, "work");
  await mkdir(work, { recursive: true });
  const clips = places.map((place) => planClip(place, size));
  const timings: string[] = [];
  for (const clip of clips) {
    const began = performance.now();
    const video = join(work, `${clip.place.id}.mkv`);
    if (!(options["reuse-frames"] && (await exists(video)))) await renderFrames(clip, size, video);
    if (!options["sequence-only"] || clips.length === 1) {
      const output = join(directory, `${clip.place.id}${SUFFIX}.mp4`);
      await assemble([clip], [video], output, work);
      console.log(output);
    }
    const seconds = (performance.now() - began) / 1000;
    timings.push(`${clip.place.id}: ${clip.seconds.toFixed(1)} s of video, ${clip.start}–${clip.end}, ` +
      `${clip.events.length} buildings sounding, rendered in ${seconds.toFixed(0)} s`);
  }
  if (clips.length > 1) {
    const output = join(directory, `sequence${SUFFIX}.mp4`);
    await assemble(clips, clips.map((clip) => join(work, `${clip.place.id}.mkv`)), output, work);
    console.log(output);
  }
  console.log(timings.join("\n"));
}

/** Captures each distinct frame once, and repeats it while the year holds. */
async function renderFrames(clip: Clip, size: OutputSize, output: string) {
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
      frame = await captureFrame(clip.place, size, year);
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
 * The video is encoded once and kept, so that another soundtrack reuses it.
 */
async function assemble(clips: Clip[], videos: string[], output: string, work: string) {
  const name = output.replace(/^.*\//, "").replace(/\.mp4$/, "");
  const offsets: number[] = [];
  let total = 0;
  for (const clip of clips) {
    offsets.push(total);
    total += clip.seconds;
  }

  const encoded = join(work, `${name.slice(0, name.length - SUFFIX.length)}.video.mp4`);
  if (!(options["reuse-frames"] && (await newerThan(encoded, videos)))) {
    await encodeVideo(clips, videos, encoded, total);
  }
  const inputs = ["-i", encoded];
  const audioArgs: string[] = [];
  if (!options["no-audio"]) {
    // Notes are chosen clip by clip, since each clip has its own pace and density.
    const events = clips.flatMap((clip, i) =>
      clip.events.map((event) => ({ ...event, time: event.time + offsets[i] })),
    );
    const played: Note[] = [];
    clips.forEach((clip) => {
      played.push(...notes(events.filter((event) => event.place === clip.place.id), clip.busiest));
    });
    const raw = join(work, `${name}-raw.wav`);
    const normalized = join(work, `${name}.wav`);
    const soundSections = clips.map((clip, i) => ({
      start: offsets[i],
      seconds: clip.seconds,
      firstYear: clip.start,
      lastYear: clip.end,
      yearsPerSecond: clip.yearsPerSecond,
    }));
    await writeWav(raw, renderAudio(played, total, instrument, soundSections));
    await normalize(raw, normalized);
    const sections = clips.map((clip, i) => ({ id: clip.place.id, name: clip.place.name, start: offsets[i] }));
    await exportSound(join(dirname(output), name), normalized, played, sections, total);
    inputs.push("-i", normalized);
    audioArgs.push("-map", "1:a", "-c:a", "aac", "-b:a", "256k", "-ar", String(SAMPLE_RATE));
  }
  // No title, artist, or comment: -map_metadata -1 drops anything the inputs carry.
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs, "-map", "0:v", ...audioArgs,
    "-c:v", "copy", "-map_metadata", "-1", "-movflags", "+faststart", "-t", total.toFixed(3), output,
  ]);
}

/**
 * Encodes the clips' frames as H.264 High with keyframes every two seconds.
 * --maxrate caps the bitrate, so that a laptop's hardware decoder plays 4K at
 * 60 fps over HDMI without dropping frames.
 */
async function encodeVideo(clips: Clip[], videos: string[], output: string, total: number) {
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
  const rate = MAXRATE ? ["-maxrate", `${MAXRATE}M`, "-bufsize", `${2 * MAXRATE}M`] : [];
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs,
    "-filter_complex", filters.join(";"), "-map", "[v]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", ...rate, "-profile:v", "high",
    "-g", String(2 * FPS), "-r", String(FPS),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-map_metadata", "-1", "-movflags", "+faststart", "-t", total.toFixed(3), output,
  ]);
}

/** Whether a file exists and is newer than every one of the others. */
async function newerThan(file: string, others: string[]): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(file);
    const times = await Promise.all(others.map(async (other) => (await stat(other)).mtimeMs));
    return times.every((time) => time < mtimeMs);
  } catch {
    return false;
  }
}

/**
 * Writes the soundtrack and its notes beside the video, for other instruments
 * and tools: a 24-bit WAV, a MIDI file, and the notes as JSON and CSV.
 */
async function exportSound(base: string, wav: string, played: Note[], sections: Section[], seconds: number) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "pcm_s24le", `${base}.wav`]);
  await writeMidi(`${base}.mid`, played, sections, seconds, {
    program: instrument.program,
    velocities: instrument.velocities,
  });
  const names = new Map(sections.map((section) => [section.id, section.name]));
  const rows = played.map((note) => ({
    time: round(note.time, 4),
    frame_time: round(note.frameTime, 4),
    place: names.get(note.place) ?? note.place,
    year: note.year,
    midi: note.midi,
    velocity: velocity(note.amplitude, instrument.velocities),
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

function exited(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))));
  });
}

