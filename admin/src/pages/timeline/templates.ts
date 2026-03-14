import type { TimelineStateJSON } from "./types";

const EVENT_TYPE_SET_COLOR_BROADCAST = "Set Color Broadcast";

export type TemplateType = "blank" | "rainbow" | "breathe" | "party";

/** Default state for "Create New Show": one layer, one event at 5s (no range). */
export function getDefaultNewShowState(): TimelineStateJSON {
  return {
    version: 1,
    title: "Untitled Show",
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items: [
      {
        id: "item-1",
        layerId: "layer-1",
        kind: "event",
        startSec: 5,
        label: "Event item-1",
        effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      },
    ],
    readheadSec: 0,
  };
}

/** Rainbow Cycle: uses 3 layers with different rainbow progressions over 60 seconds */
function getRainbowCycleTemplate(): TimelineStateJSON {
  const layers = [
    { id: "layer-1", label: "Primary Rainbow" },
    { id: "layer-2", label: "Secondary Colors" },
    { id: "layer-3", label: "Accent Colors" },
  ];

  const layer1Colors = [
    { hex: "#FF0000", name: "Red" },
    { hex: "#FF7F00", name: "Orange" },
    { hex: "#FFFF00", name: "Yellow" },
    { hex: "#00FF00", name: "Green" },
    { hex: "#0000FF", name: "Blue" },
    { hex: "#8B00FF", name: "Violet" },
  ];

  const layer2Colors = [
    { hex: "#00FFFF", name: "Cyan" },
    { hex: "#FF00FF", name: "Magenta" },
    { hex: "#7FFF00", name: "Chartreuse" },
    { hex: "#FF1493", name: "Deep Pink" },
    { hex: "#00CED1", name: "Turquoise" },
  ];

  const layer3Colors = [
    { hex: "#FFD700", name: "Gold" },
    { hex: "#FF69B4", name: "Hot Pink" },
    { hex: "#00FA9A", name: "Spring Green" },
    { hex: "#BA55D3", name: "Orchid" },
    { hex: "#FF4500", name: "Orange Red" },
    { hex: "#1E90FF", name: "Dodger Blue" },
  ];

  const items: TimelineStateJSON["items"] = [];
  let itemId = 1;

  for (let i = 0; i < 12; i++) {
    const color = layer1Colors[i % layer1Colors.length];
    items.push({
      id: `rainbow-1-${itemId++}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 5,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
    });
  }

  for (let i = 0; i < 10; i++) {
    const color = layer2Colors[i % layer2Colors.length];
    items.push({
      id: `rainbow-2-${itemId++}`,
      layerId: "layer-2",
      kind: "event",
      startSec: 1 + i * 6,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
    });
  }

  for (let i = 0; i < 15; i++) {
    const color = layer3Colors[i % layer3Colors.length];
    items.push({
      id: `rainbow-3-${itemId++}`,
      layerId: "layer-3",
      kind: "event",
      startSec: 2 + i * 4,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
    });
  }

  return {
    version: 1,
    title: "Rainbow Cycle",
    layers,
    items,
    readheadSec: 0,
  };
}

/** Breathe: gentle pulse between blue shades for a full minute */
function getBreatheTemplate(): TimelineStateJSON {
  const items: TimelineStateJSON["items"] = [];
  const colors = [
    { hex: "#001f3f", name: "Navy" },
    { hex: "#0047AB", name: "Cobalt" },
    { hex: "#4169E1", name: "Royal Blue" },
    { hex: "#87CEEB", name: "Sky Blue" },
    { hex: "#ADD8E6", name: "Light Blue" },
    { hex: "#87CEEB", name: "Sky Blue" },
    { hex: "#4169E1", name: "Royal Blue" },
    { hex: "#0047AB", name: "Cobalt" },
  ];

  for (let i = 0; i < 20; i++) {
    const color = colors[i % colors.length];
    items.push({
      id: `breathe-${i + 1}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 3,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
    });
  }

  return {
    version: 1,
    title: "Breathe",
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items,
    readheadSec: 0,
  };
}

/** Party Mode: energetic rapid color changes between vibrant colors */
function getPartyModeTemplate(): TimelineStateJSON {
  const items: TimelineStateJSON["items"] = [];
  const colors = [
    { hex: "#FF0000", name: "Red" },
    { hex: "#00FF00", name: "Green" },
    { hex: "#0000FF", name: "Blue" },
    { hex: "#FFFF00", name: "Yellow" },
  ];

  for (let i = 0; i < 20; i++) {
    const color = colors[i % colors.length];
    items.push({
      id: `party-${i + 1}`,
      layerId: "layer-1",
      kind: "event",
      startSec: i * 3,
      label: color.name,
      effectType: EVENT_TYPE_SET_COLOR_BROADCAST,
      color: color.hex,
    });
  }

  return {
    version: 1,
    title: "Party Mode",
    layers: [{ id: "layer-1", label: "Layer 1" }],
    items,
    readheadSec: 0,
  };
}

/** Get a template show state by type */
export function getTemplateState(templateType: TemplateType): TimelineStateJSON {
  switch (templateType) {
    case "rainbow":
      return getRainbowCycleTemplate();
    case "breathe":
      return getBreatheTemplate();
    case "party":
      return getPartyModeTemplate();
    case "blank":
    default:
      return getDefaultNewShowState();
  }
}

/** Load a template into an existing show by showId */
export async function applyTemplateToShow(showId: string, templateType: TemplateType): Promise<void> {
  const state = getTemplateState(templateType);
  await fetch(`/api/admin/show-workspaces/${showId}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(state),
  });
}
