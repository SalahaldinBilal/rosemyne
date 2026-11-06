import styles from "./SideNav.module.scss";
import { createEffect, createSignal, JSX, on, onCleanup, onMount } from "solid-js";

// One indicator for the whole list, so the active highlight slides between items instead of jumping.
function SideNav(props: { activeKey: string | undefined, children: JSX.Element }) {
  const [offset, setOffset] = createSignal<{ top: number, height: number } | null>(null);
  const [animate, setAnimate] = createSignal(false);
  let root: HTMLDivElement | undefined;

  function measure() {
    const active = root?.querySelector<HTMLElement>(":scope > [data-active]");
    setOffset(active ? { top: active.offsetTop, height: active.offsetHeight } : null);
  }

  onMount(() => {
    measure();
    requestAnimationFrame(() => setAnimate(true));

    const observer = new ResizeObserver(measure);
    if (root) observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  createEffect(on(() => props.activeKey, () => queueMicrotask(measure), { defer: true }));

  return (
    <div ref={root} class={styles.SideNav}>
      <span
        class={styles.Indicator}
        classList={{ [styles.Animated]: animate(), [styles.Hidden]: !offset() }}
        style={{ transform: `translateY(${offset()?.top ?? 0}px)`, height: `${offset()?.height ?? 0}px` }}
      />
      {props.children}
    </div>
  );
}

export default SideNav;
