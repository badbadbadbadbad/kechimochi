import { describe, it, expect } from 'vitest';
import * as timelineBuckets from '../src/timeline/timeline_buckets';
import type { TimelineBucket } from '../src/types';

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

describe('timeline_buckets.ts', () => {
    describe('getTimelineBucketPips', () => {
        it('should omit zero counts', () => {
            const bucket = buildBucket({ startedCount: 6, finishedCount: 2, milestoneCount: 3 });
            expect(timelineBuckets.getTimelineBucketPips(bucket)).toEqual([
                { kind: 'started', count: 6, label: '6 started' },
                { kind: 'finished', count: 2, label: '2 completed' },
                { kind: 'milestone', count: 3, label: '3 milestones' },
            ]);
        });

        it('should return an empty list for an empty bucket', () => {
            expect(timelineBuckets.getTimelineBucketPips(buildBucket())).toEqual([]);
        });

        it('should singularize the milestone label at a count of one', () => {
            const bucket = buildBucket({ milestoneCount: 1 });
            expect(timelineBuckets.getTimelineBucketPips(bucket)).toEqual([
                { kind: 'milestone', count: 1, label: '1 milestone' },
            ]);
        });

        it('should include every kind that has a nonzero count, in a stable order', () => {
            const bucket = buildBucket({
                startedCount: 1,
                finishedCount: 1,
                pausedCount: 1,
                droppedCount: 1,
                milestoneCount: 1,
            });
            expect(timelineBuckets.getTimelineBucketPips(bucket).map(pip => pip.kind)).toEqual([
                'started',
                'finished',
                'paused',
                'dropped',
                'milestone',
            ]);
        });
    });

    describe('getTimelineBucketDominantKind', () => {
        it('should return the kind with the highest count', () => {
            const bucket = buildBucket({ startedCount: 2, finishedCount: 6, milestoneCount: 3 });
            expect(timelineBuckets.getTimelineBucketDominantKind(bucket)).toBe('finished');
        });

        it('should break a tie by started→finished→paused→dropped→milestone order', () => {
            const bucket = buildBucket({
                startedCount: 1,
                finishedCount: 1,
                pausedCount: 1,
                droppedCount: 1,
                milestoneCount: 1,
            });
            expect(timelineBuckets.getTimelineBucketDominantKind(bucket)).toBe('started');
        });

        it('should return null for a bucket with no events', () => {
            expect(timelineBuckets.getTimelineBucketDominantKind(buildBucket())).toBeNull();
        });
    });

    describe('buildTimelineBucketTotalsParts', () => {
        it('should return logged time and characters as separate parts', () => {
            const bucket = buildBucket({ loggedMinutes: 860, loggedCharacters: 92431 });
            expect(timelineBuckets.buildTimelineBucketTotalsParts(bucket))
                .toEqual(['14h 20m', '92,431 chars logged']);
        });

        it('should return no parts for an empty bucket', () => {
            expect(timelineBuckets.buildTimelineBucketTotalsParts(buildBucket())).toEqual([]);
        });

        it('should omit characters when only time is logged', () => {
            const bucket = buildBucket({ loggedMinutes: 120, loggedCharacters: 0 });
            expect(timelineBuckets.buildTimelineBucketTotalsParts(bucket)).toEqual(['2h']);
        });

        it('should omit time when only characters are logged', () => {
            const bucket = buildBucket({ loggedMinutes: 0, loggedCharacters: 4200 });
            expect(timelineBuckets.buildTimelineBucketTotalsParts(bucket))
                .toEqual(['4,200 chars logged']);
        });

        it('should use the singular noun for a single character', () => {
            const bucket = buildBucket({ loggedMinutes: 0, loggedCharacters: 1 });
            expect(timelineBuckets.buildTimelineBucketTotalsParts(bucket))
                .toEqual(['1 char logged']);
        });
    });

    describe('formatTimelineBucketCoverOverflowLabel', () => {
        it('should format a positive overflow when a cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(12, true)).toBe('+12');
        });

        it('should return null when there is no overflow, whether or not a cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(0, true)).toBeNull();
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(0, false)).toBeNull();
        });

        it('should spell out the title count when no cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(7, false)).toBe('7 titles');
        });

        it('should singularize the title count at a count of one', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(1, false)).toBe('1 title');
        });
    });

    describe('fitTimelineBucketCovers', () => {
        const baseFit = {
            availableWidth: 600,
            coverWidth: 76,
            coverGap: 8,
            maxRows: 1,
            renderedCount: 7,
            distinctMediaCount: 7,
        };

        it('should show every cover when they all fit', () => {
            expect(timelineBuckets.fitTimelineBucketCovers(baseFit)).toEqual({
                visibleCount: 7,
                overflowCount: 0,
            });
        });

        it('should give up a slot to the overflow tile when the row is full', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({ ...baseFit, availableWidth: 340 }),
            ).toEqual({ visibleCount: 3, overflowCount: 4 });
        });

        it('should fit twice as many covers across two rows', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({
                    ...baseFit,
                    availableWidth: 340,
                    maxRows: 2,
                }),
            ).toEqual({ visibleCount: 7, overflowCount: 0 });
        });

        it('should count media the backend never sent as overflow', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({
                    ...baseFit,
                    renderedCount: 7,
                    distinctMediaCount: 30,
                }),
            ).toEqual({ visibleCount: 6, overflowCount: 24 });
        });

        it('should keep at least one cover in an impossibly narrow card', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({ ...baseFit, availableWidth: 10 }),
            ).toEqual({ visibleCount: 1, overflowCount: 6 });
        });
    });

    describe('formatTimelineBucketLabel', () => {
        it('should format a month bucket as its full month and year', () => {
            const bucket = buildBucket({ key: '2024-03', startDate: '2024-03-01' });
            expect(timelineBuckets.formatTimelineBucketLabel(bucket, 'month')).toBe('March 2024');
        });

        it('should format a year bucket as its bare key', () => {
            const bucket = buildBucket({ key: '2024', startDate: '2024-01-01' });
            expect(timelineBuckets.formatTimelineBucketLabel(bucket, 'year')).toBe('2024');
        });
    });
});