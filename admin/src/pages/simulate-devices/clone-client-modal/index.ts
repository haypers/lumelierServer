import "./styles.css";
import openIcon from "../../../icons/open.svg?raw";
import { openModal as openGlobalModal } from "../../../components/modal";
import type { SimulatedClient, SimulatedClientDistKey, DistributionCurve } from "../types";
import { DIST_KEYS_BY_PRESET_INDEX } from "../details-pane";
import { renderDistributionTablesEditor } from "../distribution-tables-editor";
import { generateClientFromProfile } from "../profile-generation";
import {
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE,
  SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL,
  REALISTIC_BAD_DEVICE_PROFILE,
  isReservedSystemPresetName,
} from "../system-presets";

const PROFILE_VALIDATION_TOOLTIP =
  "Every Distribution Table in the profile must have at least 1 point with a 0% chance of destruction.";

interface TimelineLayersResponse {
  layers?: { id: string; label: string }[];
}

function getCurveCopy(client: SimulatedClient, key: SimulatedClientDistKey): DistributionCurve {
  const cur = client[key];
  return cur && Array.isArray(cur.anchors)
    ? { anchors: cur.anchors.map((a) => ({ ...a })) }
    : { anchors: [] };
}

function hasZeroDestructionPointInAllCharts(curves: DistributionCurve[]): boolean {
  if (!curves || curves.length !== DIST_KEYS_BY_PRESET_INDEX.length) return false;
  return curves.every(
    (c) => c.anchors?.some((a) => (a.destructionChance ?? 0) === 0) ?? false
  );
}

export function showCloneClientModal(
  showId: string,
  sourceClient: SimulatedClient,
  onCreate: (newClients: SimulatedClient[]) => void
): void {
  const initialCurves: DistributionCurve[] = DIST_KEYS_BY_PRESET_INDEX.map((key) =>
    getCurveCopy(sourceClient, key)
  );

  const content = document.createElement("div");
  content.className = "clone-client-modal-content";

  const countRow = document.createElement("div");
  countRow.className = "clone-clients-row";
  countRow.innerHTML = `
    <label for="clone-modal-count">Number of clones to create:</label>
    <input type="number" id="clone-modal-count" min="1" value="1" />
  `;
  content.appendChild(countRow);

  const trackRow = document.createElement("div");
  trackRow.className = "clone-clients-row";
  trackRow.innerHTML = `
    <label for="clone-modal-track">Track to sync to:</label>
    <select id="clone-modal-track" aria-label="Track to sync to">
      <option value="">All layers</option>
    </select>
  `;
  content.appendChild(trackRow);

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

  let editorApi: ReturnType<typeof renderDistributionTablesEditor>;
  function updateCloneButtonsState(): void {
    /* Button state not applied; global modal footer buttons stay enabled. Validation on click. */
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

  async function handleSaveProfile(): Promise<void> {
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
  }

  function handleConfirmClone(modalClose: () => void): void {
    const countInput = content.querySelector("#clone-modal-count") as HTMLInputElement | null;
    const count = countInput != null ? parseInt(countInput.value.trim(), 10) : NaN;
    if (!Number.isInteger(count) || count < 1) {
      alert("Number of clones must be an integer ≥ 1.");
      return;
    }
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
    const trackSelect = content.querySelector("#clone-modal-track") as HTMLSelectElement | null;
    const trackVal = trackSelect?.value?.trim() ?? "";
    for (const c of newClients) c.trackId = trackVal || null;
    modalClose();
    onCreate(newClients);
  }

  const modalApi = openGlobalModal({
    size: "large",
    clickOutsideToClose: false,
    title: "Clone Client",
    content,
    cancel: {},
    actions: [
      { preset: "secondary", label: "Save Profile", onClick: handleSaveProfile },
      { preset: "primary", label: "Confirm Clone", onClick: () => handleConfirmClone(modalApi.close) },
    ],
    onClose: () => {
      document.removeEventListener("click", closeOnClickOutsideClone);
      editorApi.destroy();
    },
  });

  async function loadCloneTimelineLayers(): Promise<void> {
    const select = content.querySelector("#clone-modal-track") as HTMLSelectElement | null;
    if (!select) return;
    try {
      const res = await fetch(`/api/admin/show-workspaces/${encodeURIComponent(showId)}/timeline`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as TimelineLayersResponse;
      const layers = data?.layers ?? [];
      const currentVal = sourceClient.trackId ?? "";
      select.innerHTML = '<option value="">All layers</option>';
      for (const l of layers) {
        const opt = document.createElement("option");
        opt.value = l.id;
        opt.textContent = l.label;
        if (l.id === currentVal) opt.selected = true;
        select.appendChild(opt);
      }
      if (!currentVal || !layers.some((l) => l.id === currentVal)) select.value = "";
    } catch {
      select.value = "";
    }
  }

  void loadCloneTimelineLayers();
}
