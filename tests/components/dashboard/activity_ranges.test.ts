import { describe, it, expect, vi, afterEach } from 'vitest';
import { getActivityRange, ACTIVITY_TIME_RANGES } from '../../../src/dashboard/activity_ranges';

describe('getActivityRange — monthly', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('produces correct date-range labels for June 2026 (30-day month)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toEqual([
            'Jun 1–7',
            'Jun 8–14',
            'Jun 15–21',
            'Jun 22–28',
            'Jun 29–30',
        ]);
    });

    it('maps June 2026 dates to correct bucket indexes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.getBucketIndex('2026-06-01')).toBe(0);
        expect(range.getBucketIndex('2026-06-07')).toBe(0);
        expect(range.getBucketIndex('2026-06-08')).toBe(1);
        expect(range.getBucketIndex('2026-06-14')).toBe(1);
        expect(range.getBucketIndex('2026-06-30')).toBe(4);
        expect(range.getBucketIndex('2026-05-31')).toBe(-1);
        expect(range.getBucketIndex('2026-07-01')).toBe(-1);
    });

    it('produces correct labels and bucket indexes for a 31-day month (July 2026)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toEqual([
            'Jul 1–7',
            'Jul 8–14',
            'Jul 15–21',
            'Jul 22–28',
            'Jul 29–31',
        ]);
        expect(range.labels.length).toBe(5);
        expect(range.getBucketIndex('2026-07-31')).toBe(4);
    });

    it('produces correct labels for February 2026 (28-day month)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toEqual([
            'Feb 1–7',
            'Feb 8–14',
            'Feb 15–21',
            'Feb 22–28',
        ]);
        expect(range.labels.length).toBe(4);
        expect(range.getBucketIndex('2026-02-28')).toBe(3);
    });
});