// Drives the year-range controls in src/components/YearFilter.astro.
import {
  fullRange,
  orderRange,
  playbackSteps,
  playbackYear,
  type YearBounds,
  type YearRange,
} from "../lib/year-filter";
import { announce } from "./announce";

/** Smooth playback takes this long from the earliest year to the latest. */
const PLAY_DURATION = 10_000;
/** With reduced motion, playback steps this many years at a time. */
const REDUCED_STEP = 5;
const REDUCED_INTERVAL = 400;

export function setupYearFilter(bounds: YearBounds, onChange: (range: YearRange) => void): void {
  const minInput = byId("year-min", HTMLInputElement);
  const maxInput = byId("year-max", HTMLInputElement);
  const minOutput = byId("year-min-value", HTMLOutputElement);
  const maxOutput = byId("year-max-value", HTMLOutputElement);
  const unknown = byId("include-unknown", HTMLInputElement);
  const play = byId("year-play", HTMLButtonElement);
  const reset = byId("year-reset", HTMLButtonElement);
  const bars = [...document.querySelectorAll<SVGRectElement>(".histogram rect")];

  /** The range the user chose, which playback restores when it ends. */
  let chosen: YearRange = fullRange(bounds);

  function show(range: YearRange) {
    minInput.value = String(range.min);
    maxInput.value = String(range.max);
    minOutput.textContent = String(range.min);
    maxOutput.textContent = String(range.max);
    unknown.checked = range.includeUnknown;
    for (const bar of bars) {
      const start = Number(bar.dataset.start);
      const end = Number(bar.dataset.end);
      bar.classList.toggle("out", end < range.min || start > range.max);
    }
    onChange(range);
  }

  // Playback state. A paused playback keeps its place until Play resumes it.
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let playing = false;
  let paused = false;
  let elapsed = 0;
  let stepIndex = 0;
  let lastYear = NaN;

  function setPlayButton(isPlaying: boolean) {
    play.textContent = isPlaying ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(isPlaying));
  }

  function showYear(year: number) {
    if (year === lastYear) return;
    lastYear = year;
    show({ min: bounds.earliest, max: year, includeUnknown: chosen.includeUnknown });
  }

  function halt() {
    cancelAnimationFrame(frame);
    clearInterval(timer);
    playing = false;
  }

  function finish() {
    halt();
    paused = false;
    setPlayButton(false);
    show(chosen);
    announce(`Playback finished. Showing ${describeRange(chosen)}.`);
  }

  /** Stops playback without restoring the range, when the user changes it. */
  function abandon() {
    if (!playing && !paused) return;
    halt();
    paused = false;
    setPlayButton(false);
  }

  function start() {
    playing = true;
    setPlayButton(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const steps = playbackSteps(bounds, REDUCED_STEP);
      const tick = () => {
        if (stepIndex >= steps.length) return finish();
        showYear(steps[stepIndex++]);
      };
      tick();
      timer = setInterval(tick, REDUCED_INTERVAL);
    } else {
      let previous = performance.now();
      const tick = (now: number) => {
        elapsed += now - previous;
        previous = now;
        showYear(playbackYear(bounds, elapsed / PLAY_DURATION));
        if (elapsed >= PLAY_DURATION) return finish();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
  }

  play.addEventListener("click", () => {
    if (playing) {
      halt();
      paused = true;
      setPlayButton(false);
      announce(`Paused at ${lastYear}.`);
      return;
    }
    if (!paused) {
      elapsed = 0;
      stepIndex = 0;
      lastYear = NaN;
    }
    paused = false;
    start();
  });

  function fromInputs(changed: "min" | "max"): YearRange {
    return orderRange(
      {
        min: Number(minInput.value),
        max: Number(maxInput.value),
        includeUnknown: unknown.checked,
      },
      changed,
      bounds,
    );
  }

  minInput.addEventListener("input", () => {
    abandon();
    chosen = fromInputs("min");
    show(chosen);
  });
  maxInput.addEventListener("input", () => {
    abandon();
    chosen = fromInputs("max");
    show(chosen);
  });
  unknown.addEventListener("change", () => {
    abandon();
    chosen = { ...chosen, includeUnknown: unknown.checked };
    show(chosen);
  });
  reset.addEventListener("click", () => {
    abandon();
    chosen = fullRange(bounds);
    show(chosen);
    announce(`Showing ${describeRange(chosen)}.`);
  });

  // A browser can restore form values from an earlier visit; start from them.
  chosen = fromInputs("min");
  show(chosen);
}

function byId<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

function describeRange(range: YearRange): string {
  const years = `buildings from ${range.min} to ${range.max}`;
  return range.includeUnknown ? `${years} and buildings of unknown year` : years;
}
