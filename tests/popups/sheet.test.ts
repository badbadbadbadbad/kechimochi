import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSheetLayout, openSheet as openSheetUnderTest, type SheetHandle, type SheetOptions } from '../../src/popups/sheet';
import { configureBackStack, resetBackStack } from '../../src/back_stack';

describe('sheet.ts', () => {
    let capturedBackHandler: (() => void | Promise<void>) | null = null;
    let content: HTMLElement;
    let returnFocusTo: HTMLButtonElement;
    let openedSheets: SheetHandle[] = [];

    const openSheet = (options: SheetOptions): SheetHandle => {
        const sheet = openSheetUnderTest(options);
        openedSheets.push(sheet);
        return sheet;
    };

    const configureCapturingBackStack = (): void => {
        configureBackStack({
            subscribe: async handler => {
                capturedBackHandler = handler;
                return () => { capturedBackHandler = null; };
            },
            onEmpty: () => undefined,
        });
    };

    const pressEscape = (): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        document.body.innerHTML = '';
        capturedBackHandler = null;
        resetBackStack();
        content = document.createElement('div');
        content.innerHTML = '<button type="button" id="sheet-content-button">Inside</button>';
        returnFocusTo = document.createElement('button');
        document.body.appendChild(returnFocusTo);
    });

    afterEach(() => {
        openedSheets.forEach(sheet => sheet.close());
        openedSheets = [];
        vi.unstubAllGlobals();
        resetBackStack();
        document.body.innerHTML = '';
    });

    describe('isSheetLayout', () => {
        it('should follow the sheet layout media query', () => {
            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
            expect(isSheetLayout()).toBe(true);

            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
            expect(isSheetLayout()).toBe(false);
        });
    });

    describe('openSheet', () => {
        it('should render the content in a labelled dialog panel above a scrim and focus the panel', () => {
            const { panelElement } = openSheet({ content, label: 'Date' });

            expect(panelElement.getAttribute('role')).toBe('dialog');
            expect(panelElement.getAttribute('aria-label')).toBe('Date');
            expect(panelElement.contains(content)).toBe(true);
            expect(document.querySelector('.sheet-scrim')).not.toBeNull();
            expect(document.activeElement).toBe(panelElement);
        });

        it('should close on Escape, restore focus and report the close', () => {
            const onClose = vi.fn();
            openSheet({ content, label: 'Date', returnFocusTo, onClose });

            const event = pressEscape();

            expect(event.defaultPrevented).toBe(true);
            expect(document.querySelector('.sheet-panel')).toBeNull();
            expect(document.querySelector('.sheet-scrim')).toBeNull();
            expect(document.activeElement).toBe(returnFocusTo);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('should close on a click on the scrim and consume that click', () => {
            const onClose = vi.fn();
            openSheet({ content, label: 'Date', onClose });
            const click = new MouseEvent('click', { bubbles: true, cancelable: true });

            document.querySelector('.sheet-scrim')!.dispatchEvent(click);

            expect(click.defaultPrevented).toBe(true);
            expect(document.querySelector('.sheet-panel')).toBeNull();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('should stay open on a pointer down on the scrim, so the closing tap cannot reach what is underneath', () => {
            openSheet({ content, label: 'Date' });

            document.querySelector('.sheet-scrim')!.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

            expect(document.querySelector('.sheet-panel')).not.toBeNull();
        });

        it('should stay open on a click inside the panel', () => {
            openSheet({ content, label: 'Date' });

            content.querySelector('button')!.click();

            expect(document.querySelector('.sheet-panel')).not.toBeNull();
        });

        it('should keep Tab focus inside the panel', () => {
            content.innerHTML = '<button type="button" id="first">First</button><button type="button" id="last">Last</button>';
            openSheet({ content, label: 'Date' });
            const lastButton = content.querySelector<HTMLButtonElement>('#last')!;
            const firstButton = content.querySelector<HTMLButtonElement>('#first')!;

            lastButton.focus();
            const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            document.dispatchEvent(forwardTab);
            expect(forwardTab.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(firstButton);

            const backwardTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
            document.dispatchEvent(backwardTab);
            expect(document.activeElement).toBe(lastButton);
        });

        it('should close when the layout leaves the sheet breakpoint', () => {
            let fireLayoutChange: () => void = () => {};
            vi.stubGlobal('matchMedia', vi.fn(() => ({
                matches: true,
                addEventListener: (_type: string, listener: () => void) => { fireLayoutChange = listener; },
                removeEventListener: vi.fn(),
            })));
            const onClose = vi.fn();
            openSheet({ content, label: 'Date', onClose });

            fireLayoutChange();

            expect(document.querySelector('.sheet-panel')).toBeNull();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('should close through the system back button', async () => {
            configureCapturingBackStack();
            const onClose = vi.fn();
            openSheet({ content, label: 'Date', onClose });
            await vi.waitFor(() => expect(capturedBackHandler).not.toBeNull());

            await capturedBackHandler?.();

            expect(document.querySelector('.sheet-panel')).toBeNull();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('should unregister its back handler on close, leaving no stale stack entry', async () => {
            configureCapturingBackStack();
            const { close } = openSheet({ content, label: 'Date' });
            await vi.waitFor(() => expect(capturedBackHandler).not.toBeNull());

            close();

            await vi.waitFor(() => expect(capturedBackHandler).toBeNull());
        });

        it('should report the close only once and stop handling Escape after closing', () => {
            const onClose = vi.fn();
            const { close } = openSheet({ content, label: 'Date', onClose });

            close();
            close();
            const event = pressEscape();

            expect(onClose).toHaveBeenCalledTimes(1);
            expect(event.defaultPrevented).toBe(false);
        });
    });
});
