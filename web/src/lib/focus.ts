/*
  A menu that opens a window has a problem: by the time the window mounts,
  focus sits inside the popup that is about to vanish, and the key that
  opened it has already dropped its aria-controls. So the key says where to
  return before it acts, and the window collects the note when it opens.
*/
let noted: HTMLElement | null = null

/** Called by a control just before an action that may open a window. */
export function returnFocusTo(el: HTMLElement | null) {
  noted = el
}

/** Called by the window as it opens; the note is used once. */
export function takeReturnFocus(): HTMLElement | null {
  const el = noted
  noted = null
  return el
}
