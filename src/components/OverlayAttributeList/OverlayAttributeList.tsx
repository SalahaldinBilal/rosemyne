import { createMemo, For, mapArray, Match, Switch } from "solid-js";
import styles from "./OverlayAttributeList.module.scss";
import { ImageOverlayAttributeMap, ImageOverlayNumberAttribute, ImageOverlaySelectAttribute } from "@core/types/imageOverlay";
import Select from "@core/components/Select/Select";
import Input from "@core/components/Input/Input";
import NumberField from "@core/components/NumberField/NumberField";
import { DefaultColorPicker } from "@thednp/solid-color-picker";
import { beautifyCamelOrPascalCase } from "@core/helpers";

// Shared by a placed item's right-click menu (ImageOverlayBase) and the Overlay defaults page.
function OverlayAttributeList(props: { attributes: ImageOverlayAttributeMap, onChange: (name: string, value: any) => void }) {
  const attributes = mapArray(() => Object.entries(props.attributes), ([name, value]) => ({ name, ...value }));

  return <div class={styles.AttributeList}>
    <For each={attributes()}>{attribute => {
      const label = createMemo(() => beautifyCamelOrPascalCase(attribute.name));
      const options = createMemo(() => attribute.type === "select"
        ? (attribute as ImageOverlaySelectAttribute).options.map(option => ({ id: option, value: option, label: option }))
        : []);

      return <div class={styles.AttributeRow}>
        <span class={styles.AttributeLabel}>{label()}</span>
        <div class={styles.AttributeControl}>
          <Switch>
            <Match when={attribute.type === "color"}>
              <div class={styles.ColorPickerWrapper}>
                <DefaultColorPicker
                  format="hex"
                  theme="dark"
                  value={attribute.value as string}
                  onChange={color => props.onChange(attribute.name, color)}
                />
              </div>
            </Match>
            <Match when={attribute.type === "number"}>
              <NumberField
                size="sm"
                width={84}
                decimals={2}
                value={attribute.value as number}
                min={(attribute as ImageOverlayNumberAttribute).min ?? 0}
                max={(attribute as ImageOverlayNumberAttribute).max}
                onChange={value => props.onChange(attribute.name, value)}
              />
            </Match>
            <Match when={attribute.type === "string"}>
              <Input
                size="sm"
                class={styles.TextInput}
                value={attribute.value as string}
                onChange={e => props.onChange(attribute.name, e.currentTarget.value)}
              />
            </Match>
            <Match when={attribute.type === "select"}>
              <Select
                variant="pill"
                class={styles.SelectInput}
                value={attribute.value as string}
                items={options()}
                onItemClick={item => props.onChange(attribute.name, item.value)}
              />
            </Match>
          </Switch>
        </div>
      </div>;
    }}</For>
  </div>;
}

export default OverlayAttributeList;
