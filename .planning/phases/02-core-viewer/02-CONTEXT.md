# Phase 2: Core Viewer - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers multi-plane slice rendering with navigation, window/level control, and correct anisotropic display. Users can view medical image volumes in a standard radiology 4-panel layout (axial, coronal, sagittal + blank) with fast slice scrolling and window/level adjustment. This phase builds on Phase 1's server data pipeline and volume browser.

</domain>

<decisions>
## Implementation Decisions

### Mouse Wheel Scrolling
- **D-01:** Mouse wheel scrolls through slices when hovering over a viewer panel. Wheel up = next slice, wheel down = previous slice. Standard radiology convention (matches ITK-SNAP and PACS viewers).
- **D-02:** Wheel scrolling synchronizes crosshairs in all three panels — same behavior as slider navigation. Changing Z via wheel on axial updates crosshair position in coronal and sagittal.
- **D-03:** Wheel events are trapped (preventDefault) over viewer panels to prevent page scrolling while navigating slices.

### Crosshair Interaction
- **D-04:** Crosshairs support click AND drag — mousedown starts crosshair tracking, mousemove continuously updates position across all three panels while button is held. Matches ITK-SNAP behavior for fluid anatomy exploration.
- **D-05:** Plain click/drag = crosshair navigation. Ctrl+drag = window/level adjustment. No modifier key needed for the primary crosshair tool.

### Volume Open Transition
- **D-06:** Sidebar stays visible at 280px when a volume is opened. Volume browser list is replaced by: volume name/metadata summary at top, W/L presets below. Sidebar remains persistent during viewing.
- **D-07:** A "← Back to volumes" button at the top of the sidebar allows the user to close the viewer and return to the volume browser list.
- **D-08:** A loading indicator (spinner or progress bar) is shown in the viewer area while the volume binary data is downloading. Volumes can be 100MB+, so feedback is essential.

### Anisotropic Rendering
- **D-09:** Non-square voxels are handled via CSS stretch to correct aspect ratio. Canvas renders at native voxel grid resolution, then CSS width/height is adjusted to reflect physical proportions using voxel spacing metadata. No data resampling. Standard approach matching ITK-SNAP.

### Claude's Discretion
- Window/level drag sensitivity tuning (UI-SPEC defines proportional to window width / 300 — implementation can adjust if testing reveals issues)
- Error handling approach for failed volume loads or render failures
- Exact loading indicator design (spinner vs progress bar vs skeleton)
- Canvas rendering pipeline internals (LUT vs direct computation for W/L mapping)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI Design Contract
- `.planning/phases/02-core-viewer/02-UI-SPEC.md` — Complete visual and interaction specification for the viewer. Covers layout, colors, typography, spacing, component inventory, interaction contracts, and accessibility baseline. This is the primary design reference.

### Technical Research
- `.planning/phases/02-core-viewer/02-RESEARCH.md` — Domain research for core viewer implementation including slice extraction, canvas rendering, and performance considerations.

### Validation Strategy
- `.planning/phases/02-core-viewer/02-VALIDATION.md` — Validation architecture and test strategy for Phase 2.

### Project Context
- `.planning/REQUIREMENTS.md` — Full requirements list. Phase 2 covers VIEW-01 through VIEW-07 and WLVL-01 through WLVL-04.
- `.planning/ROADMAP.md` — Phase dependencies and success criteria.
- `CLAUDE.md` — Project technology stack decisions (vanilla JS + Canvas 2D, FastAPI backend, no frameworks).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — no code exists yet. Phase 1 has not been executed.

### Established Patterns
- None yet. Phase 2 will establish the client-side rendering patterns (canvas management, state management, event handling).

### Integration Points
- Phase 1 will provide: volume browser sidebar (280px), app header (48px), REST API for volume metadata and binary data
- Phase 2 viewer grid fills remaining space after sidebar and header
- Volume open event from Phase 1's browser triggers Phase 2's viewer initialization

</code_context>

<specifics>
## Specific Ideas

- Crosshair behavior should feel like ITK-SNAP — fluid click+drag with instant synchronization across all three orthogonal views
- Mouse wheel is essential for radiologist workflow — they expect to "scroll through" a volume naturally
- Sidebar transition should feel like navigating deeper (browser → viewer) with a clear back path, not a mode switch

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-core-viewer*
*Context gathered: 2026-03-25*
