import "./styles.css";
import noSignalSvg from "../../icons/noSignal.svg?raw";
import openIcon from "../../icons/open.svg?raw";
import saveIcon from "../../icons/save.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import { createRefreshEvery, DEFAULT_RESPONSE_TIMEOUT_MS } from "../../components/refresh-every";
import { createInfoBubble } from "../../components/info-bubble";
import { attachTooltipWhen } from "../../components/popup-tooltip";
import type {
  SimulatedClient,
  SimulatedClientDistKey,
  DistributionCurve,
  SimulatedClientWithSampleHistory,
  ClientSummaryForGrid,
  ClientSummarySummary,
} from "./types";
import {
  getClients,
  getClient,
  getSummaries,
  postClients,
  patchClient,
  deleteClient as apiDeleteClient,
  deleteAllClients,
  postSample,
} from "./api";
import { createClientWithRandomCurves } from "./client-store";
import { generateClientFromProfile } from "./profile-generation";
import { renderClientGrid } from "./client-grid";
import {
  renderDetailsPane,
  DISTRIBUTION_CHART_PRESETS,
  DIST_KEYS_BY_PRESET_INDEX,
  type DistributionChartSelection,
} from "./details-pane";
import { renderDistributionTablesEditor } from "./distribution-tables-editor";
import {
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE,
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL,
  REALISTIC_BAD_DEVICE_PROFILE,
  isReservedSystemPresetName,
} from "./system-presets";

const SQUARE_SIZE_MIN = 12;
const SQUARE_SIZE_MAX = 48;
const SQUARE_SIZE_DEFAULT = 24;
const GRID_GAP_PX = 4;

const MIN_CURVE_POINTS = 1;
const MAX_CURVE_POINTS = 100;
const DEFAULT_MAX_CURVE_POINTS = 10;

const PROFILE_VALIDATION_TOOLTIP =
  "Every Distribution Table in the profile must have at least 1 point with a 0% chance of destruction.";

/** True iff every curve has at least one anchor with destructionChance 0 (or undefined). Used to enable Create/Save/Confirm in profile mode. */
function hasZeroDestructionPointInAllCharts(curves: DistributionCurve[]): boolean {
  if (!curves || curves.length !== 5) return false;
  return curves.every(
    (c) => c.anchors?.some((a) => (a.destructionChance ?? 0) === 0) ?? false
  );
}

function showCreateClientsModal(onCreate: (newClients: SimulatedClient[]) => void): void {
  let generateFromProfile = true;
  let editorApi: ReturnType<typeof renderDistributionTablesEditor> | null = null;
  const emptyCurves: DistributionCurve[] = DIST_KEYS_BY_PRESET_INDEX.map(() => ({ anchors: [] }));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal create-clients-modal";

  const content = document.createElement("div");
  content.className = "clone-client-modal-content";

  const countRow = document.createElement("div");
  countRow.className = "clone-clients-row";
  const countLabelWrap = document.createElement("span");
  countLabelWrap.className = "create-modal-count-label-wrap";
  countLabelWrap.appendChild(
    createInfoBubble({
      tooltipText:
        "Normally you'll want to generate clients from a profile. Profiles define ranges that distribution table points can be placed in. Chaos clients are built by placing a random number of points in the distribution table at random.",
      ariaLabel: "Info",
    })
  );
  const countLabel = document.createElement("label");
  countLabel.htmlFor = "create-modal-count";
  countLabel.textContent = "New Client Count:";
  countLabelWrap.appendChild(countLabel);
  countRow.appendChild(countLabelWrap);
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.id = "create-modal-count";
  countInput.min = "1";
  countInput.value = "1";
  countRow.appendChild(countInput);
  content.appendChild(countRow);

  const modeRow = document.createElement("div");
  modeRow.className = "create-modal-mode-row";
  modeRow.innerHTML = `
    <span class="mode-switch-label create-modal-mode-label-profile active">Generate from Profile</span>
    <button type="button" class="mode-switch-toggle" id="create-modal-mode-toggle" aria-pressed="true" aria-label="Generate from Profile or Create from Chaos">
      <span class="mode-switch-track">
        <span class="mode-switch-knob"></span>
      </span>
    </button>
    <span class="mode-switch-label create-modal-mode-label-chaos">Create from Chaos</span>
  `;
  content.appendChild(modeRow);

  const profileBlock = document.createElement("div");
  profileBlock.className = "create-modal-profile-block";
  const profileSelectRow = document.createElement("div");
  profileSelectRow.className = "create-modal-profile-select-row";
  profileSelectRow.innerHTML = `
    <label for="create-modal-profile">Load from Saved Profile:</label>
    <select id="create-modal-profile">
      <option value="">Select a profile...</option>
    </select>
  `;
  profileBlock.appendChild(profileSelectRow);
  const editorContainer = document.createElement("div");
  editorContainer.className = "create-modal-editor-container";
  profileBlock.appendChild(editorContainer);
  content.appendChild(profileBlock);

  const chaosBlock = document.createElement("div");
  chaosBlock.className = "create-modal-chaos-block";
  chaosBlock.hidden = true;
  const chartBlocksHtml = DISTRIBUTION_CHART_PRESETS.map(
    (preset, i) => `
  <div class="create-clients-chart-block" data-index="${i}">
    <h4 class="create-clients-chart-title">${escapeHtml(preset.title)}</h4>
    <div class="create-clients-range-row">
      <label for="create-modal-min-${i}">Min:</label>
      <input type="number" id="create-modal-min-${i}" min="${MIN_CURVE_POINTS}" max="${MAX_CURVE_POINTS}" value="${MIN_CURVE_POINTS}" />
      <label for="create-modal-max-${i}">Max:</label>
      <input type="number" id="create-modal-max-${i}" min="${MIN_CURVE_POINTS}" max="${MAX_CURVE_POINTS}" value="${DEFAULT_MAX_CURVE_POINTS}" />
    </div>
  </div>`
  ).join("");
  chaosBlock.innerHTML = chartBlocksHtml;
  content.appendChild(chaosBlock);

  modal.appendChild(content);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.innerHTML = `
    <button type="button" class="btn-save-profile create-modal-btn-save">${saveIcon}<span>Save Profile</span></button>
    <button type="button" class="btn-cancel">Cancel</button>
    <button type="button" class="btn-confirm">Create</button>
  `;
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const createBtn = actions.querySelector(".btn-confirm") as HTMLButtonElement | null;
  const saveProfileBtn = actions.querySelector(".create-modal-btn-save") as HTMLButtonElement | null;

  function wrapButtonForTooltip(btn: HTMLButtonElement): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "modal-btn-tooltip-wrap";
    btn.parentNode?.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    return wrap;
  }
  if (createBtn) {
    const wrap = wrapButtonForTooltip(createBtn);
    attachTooltipWhen(wrap, () =>
      createBtn.disabled ? PROFILE_VALIDATION_TOOLTIP : ""
    );
  }
  if (saveProfileBtn) {
    const wrap = wrapButtonForTooltip(saveProfileBtn);
    attachTooltipWhen(wrap, () =>
      saveProfileBtn!.disabled ? PROFILE_VALIDATION_TOOLTIP : ""
    );
  }

  function updateCreateButtonState(): void {
    if (!createBtn) return;
    if (!generateFromProfile) {
      createBtn.disabled = false;
      if (saveProfileBtn) saveProfileBtn.disabled = false;
      return;
    }
    if (!editorApi) {
      createBtn.disabled = true;
      if (saveProfileBtn) saveProfileBtn.disabled = true;
      return;
    }
    const curves = editorApi.getCurves();
    const valid = hasZeroDestructionPointInAllCharts(curves);
    createBtn.disabled = !valid;
    if (saveProfileBtn) saveProfileBtn.disabled = !valid;
  }

  function setMode(useProfile: boolean): void {
    generateFromProfile = useProfile;
    const toggleBtn = content.querySelector("#create-modal-mode-toggle");
    toggleBtn?.setAttribute("aria-pressed", String(useProfile));
    modeRow.classList.toggle("create-modal-mode--chaos", !useProfile);
    content.querySelector(".create-modal-mode-label-profile")?.classList.toggle("active", useProfile);
    content.querySelector(".create-modal-mode-label-chaos")?.classList.toggle("active", !useProfile);
    profileBlock.hidden = !useProfile;
    chaosBlock.hidden = useProfile;
    const saveBtn = actions.querySelector(".create-modal-btn-save");
    if (saveBtn) (saveBtn as HTMLElement).hidden = !useProfile;
    if (useProfile && !editorApi) {
      editorApi = renderDistributionTablesEditor(editorContainer, emptyCurves, {
        onCurvesChange: updateCreateButtonState,
      });
    }
    updateCreateButtonState();
  }

  content.querySelector("#create-modal-mode-toggle")?.addEventListener("click", () => {
    setMode(!generateFromProfile);
  });

  async function loadProfileList(): Promise<void> {
    const res = await fetch("/api/admin/simulated-client-profiles");
    const names: string[] = res.ok ? await res.json() : [];
    const select = content.querySelector("#create-modal-profile") as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '<option value="">Select a profile...</option>';
    // System preset always first
    const systemOpt = document.createElement("option");
    systemOpt.value = SYSTEM_PRESET_REALISTIC_BAD_DEVICE;
    systemOpt.textContent = SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL;
    select.appendChild(systemOpt);
    const reservedLower = SYSTEM_PRESET_REALISTIC_BAD_DEVICE.toLowerCase();
    for (const name of names) {
      const normalized = name.replace(/\.json$/i, "").toLowerCase();
      if (normalized === reservedLower) continue;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/\.json$/i, "");
      select.appendChild(opt);
    }
  }

  content.querySelector("#create-modal-profile")?.addEventListener("change", async () => {
    const select = content.querySelector("#create-modal-profile") as HTMLSelectElement | null;
    const name = select?.value?.trim();
    if (!name || !editorApi) return;
    if (name === SYSTEM_PRESET_REALISTIC_BAD_DEVICE) {
      editorApi.setCurves(REALISTIC_BAD_DEVICE_PROFILE);
      updateCreateButtonState();
      return;
    }
    const res = await fetch(`/api/admin/simulated-client-profiles/${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const profile = (await res.json()) as Record<SimulatedClientDistKey, DistributionCurve>;
    editorApi.setCurves(profile);
    updateCreateButtonState();
  });

  const close = (): void => {
    if (editorApi) {
      editorApi.destroy();
      editorApi = null;
    }
    overlay.remove();
  };

  actions.querySelector(".btn-cancel")?.addEventListener("click", close);

  actions.querySelector(".create-modal-btn-save")?.addEventListener("click", async () => {
    if (!editorApi) return;
    const name = prompt("What is the name of this client profile?");
    if (name == null || name.trim() === "") return;
    const profileName = name.trim();
    const curves = editorApi.getCurves();
    const profile = {} as Record<SimulatedClientDistKey, DistributionCurve>;
    for (let i = 0; i < DIST_KEYS_BY_PRESET_INDEX.length; i++) {
      const key = DIST_KEYS_BY_PRESET_INDEX[i];
      const curve = curves[i];
      profile[key] = {
        anchors: curve.anchors.map((a) => ({
          x: a.x,
          y: a.y,
          xMutationRange: a.xMutationRange ?? 0,
          yMutationRange: a.yMutationRange ?? 0,
          destructionChance: a.destructionChance ?? 0,
        })),
      };
    }
    let res = await fetch("/api/admin/simulated-client-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName, overwrite: false, profile }),
    });
    const data = await res.json();
    if (res.status === 409 && data.exists === true) {
      if (!confirm("A profile with this name already exists. Overwrite it?")) return;
      res = await fetch("/api/admin/simulated-client-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, overwrite: true, profile }),
      });
    }
    if (res.ok) {
      alert("Profile saved successfully.");
    } else {
      alert("Failed to save profile.");
    }
  });

  actions.querySelector(".btn-confirm")?.addEventListener("click", () => {
    const countInput = content.querySelector("#create-modal-count") as HTMLInputElement | null;
    const count = countInput != null ? parseInt(countInput.value.trim(), 10) : NaN;
    if (!Number.isInteger(count) || count < 1) {
      alert("New Client Count must be an integer ≥ 1.");
      return;
    }
    if (generateFromProfile) {
      if (!editorApi) return;
      const curves = editorApi.getCurves();
      const newClients: SimulatedClient[] = [];
      const maxAttempts = count * 20 + 100;
      let attempts = 0;
      while (newClients.length < count && attempts < maxAttempts) {
        attempts++;
        const c = generateClientFromProfile(curves);
        if (c) {
          newClients.push(c);
        } else {
          console.log("generated client thrown out for having invalid chart of 0 points");
        }
      }
      close();
      onCreate(newClients);
    } else {
      const mins: number[] = [];
      const maxs: number[] = [];
      for (let i = 0; i < DISTRIBUTION_CHART_PRESETS.length; i++) {
        const minInput = content.querySelector(`#create-modal-min-${i}`) as HTMLInputElement | null;
        const maxInput = content.querySelector(`#create-modal-max-${i}`) as HTMLInputElement | null;
        const minVal = minInput != null ? parseInt(minInput.value.trim(), 10) : NaN;
        const maxVal = maxInput != null ? parseInt(maxInput.value.trim(), 10) : NaN;
        if (!Number.isInteger(minVal) || minVal < MIN_CURVE_POINTS || minVal > MAX_CURVE_POINTS) {
          alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Min must be an integer between ${MIN_CURVE_POINTS} and ${MAX_CURVE_POINTS}.`);
          return;
        }
        if (!Number.isInteger(maxVal) || maxVal < MIN_CURVE_POINTS || maxVal > MAX_CURVE_POINTS) {
          alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Max must be an integer between ${MIN_CURVE_POINTS} and ${MAX_CURVE_POINTS}.`);
          return;
        }
        if (minVal > maxVal) {
          alert(`Chart "${DISTRIBUTION_CHART_PRESETS[i].title}": Min must not exceed Max.`);
          return;
        }
        mins.push(minVal);
        maxs.push(maxVal);
      }
      const bounds = DISTRIBUTION_CHART_PRESETS.map((p) => ({
        xMin: p.xAxis.min,
        xMax: p.xAxis.max,
      }));
      const newClients: SimulatedClient[] = [];
      for (let c = 0; c < count; c++) {
        const pointCounts = mins.map((min, i) => {
          const max = maxs[i];
          return min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
        });
        newClients.push(createClientWithRandomCurves(bounds, pointCounts));
      }
      close();
      onCreate(newClients);
    }
  });

  loadProfileList();
  setMode(true);

  document.body.appendChild(overlay);
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function getCurveCopy(client: SimulatedClient, key: SimulatedClientDistKey): DistributionCurve {
  const cur = client[key];
  return cur && Array.isArray(cur.anchors)
    ? { anchors: cur.anchors.map((a) => ({ ...a })) }
    : { anchors: [] };
}

function showCloneClientModal(sourceClient: SimulatedClient, onCreate: (newClients: SimulatedClient[]) => void): void {
  const initialCurves: DistributionCurve[] = DIST_KEYS_BY_PRESET_INDEX.map((key) =>
    getCurveCopy(sourceClient, key)
  );

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal clone-client-modal";

  const content = document.createElement("div");
  content.className = "clone-client-modal-content";

  const countRow = document.createElement("div");
  countRow.className = "clone-clients-row";
  countRow.innerHTML = `
    <label for="clone-modal-count">Number of clones to create:</label>
    <input type="number" id="clone-modal-count" min="1" value="1" />
  `;
  content.appendChild(countRow);

  const editorContainer = document.createElement("div");
  content.appendChild(editorContainer);

  modal.appendChild(content);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.innerHTML = `
    <button type="button" class="btn-save-profile">${saveIcon}<span>Save Profile</span></button>
    <button type="button" class="btn-cancel">Cancel</button>
    <button type="button" class="btn-confirm">Confirm Clone</button>
  `;
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const cloneConfirmBtn = actions.querySelector(".btn-confirm") as HTMLButtonElement | null;
  const cloneSaveBtn = actions.querySelector(".btn-save-profile") as HTMLButtonElement | null;

  function wrapCloneButtonForTooltip(btn: HTMLButtonElement): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "modal-btn-tooltip-wrap";
    btn.parentNode?.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    return wrap;
  }
  if (cloneConfirmBtn) {
    const wrap = wrapCloneButtonForTooltip(cloneConfirmBtn);
    attachTooltipWhen(wrap, () =>
      cloneConfirmBtn.disabled ? PROFILE_VALIDATION_TOOLTIP : ""
    );
  }
  if (cloneSaveBtn) {
    const wrap = wrapCloneButtonForTooltip(cloneSaveBtn);
    attachTooltipWhen(wrap, () =>
      cloneSaveBtn!.disabled ? PROFILE_VALIDATION_TOOLTIP : ""
    );
  }

  let editorApi: ReturnType<typeof renderDistributionTablesEditor>;
  function updateCloneButtonsState(): void {
    const curves = editorApi.getCurves();
    const valid = hasZeroDestructionPointInAllCharts(curves);
    if (cloneConfirmBtn) cloneConfirmBtn.disabled = !valid;
    if (cloneSaveBtn) cloneSaveBtn.disabled = !valid;
  }

  editorApi = renderDistributionTablesEditor(editorContainer, initialCurves, {
    onCurvesChange: updateCloneButtonsState,
  });
  updateCloneButtonsState();

  const close = (): void => {
    editorApi.destroy();
    overlay.remove();
  };

  function buildProfilePayload(): Record<SimulatedClientDistKey, DistributionCurve> {
    const profile = {} as Record<SimulatedClientDistKey, DistributionCurve>;
    const curves = editorApi.getCurves();
    for (let i = 0; i < DIST_KEYS_BY_PRESET_INDEX.length; i++) {
      const key = DIST_KEYS_BY_PRESET_INDEX[i];
      const curve = curves[i];
      profile[key] = {
        anchors: curve.anchors.map((a) => ({
          x: a.x,
          y: a.y,
          xMutationRange: a.xMutationRange ?? 0,
          yMutationRange: a.yMutationRange ?? 0,
          destructionChance: a.destructionChance ?? 0,
        })),
      };
    }
    return profile;
  }

  async function saveProfile(
    profileName: string,
    overwrite: boolean
  ): Promise<{ success: boolean; exists?: boolean }> {
    const profile = buildProfilePayload();
    const res = await fetch("/api/admin/simulated-client-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName, overwrite, profile }),
    });
    await res.json();
    if (res.status === 409) return { success: false, exists: true };
    if (!res.ok) return { success: false };
    return { success: true };
  }

  actions.querySelector(".btn-save-profile")?.addEventListener("click", async () => {
    const name = prompt("What is the name of this client profile?");
    if (name == null || name.trim() === "") return;
    const profileName = name.trim();
    if (isReservedSystemPresetName(profileName)) {
      alert(`"${SYSTEM_PRESET_REALISTIC_BAD_DEVICE}" is a reserved system preset name. Please choose a different name.`);
      return;
    }
    let result = await saveProfile(profileName, false);
    if (result.exists === true) {
      if (!confirm("A profile with this name already exists. Overwrite it?")) return;
      result = await saveProfile(profileName, true);
    }
    if (result.success) {
      alert("Profile saved successfully.");
    } else {
      alert("Failed to save profile.");
    }
  });

  actions.querySelector(".btn-cancel")?.addEventListener("click", close);

  actions.querySelector(".btn-confirm")?.addEventListener("click", () => {
    const countInput = content.querySelector("#clone-modal-count") as HTMLInputElement | null;
    const count = countInput != null ? parseInt(countInput.value.trim(), 10) : NaN;
    if (!Number.isInteger(count) || count < 1) {
      alert("Number of clones must be an integer ≥ 1.");
      return;
    }
    const curves = editorApi.getCurves();
    const newClients: SimulatedClient[] = [];
    const maxAttempts = count * 20 + 100;
    let attempts = 0;
    while (newClients.length < count && attempts < maxAttempts) {
      attempts++;
      const c = generateClientFromProfile(curves);
      if (c) {
        newClients.push(c);
      } else {
        console.log("generated client thrown out for having invalid chart of 0 points");
      }
    }
    close();
    onCreate(newClients);
  });

  document.body.appendChild(overlay);
}

let clients: ClientSummaryForGrid[] = [];
let selectedId: string | null = null;
/** Full client + sampleHistory from GET /clients/:id; used for details pane. */
let selectedClientFull: SimulatedClientWithSampleHistory | null = null;
let selectedAnchor: DistributionChartSelection | null = null;
let gridContainer: HTMLElement | null = null;
let detailsContainer: HTMLElement | null = null;
let gridRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let detailsRefreshApi: ReturnType<typeof createRefreshEvery> | null = null;
let gridRefreshTimer: ReturnType<typeof setInterval> | null = null;
let detailsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let clockRafId: number | null = null;
let secondaryToolbar: HTMLElement | null = null;
let btnDelete: HTMLElement | null = null;
let btnClone: HTMLElement | null = null;
let btnToggleConnection: HTMLElement | null = null;

let squareSizePx = SQUARE_SIZE_DEFAULT;
let pageIndex = 0;
let resizeObserver: ResizeObserver | null = null;
let lastContainerWidth = 0;
let lastContainerHeight = 0;
let scheduledGridUpdate = false;
let paginationInfoEl: HTMLElement | null = null;
let pagePrevBtn: HTMLButtonElement | null = null;
let pageNextBtn: HTMLButtonElement | null = null;

function computeGridLayout(
  containerWidth: number,
  containerHeight: number,
  squareSizePxVal: number,
  gapPx: number,
  paddingPx: number,
  totalClients: number
): { squaresPerRow: number; rowsVisible: number; pageSize: number; totalPages: number } {
  const innerW = Math.max(0, containerWidth - paddingPx * 2);
  const innerH = Math.max(0, containerHeight - paddingPx * 2);
  const cellSize = squareSizePxVal + gapPx;
  const squaresPerRow = Math.max(1, Math.floor((innerW + gapPx) / cellSize));
  const rowsVisible = Math.max(1, Math.floor((innerH + gapPx) / cellSize));
  const pageSize = squaresPerRow * rowsVisible;
  const totalPages = Math.max(1, Math.ceil(totalClients / pageSize));
  return { squaresPerRow, rowsVisible, pageSize, totalPages };
}

function scheduleGridUpdate(): void {
  if (scheduledGridUpdate) return;
  scheduledGridUpdate = true;
  requestAnimationFrame(() => {
    scheduledGridUpdate = false;
    if (!gridContainer) return;
    updateGridLayoutAndRender();
  });
}

function observeGridPanel(panel: HTMLElement): void {
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry || !gridContainer) return;
    const { width, height } = entry.contentRect;
    const w = Math.round(width);
    const h = Math.round(height);
    if (w === lastContainerWidth && h === lastContainerHeight) return;
    lastContainerWidth = w;
    lastContainerHeight = h;
    scheduleGridUpdate();
  });
  resizeObserver.observe(panel);
  const rect = panel.getBoundingClientRect();
  lastContainerWidth = Math.round(rect.width);
  lastContainerHeight = Math.round(rect.height);
}

function updatePaginationUI(totalPages: number, currentPageIndex: number): void {
  if (paginationInfoEl) {
    paginationInfoEl.textContent = `Page ${currentPageIndex + 1} of ${totalPages}`;
  }
  if (pagePrevBtn) {
    pagePrevBtn.disabled = currentPageIndex === 0;
  }
  if (pageNextBtn) {
    pageNextBtn.disabled = currentPageIndex >= totalPages - 1 || totalPages <= 1;
  }
}

const FALLBACK_GRID_WIDTH = 400;
const FALLBACK_GRID_HEIGHT = 300;

function getGridAvailableSize(): { w: number; h: number } {
  const panel = document.getElementById("simulate-devices-grid-panel");
  const paginationEl = document.getElementById("simulate-devices-grid-pagination");
  if (!panel) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  const style = getComputedStyle(panel);
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const toolbarEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar");
  const toolbarSecondaryEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar-secondary");
  const toolbarHeight = toolbarEl?.offsetHeight ?? 0;
  const toolbarSecondaryHeight = toolbarSecondaryEl?.offsetHeight ?? 0;
  const paginationHeight = paginationEl ? paginationEl.offsetHeight : 0;
  const w = Math.max(0, panel.clientWidth - padL - padR);
  const h = Math.max(
    0,
    panel.clientHeight - padT - padB - toolbarHeight - toolbarSecondaryHeight - paginationHeight
  );
  if (w <= 0 || h <= 0) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  return { w, h };
}

function updateGridLayoutAndRender(): void {
  if (!gridContainer) return;
  const { w, h } = getGridAvailableSize();
  const layout = computeGridLayout(w, h, squareSizePx, GRID_GAP_PX, 0, clients.length);
  const { pageSize, totalPages } = layout;
  pageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const start = pageIndex * pageSize;
  const pageClients = clients.slice(start, start + pageSize);
  renderClientGrid(gridContainer, pageClients, selectedId, noSignalSvg, (id) => {
    selectedId = id;
    selectedClientFull = null;
    selectedAnchor = null;
    refresh();
    getClient(id)
      .then((full) => {
        if (selectedId === id) {
          selectedClientFull = full;
          refresh();
        }
      })
      .catch(() => {
        if (selectedId === id) refresh();
      });
  }, squareSizePx);
  updatePaginationUI(totalPages, pageIndex);
}

function getSelected(): ClientSummaryForGrid | null {
  if (selectedId == null) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

/** Merge summaries (same order as requested ids) into clients at the given start index; optionally merge one extra for selectedId. */
function mergeSummariesIntoClients(
  summaries: ClientSummarySummary[],
  visibleIds: string[],
  start: number,
  selectedIdExtra: boolean
): void {
  for (let i = 0; i < visibleIds.length; i++) {
    const c = clients[start + i];
    const s = summaries[i];
    if (c && s) {
      c.connectionEnabled = s.connectionEnabled;
      c.currentDisplayColor = s.currentDisplayColor;
    }
  }
  if (selectedIdExtra && visibleIds.length < summaries.length) {
    const selSummary = summaries[visibleIds.length];
    const selClient = clients.find((c) => c.id === selSummary.id);
    if (selClient) {
      selClient.connectionEnabled = selSummary.connectionEnabled;
      selClient.currentDisplayColor = selSummary.currentDisplayColor;
    }
  }
}

/** Fetch summaries for currently visible page (and selected client if not on page), merge into clients, then refresh. */
async function fetchVisibleSummariesAndRefresh(): Promise<void> {
  const { w, h } = getGridAvailableSize();
  const layout = computeGridLayout(w, h, squareSizePx, GRID_GAP_PX, 0, clients.length);
  const { pageSize } = layout;
  const start = pageIndex * pageSize;
  const visibleIds = clients.slice(start, start + pageSize).map((c) => c.id);
  const includeSelected =
    selectedId != null && !visibleIds.includes(selectedId);
  const idsToFetch: string[] = [...visibleIds];
  if (includeSelected && selectedId != null) idsToFetch.push(selectedId);
  if (idsToFetch.length === 0) {
    refresh();
    return;
  }
  try {
    const summaries = await getSummaries(idsToFetch);
    mergeSummariesIntoClients(summaries, visibleIds, start, includeSelected);
  } catch {
    // leave existing merged data as-is
  }
  refresh();
}

function refresh(): void {
  if (!gridContainer || !detailsContainer) return;
  if (clients.length > 0 && getSelected() === null) selectedId = clients[0].id;
  const savedScrollTop = detailsContainer.scrollTop;
  updateGridLayoutAndRender();
  const client = selectedClientFull;
  const showDetailsLoading = selectedId != null && selectedClientFull == null;
  const detailsRefreshWrapEl = document.getElementById("simulate-devices-details-refresh-wrap");
  if (detailsRefreshWrapEl) {
    detailsRefreshWrapEl.classList.toggle("simulate-devices-details-refresh-wrap--hidden", showDetailsLoading || client == null);
  }
  if (showDetailsLoading) {
    detailsContainer.innerHTML = "";
    detailsContainer.className = "simulate-devices-details-pane";
    const loading = document.createElement("p");
    loading.className = "simulate-devices-details-empty";
    loading.textContent = "Loading client details…";
    detailsContainer.appendChild(loading);
  } else {
    if (client == null && detailsRefreshTimer) {
      clearInterval(detailsRefreshTimer);
      detailsRefreshTimer = null;
    }
    renderDetailsPane(
      detailsContainer,
      client,
      (distKey: SimulatedClientDistKey, curve: DistributionCurve) => {
        if (selectedId == null || !selectedClientFull) return;
        patchClient(selectedId, { [distKey]: curve }).then(() => {
          selectedClientFull = selectedClientFull
            ? { ...selectedClientFull, [distKey]: curve }
            : null;
          refresh();
        });
      },
      selectedAnchor,
      (sel) => {
        selectedAnchor = sel;
        refresh();
      },
      client ? (distKey) => selectedClientFull?.sampleHistory?.[distKey] ?? [] : undefined,
      client && selectedId
        ? (distKey) => {
            postSample(selectedId!, distKey)
              .then((point) => {
                if (selectedClientFull?.sampleHistory?.[distKey]) {
                  selectedClientFull.sampleHistory[distKey].push(point);
                  if (selectedClientFull.sampleHistory[distKey].length > 100) {
                    selectedClientFull.sampleHistory[distKey] =
                      selectedClientFull.sampleHistory[distKey].slice(-100);
                  }
                }
                navigator.clipboard.writeText(String(point.x)).catch(() => {});
                refresh();
              })
              .catch(() => refresh());
          }
        : undefined
    );
    if (detailsRefreshApi && detailsRefreshApi.getIntervalMs() > 0 && selectedId != null && !detailsRefreshTimer) {
      detailsRefreshTimer = setInterval(() => {
        if (selectedId == null) return;
        detailsRefreshApi?.recordRefresh();
        getClient(selectedId)
          .then((full) => {
            if (selectedId != null) {
              selectedClientFull = full;
              refresh();
            }
          })
          .catch(() => {});
      }, detailsRefreshApi.getIntervalMs());
    }
  }
  detailsContainer.scrollTop = savedScrollTop;

  if (secondaryToolbar) {
    const hide = selectedId == null;
    secondaryToolbar.hidden = hide;
    secondaryToolbar.style.visibility = hide ? "hidden" : "";
    secondaryToolbar.style.pointerEvents = hide ? "none" : "";
  }
  if (btnToggleConnection) {
    const sel = getSelected();
    btnToggleConnection.textContent = sel?.connectionEnabled ? "Disable Connection" : "Enable Connection";
  }
}

async function runGridRefresh(): Promise<void> {
  gridRefreshApi?.requestStarted();
  gridRefreshApi?.recordRefresh();
  let success = false;
  try {
    const list = await getClients();
    clients.length = 0;
    clients.push(...list);
    if (selectedId != null && !clients.some((c) => c.id === selectedId)) {
      selectedId = null;
      selectedClientFull = null;
    }
    if (clients.length > 0 && selectedId == null) selectedId = clients[0].id;
    success = true;
    await fetchVisibleSummariesAndRefresh();
  } catch {
    // Leave clients as-is; disconnect indicator will show
  } finally {
    gridRefreshApi?.requestCompleted(success);
  }
}

export function render(container: HTMLElement): void {
  if (clockRafId != null) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
  clients = [];
  selectedId = null;
  selectedClientFull = null;
  pageIndex = 0;
  if (detailsRefreshTimer) {
    clearInterval(detailsRefreshTimer);
    detailsRefreshTimer = null;
  }

  resizeObserver?.disconnect();
  resizeObserver = null;

  if (gridRefreshTimer != null) {
    clearInterval(gridRefreshTimer);
    gridRefreshTimer = null;
  }

  container.innerHTML = `
    <div class="simulate-devices-page">
      <div class="simulate-devices-body">
        <div class="simulate-devices-client-array-panel" id="simulate-devices-grid-panel">
          <div class="simulate-devices-toolbar">
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-icon" id="simulate-devices-create">${openIcon}<span>Create Clients</span></button>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
            <span class="simulate-devices-square-size-wrap">
              <label for="simulate-devices-square-size" class="simulate-devices-toolbar-label">Square size</label>
              <input type="range" id="simulate-devices-square-size" min="${SQUARE_SIZE_MIN}" max="${SQUARE_SIZE_MAX}" value="${squareSizePx}" />
              <span id="simulate-devices-square-size-value">${squareSizePx} px</span>
            </span>
          </div>
          <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
            <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-toggle-connection">Disable Connection</button>
          </div>
          <div class="simulate-devices-grid-panel-inner">
            <div class="simulate-devices-grid-area" id="simulate-devices-grid-area"></div>
            <div class="simulate-devices-grid-pagination" id="simulate-devices-grid-pagination">
              <span id="simulate-devices-page-info">Page 1 of 1</span>
              <button type="button" id="simulate-devices-page-prev">Prev</button>
              <button type="button" id="simulate-devices-page-next">Next</button>
            </div>
          </div>
        </div>
        <section class="simulate-devices-details-section" aria-label="Client details">
          <div class="simulate-devices-details-refresh-wrap" id="simulate-devices-details-refresh-wrap"></div>
          <div id="simulate-devices-details-pane"></div>
        </section>
      </div>
    </div>
  `;

  gridContainer = document.getElementById("simulate-devices-grid-area");
  detailsContainer = document.getElementById("simulate-devices-details-pane");
  const detailsRefreshWrapEl = document.getElementById("simulate-devices-details-refresh-wrap");
  secondaryToolbar = document.getElementById("simulate-devices-toolbar-secondary");
  btnDelete = document.getElementById("simulate-devices-delete");
  btnClone = document.getElementById("simulate-devices-clone");
  btnToggleConnection = document.getElementById("simulate-devices-toggle-connection");
  paginationInfoEl = document.getElementById("simulate-devices-page-info");
  pagePrevBtn = document.getElementById("simulate-devices-page-prev") as HTMLButtonElement | null;
  pageNextBtn = document.getElementById("simulate-devices-page-next") as HTMLButtonElement | null;

  const gridPanelEl = document.getElementById("simulate-devices-grid-panel");
  const toolbarEl = gridPanelEl?.querySelector<HTMLElement>(".simulate-devices-toolbar");
  if (toolbarEl) {
    gridRefreshApi = createRefreshEvery({
      name: "simulate-devices-grid-refresh",
      defaultMs: 1000,
      responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
      disconnectTooltip: "The Simulated Client Server is not responding. It may be down.",
      infoTooltip: "Refreshing these values often can cause UI lag.",
      onIntervalChange(ms) {
        if (gridRefreshTimer) clearInterval(gridRefreshTimer);
        gridRefreshTimer = null;
        if (ms > 0) gridRefreshTimer = setInterval(() => runGridRefresh(), ms);
      },
      onManualRefresh: runGridRefresh,
    });
    toolbarEl.insertBefore(gridRefreshApi.root, toolbarEl.firstChild);
  }
  if (detailsRefreshWrapEl) {
    detailsRefreshApi = createRefreshEvery({
      name: "simulate-devices-details-refresh",
      defaultMs: 1000,
      infoTooltip: "Refreshing these values often can cause UI lag.",
      onIntervalChange(ms) {
        if (detailsRefreshTimer) clearInterval(detailsRefreshTimer);
        detailsRefreshTimer = null;
        if (ms > 0 && selectedId != null) {
          detailsRefreshTimer = setInterval(() => {
            if (selectedId == null) return;
            detailsRefreshApi?.recordRefresh();
            getClient(selectedId)
              .then((full) => {
                if (selectedId != null) {
                  selectedClientFull = full;
                  refresh();
                }
              })
              .catch(() => {});
          }, ms);
        }
      },
    });
    detailsRefreshWrapEl.appendChild(detailsRefreshApi.root);
  }
  if (gridPanelEl) observeGridPanel(gridPanelEl);
  const gridMs = gridRefreshApi?.getIntervalMs() ?? 1000;
  if (gridRefreshTimer) clearInterval(gridRefreshTimer);
  gridRefreshTimer = null;
  if (gridMs > 0) gridRefreshTimer = setInterval(runGridRefresh, gridMs);

  function tickClocks(): void {
    gridRefreshApi?.updateClockHand();
    detailsRefreshApi?.updateClockHand();
    clockRafId = requestAnimationFrame(tickClocks);
  }
  clockRafId = requestAnimationFrame(tickClocks);

  requestAnimationFrame(() => refresh());

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const active = document.activeElement;
    if (
      active &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active as HTMLElement).isContentEditable)
    )
      return;
    if (selectedAnchor == null || selectedAnchor.indices.length === 0) return;
    const client = selectedClientFull;
    if (client == null || selectedId == null) return;
    const { distKey, indices } = selectedAnchor;
    const curve = client[distKey];
    const indexSet = new Set(indices);
    const anchors = curve.anchors.filter((_, i) => !indexSet.has(i));
    e.preventDefault();
    patchClient(selectedId, { [distKey]: { anchors } }).then(() => {
      selectedClientFull = selectedClientFull
        ? { ...selectedClientFull, [distKey]: { anchors } }
        : null;
      selectedAnchor = null;
      refresh();
    });
  });

  document.getElementById("simulate-devices-create")?.addEventListener("click", () => {
    showCreateClientsModal((newClients) => {
      postClients(newClients)
        .then(() => runGridRefresh())
        .then(() => {
          if (selectedId != null && selectedClientFull == null) {
            getClient(selectedId).then((full) => {
              if (selectedId != null) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
        })
        .catch(() => runGridRefresh());
    });
  });

  document.getElementById("simulate-devices-destroy")?.addEventListener("click", () => {
    deleteAllClients()
      .then(() => {
        selectedId = null;
        selectedClientFull = null;
        runGridRefresh();
      })
      .catch(() => runGridRefresh());
  });

  btnDelete?.addEventListener("click", () => {
    if (selectedId == null) return;
    const idToDelete = selectedId;
    apiDeleteClient(idToDelete)
      .then(() => {
        selectedId = null;
        selectedClientFull = null;
        runGridRefresh();
      })
      .catch(() => runGridRefresh());
  });

  btnClone?.addEventListener("click", () => {
    const sel = selectedClientFull;
    if (sel == null) return;
    showCloneClientModal(sel, (newClients) => {
      postClients(newClients)
        .then(() => runGridRefresh())
        .then(() => {
          const lastId = newClients[newClients.length - 1]?.id;
          if (lastId && clients.some((c) => c.id === lastId)) {
            selectedId = lastId;
            selectedClientFull = null;
            getClient(lastId).then((full) => {
              if (selectedId === lastId) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
          refresh();
        })
        .catch(() => runGridRefresh());
    });
  });

  btnToggleConnection?.addEventListener("click", () => {
    const sel = getSelected();
    if (sel == null) return;
    patchClient(sel.id, { connectionEnabled: !sel.connectionEnabled })
      .then(() => runGridRefresh())
      .catch(() => runGridRefresh());
  });

  const squareSizeInput = document.getElementById("simulate-devices-square-size") as HTMLInputElement | null;
  const squareSizeValueEl = document.getElementById("simulate-devices-square-size-value");
  squareSizeInput?.addEventListener("input", () => {
    const val = parseInt(squareSizeInput.value, 10);
    if (!Number.isNaN(val)) {
      squareSizePx = Math.max(SQUARE_SIZE_MIN, Math.min(SQUARE_SIZE_MAX, val));
      if (squareSizeValueEl) squareSizeValueEl.textContent = `${squareSizePx} px`;
      updateGridLayoutAndRender();
    }
  });

  pagePrevBtn?.addEventListener("click", () => {
    pageIndex--;
    fetchVisibleSummariesAndRefresh();
  });
  pageNextBtn?.addEventListener("click", () => {
    pageIndex++;
    fetchVisibleSummariesAndRefresh();
  });
}
