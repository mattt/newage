// Speaks messages through the visually hidden live region in index.astro.

let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string): void {
  const region = document.getElementById("announcer");
  if (!region) return;
  // Clear first, so that a message the same as the last one is read again.
  region.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    region.textContent = message;
  }, 100);
}
