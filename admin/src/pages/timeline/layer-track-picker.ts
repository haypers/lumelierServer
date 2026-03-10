export interface LayerTrackPickerLayer {
  id: string;
  label: string;
}

export interface CreateLayerTrackPickerOptions {
  layers: LayerTrackPickerLayer[];
  value: string;
  onChange: (layerId: string) => void;
  ariaLabel?: string;
}

const FALLBACK_LAYERS: LayerTrackPickerLayer[] = [{ id: "1", label: "Track 1" }];

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Creates a layer/track picker: dropdown of layer names + 1-based number input, kept in sync.
 * If value is not in layers, calls onChange with the first valid id on init.
 * If layers is empty, uses a single synthetic option (id "1", label "Track 1").
 */
export function createLayerTrackPicker(options: CreateLayerTrackPickerOptions): HTMLElement {
  const { value, onChange, ariaLabel } = options;
  const layers = options.layers.length > 0 ? options.layers : FALLBACK_LAYERS;

  const wrapper = document.createElement("div");
  wrapper.className = "layer-track-picker";

  const select = document.createElement("select");
  select.className = "layer-track-picker__select";
  select.setAttribute("aria-label", ariaLabel ?? "Layer by name");
  layers.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = escapeAttr(l.id);
    opt.textContent = l.label;
    if (l.id === value) opt.selected = true;
    select.appendChild(opt);
  });

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.className = "layer-track-picker__num";
  numInput.min = "1";
  numInput.max = String(layers.length);
  numInput.step = "1";
  numInput.setAttribute("aria-label", "Layer index");
  const idx = layers.findIndex((l) => l.id === value) + 1 || 1;
  numInput.value = String(idx);

  wrapper.appendChild(select);
  wrapper.appendChild(numInput);

  // Normalize if value was not in layers
  const validIndex = layers.findIndex((l) => l.id === value);
  if (validIndex < 0) {
    const firstId = layers[0]?.id ?? "1";
    onChange(firstId);
  }

  function applyFromSelect(): void {
    const rawValue = select.value;
    const layer = layers.find((l) => escapeAttr(l.id) === rawValue);
    if (layer) {
      const i = layers.indexOf(layer) + 1;
      numInput.value = String(i);
      numInput.max = String(layers.length);
      onChange(layer.id);
    }
  }

  function applyFromNum(): void {
    const num = parseInt(numInput.value, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= layers.length) {
      const layer = layers[num - 1];
      if (layer) {
        select.value = escapeAttr(layer.id);
        onChange(layer.id);
      }
    }
  }

  select.addEventListener("change", applyFromSelect);
  numInput.addEventListener("change", applyFromNum);
  numInput.addEventListener("blur", applyFromNum);

  return wrapper;
}
