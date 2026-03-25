# Phase 2: Core Viewer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 02-core-viewer
**Areas discussed:** Mouse wheel scrolling, Crosshair drag behavior, Volume open transition, Anisotropic rendering

---

## Mouse Wheel Scrolling

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, wheel scrolls slices (Recommended) | Standard radiology behavior. Wheel up/down steps through slices on the hovered panel. | ✓ |
| Slider only | No wheel interaction. Users navigate slices exclusively via the vertical slider. | |
| You decide | Claude's discretion on whether to include wheel scrolling. | |

**User's choice:** Yes, wheel scrolls slices (Recommended)
**Notes:** None

### Follow-up: Crosshair sync on wheel

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, sync crosshairs on wheel scroll | Wheel scrolling updates crosshair position in all three panels. | ✓ |
| No, wheel only changes local slice | Only affects hovered panel. | |
| You decide | Claude's discretion. | |

**User's choice:** Yes, sync crosshairs on wheel scroll
**Notes:** None

### Follow-up: Scroll trapping

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, trap wheel over viewer (Recommended) | preventDefault on wheel events over canvas. | ✓ |
| You decide | Claude's discretion. | |

**User's choice:** Yes, trap wheel over viewer (Recommended)
**Notes:** None

---

## Crosshair Drag Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Click + drag (Recommended) | Mousedown starts crosshair tracking, mousemove continuously updates. Standard ITK-SNAP behavior. | ✓ |
| Click only | Each click repositions. No continuous tracking during drag. | |
| You decide | Claude's discretion. | |

**User's choice:** Click + drag (Recommended)
**Notes:** None

### Follow-up: Drag conflict with W/L

| Option | Description | Selected |
|--------|-------------|----------|
| Plain click/drag = crosshair, Ctrl+drag = W/L (Recommended) | Default mouse = crosshairs. Ctrl modifier switches to window/level. Matches ITK-SNAP. | ✓ |
| You decide | Claude's discretion. | |

**User's choice:** Plain click/drag = crosshair, Ctrl+drag = W/L (Recommended)
**Notes:** None

---

## Volume Open Transition

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar stays, shows volume info + W/L | Volume browser replaced by volume metadata + W/L presets. Sidebar stays at 280px. | ✓ |
| Sidebar collapses, full-width viewer | Sidebar hides entirely. Viewer takes full width. | |
| You decide | Claude's discretion. | |

**User's choice:** Sidebar stays, shows volume info + W/L
**Notes:** None

### Follow-up: Close volume mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Back button at top of sidebar (Recommended) | A "← Back to volumes" button at the top of the sidebar. | ✓ |
| Close button on header bar | An X or "Close Volume" button in the app header. | |
| You decide | Claude's discretion. | |

**User's choice:** Back button at top of sidebar (Recommended)
**Notes:** None

### Follow-up: Loading indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, progress bar or spinner (Recommended) | Show loading indicator in viewer area while ArrayBuffer downloads. | ✓ |
| Just show the viewer when ready | No intermediate loading state. | |
| You decide | Claude's discretion. | |

**User's choice:** Yes, progress bar or spinner (Recommended)
**Notes:** None

---

## Anisotropic Rendering

| Option | Description | Selected |
|--------|-------------|----------|
| CSS stretch to correct aspect ratio (Recommended) | Canvas renders at native voxel grid, CSS stretches to correct proportions. Standard approach. | ✓ |
| Resample data to isotropic | Resample volume on load. Costs memory and time. | |
| You decide | Claude's discretion. | |

**User's choice:** CSS stretch to correct aspect ratio (Recommended)
**Notes:** None

---

## Claude's Discretion

- Window/level drag sensitivity tuning
- Error handling approach for failed loads/renders
- Loading indicator design (spinner vs progress bar)
- Canvas rendering pipeline internals (LUT vs direct computation)

## Deferred Ideas

None — discussion stayed within phase scope
