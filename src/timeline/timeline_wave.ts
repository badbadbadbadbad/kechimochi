/**
 * Pure geometry for the decorative timeline wave backdrop.
 */
import type { TimelineBucket, TimelineEvent } from '../types';

export const WAVE_RESIZE_DEBOUNCE_MS = 160;

const WAVE_CALM_AMPLITUDE_RATIO = 0.68;
const WAVE_MIN_AMPLITUDE_FLOOR = 52;
const WAVE_MIN_AMPLITUDE_CEILING = 88;
const WAVE_MIN_AMPLITUDE_WIDTH_RATIO = 0.085;
const WAVE_MAX_AMPLITUDE_FLOOR = 220;
const WAVE_MAX_AMPLITUDE_CEILING = 420;
const WAVE_MAX_AMPLITUDE_WIDTH_RATIO = 0.34;

const WAVE_BODY_OUTER_STRETCH = 1.42;
const WAVE_BODY_INNER_RATIO = 0.2;
const WAVE_HAZE_OUTER_STRETCH = 1.92;
const WAVE_HAZE_INNER_RATIO = 0.08;
const WAVE_AREA_DEFAULT_OUTER_STRETCH = 1.16;
const WAVE_AREA_DEFAULT_INNER_RATIO = 0.18;

const WAVE_SMOOTHING_NEIGHBOR_WEIGHT = 0.22;
const WAVE_SMOOTHING_CENTER_WEIGHT = 0.56;
const WAVE_DEFAULT_NODE_GAP = 136;
const WAVE_MIN_LOCAL_GAP = 72;
const WAVE_SHOULDER_MIN = 34;
const WAVE_SHOULDER_MAX = 72;
const WAVE_SHOULDER_LOCAL_GAP_RATIO = 0.42;
const WAVE_SHOULDER_REACH = 3.6;
const WAVE_TROUGH_MIN_AMPLITUDE_RATIO = 0.72;
const WAVE_TROUGH_CREST_RATIO = 0.74;
const WAVE_SHOULDER_MIN_AMPLITUDE_RATIO = 0.76;
const WAVE_SHOULDER_CREST_RATIO = 0.84;
const WAVE_EDGE_TROUGH_RATIO = 0.92;
const WAVE_MIDPOINT_CREST_RATIO = 0.46;

const CHARACTERS_PER_MINUTE_ESTIMATE = 240;
const WAVE_METRIC_MINUTE_SCALE = 0.35;
const WAVE_METRIC_FLOOR = 20;
const WAVE_METRIC_CEILING = 220;

export interface TimelineWaveGeometry {
    waveWidth: number;
    waveHeight: number;
    centerX: number;
    amplitudeScale: number;
    nodeOffsets: number[]; // y per node, aligned to metrics
}

export interface TimelineWavePaths {
    viewBox: string;
    body: [string, string];
    haze: [string, string];
}

export function buildTimelineWavePaths(geometry: TimelineWaveGeometry, metrics: number[]): TimelineWavePaths | null {
    const { waveWidth, waveHeight, centerX, amplitudeScale, nodeOffsets } = geometry;

    const minAmplitude =
        Math.max(WAVE_MIN_AMPLITUDE_FLOOR, Math.min(WAVE_MIN_AMPLITUDE_CEILING, waveWidth * WAVE_MIN_AMPLITUDE_WIDTH_RATIO)) *
        amplitudeScale;
    const maxAmplitude =
        Math.max(WAVE_MAX_AMPLITUDE_FLOOR, Math.min(WAVE_MAX_AMPLITUDE_CEILING, waveWidth * WAVE_MAX_AMPLITUDE_WIDTH_RATIO)) *
        amplitudeScale;

    const pointCount = Math.min(nodeOffsets.length, metrics.length);

    // Only a rowless view falls back to the flat band: `buildWaveSamples` shapes a proper
    // crest from a single point, using that point for its own missing neighbours.
    let wavePoints: Array<{ y: number; amplitude: number }>;
    if (pointCount === 0) {
        wavePoints = [
            { y: 0, amplitude: minAmplitude },
            { y: waveHeight, amplitude: minAmplitude },
        ];
    } else {
        const points = metrics.slice(0, pointCount).map((metric, index) => ({
            y: nodeOffsets[index],
            metric,
        }));

        const normalizedMetrics = points.map(point => Math.sqrt(point.metric));
        const maxMetric = Math.max(...normalizedMetrics, 1);
        wavePoints = points.map((point, index) => ({
            y: point.y,
            amplitude: minAmplitude + (normalizedMetrics[index] / maxMetric) * (maxAmplitude - minAmplitude),
        }));
    }

    const leftSamples = buildWaveSamples(wavePoints, waveHeight, minAmplitude);
    const rightSamples = buildWaveSamples(wavePoints, waveHeight, minAmplitude);
    const leftBodyPath = buildSideWaveAreaPath(leftSamples, centerX, -1, minAmplitude, WAVE_BODY_OUTER_STRETCH, WAVE_BODY_INNER_RATIO);
    const rightBodyPath = buildSideWaveAreaPath(rightSamples, centerX, 1, minAmplitude, WAVE_BODY_OUTER_STRETCH, WAVE_BODY_INNER_RATIO);
    const leftHazePath = buildSideWaveAreaPath(leftSamples, centerX, -1, minAmplitude, WAVE_HAZE_OUTER_STRETCH, WAVE_HAZE_INNER_RATIO);
    const rightHazePath = buildSideWaveAreaPath(rightSamples, centerX, 1, minAmplitude, WAVE_HAZE_OUTER_STRETCH, WAVE_HAZE_INNER_RATIO);

    return {
        viewBox: `0 0 ${waveWidth} ${waveHeight}`,
        body: [leftBodyPath, rightBodyPath],
        haze: [leftHazePath, rightHazePath],
    };
}

export function buildWaveSamples(
    points: Array<{ y: number; amplitude: number }>,
    shellHeight: number,
    minAmplitude: number,
): Array<{ y: number; amplitude: number }> {
    if (points.length === 0) {
        return [];
    }

    const samples: Array<{ y: number; amplitude: number }> = [];
    const calmAmplitude = minAmplitude * WAVE_CALM_AMPLITUDE_RATIO;

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const previousPoint = points[index - 1] ?? null;
        const nextPoint = points[index + 1] ?? null;
        const previousAmplitude = previousPoint?.amplitude ?? point.amplitude;
        const nextAmplitude = nextPoint?.amplitude ?? point.amplitude;
        const crestAmplitude =
            previousAmplitude * WAVE_SMOOTHING_NEIGHBOR_WEIGHT +
            point.amplitude * WAVE_SMOOTHING_CENTER_WEIGHT +
            nextAmplitude * WAVE_SMOOTHING_NEIGHBOR_WEIGHT;
        const leadingGap = previousPoint ? point.y - previousPoint.y : WAVE_DEFAULT_NODE_GAP;
        const trailingGap = nextPoint ? nextPoint.y - point.y : WAVE_DEFAULT_NODE_GAP;
        const localGap = Math.max(WAVE_MIN_LOCAL_GAP, Math.min(leadingGap, trailingGap));
        const shoulder = Math.max(WAVE_SHOULDER_MIN, Math.min(WAVE_SHOULDER_MAX, localGap * WAVE_SHOULDER_LOCAL_GAP_RATIO));
        const troughAmplitude = Math.max(minAmplitude * WAVE_TROUGH_MIN_AMPLITUDE_RATIO, crestAmplitude * WAVE_TROUGH_CREST_RATIO);

        if (index === 0) {
            samples.push({
                y: Math.max(0, point.y - shoulder * WAVE_SHOULDER_REACH),
                amplitude: Math.max(calmAmplitude, troughAmplitude * WAVE_EDGE_TROUGH_RATIO),
            });
        }

        const upperShoulderY = Math.max(0, point.y - shoulder);
        if (samples.at(-1)?.y !== upperShoulderY) {
            samples.push({
                y: upperShoulderY,
                amplitude: Math.max(minAmplitude * WAVE_SHOULDER_MIN_AMPLITUDE_RATIO, crestAmplitude * WAVE_SHOULDER_CREST_RATIO),
            });
        }

        samples.push({
            y: point.y,
            amplitude: crestAmplitude,
        });

        const lowerShoulderY = Math.min(shellHeight, point.y + shoulder);
        samples.push({
            y: lowerShoulderY,
            amplitude: Math.max(minAmplitude * WAVE_SHOULDER_MIN_AMPLITUDE_RATIO, crestAmplitude * WAVE_SHOULDER_CREST_RATIO),
        });

        if (nextPoint) {
            const midpointY = (point.y + nextPoint.y) / 2;
            const nextCrestAmplitude =
                point.amplitude * WAVE_SMOOTHING_NEIGHBOR_WEIGHT +
                nextAmplitude * WAVE_SMOOTHING_CENTER_WEIGHT +
                (points[index + 2]?.amplitude ?? nextAmplitude) * WAVE_SMOOTHING_NEIGHBOR_WEIGHT;
            samples.push({
                y: midpointY,
                amplitude: Math.max(calmAmplitude, (crestAmplitude + nextCrestAmplitude) * WAVE_MIDPOINT_CREST_RATIO),
            });
        } else {
            samples.push({
                y: Math.min(shellHeight, point.y + shoulder * WAVE_SHOULDER_REACH),
                amplitude: Math.max(calmAmplitude, troughAmplitude * WAVE_EDGE_TROUGH_RATIO),
            });
        }
    }

    // Both edges settle at the calm width instead of inheriting the terminal sample's
    // amplitude, which would keep a single loud row at full width all the way to the edge.
    if (samples[0].y > 0) {
        samples.unshift({ y: 0, amplitude: calmAmplitude });
    }
    if (samples.at(-1)!.y < shellHeight) {
        samples.push({ y: shellHeight, amplitude: calmAmplitude });
    }

    return samples;
}

export function buildSideWaveAreaPath(
    samples: Array<{ y: number; amplitude: number }>,
    centerX: number,
    direction: -1 | 1,
    minAmplitude: number,
    outerStretch = WAVE_AREA_DEFAULT_OUTER_STRETCH,
    innerRatio = WAVE_AREA_DEFAULT_INNER_RATIO,
): string {
    if (samples.length === 0) {
        return '';
    }

    const outerPoints = samples.map(sample => ({
        x: centerX + direction * sample.amplitude * outerStretch,
        y: sample.y,
    }));
    const innerPoints = [...samples]
        .reverse()
        .map(sample => ({
            x: centerX + direction * Math.max(minAmplitude * innerRatio, sample.amplitude * innerRatio),
            y: sample.y,
        }));

    return [
        `M ${outerPoints[0].x} ${outerPoints[0].y}`,
        buildSmoothWaveSegments(outerPoints),
        `L ${innerPoints[0].x} ${innerPoints[0].y}`,
        buildSmoothWaveSegments(innerPoints),
        'Z',
    ].join(' ');
}

export function buildSmoothWaveSegments(points: Array<{ x: number; y: number }>): string {
    let path = '';
    for (let index = 1; index < points.length; index += 1) {
        const previousPoint = points[index - 1];
        const currentPoint = points[index];
        const midpointY = (previousPoint.y + currentPoint.y) / 2;
        path += ` C ${previousPoint.x} ${midpointY}, ${currentPoint.x} ${midpointY}, ${currentPoint.x} ${currentPoint.y}`;
    }
    return path;
}

export function getWaveMetric(event: TimelineEvent): number {
    if (event.kind === 'milestone') {
        if (event.milestoneMinutes > 0) {
            return event.milestoneMinutes;
        }
        if (event.milestoneCharacters > 0) {
            return event.milestoneCharacters / CHARACTERS_PER_MINUTE_ESTIMATE;
        }
    }

    if (event.totalMinutes > 0) {
        if (event.kind === 'started') {
            return Math.max(WAVE_METRIC_FLOOR, Math.min(event.totalMinutes * WAVE_METRIC_MINUTE_SCALE, WAVE_METRIC_CEILING));
        }
        return event.totalMinutes;
    }

    if (event.totalCharacters > 0) {
        const scaledCharacters = event.totalCharacters / CHARACTERS_PER_MINUTE_ESTIMATE;
        if (event.kind === 'started') {
            return Math.max(WAVE_METRIC_FLOOR, Math.min(scaledCharacters * WAVE_METRIC_MINUTE_SCALE, WAVE_METRIC_CEILING));
        }
        return scaledCharacters;
    }

    return WAVE_METRIC_FLOOR;
}

export function getBucketWaveMetric(bucket: TimelineBucket): number {
    if (bucket.loggedMinutes > 0) {
        return bucket.loggedMinutes;
    }

    if (bucket.loggedCharacters > 0) {
        return bucket.loggedCharacters / CHARACTERS_PER_MINUTE_ESTIMATE;
    }

    return WAVE_METRIC_FLOOR;
}