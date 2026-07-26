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
        highlightOverflow: 0,
        milestones: [],
        milestoneOverflow: 0,
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

    describe('formatTimelineBucketTotals', () => {
        it('should format logged time and characters together', () => {
            const bucket = buildBucket({ loggedMinutes: 860, loggedCharacters: 92431 });
            expect(timelineBuckets.formatTimelineBucketTotals(bucket)).toBe('14h 20m · 92,431 chars logged');
        });

        it('should format an empty bucket as zero time and characters', () => {
            expect(timelineBuckets.formatTimelineBucketTotals(buildBucket())).toBe('0m · 0 chars logged');
        });
    });

    describe('formatTimelineBucketCoverOverflowLabel', () => {
        it('should format a positive overflow', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(12)).toBe('+12');
        });

        it('should return null when there is no overflow', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(0)).toBeNull();
        });
    });

    describe('formatTimelineBucketMilestoneOverflowLabel', () => {
        it('should format a positive overflow', () => {
            expect(timelineBuckets.formatTimelineBucketMilestoneOverflowLabel(5)).toBe('+5 more');
        });

        it('should return null when there is no overflow', () => {
            expect(timelineBuckets.formatTimelineBucketMilestoneOverflowLabel(0)).toBeNull();
        });
    });
});