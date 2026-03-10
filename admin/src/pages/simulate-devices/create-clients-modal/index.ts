import "./styles.css";
import openIcon from "../../../icons/open.svg?raw";
import { openModal as openGlobalModal } from "../../../components/modal";
import type { SimulatedClient, SimulatedClientDistKey, DistributionCurve } from "../types";
import { DISTRIBUTION_CHART_PRESETS, DIST_KEYS_BY_PRESET_INDEX } from "../details-pane";
import { renderDistributionTablesEditor } from "../distribution-tables-editor";
import { createClientWithRandomCurves } from "../client-store";
import { generateClientFromProfile } from "../profile-generation";
import {
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE,
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL,
  REALISTIC_BAD_DEVICE_PROFILE,
} from "../system-presets";

const MIN_CURVE_POINTS = 1;
const MAX_CURVE_POINTS = 100;
const DEFAULT_MAX_CURVE_POINTS = 10;

const PROFILE_VALIDATION_TOOLTIP =
  "Every Distribution Table in the profile must have at least 1 point with a 0% chance of destruction.";

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** True iff every curve has at least one anchor with destructionChance 0 (or undefined). */
function hasZeroDestructionPointInAllCharts(curves: DistributionCurve[]): boolean {
  if (!curves || curves.length !== DIST_KEYS_BY_PRESET_INDEX.length) return false;
  return curves.every(
    (c) => c.anchors?.some((a) => (a.destructionChance ?? 0) === 0) ?? false
  );
}

export function showCreateClientsModal(
  _showId: string,
  onCreate: (newClients: SimulatedClient[]) => void
): void {
  let generateFromProfile = true;
  let editorApi: ReturnType<typeof renderDistributionTablesEditor> | null = null;
  const emptyCurves: DistributionCurve[] = DIST_KEYS_BY_PRESET_INDEX.map(() => ({ anchors: [] }));

  const content = document.createElement("div");
  content.className = "clone-client-modal-content";

  const countRow = document.createElement("div");
  countRow.className = "create-modal-count-row";
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

  // Track assignment is now done by the main server on first poll; UI to set track when creating clients will be restored later.
  // const trackRow = document.createElement("div");
  // trackRow.className = "create-clients-row";
  // trackRow.innerHTML = `...Track to sync to dropdown...`;
  // content.appendChild(trackRow);

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

  function getFooterButtons(): [HTMLButtonElement | null, HTMLButtonElement | null] {
    const panel = content.closest(".global-modal-panel");
    const rightBtns = panel?.querySelectorAll(".global-modal-footer-right button");
    if (!rightBtns || rightBtns.length < 2) return [null, null];
    return [rightBtns[0] as HTMLButtonElement, rightBtns[1] as HTMLButtonElement];
  }

  function updateCreateButtonState(): void {
    const [, createBtn] = getFooterButtons();
    const saveProfileBtn = getFooterButtons()[0];
    if (!createBtn || !saveProfileBtn) return;
    if (!generateFromProfile) {
      createBtn.disabled = false;
      saveProfileBtn.disabled = false;
      return;
    }
    if (!editorApi) {
      createBtn.disabled = true;
      saveProfileBtn.disabled = true;
      return;
    }
    const curves = editorApi.getCurves();
    const valid = hasZeroDestructionPointInAllCharts(curves);
    createBtn.disabled = !valid;
    saveProfileBtn.disabled = !valid;
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
    const saveProfileBtn = getFooterButtons()[0];
    if (saveProfileBtn) saveProfileBtn.hidden = !useProfile;
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

  const closeRef = { current: (): void => {} };

  async function handleSaveProfile(): Promise<void> {
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
  }

  function handleCreate(close: () => void): void {
    const countInput = content.querySelector("#create-modal-count") as HTMLInputElement | null;
    const count = countInput != null ? parseInt(countInput.value.trim(), 10) : NaN;
    if (!Number.isInteger(count) || count < 1) {
      alert("New Client Count must be an integer ≥ 1.");
      return;
    }
    if (generateFromProfile) {
      if (!editorApi) return;
      const curves = editorApi.getCurves();
      if (!hasZeroDestructionPointInAllCharts(curves)) {
        alert(PROFILE_VALIDATION_TOOLTIP);
        return;
      }
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
      // Track set by main server on first poll; restore UI later.
      // const trackSelect = content.querySelector("#create-modal-track") as HTMLSelectElement | null;
      // const trackVal = trackSelect?.value?.trim() ?? "";
      // for (const c of newClients) c.lastAssignedTrackIndex = trackVal ? parseInt(trackVal, 10) : null;
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
      // Track set by main server on first poll; restore UI later.
      // const trackSelect = content.querySelector("#create-modal-track") as HTMLSelectElement | null;
      // const trackVal = trackSelect?.value?.trim() ?? "";
      // for (const c of newClients) c.lastAssignedTrackIndex = trackVal ? parseInt(trackVal, 10) : null;
      close();
      onCreate(newClients);
    }
  }

  const modalApi = openGlobalModal({
    size: "large",
    clickOutsideToClose: false,
    title: "Create Clients",
    info: "Normally you'll want to generate clients from a profile. Profiles define ranges that distribution table points can be placed in. Chaos clients are built by placing a random number of points in the distribution table at random.",
    content,
    cancel: {},
    actions: [
      { preset: "secondary", label: "Save Profile", onClick: handleSaveProfile },
      { preset: "primary", label: "Create", onClick: () => handleCreate(closeRef.current) },
    ],
    onClose: () => {
      document.removeEventListener("click", closeOnClickOutside);
      if (editorApi) {
        editorApi.destroy();
        editorApi = null;
      }
    },
  });
  closeRef.current = modalApi.close;

  // Track dropdown hidden; restore loadTimelineLayers() when we add UI to set track on create.
  loadProfileList();
  setMode(true);
}
