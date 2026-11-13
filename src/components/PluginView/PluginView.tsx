import styles from "./PluginView.module.scss";
import { createEffect, createMemo, createSignal, For, JSX, Match, on, Show, Switch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { PluginNode, PluginUiEvent } from "@core/types/plugins";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { errorMessage } from "@core/helpers/errorMessage";
import useToastState from "@core/states/toastState";
import Badge, { BadgeTone } from "@core/components/Badge/Badge";
import Button from "@core/components/Button/Button";
import DimensionField, { Dimensions } from "@core/components/NumberField/DimensionField";
import DurationField from "@core/components/DurationField/DurationField";
import EmptyState from "@core/components/EmptyState/EmptyState";
import FileSizeField from "@core/components/FileSizeField/FileSizeField";
import Input from "@core/components/Input/Input";
import Modal from "@core/components/Modal/Modal";
import NumberField from "@core/components/NumberField/NumberField";
import { Progress } from "@core/components/Progress/Progress";
import Segmented from "@core/components/Segmented/Segmented";
import Select from "@core/components/Select/Select";
import TemplateInput from "@core/components/TemplateInput/TemplateInput";
import { TemplateVariable } from "@core/constants/templateVariables";
import { InlineControls, SettingRow, SettingsGroup, ToggleRow } from "@core/pages/Settings/SettingsLayout/SettingsLayout";
import { ExternalLink, Puzzle } from "lucide-solid";

const INPUT_TYPES = ["toggle", "select", "segmented", "number", "duration", "fileSize", "dimension", "text", "template"];
const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "danger-solid", "warn"] as const;
const BADGE_TONES: readonly BadgeTone[] = ["neutral", "accent", "ok", "warn", "danger"];
const LABEL_TONES = ["normal", "muted", "warn", "danger"];

type Choice = { value: string | number, label: string };

function findNode(nodes: PluginNode[], id: string): PluginNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children && findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

// Updates land in place, keyed by node id. Replacing the tree would rebuild the DOM and close an open Select.
export function createPluginTree() {
  const [nodes, setNodes] = createStore<PluginNode[]>([]);

  function apply(tree: PluginNode[]) {
    setNodes(reconcile(tree, { key: "id" }));
  }

  function setValue(id: string, value: unknown) {
    setNodes(produce(list => {
      const node = findNode(list, id);
      if (node) node.value = value;
    }));
  }

  return { nodes, apply, setValue };
}

export function pluginAssetUrl(pluginId: string, asset: string): string {
  return `http://rosemyne-photo.localhost/plugin-asset/${encodeURIComponent(pluginId)}/${encodeURIComponent(asset)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function choices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Choice =>
    !!item && typeof item === "object"
    && (typeof item.value === "string" || typeof item.value === "number")
    && typeof item.label === "string");
}

function variables(value: unknown): TemplateVariable[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => !!item && typeof item === "object" && typeof item.name === "string")
    .map(item => ({ name: item.name, description: text(item.description) }));
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function dimensions(value: unknown): Dimensions {
  const size = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { width: number(size.width, 0), height: number(size.height, 0) };
}

type ViewContext = {
  pluginId: string,
  busy: () => boolean,
  value: (node: PluginNode) => unknown,
  change: (node: PluginNode, value: unknown) => void,
  click: (node: PluginNode) => void,
  openLink: (url: string) => void,
};

// Typed text is only sent when the field is left or Enter is pressed, never per keystroke.
function TextControl(props: { node: PluginNode, context: ViewContext }) {
  const committed = createMemo(() => text(props.context.value(props.node)));
  const [draft, setDraft] = createSignal(committed());
  const maxLength = createMemo(() => optionalNumber(props.node.maxLength));

  createEffect(on(committed, value => setDraft(value), { defer: true }));

  function commit() {
    if (draft() !== committed()) props.context.change(props.node, draft());
  }

  return (
    <Input
      value={draft()}
      type={props.node.secret === true ? "password" : "text"}
      placeholder={text(props.node.placeholder)}
      disabled={props.context.busy()}
      style={{ width: "240px" }}
      onChange={event => {
        const limit = maxLength();
        setDraft(limit === undefined ? event.currentTarget.value : event.currentTarget.value.slice(0, limit));
      }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function TemplateControl(props: { node: PluginNode, context: ViewContext }) {
  const committed = createMemo(() => text(props.context.value(props.node)));
  const [draft, setDraft] = createSignal(committed());
  const names = createMemo(() => variables(props.node.variables));

  createEffect(on(committed, value => setDraft(value), { defer: true }));

  function commit() {
    if (draft() !== committed()) props.context.change(props.node, draft());
  }

  return (
    <TemplateInput
      value={draft()}
      variables={names()}
      placeholder={text(props.node.placeholder)}
      disabled={props.context.busy()}
      style={{ width: "280px" }}
      onChange={next => setDraft(next)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function Control(props: { node: PluginNode, context: ViewContext }) {
  const value = createMemo(() => props.context.value(props.node));
  const items = createMemo(() => choices(props.node.items));
  const selectItems = createMemo(() => items().map(item => ({ id: item.value, value: item.value, label: item.label })));
  const segmentedItems = createMemo(() => items().map(item => ({ id: item.value, label: item.label })));
  const picked = createMemo(() => {
    const current = value();
    return typeof current === "string" || typeof current === "number" ? current : "";
  });
  const buttonVariant = createMemo(() => BUTTON_VARIANTS.find(variant => variant === props.node.variant) ?? "secondary");
  const badgeTone = createMemo(() => BADGE_TONES.find(tone => tone === props.node.tone) ?? "neutral");
  const labelTone = createMemo(() => LABEL_TONES.find(tone => tone === props.node.tone) ?? "normal");
  const percent = createMemo(() => {
    const fraction = optionalNumber(props.node.value);
    return props.node.indeterminate === true || fraction === undefined ? null : fraction * 100;
  });
  const imageHeight = createMemo(() => `${Math.min(600, number(props.node.maxHeight, 240))}px`);

  return (
    <Switch>
      <Match when={props.node.type === "select"}>
        <Select
          value={picked()}
          items={selectItems()}
          onItemClick={item => props.context.change(props.node, item.value)}
          style={{ "min-width": "160px" }}
        />
      </Match>
      <Match when={props.node.type === "segmented"}>
        <Segmented items={segmentedItems()} value={picked()} size="sm" onChange={next => props.context.change(props.node, next)} />
      </Match>
      <Match when={props.node.type === "number"}>
        <NumberField
          value={optionalNumber(value()) ?? null}
          min={optionalNumber(props.node.min)}
          max={optionalNumber(props.node.max)}
          step={optionalNumber(props.node.step)}
          unit={optionalText(props.node.unit)}
          disabled={props.context.busy()}
          width={120}
          onChange={next => props.context.change(props.node, next)}
        />
      </Match>
      <Match when={props.node.type === "duration"}>
        <DurationField valueMs={number(value(), 0)} disabled={props.context.busy()} onChange={next => props.context.change(props.node, next)} />
      </Match>
      <Match when={props.node.type === "fileSize"}>
        <FileSizeField valueBytes={number(value(), 0)} onChange={next => props.context.change(props.node, next)} />
      </Match>
      <Match when={props.node.type === "dimension"}>
        <DimensionField
          value={dimensions(value())}
          min={optionalNumber(props.node.min)}
          max={optionalNumber(props.node.max)}
          disabled={props.context.busy()}
          onChange={next => props.context.change(props.node, next)}
        />
      </Match>
      <Match when={props.node.type === "text"}>
        <TextControl node={props.node} context={props.context} />
      </Match>
      <Match when={props.node.type === "template"}>
        <TemplateControl node={props.node} context={props.context} />
      </Match>
      <Match when={props.node.type === "button"}>
        <Button
          size="sm"
          variant={buttonVariant()}
          disabled={props.context.busy() || props.node.disabled === true}
          onClick={() => props.context.click(props.node)}
        >
          {text(props.node.label)}
        </Button>
      </Match>
      <Match when={props.node.type === "label"}>
        <span class={styles.Label} data-tone={labelTone()}>{text(props.node.text)}</span>
      </Match>
      <Match when={props.node.type === "badge"}>
        <Badge tone={badgeTone()}>{text(props.node.text)}</Badge>
      </Match>
      <Match when={props.node.type === "progress"}>
        <Progress percent={percent()} class={styles.Progress} />
      </Match>
      <Match when={props.node.type === "link"}>
        <button type="button" class={styles.Link} onClick={() => props.context.openLink(text(props.node.url))}>
          {text(props.node.label) || text(props.node.url)}
          <ExternalLink size={12} />
        </button>
      </Match>
      <Match when={props.node.type === "image"}>
        <img
          class={styles.Image}
          style={{ "max-height": imageHeight() }}
          src={pluginAssetUrl(props.context.pluginId, text(props.node.asset))}
          alt=""
          draggable={false}
        />
      </Match>
      <Match when={props.node.type === "emptyState"}>
        <EmptyState icon={<Puzzle size={20} />} title={text(props.node.title)}>{text(props.node.text)}</EmptyState>
      </Match>
    </Switch>
  );
}

// One entry of a group's card: a labelled row for inputs, a plain padded block for everything else.
function Item(props: { node: PluginNode, context: ViewContext }) {
  const isInput = createMemo(() => INPUT_TYPES.includes(props.node.type));
  const children = createMemo(() => props.node.children ?? []);
  const checked = createMemo(() => props.context.value(props.node) === true);

  return (
    <Switch fallback={<div class={styles.Loose}><Control node={props.node} context={props.context} /></div>}>
      <Match when={props.node.type === "toggle"}>
        <ToggleRow
          label={text(props.node.label)}
          hint={optionalText(props.node.hint)}
          checked={checked()}
          disabled={props.context.busy()}
          onChange={next => props.context.change(props.node, next)}
        />
      </Match>
      <Match when={props.node.type === "inline"}>
        <SettingRow label={text(props.node.label)} hint={optionalText(props.node.hint)}>
          <InlineControls>
            <For each={children()}>{child => <Control node={child} context={props.context} />}</For>
          </InlineControls>
        </SettingRow>
      </Match>
      <Match when={props.node.type === "group"}>
        <Show when={optionalText(props.node.title)}>
          {title => <div class={styles.SubHead}>{title()}</div>}
        </Show>
        <For each={children()}>{child => <Item node={child} context={props.context} />}</For>
      </Match>
      <Match when={isInput()}>
        <SettingRow label={text(props.node.label)} hint={optionalText(props.node.hint)}>
          <Control node={props.node} context={props.context} />
        </SettingRow>
      </Match>
    </Switch>
  );
}

function PluginView(props: {
  pluginId: string,
  nodes: PluginNode[],
  // Stored values of static settings, which win over the `value` the manifest declares.
  values?: Record<string, unknown>,
  busy?: boolean,
  onEvent: (event: PluginUiEvent) => void,
}) {
  const [pendingLink, setPendingLink] = createSignal<URL | null>(null);
  const { pushToast } = useToastState;

  const busy = createMemo(() => props.busy ?? false);

  const context: ViewContext = {
    get pluginId() {
      return props.pluginId;
    },
    busy,
    value: node => {
      const stored = node.id === undefined ? undefined : props.values?.[node.id];
      return stored === undefined ? node.value : stored;
    },
    change: (node, value) => {
      if (node.id !== undefined) props.onEvent({ id: node.id, type: "change", value });
    },
    click: node => {
      if (node.id !== undefined) props.onEvent({ id: node.id, type: "click" });
    },
    openLink: url => {
      const parsed = parseUrl(url);
      if (parsed?.protocol === "https:") setPendingLink(parsed);
    },
  };

  function openPendingLink() {
    const link = pendingLink();
    setPendingLink(null);
    if (link) safeInvoke("open_plugin_link", { url: link.href }).catch(error => pushToast(errorMessage(error), "error", 6000));
  }

  function group(node: PluginNode): JSX.Element {
    return (
      <SettingsGroup title={node.type === "group" ? optionalText(node.title) : undefined}>
        <Show when={node.type === "group"} fallback={<Item node={node} context={context} />}>
          <Show when={optionalText(node.description)}>
            {description => <div class={styles.Description}>{description()}</div>}
          </Show>
          <For each={node.children ?? []}>{child => <Item node={child} context={context} />}</For>
        </Show>
      </SettingsGroup>
    );
  }

  return <>
    <For each={props.nodes}>{group}</For>
    <Modal
      show={!!pendingLink()}
      onHide={() => setPendingLink(null)}
      title="Open this link?"
      width={420}
      footer={<>
        <Button onClick={() => setPendingLink(null)}>Cancel</Button>
        <Button variant="primary" onClick={openPendingLink}><ExternalLink size={15} />Open</Button>
      </>}
    >
      <p>It opens in your browser at <b>{pendingLink()?.hostname}</b>.</p>
      <p class={styles.LinkUrl}>{pendingLink()?.href}</p>
    </Modal>
  </>;
}

export default PluginView;
