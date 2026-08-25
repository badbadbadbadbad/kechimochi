import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { getSelectedOptionLabel } from '../../helpers/form-controls.js';
import {
    getTimelineRowCount,
    getTimelineZoomLevel,
    openTimeline,
    setTimelineKindFilter,
    setTimelineZoomLevel,
    waitForTimelineReady,
} from '../../helpers/timeline.js';

const KIND_FILTER_SELECTOR = '#timeline-kind-filter';
const YEAR_FILTER_SELECTOR = '#timeline-year-filter';

// Measured against the seed fixture. A bucket exists for any month with an event
// *or* with logged time, so the seeded date range alone does not imply these.
const SEEDED_MONTH_BUCKET_COUNT = 3;
const SEEDED_YEAR_BUCKET_COUNT = 1;

describe('Timeline zoom levels', () => {
    before(async () => {
        await waitForAppReady();
        await openTimeline();
    });

    // Runs first and deliberately does not reset the level beforehand, so it
    // observes whatever level a freshly opened timeline actually lands on.
    it('should default to the detailed level showing per-event rows', async () => {
        expect(await getTimelineZoomLevel()).toBe('detailed');
        expect(await getTimelineRowCount()).toBeGreaterThan(0);
        expect(await $$('.timeline-entry').length).toBeGreaterThan(0);
    });

    it('should step out through compact, month, and year on repeated zoom-out clicks', async () => {
        await setTimelineZoomLevel('detailed');

        await $('#btn-timeline-zoom-out').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('compact');
        expect(await $$('.timeline-compact-row').length).toBeGreaterThan(0);

        await $('#btn-timeline-zoom-out').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('month');
        expect(await $$('.timeline-bucket-row').length).toBe(SEEDED_MONTH_BUCKET_COUNT);

        await $('#btn-timeline-zoom-out').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('year');
        expect(await $$('.timeline-bucket-row').length).toBe(SEEDED_YEAR_BUCKET_COUNT);
    });

    it('should step back in through month and compact on repeated zoom-in clicks', async () => {
        await setTimelineZoomLevel('year');

        await $('#btn-timeline-zoom-in').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('month');

        await $('#btn-timeline-zoom-in').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('compact');

        await $('#btn-timeline-zoom-in').click();
        await waitForTimelineReady();
        expect(await getTimelineZoomLevel()).toBe('detailed');
    });

    it('should return to detailed when the reset button is clicked from any level', async () => {
        await setTimelineZoomLevel('month');

        await $('#btn-timeline-zoom-reset').click();
        await waitForTimelineReady();

        expect(await getTimelineZoomLevel()).toBe('detailed');
    });

    it('should disable the zoom-out button at year and the zoom-in button at detailed', async () => {
        await setTimelineZoomLevel('detailed');
        expect(await $('#btn-timeline-zoom-out').isEnabled()).toBe(true);
        expect(await $('#btn-timeline-zoom-in').isEnabled()).toBe(false);

        await setTimelineZoomLevel('year');
        expect(await $('#btn-timeline-zoom-out').isEnabled()).toBe(false);
        expect(await $('#btn-timeline-zoom-in').isEnabled()).toBe(true);
    });

    it('should keep the selected zoom level after navigating away and back', async () => {
        await setTimelineZoomLevel('month');

        await navigateTo('dashboard');
        await openTimeline();

        expect(await getTimelineZoomLevel()).toBe('month');
    });
});

describe('Timeline zoom filter visibility', () => {
    before(async () => {
        await waitForAppReady();
    });

    beforeEach(async () => {
        await openTimeline();
        await setTimelineZoomLevel('detailed');
    });

    it('should keep the kind filter state while it is hidden at bucket levels', async () => {
        await setTimelineKindFilter('Completed');
        expect(await getSelectedOptionLabel(KIND_FILTER_SELECTOR)).toBe('Completed');

        await setTimelineZoomLevel('month');
        expect(await $(KIND_FILTER_SELECTOR).isExisting()).toBe(false);
        expect(await $(YEAR_FILTER_SELECTOR).isExisting()).toBe(true);

        await setTimelineZoomLevel('year');
        expect(await $(KIND_FILTER_SELECTOR).isExisting()).toBe(false);
        expect(await $(YEAR_FILTER_SELECTOR).isExisting()).toBe(false);

        await setTimelineZoomLevel('detailed');
        expect(await $(KIND_FILTER_SELECTOR).isExisting()).toBe(true);
        expect(await getSelectedOptionLabel(KIND_FILTER_SELECTOR)).toBe('Completed');
    });
});