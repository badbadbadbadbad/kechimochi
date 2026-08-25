export interface FocusState {
    elementId: string;
    selectionStart: number | null;
    selectionEnd: number | null;
}

/**
 * Captures which element inside `root` is focused, so it can be restored after an
 * `innerHTML` replacement detaches and recreates it.
 */
export function captureFocusState(root: HTMLElement): FocusState | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return null;
    if (!root.contains(activeElement)) return null;
    if (!activeElement.id) return null;

    const selectionStart = 'selectionStart' in activeElement ? (activeElement as HTMLInputElement).selectionStart : null;
    const selectionEnd = 'selectionEnd' in activeElement ? (activeElement as HTMLInputElement).selectionEnd : null;

    return {
        elementId: activeElement.id,
        selectionStart,
        selectionEnd,
    };
}

export function restoreFocusState(root: HTMLElement, state: FocusState | null): void {
    if (!state) return;

    const element = document.getElementById(state.elementId);
    if (!element || !root.contains(element)) return;

    element.focus({ preventScroll: true });
    if (state.selectionStart === null || state.selectionEnd === null) return;
    if (!('setSelectionRange' in element)) return;

    try {
        (element as HTMLInputElement).setSelectionRange(state.selectionStart, state.selectionEnd);
    } catch {
        // Some input types (e.g. number, email) do not support text selection.
    }
}