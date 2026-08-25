/**
 * Pure level model for timeline semantic zoom. No DOM.
 */
import type { TimelineBucketGranularity } from '../types';

export const TIMELINE_ZOOM_LEVELS = ['detailed', 'compact', 'month', 'year'] as const;
export type TimelineZoomLevel = (typeof TIMELINE_ZOOM_LEVELS)[number];
export const DEFAULT_TIMELINE_ZOOM_LEVEL: TimelineZoomLevel = 'detailed';
export type TimelineZoomDirection = 'in' | 'out';

const TIMELINE_ZOOM_LABELS: Record<TimelineZoomLevel, string> = {
    detailed: 'Detailed',
    compact: 'Compact',
    month: 'Month',
    year: 'Year',
};

const TIMELINE_BUCKET_GRANULARITIES: Partial<Record<TimelineZoomLevel, TimelineBucketGranularity>> = {
    month: 'month',
    year: 'year',
};

export function normalizeTimelineZoomLevel(raw: string | null): TimelineZoomLevel {
    if (raw !== null && (TIMELINE_ZOOM_LEVELS as readonly string[]).includes(raw)) {
        return raw as TimelineZoomLevel;
    }
    return DEFAULT_TIMELINE_ZOOM_LEVEL;
}

export function stepTimelineZoomLevel(level: TimelineZoomLevel, direction: TimelineZoomDirection): TimelineZoomLevel {
    const currentIndex = TIMELINE_ZOOM_LEVELS.indexOf(level);
    const nextIndex = direction === 'out' ? currentIndex + 1 : currentIndex - 1;
    const clampedIndex = Math.min(Math.max(nextIndex, 0), TIMELINE_ZOOM_LEVELS.length - 1);
    return TIMELINE_ZOOM_LEVELS[clampedIndex];
}

export function getTimelineZoomLabel(level: TimelineZoomLevel): string {
    return TIMELINE_ZOOM_LABELS[level];
}

export function isTimelineBucketLevel(level: TimelineZoomLevel): boolean {
    return level === 'month' || level === 'year';
}

export function getTimelineBucketGranularity(level: TimelineZoomLevel): TimelineBucketGranularity | null {
    return TIMELINE_BUCKET_GRANULARITIES[level] ?? null;
}