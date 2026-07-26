/**
 * Pure bucket-row formatting for the `month` / `year` timeline zoom levels. No DOM.
 */
import type { TimelineBucket, TimelineEventKind } from '../types';
import { formatStatsDuration } from '../time';

export interface TimelineBucketPip {
    kind: TimelineEventKind;
    count: number;
    label: string;
}

interface TimelineBucketPipNoun {
    kind: TimelineEventKind;
    count: number;
    singular: string;
    plural: string;
}

function buildTimelineBucketPipNouns(bucket: TimelineBucket): TimelineBucketPipNoun[] {
    return [
        { kind: 'started', count: bucket.startedCount, singular: 'started', plural: 'started' },
        { kind: 'finished', count: bucket.finishedCount, singular: 'completed', plural: 'completed' },
        { kind: 'paused', count: bucket.pausedCount, singular: 'paused', plural: 'paused' },
        { kind: 'dropped', count: bucket.droppedCount, singular: 'dropped', plural: 'dropped' },
        { kind: 'milestone', count: bucket.milestoneCount, singular: 'milestone', plural: 'milestones' },
    ];
}

export function getTimelineBucketPips(bucket: TimelineBucket): TimelineBucketPip[] {
    return buildTimelineBucketPipNouns(bucket)
        .filter(pip => pip.count > 0)
        .map(pip => ({
            kind: pip.kind,
            count: pip.count,
            label: `${pip.count} ${pip.count === 1 ? pip.singular : pip.plural}`,
        }));
}

export function formatTimelineBucketTotals(bucket: TimelineBucket): string {
    const duration = formatStatsDuration(bucket.loggedMinutes);
    const characters = bucket.loggedCharacters.toLocaleString();
    return `${duration} · ${characters} chars logged`;
}

export function formatTimelineBucketCoverOverflowLabel(highlightOverflow: number): string | null {
    return highlightOverflow > 0 ? `+${highlightOverflow}` : null;
}

export function formatTimelineBucketMilestoneOverflowLabel(milestoneOverflow: number): string | null {
    return milestoneOverflow > 0 ? `+${milestoneOverflow} more` : null;
}