import { beforeEach, describe, expect, it } from 'vitest';

import { captureFocusState, restoreFocusState } from '../src/focus_preservation';

describe('focus_preservation.ts', () => {
    let root: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    describe('captureFocusState', () => {
        it("should capture the focused element's id and selection range", () => {
            root.innerHTML = '<input id="search-input" type="search" value="hello world" />';
            const input = root.querySelector<HTMLInputElement>('#search-input')!;
            input.focus();
            input.setSelectionRange(2, 5);

            expect(captureFocusState(root)).toEqual({
                elementId: 'search-input',
                selectionStart: 2,
                selectionEnd: 5,
            });
        });

        it('should return null when nothing inside the root is focused', () => {
            root.innerHTML = '<input id="search-input" type="search" />';

            expect(captureFocusState(root)).toBeNull();
        });

        it('should return null when the focused element is outside the root', () => {
            const outsideInput = document.createElement('input');
            outsideInput.id = 'outside-input';
            document.body.appendChild(outsideInput);
            outsideInput.focus();

            expect(captureFocusState(root)).toBeNull();
        });

        it('should return null when the focused element has no id', () => {
            root.innerHTML = '<input type="search" />';
            const input = root.querySelector<HTMLInputElement>('input')!;
            input.focus();

            expect(captureFocusState(root)).toBeNull();
        });
    });

    describe('restoreFocusState', () => {
        it("should restore focus and caret after the container's innerHTML is replaced", () => {
            root.innerHTML = '<input id="search-input" type="search" value="hello world" />';
            const input = root.querySelector<HTMLInputElement>('#search-input')!;
            input.focus();
            input.setSelectionRange(2, 5);

            const state = captureFocusState(root);
            root.innerHTML = '<input id="search-input" type="search" value="hello world" />';
            restoreFocusState(root, state);

            const restoredInput = root.querySelector<HTMLInputElement>('#search-input')!;
            expect(document.activeElement).toBe(restoredInput);
            expect(restoredInput.selectionStart).toBe(2);
            expect(restoredInput.selectionEnd).toBe(5);
        });

        it('should do nothing when the captured state is null', () => {
            root.innerHTML = '<input id="search-input" type="search" />';

            expect(() => restoreFocusState(root, null)).not.toThrow();
            expect(document.activeElement).not.toBe(root.querySelector('#search-input'));
        });

        it('should not throw when the restored element rejects setSelectionRange', () => {
            root.innerHTML = '<input id="quantity-input" type="number" value="42" />';
            const input = root.querySelector<HTMLInputElement>('#quantity-input')!;
            input.focus();

            const state = { elementId: 'quantity-input', selectionStart: 0, selectionEnd: 2 };
            root.innerHTML = '<input id="quantity-input" type="number" value="42" />';

            expect(() => restoreFocusState(root, state)).not.toThrow();
            expect(document.activeElement).toBe(root.querySelector('#quantity-input'));
        });
    });
});