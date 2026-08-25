import { describe, it, expect } from 'vitest';
import {
    buildSideWaveAreaPath,
    buildSmoothWaveSegments,
    buildTimelineWavePaths,
    buildWaveSamples,
    getBucketWaveMetric,
    getWaveMetric,
} from '../src/timeline/timeline_wave';
import type { TimelineBucket, TimelineEvent } from '../src/types';

function buildEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
    return {
        kind: 'finished',
        date: '2024-03-15',
        mediaId: 1,
        mediaTitle: 'Novel A',
        mediaVariant: '',
        coverImage: '',
        activityType: 'Reading',
        contentType: 'Novel',
        trackingStatus: 'Complete',
        milestoneName: null,
        milestoneId: null,
        firstDate: '2024-03-01',
        lastDate: '2024-03-15',
        totalMinutes: 0,
        totalCharacters: 0,
        milestoneMinutes: 0,
        milestoneCharacters: 0,
        sameDayTerminal: false,
        ...overrides,
    };
}

function buildBucket(overrides: Partial<TimelineBucket> = {}): TimelineBucket {
    return {
        key: '2024-03',
        startDate: '2024-03-01',
        startedCount: 0,
        finishedCount: 0,
        pausedCount: 0,
        droppedCount: 0,
        milestoneCount: 0,
        loggedMinutes: 0,
        loggedCharacters: 0,
        highlights: [],
        distinctMediaCount: 0,
        ...overrides,
    };
}

/** Every command in a wave path (M, L, C) carries an even number of coordinates, so the numeric
 *  tokens pair up as (x, y) in order. Returns every x recorded at a given y. */
function extractXAtY(path: string, y: number): number[] {
    const numbers = path
        .split(/[\s,]+/)
        .filter(token => token !== '')
        .map(Number)
        .filter(value => !Number.isNaN(value));
    const matches: number[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
        if (numbers[index + 1] === y) {
            matches.push(numbers[index]);
        }
    }
    return matches;
}

function roundTo4(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

describe('timeline_wave.ts', () => {
    describe('buildSmoothWaveSegments', () => {
        it('should join consecutive points with cubic segments through their midpoint', () => {
            const path = buildSmoothWaveSegments([
                { x: 0, y: 0 },
                { x: 10, y: 20 },
            ]);
            expect(path).toBe(' C 0 10, 10 10, 10 20');
        });

        it('should return an empty string for a single point', () => {
            expect(buildSmoothWaveSegments([{ x: 0, y: 0 }])).toBe('');
        });
    });

    describe('buildWaveSamples', () => {
        it('should return no samples for no points', () => {
            expect(buildWaveSamples([], 1000, 88)).toEqual([]);
        });

        it('should shape a single point into a crest with calmed shoulders and edges', () => {
            const samples = buildWaveSamples([{ y: 500, amplitude: 420 }], 1000, 88);

            expect(samples.map(sample => roundTo4(sample.y))).toEqual([0, 294.368, 442.88, 500, 557.12, 705.632, 1000]);
            expect(samples.map(sample => roundTo4(sample.amplitude))).toEqual([
                59.84, 285.936, 352.8, 420, 352.8, 285.936, 59.84,
            ]);
        });
    });

    describe('buildSideWaveAreaPath', () => {
        it('should return an empty string for no samples', () => {
            expect(buildSideWaveAreaPath([], 1000, -1, 88)).toBe('');
        });

        it('should stretch the outer edge away from centre by amplitude and direction', () => {
            const samples = [{ y: 500, amplitude: 420 }];

            const leftPath = buildSideWaveAreaPath(samples, 1000, -1, 88, 1.42, 0.2);
            const rightPath = buildSideWaveAreaPath(samples, 1000, 1, 88, 1.42, 0.2);

            expect(extractXAtY(leftPath, 500)).toContain(403.6);
            expect(extractXAtY(rightPath, 500)).toContain(1596.4);
        });
    });

    describe('buildTimelineWavePaths', () => {
        const baseGeometry = {
            waveWidth: 2000,
            waveHeight: 1000,
            centerX: 1000,
            amplitudeScale: 1,
        };

        it('should draw a calm two-point band across the full height when there are no rows', () => {
            const paths = buildTimelineWavePaths({ ...baseGeometry, nodeOffsets: [] }, []);

            expect(paths).not.toBeNull();
            expect(paths!.viewBox).toBe('0 0 2000 1000');
            // The clamped minimum amplitude (88, from the width ratio hitting its ceiling) is the
            // crest reached at both flat edges (y=0 and y=waveHeight).
            expect(extractXAtY(paths!.body[0], 0)).toContain(1000 - 88 * 1.42);
            expect(extractXAtY(paths!.body[1], 1000)).toContain(1000 + 88 * 1.42);
        });

        it('should widen the reach around a node with a larger wave metric, not merely around centerX', () => {
            const paths = buildTimelineWavePaths(
                { ...baseGeometry, nodeOffsets: [300, 700] },
                [100, 400],
            );

            expect(paths).not.toBeNull();
            const lowMetricReach = 1000 - extractXAtY(paths!.body[0], 300)[0];
            const highMetricReach = 1000 - extractXAtY(paths!.body[0], 700)[0];

            expect(lowMetricReach).toBeCloseTo(412.5384, 3);
            expect(highMetricReach).toBeCloseTo(544.5416, 3);
            expect(highMetricReach).toBeGreaterThan(lowMetricReach);
        });

        it('should scale both amplitudes by amplitudeScale, matching the wide-screen fix', () => {
            const narrow = buildTimelineWavePaths({ ...baseGeometry, amplitudeScale: 1, nodeOffsets: [] }, []);
            const wide = buildTimelineWavePaths({ ...baseGeometry, amplitudeScale: 2, nodeOffsets: [] }, []);

            const narrowReach = 1000 - extractXAtY(narrow!.body[0], 0)[0];
            const wideReach = 1000 - extractXAtY(wide!.body[0], 0)[0];

            expect(wideReach).toBeCloseTo(narrowReach * 2, 6);
        });
    });

    describe('getWaveMetric', () => {
        it('should use milestone minutes when present', () => {
            expect(getWaveMetric(buildEvent({ kind: 'milestone', milestoneMinutes: 45 }))).toBe(45);
        });

        it('should convert milestone characters to a minute-equivalent when there are no minutes', () => {
            expect(getWaveMetric(buildEvent({ kind: 'milestone', milestoneCharacters: 2400 }))).toBe(10);
        });

        it('should clamp a started event with a large total to the ceiling', () => {
            expect(getWaveMetric(buildEvent({ kind: 'started', totalMinutes: 1000 }))).toBe(220);
        });

        it('should scale a started event within the floor and ceiling', () => {
            expect(getWaveMetric(buildEvent({ kind: 'started', totalMinutes: 100 }))).toBe(35);
        });

        it('should use the raw total minutes for a non-started event', () => {
            expect(getWaveMetric(buildEvent({ kind: 'finished', totalMinutes: 90 }))).toBe(90);
        });

        it('should fall back to the metric floor with no minutes or characters', () => {
            expect(getWaveMetric(buildEvent({ kind: 'finished' }))).toBe(20);
        });
    });

    describe('getBucketWaveMetric', () => {
        it('should use logged minutes when present', () => {
            expect(getBucketWaveMetric(buildBucket({ loggedMinutes: 120 }))).toBe(120);
        });

        it('should convert logged characters to a minute-equivalent when there are no logged minutes', () => {
            expect(getBucketWaveMetric(buildBucket({ loggedCharacters: 4800 }))).toBe(20);
        });

        it('should fall back to the metric floor with nothing logged', () => {
            expect(getBucketWaveMetric(buildBucket())).toBe(20);
        });
    });
});