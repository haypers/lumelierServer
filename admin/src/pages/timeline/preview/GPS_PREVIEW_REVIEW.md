# Preview panel & GPS interface – review

## Summary

The preview panel (bottom-right of the timeline page) shows a grid or a map when "Use GPS" is on. The GPS flow lets users place a circle (center, radius, rotation) on the map for local effects. Below are **bugs**, **UI/UX issues**, and **backend notes** plus recommended fixes.

---

## Bugs

### 1. GPS toggle can overwrite server location (race)

**What happens:** Initial show-location is loaded with an async `GET`. If the user turns "Use GPS" **on before** that request finishes, the panel still has `showLocation === null`, so the toggle sends a PUT with `lat/lng/radiusMeters/angle: null`. That **overwrites** any existing location on the server.

**Fix:** Disable the GPS toggle until the initial GET has completed (e.g. a short “loading” state), or when building the PUT body for “turn GPS on”, first GET the current show-location and use that (or merge) instead of the in-memory `showLocation`.

### 2. New circle always sends `requestsGPS: false`

**What happens:** When the user places a **new** circle (no prior location), the code sets `showLocation = { ..., requestsGPS: false }`. On "Confirm Location", that object is sent to the server, so **`requestsGPS` is saved as `false`** even if the user had already turned "Use GPS" on. The toggle state is then out of sync with the server.

**Fix:** When creating the payload (new circle or confirm), use the **current** `requestsGPS` value (e.g. from the parent panel), not a hardcoded `false`. For example, pass a getter like `getRequestsGPS?: () => boolean` into the venue-map features and use it when building the PUT body.

---

## UI / UX

### 3. Overlays only on hover

Search and bottom-left controls (Edit Show Location, Map Clients) use `opacity: 0` and `pointer-events: none` until the user hovers the map. That can feel “janky” because:

- New users may not discover the controls.
- On touch devices, hover is unreliable.

**Suggestion:** Keep the controls visible when "Edit Show Location" is active; consider making the search bar or primary actions always visible (e.g. low opacity) or add a small “show controls” affordance.

### 4. Escape only exits edit when there’s no location

**What happens:** In edit mode, Escape closes search and Map Clients dropdown and exits edit mode **only if** `!showLocation`. If there is already a circle, Escape does nothing.

**Suggestion:** Let Escape always exit edit mode (and optionally revert to last saved state by re-fetching show-location).

### 5. No feedback while saving location

**What happens:** After "Confirm Location", a PUT runs but the Edit button is not disabled. The user can click Edit again and change the circle while the request is in flight, which can be confusing.

**Suggestion:** Disable the Edit button (or show a loading state) until the PUT completes.

### 6. Map view jumps on load

**What happens:** When show-location is loaded from the server, `drawCircleState(true)` is called, which calls `centerOnCircle()` and fits the view to the circle. If the user had already panned/zoomed, that view is replaced.

**Suggestion:** Either only fit bounds on first load when no prior view is set, or offer a “Center on venue” action (you already have the crosshair button) and avoid auto-fitting when the user has interacted with the map.

### 7. Small hit target for handle

The rotation/radius handle is a 24×24px draggable marker. On touch or small preview panes it can be hard to grab.

**Suggestion:** Slightly larger hit area (e.g. 32×32) or padding via CSS without changing the visual size.

### 8. Typo in tooltips

In `venue-map-features.ts`, `MAP_CLIENTS_TOOLTIP` uses "opperation" twice; should be "operation".

---

## Backend

### 9. Validation

- **Lat/lng:** Backend correctly restricts lat to [-90, 90] and lng to [-180, 180]; radius must be > 0 when set. Good.
- **Angle:** Any finite value is accepted. Frontend uses 0–360° (bearing). Normalizing angle to e.g. [0, 360) or [-180, 180] on save would keep data consistent; optional.

### 10. GET 404

If `ShowLocation.json` is missing, GET returns 404. The frontend treats non-ok as “keep defaults” and doesn’t show a specific error. Acceptable; optional improvement: create `ShowLocation.json` when a show is created (you may already do this) so GET rarely 404s.

### 11. Legacy “unset” sentinel

Frontend treats `lat === 0 && lng === 0 && radiusMeters === 100 && angle === 0` as “no location”. Backend doesn’t treat this specially. Fine; just keep frontend and backend in sync on this convention.

---

## Other

### 12. Document listeners never removed

`venue-map-features` adds `document` listeners for `keydown` (Escape) and `click` (close search). If the preview panel is ever torn down (e.g. tab content recreated or show changed), these listeners are not removed.

**Suggestion:** Either ensure the preview panel is long-lived, or add a cleanup/teardown that removes these listeners (e.g. return a cleanup function or use an AbortController).

### 13. `onShowLocationUpdated` not passed from timeline page

The timeline page calls `renderPreviewPanel(el, showId, { onShowSyncing, onShowSaved })` and does **not** pass `onShowLocationUpdated`. So when the user confirms a location from the map, the preview’s internal state is updated via the callback passed into `initPreviewMapVenueFeatures`, but no parent-level handler runs. If you later need the timeline page to react to “location saved” (e.g. enable/disable something), pass `onShowLocationUpdated` from the timeline page.

---

## Priority

- **High:** Fix bugs 1 and 2 (race on toggle, `requestsGPS` overwrite).
- **Medium:** Escape exits edit mode (4), save feedback (5), typos (8).
- **Low:** Overlay visibility (3), map fit (6), handle size (7), angle normalization (9), listener cleanup (12), `onShowLocationUpdated` (13).
