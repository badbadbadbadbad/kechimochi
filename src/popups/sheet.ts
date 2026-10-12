import { pushBackHandler } from '../back_stack';

export const SHEET_LAYOUT_MEDIA_QUERY = '(max-width: 768px)';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface SheetOptions {
    readonly content: HTMLElement;
    readonly label: string;
    readonly returnFocusTo?: HTMLElement;
    readonly onClose?: () => void;
}

export interface SheetHandle {
    readonly panelElement: HTMLElement;
    close(): void;
}

export function isSheetLayout(): boolean {
    return globalThis.matchMedia?.(SHEET_LAYOUT_MEDIA_QUERY).matches ?? false;
}

export function openSheet({ content, label, returnFocusTo, onClose }: SheetOptions): SheetHandle {
    const scrimElement = document.createElement('div');
    scrimElement.className = 'sheet-scrim';

    const panelElement = document.createElement('div');
    panelElement.className = 'sheet-panel';
    panelElement.setAttribute('role', 'dialog');
    panelElement.setAttribute('aria-modal', 'true');
    panelElement.setAttribute('aria-label', label);
    panelElement.tabIndex = -1;
    panelElement.appendChild(content);

    const keepFocusInside = (event: KeyboardEvent) => {
        const focusableElements = Array.from(panelElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter(element => element.closest('[hidden]') === null);
        if (focusableElements.length === 0) {
            event.preventDefault();
            panelElement.focus();
            return;
        }
        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1)!;
        const activeElement = document.activeElement;
        const isFocusOutside = !(activeElement instanceof Node) || !panelElement.contains(activeElement) || activeElement === panelElement;
        if (event.shiftKey && (activeElement === firstElement || isFocusOutside)) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && (activeElement === lastElement || isFocusOutside)) {
            event.preventDefault();
            firstElement.focus();
        }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Tab') {
            keepFocusInside(event);
            return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };

    const sheetLayoutQuery = globalThis.matchMedia?.(SHEET_LAYOUT_MEDIA_QUERY) ?? null;
    const handleLayoutChange = () => close();

    let isClosed = false;
    const removeBackHandler = pushBackHandler(() => {
        close();
        return true;
    });

    function close() {
        if (isClosed) return;
        isClosed = true;
        document.removeEventListener('keydown', handleKeyDown, true);
        sheetLayoutQuery?.removeEventListener?.('change', handleLayoutChange);
        removeBackHandler();
        scrimElement.remove();
        panelElement.remove();
        returnFocusTo?.focus();
        onClose?.();
    }

    scrimElement.addEventListener('click', (event) => {
        event.preventDefault();
        close();
    });
    document.addEventListener('keydown', handleKeyDown, true);
    sheetLayoutQuery?.addEventListener?.('change', handleLayoutChange);
    document.body.append(scrimElement, panelElement);
    panelElement.focus();

    return { panelElement, close };
}
