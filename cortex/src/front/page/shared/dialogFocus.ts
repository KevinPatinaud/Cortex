import type { KeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;

  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) =>
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    !element.closest("[hidden], [inert]") &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  ).filter((element, _, candidates) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) {
      return true;
    }

    const group = candidates.filter((candidate) =>
      candidate instanceof HTMLInputElement &&
      candidate.type === "radio" &&
      candidate.name === element.name &&
      candidate.form === element.form
    ) as HTMLInputElement[];

    return element === (group.find((radio) => radio.checked) ?? group[0]);
  });

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
