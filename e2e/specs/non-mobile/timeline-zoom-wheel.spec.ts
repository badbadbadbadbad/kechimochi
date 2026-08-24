import { waitForAppReady } from '../../helpers/setup.js';
import { getTimelineZoomLevel, openTimeline, setTimelineZoomLevel, waitForTimelineReady } from '../../helpers/timeline.js';
import { WHEEL_ZOOM_STEP_THRESHOLD } from '../../../src/zoom_gestures';

async function dispatchTimelineWheel(deltaY: number, ctrlKey: boolean): Promise<void> {
  const root = await $('#timeline-root');
  await browser.execute((el, wheelDeltaY, wheelCtrlKey) => {
    (el as HTMLElement).dispatchEvent(new WheelEvent('wheel', {
      deltaY: wheelDeltaY,
      ctrlKey: wheelCtrlKey,
      bubbles: true,
      cancelable: true,
    }));
  }, root, deltaY, ctrlKey);
}

describe('Desktop/Web: Timeline zoom via ctrl+wheel', () => {
  before(async () => {
    await waitForAppReady();
  });

  beforeEach(async () => {
    await openTimeline();
    await setTimelineZoomLevel('detailed');
  });

  it('should zoom out one level on a ctrl+wheel down past the threshold', async () => {
    await dispatchTimelineWheel(WHEEL_ZOOM_STEP_THRESHOLD, true);
    await waitForTimelineReady();

    expect(await getTimelineZoomLevel()).toBe('compact');
  });

  it('should zoom back in one level on a ctrl+wheel up past the threshold', async () => {
    await setTimelineZoomLevel('compact');

    await dispatchTimelineWheel(-WHEEL_ZOOM_STEP_THRESHOLD, true);
    await waitForTimelineReady();

    expect(await getTimelineZoomLevel()).toBe('detailed');
  });

  it('should not change the zoom level on a plain wheel event without ctrl', async () => {
    await dispatchTimelineWheel(WHEEL_ZOOM_STEP_THRESHOLD, false);
    expect(await getTimelineZoomLevel()).toBe('detailed');

    await dispatchTimelineWheel(WHEEL_ZOOM_STEP_THRESHOLD, true);
    await waitForTimelineReady();

    expect(await getTimelineZoomLevel()).toBe('compact');
  });
});