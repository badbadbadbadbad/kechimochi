import { formatCompactDuration, parseDuration, withEpisodeCount } from '../../time';
import { wireDigitsOnlyInput } from '../../counts';

export const MAX_EPISODE_COUNT_DIGITS = 4;

const PRECISE_POINTER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

function hasPrecisePointer(): boolean {
    return globalThis.matchMedia?.(PRECISE_POINTER_MEDIA_QUERY).matches ?? false;
}

export interface EpisodeStepperElements {
    field: HTMLElement;
    decrementButton: HTMLButtonElement;
    incrementButton: HTMLButtonElement;
    countInput: HTMLInputElement;
    episodeDurationLabel: HTMLElement;
}

export function wireEpisodeStepper(
    elements: EpisodeStepperElements,
    durationInput: HTMLInputElement,
    getEpisodeDurationMinutes: () => number | null,
): { refresh: () => void } {
    const { field, decrementButton, incrementButton, countInput, episodeDurationLabel } = elements;

    const readEpisodeCount = (): number | null => {
        const episodeDurationMinutes = getEpisodeDurationMinutes();
        if (episodeDurationMinutes === null) return null;
        const result = parseDuration(durationInput.value, episodeDurationMinutes);
        return result.status === 'parsed' ? result.episodeCount : null;
    };

    const readTypedEpisodeCount = (): number => Number(countInput.value.slice(0, MAX_EPISODE_COUNT_DIGITS));

    const refresh = () => {
        const episodeDurationMinutes = getEpisodeDurationMinutes();
        field.hidden = episodeDurationMinutes === null;
        if (episodeDurationMinutes === null) return;

        episodeDurationLabel.textContent = formatCompactDuration(episodeDurationMinutes);

        const episodeCount = readEpisodeCount();
        const isTypingMatchingCount = document.activeElement === countInput && readTypedEpisodeCount() === episodeCount;
        if (!isTypingMatchingCount) {
            countInput.value = episodeCount === null ? '' : String(episodeCount);
        }
        countInput.disabled = episodeCount === null;
        decrementButton.disabled = episodeCount === null || episodeCount === 0;
        incrementButton.disabled = episodeCount === null;
    };

    const applyEpisodeCount = (nextEpisodeCount: number) => {
        durationInput.value = withEpisodeCount(durationInput.value, nextEpisodeCount);
        durationInput.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const stepEpisodeCount = (delta: number) => {
        const episodeCount = readEpisodeCount();
        if (episodeCount === null) return;
        applyEpisodeCount(Math.max(0, episodeCount + delta));
        if (hasPrecisePointer()) {
            countInput.focus();
            countInput.select();
        }
    };

    wireDigitsOnlyInput(countInput);
    countInput.addEventListener('input', () => {
        if (countInput.value.length > MAX_EPISODE_COUNT_DIGITS) {
            countInput.value = countInput.value.slice(0, MAX_EPISODE_COUNT_DIGITS);
        }
        if (readEpisodeCount() === null) return;
        applyEpisodeCount(readTypedEpisodeCount());
    });
    countInput.addEventListener('blur', refresh);
    decrementButton.addEventListener('click', () => stepEpisodeCount(-1));
    incrementButton.addEventListener('click', () => stepEpisodeCount(1));
    durationInput.addEventListener('input', refresh);
    refresh();

    return { refresh };
}
