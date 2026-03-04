import "./styles.css";
import openIcon from "../../icons/open.svg?raw";
import saveIcon from "../../icons/save.svg?raw";
import trashIcon from "../../icons/trash.svg?raw";
import noSignalIcon from "../../icons/noSignal.svg?raw";
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
import { updateClientGrid } from "./client-grid";
import {
  renderDetailsPane,
  DISTRIBUTION_CHART_PRESETS,
  DIST_KEYS_BY_PRESET_INDEX,
  updateDetailsPaneChartsSamplePoints,
  updateDetailsPaneReadOnly,
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
  if (!curves || curves.length !== DIST_KEYS_BY_PRESET_INDEX.length) return false;
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
  countRow.className = "create-modal-count-row";
  countRow.appendChild(
    createInfoBubble({
      tooltipText:
        "Normally you'll want to generate clients from a profile. Profiles define ranges that distribution table points can be placed in. Chaos clients are built by placing a random number of points in the distribution table at random.",
      ariaLabel: "Info",
    })
  );
  const countLabel = document.createElement("label");
  countLabel.htmlFor = "create-modal-count";
  countLabel.textContent = "New Client Count: ";
  countRow.appendChild(countLabel);
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
  const distributionHeading = document.createElement("h4");
  distributionHeading.className = "modal-distribution-heading";
  distributionHeading.textContent = "Distribution Tables";
  profileBlock.appendChild(distributionHeading);
  const distributionHr = document.createElement("hr");
  distributionHr.className = "modal-distribution-hr";
  profileBlock.appendChild(distributionHr);
  const profileDropdownWrap = document.createElement("div");
  profileDropdownWrap.className = "modal-profile-dropdown";
  const profileDropdownBtn = document.createElement("button");
  profileDropdownBtn.type = "button";
  profileDropdownBtn.className = "modal-profile-dropdown-btn";
  profileDropdownBtn.setAttribute("aria-haspopup", "listbox");
  profileDropdownBtn.setAttribute("aria-expanded", "false");
  profileDropdownBtn.innerHTML = `${openIcon}<span>Load From Saved Profile</span>`;
  const profileDropdownList = document.createElement("div");
  profileDropdownList.className = "modal-profile-dropdown-list";
  profileDropdownList.setAttribute("role", "listbox");
  profileDropdownList.hidden = true;
  profileDropdownWrap.appendChild(profileDropdownBtn);
  profileDropdownWrap.appendChild(profileDropdownList);
  profileBlock.appendChild(profileDropdownWrap);
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
        showHeading: false,
      });
    }
    updateCreateButtonState();
  }

  content.querySelector("#create-modal-mode-toggle")?.addEventListener("click", () => {
    setMode(!generateFromProfile);
  });

  function closeProfileDropdown(): void {
    profileDropdownList.hidden = true;
    profileDropdownBtn.setAttribute("aria-expanded", "false");
  }

  profileDropdownBtn.addEventListener("click", () => {
    const open = profileDropdownList.hidden;
    profileDropdownList.hidden = !open;
    profileDropdownBtn.setAttribute("aria-expanded", String(!open));
  });
  function closeOnClickOutside(e: MouseEvent): void {
    if (!overlay.contains(e.target as Node)) return;
    if (profileDropdownWrap.contains(e.target as Node)) return;
    closeProfileDropdown();
  }
  document.addEventListener("click", closeOnClickOutside);

  async function loadProfileList(): Promise<void> {
    const res = await fetch("/api/admin/simulated-client-profiles");
    const names: string[] = res.ok ? await res.json() : [];
    profileDropdownList.innerHTML = "";
    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "modal-profile-dropdown-item";
    placeholder.textContent = "Select a profile...";
    placeholder.disabled = true;
    profileDropdownList.appendChild(placeholder);
    const systemBtn = document.createElement("button");
    systemBtn.type = "button";
    systemBtn.className = "modal-profile-dropdown-item";
    systemBtn.dataset.profileName = SYSTEM_PRESET_REALISTIC_BAD_DEVICE;
    systemBtn.textContent = SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL;
    profileDropdownList.appendChild(systemBtn);
    const reservedLower = SYSTEM_PRESET_REALISTIC_BAD_DEVICE.toLowerCase();
    for (const name of names) {
      const normalized = name.replace(/\.json$/i, "").toLowerCase();
      if (normalized === reservedLower) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-profile-dropdown-item";
      btn.dataset.profileName = name;
      btn.textContent = name.replace(/\.json$/i, "");
      profileDropdownList.appendChild(btn);
    }
  }

  async function loadProfileByName(name: string): Promise<void> {
    if (!editorApi) return;
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
  }

  profileDropdownList.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".modal-profile-dropdown-item");
    if (!item || (item as HTMLButtonElement).disabled) return;
    const name = (item as HTMLButtonElement).dataset.profileName;
    if (name) {
      loadProfileByName(name);
      closeProfileDropdown();
    }
  });

  const close = (): void => {
    document.removeEventListener("click", closeOnClickOutside);
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

  const distributionHeading = document.createElement("h4");
  distributionHeading.className = "modal-distribution-heading";
  distributionHeading.textContent = "Distribution Tables";
  content.appendChild(distributionHeading);
  const distributionHr = document.createElement("hr");
  distributionHr.className = "modal-distribution-hr";
  content.appendChild(distributionHr);
  const profileDropdownWrap = document.createElement("div");
  profileDropdownWrap.className = "modal-profile-dropdown";
  const profileDropdownBtn = document.createElement("button");
  profileDropdownBtn.type = "button";
  profileDropdownBtn.className = "modal-profile-dropdown-btn";
  profileDropdownBtn.setAttribute("aria-haspopup", "listbox");
  profileDropdownBtn.setAttribute("aria-expanded", "false");
  profileDropdownBtn.innerHTML = `${openIcon}<span>Load From Saved Profile</span>`;
  const profileDropdownList = document.createElement("div");
  profileDropdownList.className = "modal-profile-dropdown-list";
  profileDropdownList.setAttribute("role", "listbox");
  profileDropdownList.hidden = true;
  profileDropdownWrap.appendChild(profileDropdownBtn);
  profileDropdownWrap.appendChild(profileDropdownList);
  content.appendChild(profileDropdownWrap);

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

  function closeCloneProfileDropdown(): void {
    profileDropdownList.hidden = true;
    profileDropdownBtn.setAttribute("aria-expanded", "false");
  }
  profileDropdownBtn.addEventListener("click", () => {
    const open = profileDropdownList.hidden;
    profileDropdownList.hidden = !open;
    profileDropdownBtn.setAttribute("aria-expanded", String(!open));
  });
  function closeOnClickOutsideClone(e: MouseEvent): void {
    if (!overlay.contains(e.target as Node)) return;
    if (profileDropdownWrap.contains(e.target as Node)) return;
    closeCloneProfileDropdown();
  }
  document.addEventListener("click", closeOnClickOutsideClone);

  async function loadCloneProfileList(): Promise<void> {
    const res = await fetch("/api/admin/simulated-client-profiles");
    const names: string[] = res.ok ? await res.json() : [];
    profileDropdownList.innerHTML = "";
    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "modal-profile-dropdown-item";
    placeholder.textContent = "Select a profile...";
    placeholder.disabled = true;
    profileDropdownList.appendChild(placeholder);
    const systemBtn = document.createElement("button");
    systemBtn.type = "button";
    systemBtn.className = "modal-profile-dropdown-item";
    systemBtn.dataset.profileName = SYSTEM_PRESET_REALISTIC_BAD_DEVICE;
    systemBtn.textContent = SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL;
    profileDropdownList.appendChild(systemBtn);
    const reservedLower = SYSTEM_PRESET_REALISTIC_BAD_DEVICE.toLowerCase();
    for (const name of names) {
      const normalized = name.replace(/\.json$/i, "").toLowerCase();
      if (normalized === reservedLower) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-profile-dropdown-item";
      btn.dataset.profileName = name;
      btn.textContent = name.replace(/\.json$/i, "");
      profileDropdownList.appendChild(btn);
    }
  }
  async function loadCloneProfileByName(name: string): Promise<void> {
    if (name === SYSTEM_PRESET_REALISTIC_BAD_DEVICE) {
      editorApi.setCurves(REALISTIC_BAD_DEVICE_PROFILE);
      updateCloneButtonsState();
      return;
    }
    const res = await fetch(`/api/admin/simulated-client-profiles/${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const profile = (await res.json()) as Record<SimulatedClientDistKey, DistributionCurve>;
    editorApi.setCurves(profile);
    updateCloneButtonsState();
  }
  profileDropdownList.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".modal-profile-dropdown-item");
    if (!item || (item as HTMLButtonElement).disabled) return;
    const name = (item as HTMLButtonElement).dataset.profileName;
    if (name) {
      loadCloneProfileByName(name);
      closeCloneProfileDropdown();
    }
  });

  editorApi = renderDistributionTablesEditor(editorContainer, initialCurves, {
    onCurvesChange: updateCloneButtonsState,
    showHeading: false,
  });
  updateCloneButtonsState();
  loadCloneProfileList();

  const close = (): void => {
    document.removeEventListener("click", closeOnClickOutsideClone);
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
      alert(`"${profileName}" is a reserved system preset name. Please choose a different name.`);
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
let detailsRefreshIntervalMs = 0;
let clockRafId: number | null = null;
let secondaryToolbar: HTMLElement | null = null;
let btnDelete: HTMLElement | null = null;
let btnClone: HTMLElement | null = null;

let squareSizePx = SQUARE_SIZE_DEFAULT;
let showLagOverlay = true;
let pageIndex = 0;
let resizeObserver: ResizeObserver | null = null;
let lastContainerWidth = 0;
let lastContainerHeight = 0;
let scheduledGridUpdate = false;
/** Only re-render details pane when selection or full client data actually changed (avoids DOM rebuild on grid refresh). */
let lastRenderedDetailsSelectedId: string | null | undefined = undefined;
let lastRenderedDetailsClientFull: SimulatedClientWithSampleHistory | null | undefined = undefined;
let paginationInfoEl: HTMLElement | null = null;
let pagePrevBtn: HTMLButtonElement | null = null;
let pageNextBtn: HTMLButtonElement | null = null;
/** Prevents overlapping grid stats requests so the RefreshEvery disconnect timeout is not cleared by a new request. */
let gridRefreshStatsInFlight = false;
/** If a full refresh is requested during an in-flight refresh, run it after the in-flight completes. */
let gridRefreshFullPending = false;
/** Prevent auto-selecting clients while we're intentionally clearing the list (e.g. delete-all). */
let suppressAutoSelect = false;
/** Current show for simulated devices API; set in render(container, showId) when showId is non-null. */
let currentShowId: string | null = null;

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
  if (gridContainer) {
    const w = Math.max(0, Math.round(gridContainer.clientWidth));
    const h = Math.max(0, Math.round(gridContainer.clientHeight));
    if (w > 0 && h > 0) return { w, h };
  }
  const panel = document.getElementById("simulate-devices-grid-panel");
  if (!panel) return { w: FALLBACK_GRID_WIDTH, h: FALLBACK_GRID_HEIGHT };
  const style = getComputedStyle(panel);
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const toolbarEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar");
  const toolbarSecondaryEl = panel.querySelector<HTMLElement>(".simulate-devices-toolbar-secondary");
  const paginationEl = document.getElementById("simulate-devices-grid-pagination");
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

/**
 * Single source of truth for "what is the current visible page". Uses the same snapped
 * height as the grid render so fetch and display never disagree (e.g. after resize).
 * Updates pageIndex (clamps to valid range). Call whenever layout might have changed.
 */
function getVisiblePageLayout(): {
  layout: ReturnType<typeof computeGridLayout>;
  start: number;
  pageSize: number;
  totalPages: number;
} {
  const { w, h } = getGridAvailableSize();
  const cellSize = squareSizePx + GRID_GAP_PX;
  const snappedH = Math.max(cellSize, Math.floor(h / cellSize) * cellSize);
  const layout = computeGridLayout(w, snappedH, squareSizePx, GRID_GAP_PX, 0, clients.length);
  const { pageSize, totalPages } = layout;
  pageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const start = pageIndex * pageSize;
  return { layout, start, pageSize, totalPages };
}

function updateGridLayoutAndRender(): void {
  if (!gridContainer) return;
  const visible = getVisiblePageLayout();
  const { start, pageSize, totalPages } = visible;
  const pageClients = clients.slice(start, start + pageSize);
  const showIdForGrid = currentShowId;
  updateClientGrid(gridContainer, pageClients, selectedId, (id) => {
    selectedId = id;
    selectedClientFull = null;
    selectedAnchor = null;
    refresh();
    if (showIdForGrid)
      getClient(showIdForGrid, id)
        .then((full) => {
          if (selectedId === id) {
            selectedClientFull = full;
            refresh();
          }
        })
        .catch(() => {
          if (selectedId === id) refresh();
        });
  }, squareSizePx, showLagOverlay);
  updatePaginationUI(totalPages, pageIndex);
}

function getSelected(): ClientSummaryForGrid | null {
  if (selectedId == null) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

const CLOCK_ERROR_WIDGET_TOOLTIP =
  "Average Clock Error: The average difference between the client's estimated server clock and the actual server clock. This should approach 0 to indicate an accurate simulation. Average Absolute Clock Error: The average positive absolute values of the difference between the client's estimated server clock and the actual server clock. The lower this value, the more in sync the devices are." ;

function createClockErrorWidget(): HTMLElement {
  const root = document.createElement("div");
  root.className = "simulate-devices-clock-error-widget";
  root.innerHTML = `
    <div class="simulate-devices-clock-error-left">
      <div class="simulate-devices-clock-error-row">
        <span class="simulate-devices-clock-error-label">Ave Clock Error:</span>
        <span id="simulate-devices-ave-clock-error-value" class="simulate-devices-clock-error-value">—</span>
      </div>
      <div class="simulate-devices-clock-error-row">
        <span class="simulate-devices-clock-error-label">Ave Absolute Clock Error:</span>
        <span id="simulate-devices-ave-abs-clock-error-value" class="simulate-devices-clock-error-value">—</span>
      </div>
    </div>
    <div class="simulate-devices-clock-error-right">
    </div>`;
  const rightHalf = root.querySelector(".simulate-devices-clock-error-right");
  if (rightHalf) {
    rightHalf.appendChild(
      createInfoBubble({
        tooltipText: CLOCK_ERROR_WIDGET_TOOLTIP,
        ariaLabel: "Info about clock error",
      })
    );
  }
  return root;
}

function updateClockErrorWidget(aveErrorMs: number | null, aveAbsErrorMs: number | null): void {
  const elAve = document.getElementById("simulate-devices-ave-clock-error-value");
  const elAbs = document.getElementById("simulate-devices-ave-abs-clock-error-value");
  if (elAve) elAve.textContent = aveErrorMs != null ? `${aveErrorMs.toFixed(1)} ms` : "—";
  if (elAbs) elAbs.textContent = aveAbsErrorMs != null ? `${aveAbsErrorMs.toFixed(1)} ms` : "—";
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
      c.currentDisplayColor = s.currentDisplayColor;
      c.lagEndsInMs = s.lagEndsInMs ?? null;
    }
  }
  if (selectedIdExtra && visibleIds.length < summaries.length) {
    const selSummary = summaries[visibleIds.length];
    const selClient = clients.find((c) => c.id === selSummary.id);
    if (selClient) {
      selClient.currentDisplayColor = selSummary.currentDisplayColor;
      selClient.lagEndsInMs = selSummary.lagEndsInMs ?? null;
    }
  }
}

/** Fetch summaries for currently visible page (and selected client if not on page), merge into clients, then refresh. */
async function fetchVisibleSummariesAndRefresh(): Promise<boolean> {
  const visible = getVisiblePageLayout();
  const { start, pageSize } = visible;
  const visibleIds = clients.slice(start, start + pageSize).map((c) => c.id);
  const includeSelected =
    selectedId != null && !visibleIds.includes(selectedId);
  const idsToFetch: string[] = [...visibleIds];
  if (includeSelected && selectedId != null) idsToFetch.push(selectedId);
  if (idsToFetch.length === 0 || !currentShowId) {
    updateClockErrorWidget(null, null);
    refresh();
    return true;
  }
  try {
    const summaries = await getSummaries(currentShowId, idsToFetch);
    mergeSummariesIntoClients(summaries, visibleIds, start, includeSelected);
    const onScreenSummaries = summaries.slice(0, visibleIds.length);
    const errors = onScreenSummaries
      .map((s) => s.serverTimeEstimateErrorMs)
      .filter((e): e is number => e != null && Number.isFinite(e));
    if (errors.length > 0) {
      const ave = errors.reduce((a, b) => a + b, 0) / errors.length;
      const aveAbs = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
      updateClockErrorWidget(ave, aveAbs);
    } else {
      updateClockErrorWidget(null, null);
    }
  } catch {
    // leave existing merged data as-is
    updateClockErrorWidget(null, null);
    refresh();
    return false;
  }
  refresh();
  return true;
}

function refresh(): void {
  if (!gridContainer || !detailsContainer) return;
  if (!suppressAutoSelect && clients.length > 0 && getSelected() === null) selectedId = clients[0].id;
  const savedScrollTop = detailsContainer.scrollTop;
  updateGridLayoutAndRender();
  const client = selectedClientFull;
  const showDetailsLoading = selectedId != null && selectedClientFull == null;
  const detailsRefreshWrapEl = document.getElementById("simulate-devices-details-refresh-wrap");
  if (detailsRefreshWrapEl) {
    detailsRefreshWrapEl.classList.toggle("simulate-devices-details-refresh-wrap--hidden", showDetailsLoading || client == null);
  }
  const detailsNeedRender =
    showDetailsLoading ||
    (client === null && (lastRenderedDetailsSelectedId === undefined || lastRenderedDetailsSelectedId !== null)) ||
    (client !== null &&
      (selectedId !== lastRenderedDetailsSelectedId || selectedClientFull !== lastRenderedDetailsClientFull));

  if (showDetailsLoading) {
    // Leave existing details content in place so scroll is preserved; when getClient resolves we will re-render and restore savedScrollTop.
    lastRenderedDetailsSelectedId = selectedId;
    lastRenderedDetailsClientFull = null;
  } else if (detailsNeedRender) {
    if (client === null) {
      lastRenderedDetailsSelectedId = null;
      lastRenderedDetailsClientFull = null;
    }
    // Hide pane during re-render to avoid visible flicker; restore scroll after layout.
    detailsContainer.style.visibility = "hidden";
    renderDetailsPane(
      detailsContainer,
      client,
      (distKey: SimulatedClientDistKey, curve: DistributionCurve) => {
        if (selectedId == null || !selectedClientFull || !currentShowId) return;
        patchClient(currentShowId, selectedId, { [distKey]: curve }).then(() => {
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
      client && selectedId && currentShowId
        ? (distKey) => {
            postSample(currentShowId!, selectedId!, distKey)
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
    lastRenderedDetailsSelectedId = selectedId;
    lastRenderedDetailsClientFull = selectedClientFull;
    const pane = detailsContainer;
    requestAnimationFrame(() => {
      if (!pane) return;
      const maxScroll = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.min(savedScrollTop, Math.max(0, maxScroll));
      pane.style.visibility = "";
    });
  } else {
    const maxScroll = detailsContainer.scrollHeight - detailsContainer.clientHeight;
    detailsContainer.scrollTop = Math.min(savedScrollTop, Math.max(0, maxScroll));
  }
  ensureDetailsRefreshTimer();

  if (secondaryToolbar) {
    const hide = selectedId == null;
    secondaryToolbar.hidden = hide;
    secondaryToolbar.style.visibility = hide ? "hidden" : "";
    secondaryToolbar.style.pointerEvents = hide ? "none" : "";
  }
}

/** Full refresh: fetch client list then summaries. Use on load, manual refresh, and after Create/Destroy/Delete/Clone. */
async function runGridRefreshFull(): Promise<void> {
  if (!currentShowId) return;
  if (gridRefreshStatsInFlight) {
    gridRefreshFullPending = true;
    return;
  }
  gridRefreshStatsInFlight = true;
  gridRefreshApi?.requestStarted();
  gridRefreshApi?.recordRefresh();
  let success = false;
  try {
    const list = await getClients(currentShowId);
    clients.length = 0;
    clients.push(...list);
    suppressAutoSelect = false;
    if (selectedId != null && !clients.some((c) => c.id === selectedId)) {
      selectedId = null;
      selectedClientFull = null;
    }
    if (!suppressAutoSelect && clients.length > 0 && selectedId == null) selectedId = clients[0].id;
    success = await fetchVisibleSummariesAndRefresh();
  } catch (e) {
    if (e instanceof Error && (e.message.includes("not live") || e.message.includes("404"))) {
      clients.length = 0;
      selectedId = null;
      selectedClientFull = null;
      refresh();
    }
    // Otherwise leave clients as-is; disconnect indicator will show
  } finally {
    gridRefreshStatsInFlight = false;
    gridRefreshApi?.requestCompleted(success);
    if (gridRefreshFullPending) {
      gridRefreshFullPending = false;
      // Best-effort; if another refresh started, it will re-pend.
      runGridRefreshFull();
    }
  }
}

/** Stats only: fetch summaries for visible IDs. Use for grid timer ticks. */
async function runGridRefreshStatsOnly(): Promise<void> {
  if (gridRefreshStatsInFlight) return;
  gridRefreshStatsInFlight = true;
  gridRefreshApi?.requestStarted();
  gridRefreshApi?.recordRefresh();
  let success = false;
  try {
    success = await fetchVisibleSummariesAndRefresh();
  } catch {
    // Leave existing data as-is
  } finally {
    gridRefreshStatsInFlight = false;
    gridRefreshApi?.requestCompleted(success);
    if (gridRefreshFullPending) {
      gridRefreshFullPending = false;
      runGridRefreshFull();
    }
  }
}

function ensureDetailsRefreshTimer(): void {
  const ms = detailsRefreshIntervalMs;
  const shouldRun = ms > 0 && selectedId != null && detailsRefreshApi != null;
  if (!shouldRun) {
    if (detailsRefreshTimer) clearInterval(detailsRefreshTimer);
    detailsRefreshTimer = null;
    return;
  }
  if (detailsRefreshTimer) return;
  detailsRefreshTimer = setInterval(() => {
    if (selectedId == null || !detailsRefreshApi || !currentShowId) return;
    const id = selectedId;
    const showId = currentShowId;
    detailsRefreshApi.requestStarted();
    detailsRefreshApi.recordRefresh();
    let success = false;
    getClient(showId, id)
      .then((full) => {
        if (selectedId !== id) return;
        if (full == null) {
          // Selected client no longer exists (e.g. deleted individually or via delete-all).
          // Clear selection so we don't hammer the server with repeated 404s.
          selectedId = null;
          selectedClientFull = null;
          selectedAnchor = null;
          refresh();
          return;
        }
        selectedClientFull = full;
        success = true;
        if (detailsContainer) {
          const hasReadOnlyNodes = detailsContainer.querySelector('[data-detail-key="deviceId"]') != null;
          if (!hasReadOnlyNodes) {
            // Details pane isn't rendered yet (or is showing loading). Do a full refresh once.
            refresh();
          } else {
            const st = detailsContainer.scrollTop;
            updateDetailsPaneReadOnly(detailsContainer, full);
            updateDetailsPaneChartsSamplePoints(detailsContainer, full);
            detailsContainer.scrollTop = st;
            // Keep "last rendered" pointers in sync so unrelated refreshes don't rebuild details DOM.
            lastRenderedDetailsSelectedId = selectedId;
            lastRenderedDetailsClientFull = selectedClientFull;
          }
        }
      })
      .catch(() => {
        // Keep existing UI; disconnect indicator will show via refresh-every component.
      })
      .finally(() => detailsRefreshApi?.requestCompleted(success));
  }, ms);
}

const SIMULATE_DEVICES_EMPTY_MESSAGE =
  "Please open or create a show to simulate extra devices.";

const SIMULATE_DEVICES_NOT_LIVE_MESSAGE =
  "Set this show live to Simulate Extra Connected Devices";

const LIVE_STATE_EVENT_NAME = "lumelier-live-state";
let simulateDevicesContainer: HTMLElement | null = null;
let simulateDevicesLiveStateListener: ((e: Event) => void) | null = null;

function cleanupSimulateDevices(): void {
  if (clockRafId != null) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
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
  clients = [];
  selectedId = null;
  selectedClientFull = null;
  lastRenderedDetailsSelectedId = undefined;
  lastRenderedDetailsClientFull = undefined;
  pageIndex = 0;
  gridContainer = null;
  detailsContainer = null;
  gridRefreshApi = null;
  detailsRefreshApi = null;
  secondaryToolbar = null;
  btnDelete = null;
  btnClone = null;
  paginationInfoEl = null;
  pagePrevBtn = null;
  pageNextBtn = null;
}

function showSimulateDevicesNotLiveMessage(container: HTMLElement): void {
  container.innerHTML = `
    <div class="show-required-empty-state">
      <p class="show-required-empty-state-message">${SIMULATE_DEVICES_NOT_LIVE_MESSAGE}</p>
    </div>`;
}

function renderSimulateDevicesFull(container: HTMLElement): void {
  cleanupSimulateDevices();

  container.innerHTML = `
    <div class="simulate-devices-page">
      <div class="simulate-devices-body">
        <div class="simulate-devices-client-array-panel" id="simulate-devices-grid-panel">
          <div class="simulate-devices-toolbar">
            <span id="simulate-devices-clock-error-wrap" class="simulate-devices-clock-error-wrap"></span>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-icon" id="simulate-devices-create">${openIcon}<span>Create Clients</span></button>
            <button type="button" class="devices-toolbar-btn devices-toolbar-btn-danger" id="simulate-devices-destroy">Destroy all Clients</button>
            <span class="simulate-devices-square-size-wrap">
              <label for="simulate-devices-square-size" class="simulate-devices-toolbar-label">Square size</label>
              <input type="range" id="simulate-devices-square-size" min="${SQUARE_SIZE_MIN}" max="${SQUARE_SIZE_MAX}" value="${squareSizePx}" />
              <span id="simulate-devices-square-size-value">${squareSizePx} px</span>
            </span>
            <button type="button" class="devices-toolbar-btn" id="simulate-devices-lag-overlay-toggle"><span id="simulate-devices-lag-overlay-toggle-label">Hide </span><span class="simulate-devices-lag-overlay-toggle-icon">${noSignalIcon}</span></button>
          </div>
          <div class="simulate-devices-toolbar-secondary" id="simulate-devices-toolbar-secondary" hidden>
            <button type="button" class="btn btn-danger" id="simulate-devices-delete">${trashIcon}<span>Delete Client</span></button>
            <button type="button" class="btn btn-icon-label" id="simulate-devices-clone">Clone Client</button>
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
        if (ms > 0) gridRefreshTimer = setInterval(() => runGridRefreshStatsOnly(), ms);
      },
      onManualRefresh: runGridRefreshFull,
    });
    toolbarEl.insertBefore(gridRefreshApi.root, toolbarEl.firstChild);
    const clockErrorWrap = document.getElementById("simulate-devices-clock-error-wrap");
    if (clockErrorWrap) clockErrorWrap.appendChild(createClockErrorWidget());
  }
  if (detailsRefreshWrapEl) {
    detailsRefreshApi = createRefreshEvery({
      name: "simulate-devices-details-refresh",
      defaultMs: 1000,
      responseTimeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
      disconnectTooltip: "The simulated client server is not responding to our requests.",
      infoTooltip: "Refreshing these values often can cause UI lag.",
      onIntervalChange(ms) {
        detailsRefreshIntervalMs = ms;
        if (detailsRefreshTimer) clearInterval(detailsRefreshTimer);
        detailsRefreshTimer = null;
        ensureDetailsRefreshTimer();
      },
    });
    detailsRefreshWrapEl.appendChild(detailsRefreshApi.root);
    // Sync module interval with component's initial value (from localStorage or default) so the details timer runs on load
    detailsRefreshIntervalMs = detailsRefreshApi.getIntervalMs();
  }
  if (gridPanelEl) observeGridPanel(gridPanelEl);
  const gridMs = gridRefreshApi?.getIntervalMs() ?? 1000;
  if (gridRefreshTimer) clearInterval(gridRefreshTimer);
  gridRefreshTimer = null;
  if (gridMs > 0) gridRefreshTimer = setInterval(runGridRefreshStatsOnly, gridMs);

  function tickClocks(): void {
    gridRefreshApi?.updateClockHand();
    detailsRefreshApi?.updateClockHand();
    clockRafId = requestAnimationFrame(tickClocks);
  }
  clockRafId = requestAnimationFrame(tickClocks);

  requestAnimationFrame(() => {
    refresh();
    runGridRefreshFull();
  });

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
    if (client == null || selectedId == null || !currentShowId) return;
    const { distKey, indices } = selectedAnchor;
    const curve = client[distKey];
    const indexSet = new Set(indices);
    const anchors = curve.anchors.filter((_, i) => !indexSet.has(i));
    e.preventDefault();
    patchClient(currentShowId, selectedId, { [distKey]: { anchors } }).then(() => {
      selectedClientFull = selectedClientFull
        ? { ...selectedClientFull, [distKey]: { anchors } }
        : null;
      selectedAnchor = null;
      refresh();
    });
  });

  document.getElementById("simulate-devices-create")?.addEventListener("click", () => {
    if (!currentShowId) return;
    showCreateClientsModal((newClients) => {
      postClients(currentShowId!, newClients)
        .then(() => runGridRefreshFull())
        .then(() => {
          if (selectedId != null && selectedClientFull == null && currentShowId) {
            getClient(currentShowId, selectedId).then((full) => {
              if (selectedId != null) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
        })
        .catch(() => runGridRefreshFull());
    });
  });

  document.getElementById("simulate-devices-destroy")?.addEventListener("click", () => {
    // Make UI immediately consistent (empty grid + no selection), even if refresh calls are in-flight.
    suppressAutoSelect = true;
    clients.length = 0;
    pageIndex = 0;
    selectedId = null;
    selectedClientFull = null;
    selectedAnchor = null;
    refresh();
    ensureDetailsRefreshTimer();

    if (currentShowId)
      deleteAllClients(currentShowId)
        .then(() => runGridRefreshFull())
        .catch(() => runGridRefreshFull());
  });

  btnDelete?.addEventListener("click", () => {
    if (selectedId == null || !currentShowId) return;
    const idToDelete = selectedId;
    apiDeleteClient(currentShowId, idToDelete)
      .then(() => {
        selectedId = null;
        selectedClientFull = null;
        runGridRefreshFull();
      })
      .catch(() => runGridRefreshFull());
  });

  btnClone?.addEventListener("click", () => {
    const sel = selectedClientFull;
    if (sel == null || !currentShowId) return;
    showCloneClientModal(sel, (newClients) => {
      postClients(currentShowId!, newClients)
        .then(() => runGridRefreshFull())
        .then(() => {
          const lastId = newClients[newClients.length - 1]?.id;
          if (lastId && clients.some((c) => c.id === lastId) && currentShowId) {
            selectedId = lastId;
            selectedClientFull = null;
            getClient(currentShowId, lastId).then((full) => {
              if (selectedId === lastId) {
                selectedClientFull = full;
                refresh();
              }
            });
          }
          refresh();
        })
        .catch(() => runGridRefreshFull());
    });
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
  const lagOverlayToggleBtn = document.getElementById("simulate-devices-lag-overlay-toggle");
  const lagOverlayToggleLabel = document.getElementById("simulate-devices-lag-overlay-toggle-label");
  lagOverlayToggleBtn?.addEventListener("click", () => {
    showLagOverlay = !showLagOverlay;
    if (lagOverlayToggleLabel) lagOverlayToggleLabel.textContent = showLagOverlay ? "Hide " : "Show ";
    updateGridLayoutAndRender();
  });

  pagePrevBtn?.addEventListener("click", () => {
    pageIndex--;
    refresh();
  });
  pageNextBtn?.addEventListener("click", () => {
    pageIndex++;
    refresh();
  });
}

export function render(container: HTMLElement, showId: string | null): void {
  currentShowId = showId;
  if (showId === null) {
    simulateDevicesContainer = null;
    if (simulateDevicesLiveStateListener) {
      window.removeEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);
      simulateDevicesLiveStateListener = null;
    }
    cleanupSimulateDevices();
    container.innerHTML = `
      <div class="show-required-empty-state">
        <p class="show-required-empty-state-message">${SIMULATE_DEVICES_EMPTY_MESSAGE}</p>
      </div>`;
    return;
  }
  simulateDevicesContainer = container;
  if (simulateDevicesLiveStateListener) {
    window.removeEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);
  }
  simulateDevicesLiveStateListener = (e: Event) => {
    const ev = e as CustomEvent<{ showId: string; live: boolean }>;
    if (ev.detail?.showId !== currentShowId || !simulateDevicesContainer) return;
    cleanupSimulateDevices();
    if (ev.detail.live) {
      renderSimulateDevicesFull(simulateDevicesContainer);
    } else {
      showSimulateDevicesNotLiveMessage(simulateDevicesContainer);
    }
  };
  window.addEventListener(LIVE_STATE_EVENT_NAME, simulateDevicesLiveStateListener);

  fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : { live: false }))
    .then((data: { live?: boolean }) => {
      if (currentShowId !== showId) return;
      if (!data.live) {
        showSimulateDevicesNotLiveMessage(container);
        return;
      }
      renderSimulateDevicesFull(container);
    })
    .catch(() => {
      if (currentShowId !== showId) return;
      showSimulateDevicesNotLiveMessage(container);
    });
}
