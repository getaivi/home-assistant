// Pointer handling for the segments editor's hit layer: one overlay owns
// every pointer event over the bar. A press resolves the nearest seam from
// the shared geometry (never from which element caught it). Within
// tolerance a seam takes the roving focus, and an unlocked one is grabbed:
// the grab becomes a drag once the pointer moves past the slop. A press
// that never moves that far is a tap on the capsule under it, wherever it
// landed, so a phase narrower than the grab zone can still be selected. A
// drag runs against a frame frozen at pointerdown, renders a float draft,
// and commits once, on release; Escape (cancel) drops it uncommitted.

import {
  type BarMetrics,
  capsuleAt,
  nearestSeam,
  seamThreshold,
  seamTolerance,
} from "./seam-geometry";
import { boundariesOf, moveBoundaryDraft } from "./segments";
import type { SegmentBinding } from "./types/bindings";

/** How far a press may wander and still read as a capsule tap, px; past
 * it a grabbed seam starts to move. A finger wanders more than a cursor. */
function tapSlop(pointerType: string | undefined): number {
  return pointerType === "touch" || pointerType === "pen" ? 8 : 4;
}

/** What the drag needs from the editor hosting the bar. */
interface SeamDragHost {
  list(): SegmentBinding[];
  /** The display fractions the bar renders for `list`. */
  fracs(list: SegmentBinding[]): number[];
  /** The bar's measured frame, or null when there is none. */
  metrics(list: SegmentBinding[]): BarMetrics | null;
  /** Whether a seam follows a live source (it never drags). */
  locked(list: SegmentBinding[], seam: number): boolean;
  focusSeam(seam: number): void;
  /** A drag ended: move the seam to `threshold` within the frame's
   * `fracs`. */
  dropSeam(seam: number, threshold: number, fracs: number[]): void;
  tapCapsule(capsule: number): void;
  requestUpdate(): void;
}

interface Drag {
  seam: number;
  metrics: BarMetrics;
  fracs: number[];
  /** Where the press landed, and the capsule under it. */
  x: number;
  capsule: number;
  /** Null until the pointer has moved past the slop: a grab, not yet a
   * drag. */
  threshold: number | null;
}

export class SeamDrag {
  private readonly _host: SeamDragHost;
  private _drag: Drag | null = null;
  private _draft: number[] | null = null;
  private _tap: { x: number; capsule: number } | null = null;

  constructor(host: SeamDragHost) {
    this._host = host;
  }

  /** The seam being grabbed or dragged, or null. */
  get seam(): number | null {
    return this._drag?.seam ?? null;
  }

  /** Unquantized fractions to render mid-drag; null outside a drag. */
  get draft(): number[] | null {
    return this._draft;
  }

  down(e: PointerEvent): void {
    const host = this._host;
    const list = host.list();
    const metrics = host.metrics(list);
    if (!metrics) return;
    const fracs = host.fracs(list);
    const bounds = boundariesOf(list, fracs);
    const near = nearestSeam(bounds, metrics, e.clientX);
    const press = { x: e.clientX, capsule: capsuleAt(bounds, metrics, e.clientX) };
    if (!near || near.distance > seamTolerance(e.pointerType)) {
      this._tap = press;
      return;
    }
    host.focusSeam(near.seam);
    // The overlay is not focusable: left to its default, the press would
    // take the focus straight back off the handle.
    e.preventDefault();
    host.requestUpdate();
    if (host.locked(list, near.seam)) {
      // A locked seam never drags, but its press still taps the phase.
      this._tap = press;
      return;
    }
    // The guard tolerates synthetic MouseEvents in the test harness.
    if (e.pointerId !== undefined)
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this._drag = { seam: near.seam, metrics, fracs, ...press, threshold: null };
  }

  /** Renders the draft in the frozen frame (no commit, no re-measure, so
   * nothing feeds back mid-drag); otherwise updates the hover cursor. */
  move(e: PointerEvent): void {
    const drag = this._drag;
    if (!drag) {
      this._cursor(e);
      return;
    }
    // Still within the slop: a grab that may yet turn out to be a tap.
    if (drag.threshold === null && Math.abs(e.clientX - drag.x) <= tapSlop(e.pointerType)) return;
    const threshold = seamThreshold(drag.metrics, drag.seam, e.clientX);
    if (threshold === null) return;
    drag.threshold = threshold;
    this._draft = moveBoundaryDraft(drag.fracs, drag.seam, threshold);
    this._host.requestUpdate();
  }

  /** A drag commits exactly once; a still press selects its capsule,
   * whether or not it grabbed a seam on the way down. */
  up(e: PointerEvent): void {
    const drag = this._drag;
    const tap = this._tap;
    this._tap = null;
    if (drag) {
      this._drag = null;
      this._draft = null;
      if (drag.threshold === null) {
        this._host.tapCapsule(drag.capsule);
        this._host.requestUpdate();
      } else this._host.dropSeam(drag.seam, drag.threshold, drag.fracs);
      return;
    }
    if (tap && Math.abs(e.clientX - tap.x) <= tapSlop(e.pointerType))
      this._host.tapCapsule(tap.capsule);
  }

  /** Drops the press without committing or selecting anything: the
   * browser took the pointer, or the user pressed Escape mid-drag. */
  cancel(): void {
    this._drag = null;
    this._draft = null;
    this._tap = null;
    this._host.requestUpdate();
  }

  private _cursor(e: PointerEvent): void {
    const host = this._host;
    const list = host.list();
    const metrics = host.metrics(list);
    if (!metrics) return;
    const near = nearestSeam(boundariesOf(list, host.fracs(list)), metrics, e.clientX);
    const grabs =
      !!near && near.distance <= seamTolerance(e.pointerType) && !host.locked(list, near.seam);
    (e.currentTarget as HTMLElement).style.cursor = grabs ? "col-resize" : "pointer";
  }
}
