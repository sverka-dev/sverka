// @sverka/verification — shared TUI input handling helpers.

/** Minimal Ink Key type for input handling. */
export interface InputKey {
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

/**
 * Handle search input state. Returns true if the input was consumed by
 * search mode, false if it should be handled by the caller.
 *
 * @param input - The input character from Ink
 * @param key - The key modifiers from Ink
 * @param state - The search state (mutated in place)
 * @returns true if the input was consumed by search mode
 */
export function handleSearchInput(
  input: string,
  key: InputKey,
  state: { searching: boolean; search: string },
): boolean {
  if (!state.searching) {
    if (input === "/") {
      state.searching = true;
      return true;
    }
    return false;
  }

  if (key.escape || key.return) {
    state.searching = false;
  } else if (key.backspace || key.delete) {
    state.search = state.search.slice(0, -1);
  } else if (input && !key.ctrl && !key.meta) {
    state.search += input;
  }
  return true;
}

/**
 * Check if the input is a quit command (q or Ctrl+C).
 */
export function isQuitInput(input: string, key: InputKey): boolean {
  return input === "q" || (key.ctrl && input === "c");
}
