// The address search panel and the address line in the building popup.
// Both ask the Worker's /geocode/ routes, because the Content Security Policy
// allows connections only to this origin.
//
// The map script and this one share two events on document:
// this script sends "newage:flyto" with { lat, lng, zoom? } to move the map
// and select the building at a chosen address, and the map sends
// "newage:selected" with { bldgId, yearBuilt, lat, lng, properties }
// after it opens the popup for a building.
import { canSelectSearch } from "../lib/search-selection";
import { canFillAddress, hasAddress, type SelectionKey } from "../lib/address-lookup";

interface SearchResult {
  label: string;
  lat: number;
  lng: number;
}

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 3;
// A chosen address shows at the zoom of a building from a share link.
const RESULT_ZOOM = 17;

const form = document.getElementById("search-form") as HTMLFormElement | null;
const input = document.getElementById("search-input") as HTMLInputElement | null;
const popup = document.getElementById("search-popup");
const list = document.getElementById("search-results");
const status = document.getElementById("search-status");

if (form && input && popup && list && status) {
  let results: SearchResult[] = [];
  // The normalized query that `results` answers.
  let answered = "";
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const optionId = (index: number) => `search-option-${index}`;

  const setActive = (index: number) => {
    active = index;
    for (const [i, option] of [...list.children].entries()) {
      option.setAttribute("aria-selected", String(i === index));
    }
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", optionId(index));
      list.children[index]?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const open = () => {
    if (results.length === 0 || !canSelectSearch(input.value, answered)) return;
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const close = () => {
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  };

  const showStatus = (message: string, kind?: "error") => {
    status.textContent = message;
    status.classList.toggle("error", kind === "error");
  };

  const choose = (index: number) => {
    if (!canSelectSearch(input.value, answered)) return;
    const result = results[index];
    if (!result) return;
    input.value = result.label;
    answered = normalize(result.label);
    close();
    document.dispatchEvent(
      new CustomEvent("newage:flyto", {
        detail: { lat: result.lat, lng: result.lng, zoom: RESULT_ZOOM },
      }),
    );
  };

  const render = (next: SearchResult[], query: string) => {
    results = next;
    answered = query;
    list.replaceChildren(
      ...next.map((result, index) => {
        const option = document.createElement("li");
        option.id = optionId(index);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.textContent = result.label;
        return option;
      }),
    );
    setActive(-1);
    if (next.length === 0) {
      close();
      showStatus("No results");
    } else {
      showStatus("");
      open();
    }
  };

  const search = async (query: string, chooseSingle = false) => {
    clearTimeout(timer);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const response = await fetch(`/geocode/search?q=${encodeURIComponent(query)}`, {
        signal: current.signal,
      });
      if (!response.ok) throw new Error(`Search answered ${response.status}`);
      const body = (await response.json()) as { results?: SearchResult[] };
      if (current.signal.aborted) return;
      render(Array.isArray(body.results) ? body.results : [], query);
      if (chooseSingle && results.length === 1) choose(0);
    } catch (error) {
      if (current.signal.aborted) return;
      console.error(error);
      results = [];
      answered = "";
      list.replaceChildren();
      close();
      showStatus("Search is not available. Try again later.", "error");
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    // An answer for the earlier text would only flash before the next one.
    controller?.abort();
    results = [];
    answered = "";
    list.replaceChildren();
    close();
    const query = normalize(input.value);
    if (query.length < MIN_LENGTH) {
      results = [];
      answered = "";
      list.replaceChildren();
      close();
      showStatus("");
      return;
    }
    timer = setTimeout(() => void search(query), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    const count = results.length;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (count === 0) return;
        event.preventDefault();
        if (popup.hidden) {
          open();
          setActive(event.key === "ArrowDown" ? 0 : count - 1);
        } else {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive(active < 0 && step < 0 ? count - 1 : (active + step + count) % count);
        }
        break;
      }
      case "Enter":
        if (!popup.hidden && active >= 0) {
          event.preventDefault();
          choose(active);
        }
        break;
      case "Escape":
        // A search field clears itself on Escape; close the list first instead.
        if (!popup.hidden) {
          event.preventDefault();
          close();
        }
        break;
    }
  });

  // The form never goes anywhere: the policy blocks form submission.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = normalize(input.value);
    if (query.length < MIN_LENGTH) return;
    if (canSelectSearch(input.value, answered)) {
      if (results.length === 1) choose(0);
      else open();
    } else {
      void search(query, true);
    }
  });

  // Keep focus in the input when the pointer chooses an option.
  list.addEventListener("pointerdown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = (event.target as Element).closest('[role="option"]');
    if (option) choose([...list.children].indexOf(option));
  });
  list.addEventListener("pointermove", (event) => {
    const option = (event.target as Element).closest('[role="option"]');
    if (option) setActive([...list.children].indexOf(option));
  });

  input.addEventListener("focus", open);
  form.addEventListener("focusout", (event) => {
    if (!form.contains(event.relatedTarget as Node | null)) close();
  });
}

// Reverse geocoding for the popup's address line, while the tiles have no addresses.

let latest: SelectionKey | null = null;
let lookup: AbortController | undefined;

document.addEventListener("newage:selected", (event) => {
  const detail = (event as CustomEvent<SelectionKey & { properties?: Record<string, unknown> }>)
    .detail;
  lookup?.abort();
  lookup = undefined;
  if (!detail || !Number.isFinite(detail.lat) || !Number.isFinite(detail.lng)) {
    latest = null;
    return;
  }
  const captured: SelectionKey = { bldgId: detail.bldgId, lat: detail.lat, lng: detail.lng };
  latest = captured;
  if (hasAddress(detail.properties)) return;

  // The map opens the popup before it sends the event,
  // so this is the address element of this selection's popup.
  const target = document.getElementById("building-address");
  if (!target) return;

  const current = new AbortController();
  lookup = current;
  const params = new URLSearchParams({ lat: String(detail.lat), lng: String(detail.lng) });
  fetch(`/geocode/reverse?${params}`, { signal: current.signal })
    .then((response) => (response.ok ? response.json() : { label: null }))
    .then((body: { label?: unknown }) => {
      const label = typeof body.label === "string" ? body.label : null;
      if (label !== null && canFillAddress(label, captured, latest, target)) {
        target.textContent = label;
      }
    })
    .catch(() => {
      // Without an address, the popup still shows everything else.
    });
});
