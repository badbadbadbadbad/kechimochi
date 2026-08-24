/**
 * Generic Ctrl/⌘+wheel and (optional) two-finger pinch zoom accelerators for
 * any element. Caller-agnostic: it knows nothing about what "zoom" means to
 * its caller beyond the 'in' | 'out' direction it reports.
 */

export const WHEEL_ZOOM_STEP_THRESHOLD = 60;
export const PINCH_ZOOM_STEP_RATIO = 1.25;
const PINCH_POINTER_COUNT = 2;

export type ZoomDirection = 'in' | 'out';

// once-per-gesture reports at most one step until every finger lifts.
export type PinchMode = 'continuous' | 'once-per-gesture';

export interface ZoomGestureOptions {
    onZoom: (direction: ZoomDirection) => void;
    enablePinch?: boolean;
    pinchMode?: PinchMode;
}

interface PointerPosition {
    x: number;
    y: number;
}

function getPointerDistance(first: PointerPosition, second: PointerPosition): number {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function createWheelHandler(
    onZoom: (direction: ZoomDirection) => void,
    isPinchInProgress: () => boolean,
): (event: WheelEvent) => void {
    let accumulatedDeltaY = 0;

    return (event: WheelEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        if (isPinchInProgress()) return;

        if ((accumulatedDeltaY > 0) !== (event.deltaY > 0)) {
            accumulatedDeltaY = 0;
        }
        accumulatedDeltaY += event.deltaY;

        if (Math.abs(accumulatedDeltaY) < WHEEL_ZOOM_STEP_THRESHOLD) return;
        onZoom(event.deltaY > 0 ? 'out' : 'in');
        accumulatedDeltaY = 0;
    };
}

interface PinchHandlers {
    activePointerCount: () => number;
    handlePointerDown: (event: PointerEvent) => void;
    handlePointerMove: (event: PointerEvent) => void;
    handlePointerEnd: (event: PointerEvent) => void;
}

function createPinchHandlers(onZoom: (direction: ZoomDirection) => void, pinchMode: PinchMode): PinchHandlers {
    const activePointers = new Map<number, PointerPosition>();
    let startDistance: number | null = null;
    let hasSteppedThisGesture = false;

    const measurePointerSpread = (): number | null => {
        if (activePointers.size !== PINCH_POINTER_COUNT) return null;
        const [first, second] = Array.from(activePointers.values());
        return getPointerDistance(first, second);
    };

    const stepPinch = (direction: ZoomDirection, currentDistance: number) => {
        onZoom(direction);
        startDistance = currentDistance;
        hasSteppedThisGesture = true;
    };

    const evaluatePinch = () => {
        if (startDistance === null) return;
        if (pinchMode === 'once-per-gesture' && hasSteppedThisGesture) return;

        const currentDistance = measurePointerSpread();
        if (currentDistance === null) return;

        const ratio = currentDistance / startDistance;
        if (ratio >= PINCH_ZOOM_STEP_RATIO) {
            stepPinch('in', currentDistance);
        } else if (ratio <= 1 / PINCH_ZOOM_STEP_RATIO) {
            stepPinch('out', currentDistance);
        }
    };

    return {
        activePointerCount: () => activePointers.size,
        handlePointerDown: (event: PointerEvent) => {
            if (event.pointerType !== 'touch') return;
            activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            startDistance = measurePointerSpread();
        },
        handlePointerMove: (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !activePointers.has(event.pointerId)) return;
            activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            evaluatePinch();
        },
        handlePointerEnd: (event: PointerEvent) => {
            if (event.pointerType !== 'touch') return;
            activePointers.delete(event.pointerId);
            startDistance = null;
            hasSteppedThisGesture = false;
        },
    };
}

/**
 * Returns a detach function that removes every listener; callers
 * must invoke it before re-attaching and again in `destroy()`.
 */
export function attachZoomGestures(element: HTMLElement, options: ZoomGestureOptions): () => void {
    const { onZoom, enablePinch = false, pinchMode = 'continuous' } = options;
    const pinch = enablePinch ? createPinchHandlers(onZoom, pinchMode) : null;
    // Chrome reports a real two-finger pinch as a `wheel` event with `ctrlKey: true`,
    // so while two touch pointers are down, the wheel handler must stand down entirely.
    const handleWheel = createWheelHandler(onZoom, () => (pinch?.activePointerCount() ?? 0) === PINCH_POINTER_COUNT);

    element.addEventListener('wheel', handleWheel, { passive: false });
    if (pinch) {
        element.addEventListener('pointerdown', pinch.handlePointerDown);
        element.addEventListener('pointermove', pinch.handlePointerMove);
        element.addEventListener('pointerup', pinch.handlePointerEnd);
        element.addEventListener('pointercancel', pinch.handlePointerEnd);
    }

    return () => {
        element.removeEventListener('wheel', handleWheel);
        if (pinch) {
            element.removeEventListener('pointerdown', pinch.handlePointerDown);
            element.removeEventListener('pointermove', pinch.handlePointerMove);
            element.removeEventListener('pointerup', pinch.handlePointerEnd);
            element.removeEventListener('pointercancel', pinch.handlePointerEnd);
        }
    };
}