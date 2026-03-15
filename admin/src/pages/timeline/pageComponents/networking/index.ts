/**
 * Networking tab: poll interval and timeline lookahead settings.
 */

import { createInfoBubble } from "../../../../components/info-bubble";

export interface NetworkingConfig {
  pollIntervalSec: number;
  timelineLookaheadSec: number;
}

export interface RenderNetworkingPanelOptions {
  onSyncing?: () => void;
  onSaved?: () => void;
}

export function renderNetworkingPanel(
  container: HTMLElement,
  showId: string,
  options?: RenderNetworkingPanelOptions
): void {
  const onSyncing = options?.onSyncing;
  const onSaved = options?.onSaved;
  container.innerHTML = "";
  const heading = document.createElement("h3");
  heading.className = "networking-panel__heading";
  heading.textContent = "Networking";
  container.appendChild(heading);

  const pollRow = document.createElement("div");
  pollRow.className = "networking-panel__row";
  const pollLabelWrap = document.createElement("div");
  pollLabelWrap.className = "networking-panel__label-wrap";
  const pollLabel = document.createElement("label");
  pollLabel.textContent = "Clients Poll Every (seconds):";
  const pollInfo = createInfoBubble({
    tooltipText:
      "How often devices are asked to poll the server (1–10 seconds). The server sends this value in the poll response; clients and simulated clients use it for their next poll delay.",
    ariaLabel: "Info about poll interval",
  });
  pollLabelWrap.appendChild(pollInfo);
  pollLabelWrap.appendChild(pollLabel);
  pollRow.appendChild(pollLabelWrap);
  const pollFieldWrap = document.createElement("div");
  pollFieldWrap.className = "networking-panel__field-wrap";
  const pollInput = document.createElement("input");
  pollInput.type = "number";
  pollInput.className = "detail-input";
  pollInput.step = "0.1";
  pollInput.min = "1";
  pollInput.max = "10";
  pollInput.value = "2";
  pollInput.setAttribute("aria-label", "Clients poll every seconds");
  const pollError = document.createElement("div");
  pollError.className = "networking-panel__error";
  pollError.setAttribute("aria-live", "polite");
  pollFieldWrap.appendChild(pollInput);
  pollFieldWrap.appendChild(pollError);
  pollRow.appendChild(pollFieldWrap);
  container.appendChild(pollRow);

  const lookaheadRow = document.createElement("div");
  lookaheadRow.className = "networking-panel__row";
  const lookaheadLabelWrap = document.createElement("div");
  lookaheadLabelWrap.className = "networking-panel__label-wrap";
  const lookaheadLabel = document.createElement("label");
  lookaheadLabel.textContent = "Timeline Length to Render and Deliver (seconds):";
  const lookaheadInfo = createInfoBubble({
    tooltipText:
      "How far into the future the server sends timeline events per poll. Must be at least 1 second longer than the poll interval and no more than 60 seconds.",
    ariaLabel: "Info about timeline lookahead",
  });
  lookaheadLabelWrap.appendChild(lookaheadInfo);
  lookaheadLabelWrap.appendChild(lookaheadLabel);
  lookaheadRow.appendChild(lookaheadLabelWrap);
  const lookaheadFieldWrap = document.createElement("div");
  lookaheadFieldWrap.className = "networking-panel__field-wrap";
  const lookaheadInput = document.createElement("input");
  lookaheadInput.type = "number";
  lookaheadInput.className = "detail-input";
  lookaheadInput.step = "0.1";
  lookaheadInput.min = "2";
  lookaheadInput.max = "60";
  lookaheadInput.value = "10";
  lookaheadInput.setAttribute("aria-label", "Timeline lookahead seconds");
  const lookaheadError = document.createElement("div");
  lookaheadError.className = "networking-panel__error";
  lookaheadError.setAttribute("aria-live", "polite");
  lookaheadFieldWrap.appendChild(lookaheadInput);
  lookaheadFieldWrap.appendChild(lookaheadError);
  lookaheadRow.appendChild(lookaheadFieldWrap);
  container.appendChild(lookaheadRow);

  function updateLookaheadMin(): void {
    const pollVal = parseFloat(pollInput.value);
    if (!Number.isNaN(pollVal) && pollVal >= 1 && pollVal <= 10) {
      lookaheadInput.min = String(pollVal + 1);
    }
  }

  function showPollError(msg: string): void {
    pollError.textContent = msg;
    pollError.classList.toggle("networking-panel__error--visible", msg.length > 0);
  }

  function showLookaheadError(msg: string): void {
    lookaheadError.textContent = msg;
    lookaheadError.classList.toggle("networking-panel__error--visible", msg.length > 0);
  }

  function validate(): { ok: boolean } {
    const pollVal = parseFloat(pollInput.value);
    const lookaheadVal = parseFloat(lookaheadInput.value);
    const pollMin = 1;
    const pollMax = 10;
    const lookaheadMax = 60;

    if (Number.isNaN(pollVal) || pollVal < pollMin || pollVal > pollMax) {
      showPollError(`Must be between ${pollMin} and ${pollMax} seconds.`);
      showLookaheadError("");
      return { ok: false };
    }
    showPollError("");

    const lookaheadMin = pollVal + 1;
    if (Number.isNaN(lookaheadVal) || lookaheadVal < lookaheadMin || lookaheadVal > lookaheadMax) {
      showLookaheadError(`Must be at least 1 second longer than poll interval (${lookaheadMin}–${lookaheadMax} s).`);
      return { ok: false };
    }
    showLookaheadError("");
    return { ok: true };
  }

  function runValidation(): void {
    validate();
  }

  const MIN_SYNCING_DISPLAY_MS = 400;

  async function save(): Promise<void> {
    if (!validate().ok) return;
    const body: NetworkingConfig = {
      pollIntervalSec: parseFloat(pollInput.value),
      timelineLookaheadSec: parseFloat(lookaheadInput.value),
    };
    const syncingStartedAt = Date.now();
    onSyncing?.();
    try {
      const res = await fetch(`/api/admin/show-workspaces/${encodeURIComponent(showId)}/networking`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn("Networking PUT failed:", res.status);
      }
    } catch (e) {
      console.warn("Networking PUT error:", e);
    } finally {
      const elapsed = Date.now() - syncingStartedAt;
      const minDisplayRemaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
      if (minDisplayRemaining > 0) {
        await new Promise((r) => setTimeout(r, minDisplayRemaining));
      }
      onSaved?.();
    }
  }

  pollInput.addEventListener("input", () => {
    updateLookaheadMin();
    runValidation();
  });
  pollInput.addEventListener("change", updateLookaheadMin);
  pollInput.addEventListener("blur", () => {
    updateLookaheadMin();
    runValidation();
    save();
  });
  lookaheadInput.addEventListener("input", runValidation);
  lookaheadInput.addEventListener("blur", () => {
    runValidation();
    save();
  });

  (async () => {
    try {
      const res = await fetch(`/api/admin/show-workspaces/${encodeURIComponent(showId)}/networking`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as NetworkingConfig;
        if (typeof data.pollIntervalSec === "number" && typeof data.timelineLookaheadSec === "number") {
          pollInput.value = String(data.pollIntervalSec);
          lookaheadInput.value = String(data.timelineLookaheadSec);
          updateLookaheadMin();
          showPollError("");
          showLookaheadError("");
        }
      }
    } catch {
      // Keep defaults
    }
  })();
}
