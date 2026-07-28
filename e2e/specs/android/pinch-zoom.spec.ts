import { waitForAppReady } from '../../helpers/setup.js';
import {
  getTimelineZoomLevel,
  openTimeline,
  setTimelineZoomLevel,
  waitForTimelineReady,
} from '../../helpers/timeline.js';
import { PINCH_ZOOM_STEP_RATIO } from '../../../src/zoom_gestures';

const TIMELINE_ROOT_SELECTOR = '#timeline-root';

const PINCH_START_DISTANCE = 100;
// Comfortably past PINCH_ZOOM_STEP_RATIO so rounding cannot land short of the threshold.
const PINCH_BOUNDARY_MARGIN = 1.2;
const PINCH_SPREAD_DISTANCE = PINCH_START_DISTANCE * PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN;
const PINCH_SQUEEZE_DISTANCE = PINCH_START_DISTANCE / (PINCH_ZOOM_STEP_RATIO * PINCH_BOUNDARY_MARGIN);

async function dispatchTouchPointer(
  rootSelector: string,
  type: string,
  pointerId: number,
  x: number,
  y: number,
): Promise<void> {
  const root = await $(rootSelector);
  await browser.execute((el, eventType, id, clientX, clientY) => {
    (el as HTMLElement).dispatchEvent(new PointerEvent(eventType, {
      pointerId: id,
      pointerType: 'touch',
      clientX,
      clientY,
      bubbles: true,
    }));
  }, root, type, pointerId, x, y);
}

// One full down -> move -> up cycle with two pointers. pinchMode is
// 'once-per-gesture' on the timeline, so this produces at most one level change.
async function pinchTo(rootSelector: string, distance: number): Promise<void> {
  await dispatchTouchPointer(rootSelector, 'pointerdown', 1, 0, 0);
  await dispatchTouchPointer(rootSelector, 'pointerdown', 2, PINCH_START_DISTANCE, 0);
  await dispatchTouchPointer(rootSelector, 'pointermove', 2, distance, 0);
  await dispatchTouchPointer(rootSelector, 'pointerup', 1, 0, 0);
  await dispatchTouchPointer(rootSelector, 'pointerup', 2, distance, 0);
}

describe('Android: pinch zoom', () => {
  describe('timeline', () => {
    before(async () => {
      await waitForAppReady();
      await openTimeline();
    });

    beforeEach(async () => {
      await setTimelineZoomLevel('detailed');
    });

    it('should zoom in one level on a spreading two-finger pinch', async () => {
      await setTimelineZoomLevel('compact');

      await pinchTo(TIMELINE_ROOT_SELECTOR, PINCH_SPREAD_DISTANCE);
      await waitForTimelineReady();

      expect(await getTimelineZoomLevel()).toBe('detailed');
    });

    it('should zoom out one level on a squeezing two-finger pinch', async () => {
      await pinchTo(TIMELINE_ROOT_SELECTOR, PINCH_SQUEEZE_DISTANCE);
      await waitForTimelineReady();

      expect(await getTimelineZoomLevel()).toBe('compact');
    });

    it('should require a separate pinch gesture per level, not one continuous stretch', async () => {
      await setTimelineZoomLevel('year');

      await pinchTo(TIMELINE_ROOT_SELECTOR, PINCH_SPREAD_DISTANCE);
      await waitForTimelineReady();
      expect(await getTimelineZoomLevel()).toBe('month');

      await pinchTo(TIMELINE_ROOT_SELECTOR, PINCH_SPREAD_DISTANCE);
      await waitForTimelineReady();
      expect(await getTimelineZoomLevel()).toBe('compact');
    });
  });
});