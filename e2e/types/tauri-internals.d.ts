/**
 * Ambient declaration for the Tauri internals bridge that E2E specs use to invoke
 * backend commands directly, bypassing the UI.
 */
declare global {
    var __TAURI_INTERNALS__: {
        invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
    };
}

export {};
