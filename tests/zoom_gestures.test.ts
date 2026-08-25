import { describe, expect, it, vi } from 'vitest';

import {
    attachZoomGestures,
    PINCH_ZOOM_STEP_RATIO,
    WHEEL_ZOOM_STEP_THRESHOLD,
} from '../src/zoom_gestures';

function dispatchWheel(element: HTMLElement, deltaY: number, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}): WheelEvent {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
    // happy-dom's WheelEvent drops ctrlKey/metaKey from its init dict (they read back
    // as undefined), so the modifiers have to be planted on the constructed event.
    Object.defineProperty(event, 'ctrlKey', { value: modifiers.ctrlKey ?? false, configurable: true });
    Object.defineProperty(event, 'metaKey', { value: modifiers.metaKey ?? false, configurable: true });
    element.dispatchEvent(event);
    return event;
}

function dispatchPointer(element: HTMLElement, type: string, pointerId: number, x: number, y: number, pointerType = 'touch'): void {
    element.dispatchEvent(new PointerEvent(type, {
        pointerId,
        pointerType,
        clientX: x,
        clientY: y,
        bubbles: true,
    }));
}

const PINCH_BOUNDARY_MARGIN = 1.2;
const PINCH_START_DISTANCE = 100;
const PINCH_SPREAD_DISTANCE = PINCH_START_DISTANCE * PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN;
const PINCH_SQUEEZE_DISTANCE = PINCH_START_DISTANCE / (PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN);

function startTwoFingerPinch(element: HTMLElement): void {
    dispatchPointer(element, 'pointerdown', 1, 0, 0);
    dispatchPointer(element, 'pointerdown', 2, PINCH_START_DISTANCE, 0);
}

function movePinchTo(element: HTMLElement, distance: number): void {
    dispatchPointer(element, 'pointermove', 2, distance, 0);
}

describe('zoom_gestures.ts', () => {
    describe('wheel zoom', () => {
        it('should report a direction and prevent the default page zoom on ctrl+wheel', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom });

            const event = dispatchWheel(element, WHEEL_ZOOM_STEP_THRESHOLD, { ctrlKey: true });

            expect(onZoom).toHaveBeenCalledWith('out');
            expect(event.defaultPrevented).toBe(true);
        });

        it('should report "in" for an upward ctrl+wheel', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom });

            dispatchWheel(element, -WHEEL_ZOOM_STEP_THRESHOLD, { metaKey: true });

            expect(onZoom).toHaveBeenCalledWith('in');
        });

        it('should ignore a plain wheel event without ctrl or meta', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom });

            const event = dispatchWheel(element, WHEEL_ZOOM_STEP_THRESHOLD);

            expect(onZoom).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        it('should accumulate small deltas and fire only once the threshold is crossed', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom });
            const partialDelta = WHEEL_ZOOM_STEP_THRESHOLD / 3;

            dispatchWheel(element, partialDelta, { ctrlKey: true });
            dispatchWheel(element, partialDelta, { ctrlKey: true });
            expect(onZoom).not.toHaveBeenCalled();

            dispatchWheel(element, partialDelta, { ctrlKey: true });
            expect(onZoom).toHaveBeenCalledTimes(1);
            expect(onZoom).toHaveBeenCalledWith('out');
        });

        it('should reset the accumulator on a direction change instead of skipping levels', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom });
            const almostThreshold = WHEEL_ZOOM_STEP_THRESHOLD - 1;

            dispatchWheel(element, almostThreshold, { ctrlKey: true });
            dispatchWheel(element, -almostThreshold, { ctrlKey: true });
            expect(onZoom).not.toHaveBeenCalled();

            dispatchWheel(element, -almostThreshold, { ctrlKey: true });
            expect(onZoom).toHaveBeenCalledTimes(1);
            expect(onZoom).toHaveBeenCalledWith('in');
        });
    });

    describe('pinch zoom', () => {
        it('should report "in" once the pointer spread grows past the step ratio', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);

            expect(onZoom).toHaveBeenCalledWith('in');
        });

        it('should report "out" once the pointer spread shrinks past the inverse step ratio', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SQUEEZE_DISTANCE);

            expect(onZoom).toHaveBeenCalledWith('out');
        });

        it('should ignore non-touch pointers', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            dispatchPointer(element, 'pointerdown', 1, 0, 0, 'mouse');
            dispatchPointer(element, 'pointerdown', 2, PINCH_START_DISTANCE, 0, 'mouse');
            dispatchPointer(element, 'pointermove', 2, PINCH_SPREAD_DISTANCE, 0, 'mouse');

            expect(onZoom).not.toHaveBeenCalled();
        });

        it('should suppress ctrl+wheel while two touch pointers are down', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            startTwoFingerPinch(element);
            const event = dispatchWheel(element, WHEEL_ZOOM_STEP_THRESHOLD, { ctrlKey: true });

            expect(onZoom).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(true);
        });

        it('should resume handling wheel events once a pointer lifts back to one', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            startTwoFingerPinch(element);
            dispatchPointer(element, 'pointerup', 2, PINCH_START_DISTANCE, 0);

            dispatchWheel(element, WHEEL_ZOOM_STEP_THRESHOLD, { ctrlKey: true });

            expect(onZoom).toHaveBeenCalledWith('out');
        });
    });

    describe('pinch mode', () => {
        it('should keep stepping through a single gesture by default', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true });

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);
            movePinchTo(element, PINCH_SPREAD_DISTANCE * PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN);

            expect(onZoom).toHaveBeenCalledTimes(2);
        });

        it('should report at most one step per gesture when set to once-per-gesture', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true, pinchMode: 'once-per-gesture' });

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);
            movePinchTo(element, PINCH_SPREAD_DISTANCE * PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN);

            expect(onZoom).toHaveBeenCalledTimes(1);
        });

        it('should allow another step once the fingers lift and pinch again', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            attachZoomGestures(element, { onZoom, enablePinch: true, pinchMode: 'once-per-gesture' });

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);
            dispatchPointer(element, 'pointerup', 1, 0, 0);
            dispatchPointer(element, 'pointerup', 2, PINCH_SPREAD_DISTANCE, 0);

            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);

            expect(onZoom).toHaveBeenCalledTimes(2);
        });
    });

    describe('detach', () => {
        it('should remove every listener so no further zoom events fire', () => {
            const element = document.createElement('div');
            const onZoom = vi.fn();
            const detach = attachZoomGestures(element, { onZoom, enablePinch: true });

            detach();

            dispatchWheel(element, WHEEL_ZOOM_STEP_THRESHOLD, { ctrlKey: true });
            startTwoFingerPinch(element);
            movePinchTo(element, PINCH_SPREAD_DISTANCE);

            expect(onZoom).not.toHaveBeenCalled();
        });
    });
});