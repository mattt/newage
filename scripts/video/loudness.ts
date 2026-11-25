// Brings a soundtrack to the launch video's loudness, for the renderer and mux.ts.
import { spawn } from "node:child_process";

const LOUDNESS = -16;
/** The limiter ceiling: about -2 dBFS, which leaves room for AAC overshoot. */
const LIMIT = 0.79;

/**
 * Brings the soundtrack to the target integrated loudness: a gain, then a
 * limiter for the peaks, measured again and corrected until it lands.
 */
export async function normalize(input: string, output: string) {
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

export function run(command: string, args: string[]): Promise<string> {
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
