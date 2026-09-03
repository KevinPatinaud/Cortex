import type { KeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;

  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) => !element.hidden && element.offsetParent !== null);

  if (elements.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const firstElement = elements[0];
  const lastElement = elements[elements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && (activeElement === firstElement || !elements.includes(activeElement as HTMLElement))) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && (activeElement === lastElement || !elements.includes(activeElement as HTMLElement))) {
    event.preventDefault();
    firstElement.focus();
  }
}
