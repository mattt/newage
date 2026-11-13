// Puts an outside soundtrack, such as a cover of the rendered one, under a
// finished video: normalized as the renderer does, and never time-stretched.
// A shorter soundtrack ends in silence; a longer one ends with the video.
// The video stream is copied as is, and an existing output is never replaced.
//
// Usage: node scripts/video/mux.ts VIDEO AUDIO OUTPUT
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize, run } from "./loudness.ts";

const [video, audio, output] = process.argv.slice(2);
if (!video || !audio || !output) {
  console.error("Usage: node scripts/video/mux.ts VIDEO AUDIO OUTPUT");
  process.exit(1);
}
if (await access(output).then(() => true, () => false)) {
  console.error(`${output} already exists`);
  process.exit(1);
}

const seconds = async (file: string, stream: string) =>
  Number(await run("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", "stream=duration",
    "-of", "csv=p=0", file]));
const videoSeconds = await seconds(video, "v:0");
const audioSeconds = Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
  "-of", "csv=p=0", audio]));
console.log(`video ${videoSeconds.toFixed(3)} s, soundtrack ${audioSeconds.toFixed(3)} s, ` +
  `difference ${((audioSeconds - videoSeconds) * 1000).toFixed(0)} ms`);

const work = await mkdtemp(join(tmpdir(), "video-mux-"));
try {
  const normalized = join(work, "soundtrack.wav");
  await normalize(audio, normalized);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-i", video, "-i", normalized,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
    "-af", `apad=whole_dur=${videoSeconds}`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(videoSeconds), "-movflags", "+faststart", output]);
} finally {
  await rm(work, { recursive: true });
}
console.log(output);
