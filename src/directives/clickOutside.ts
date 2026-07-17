import { onCleanup } from "solid-js";

export function clickOutside(el: HTMLElement, onOutsideClickAccessor: () => (() => void)) {
  const onOutsideClick = onOutsideClickAccessor();

  const onClick = (e: MouseEvent) => {
    if (e.target instanceof Element && !el.contains(e.target))
      onOutsideClick();
  };

  document.body.addEventListener("click", onClick);
  onCleanup(() => document.body.removeEventListener("click", onClick));
}