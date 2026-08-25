import { describe, it, expect } from 'vitest';
import * as timelineZoom from '../src/timeline/timeline_zoom';

describe('timeline_zoom.ts', () => {
    describe('normalizeTimelineZoomLevel', () => {
        it('should pass through every known level', () => {
            expect(timelineZoom.normalizeTimelineZoomLevel('detailed')).toBe('detailed');
            expect(timelineZoom.normalizeTimelineZoomLevel('compact')).toBe('compact');
            expect(timelineZoom.normalizeTimelineZoomLevel('month')).toBe('month');
            expect(timelineZoom.normalizeTimelineZoomLevel('year')).toBe('year');
        });

        it('should fall back to the default level for null', () => {
            expect(timelineZoom.normalizeTimelineZoomLevel(null)).toBe(timelineZoom.DEFAULT_TIMELINE_ZOOM_LEVEL);
        });

        it('should fall back to the default level for an unknown value', () => {
            expect(timelineZoom.normalizeTimelineZoomLevel('century')).toBe(timelineZoom.DEFAULT_TIMELINE_ZOOM_LEVEL);
            expect(timelineZoom.normalizeTimelineZoomLevel('')).toBe(timelineZoom.DEFAULT_TIMELINE_ZOOM_LEVEL);
        });
    });

    describe('stepTimelineZoomLevel', () => {
        it('should step out toward year one level at a time', () => {
            expect(timelineZoom.stepTimelineZoomLevel('detailed', 'out')).toBe('compact');
            expect(timelineZoom.stepTimelineZoomLevel('compact', 'out')).toBe('month');
            expect(timelineZoom.stepTimelineZoomLevel('month', 'out')).toBe('year');
        });

        it('should step in toward detailed one level at a time', () => {
            expect(timelineZoom.stepTimelineZoomLevel('year', 'in')).toBe('month');
            expect(timelineZoom.stepTimelineZoomLevel('month', 'in')).toBe('compact');
            expect(timelineZoom.stepTimelineZoomLevel('compact', 'in')).toBe('detailed');
        });

        it('should clamp at the year end', () => {
            expect(timelineZoom.stepTimelineZoomLevel('year', 'out')).toBe('year');
        });

        it('should clamp at the detailed end', () => {
            expect(timelineZoom.stepTimelineZoomLevel('detailed', 'in')).toBe('detailed');
        });
    });

    describe('getTimelineZoomLabel', () => {
        it('should return a human-readable label for every level', () => {
            expect(timelineZoom.getTimelineZoomLabel('detailed')).toBe('Detailed');
            expect(timelineZoom.getTimelineZoomLabel('compact')).toBe('Compact');
            expect(timelineZoom.getTimelineZoomLabel('month')).toBe('Month');
            expect(timelineZoom.getTimelineZoomLabel('year')).toBe('Year');
        });
    });

    describe('isTimelineBucketLevel', () => {
        it('should be true only for month and year', () => {
            expect(timelineZoom.isTimelineBucketLevel('detailed')).toBe(false);
            expect(timelineZoom.isTimelineBucketLevel('compact')).toBe(false);
            expect(timelineZoom.isTimelineBucketLevel('month')).toBe(true);
            expect(timelineZoom.isTimelineBucketLevel('year')).toBe(true);
        });
    });

    describe('getTimelineBucketGranularity', () => {
        it('should map bucket levels to their granularity', () => {
            expect(timelineZoom.getTimelineBucketGranularity('month')).toBe('month');
            expect(timelineZoom.getTimelineBucketGranularity('year')).toBe('year');
        });

        it('should return null for event levels', () => {
            expect(timelineZoom.getTimelineBucketGranularity('detailed')).toBeNull();
            expect(timelineZoom.getTimelineBucketGranularity('compact')).toBeNull();
        });
    });
});
