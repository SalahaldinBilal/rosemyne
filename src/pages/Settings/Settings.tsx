import { createEffect, createMemo, createSignal, For, JSX, on, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import styles from "./Settings.module.scss";
import { ArrowLeft, Check, Search, SearchX, X } from "lucide-solid";
import { useLocation, useNavigate } from "@solidjs/router";
import { makeEventListener } from "@solid-primitives/event-listener";
import fuzzysort from "fuzzysort";
import SideNav from "@core/components/SideNav/SideNav";
import SideNavItem from "@core/components/SideNav/SideNavItem";
import EmptyState from "@core/components/EmptyState/EmptyState";
import KeyRenderer from "@core/components/KeyRenderer/KeyRenderer";
import { SETTINGS_ROUTES } from "@core/constants/settingsRoutes";
import { SETTINGS_SEARCH_ENTRIES, SettingsSearchEntry } from "@core/constants/settingsSearch";
import useSettingsSavedState from "@core/states/settingsSavedState";

type Searchable = SettingsSearchEntry & { where: string, hintText: string, keywordText: string };

const ROUTE_BY_PATH = new Map(SETTINGS_ROUTES.map(route => [route.path, route]));
const SEARCHABLE: Searchable[] = SETTINGS_SEARCH_ENTRIES.map(entry => ({
  ...entry,
  where: [ROUTE_BY_PATH.get(entry.page)?.title, entry.group].filter(Boolean).join(" › "),
  hintText: entry.hint ?? "",
  keywordText: entry.keywords ?? "",
}));
const SEARCH_KEYS = ["label", "where", "hintText", "keywordText"] as const;
// The label counts most. Descriptions and extra keywords only win when nothing matches the label as well.
const KEY_WEIGHTS = [1, 0.75, 0.55, 0.55];
const MIN_SCORE = 0.3;
const MAX_RESULTS = 40;
const FIND_ROW_FRAMES = 90;
const SEARCH_SHORTCUT = { keys: [{ key: "Control", char: "Ctrl" }, { key: "KeyF", char: "F" }] };

function highlighted(result: Fuzzysort.Result | undefined, fallback: string): JSX.Element {
  if (!result || result.score <= 0) return fallback;
  return <>{result.highlight((match, index) => <mark data-index={index}>{match}</mark>)}</>;
}

function Settings(props: { children?: JSX.Element }) {
  const location = useLocation();
  const page = createMemo(() => location.pathname.split("/")[2]);
  const navigate = useNavigate();
  const { saved } = useSettingsSavedState;
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const searching = createMemo(() => query().trim().length > 0);
  const results = createMemo(() => {
    const text = query().trim();
    if (!text) return [];
    return fuzzysort.go(text, SEARCHABLE, {
      keys: SEARCH_KEYS,
      threshold: MIN_SCORE,
      limit: MAX_RESULTS,
      scoreFn: keys => Math.max(...KEY_WEIGHTS.map((weight, index) => Math.max(0, keys[index]?.score ?? 0) * weight)),
    });
  });
  let body: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let resultList: HTMLDivElement | undefined;

  createEffect(on(page, () => {
    if (!body) return;
    body.scrollTop = 0;
    body.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: 360, easing: "cubic-bezier(.22,.8,.24,1)" },
    );
  }, { defer: true }));

  createEffect(on(query, () => setActive(0)));

  createEffect(on(active, index => {
    resultList?.querySelector<HTMLElement>(`[data-result="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, { defer: true }));

  makeEventListener(window, "keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyF") return;
    event.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  });

  // Pages load their data after mounting, so the row may take a few frames to appear.
  function revealRow(label: string) {
    let frames = 0;
    const look = () => {
      const row = body?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(label)}"]`);
      if (!row) {
        if (++frames < FIND_ROW_FRAMES) requestAnimationFrame(look);
        return;
      }
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      // Inset by 4px with a radius matching the card's corners, so the card's rounded clipping never cuts it off.
      row.animate(
        [
          { outline: "2px solid var(--accent)", outlineOffset: "-4px", borderRadius: "8px", backgroundColor: "var(--accent-soft)" },
          { outline: "2px solid transparent", outlineOffset: "-4px", borderRadius: "8px", backgroundColor: "transparent" },
        ],
        { duration: 1800, easing: "cubic-bezier(.55,0,.75,.2)" },
      );
    };
    requestAnimationFrame(look);
  }

  function open(entry: Searchable) {
    setQuery("");
    navigate(`/settings/${entry.page}`);
    if (!entry.isPage) revealRow(entry.label);
  }

  function onSearchKeyDown(event: KeyboardEvent) {
    const count = results().length;
    switch (event.key) {
      case "ArrowDown":
        if (!count) return;
        event.preventDefault();
        return setActive(index => (index + 1) % count);
      case "ArrowUp":
        if (!count) return;
        event.preventDefault();
        return setActive(index => (index - 1 + count) % count);
      case "Enter": {
        const picked = results()[active()];
        if (picked) open(picked.obj);
        return;
      }
      case "Escape":
        if (!query()) return;
        event.preventDefault();
        event.stopPropagation();
        return setQuery("");
    }
  }

  return <div class={styles.Main}>
    <div class={styles.SideBar}>
      <SideNavItem icon={<ArrowLeft />} onClick={() => navigate('/')}>
        Back to app
      </SideNavItem>
      <label class={styles.Search}>
        <Search size={14} />
        <input
          ref={searchInput}
          placeholder="Search"
          value={query()}
          spellcheck={false}
          onInput={event => setQuery(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
        />
        <Show when={query()} fallback={<KeyRenderer keys={SEARCH_SHORTCUT} size="sm" />}>
          <button type="button" class={styles.ClearSearch} aria-label="Clear search" onClick={event => { event.preventDefault(); setQuery(""); searchInput?.focus(); }}>
            <X size={13} />
          </button>
        </Show>
      </label>
      <div class={styles.Separator} />
      <SideNav activeKey={searching() ? "" : page()}>
        <For each={SETTINGS_ROUTES}>
          {route => <SideNavItem
            icon={<route.icon />}
            active={!searching() && page() === route.path}
            onClick={() => { setQuery(""); navigate(`/settings/${route.path}`); }}
          >
            {route.title}
          </SideNavItem>}
        </For>
      </SideNav>
      <div class={styles.Footer} classList={{ [styles.Saved]: saved() }} aria-live="polite">
        <Show when={saved()}>
          <Check size={13} />Saved
        </Show>
      </div>
    </div>
    <div class={styles.Body} ref={body}>
      {/* Hidden, not unmounted, so a half-edited page keeps its state while searching. */}
      <div hidden={searching()}>
        {props.children}
      </div>
      <Show when={searching()}>
        <div class={styles.Results} ref={resultList}>
          <h1 class={styles.ResultsTitle}>Search results</h1>
          <Show
            when={results().length > 0}
            fallback={
              <div class={styles.NoResults}>
                <EmptyState icon={<SearchX size={20} />} title="No settings match">
                  Try fewer or different words.
                </EmptyState>
              </div>
            }
          >
            <div class={styles.ResultCard} role="listbox">
              <For each={results()}>
                {(result, index) => {
                  const entry = result.obj;
                  const route = ROUTE_BY_PATH.get(entry.page);
                  const label = createMemo(() => highlighted(result[0], entry.label));
                  const hint = createMemo(() => highlighted(result[2], entry.hintText));
                  const selected = createMemo(() => index() === active());
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected()}
                      class={styles.Result}
                      classList={{ [styles.Active]: selected() }}
                      data-result={index()}
                      onMouseMove={() => setActive(index())}
                      onClick={() => open(entry)}
                    >
                      <span class={styles.ResultIcon}>
                        <Show when={route}>{found => <Dynamic component={found().icon} size={15} />}</Show>
                      </span>
                      <span class={styles.ResultText}>
                        <span class={styles.ResultLabel}>
                          <span class={styles.ResultName}>{label()}</span>
                          <span class={styles.ResultWhere}>{entry.isPage ? "Page" : entry.where}</span>
                        </span>
                        <Show when={entry.hintText}>
                          <span class={styles.ResultHint}>{hint()}</span>
                        </Show>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  </div>
}

export default Settings;
