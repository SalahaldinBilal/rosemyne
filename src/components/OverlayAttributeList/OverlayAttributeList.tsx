import { For, mapArray, Match, Switch } from "solid-js";
import { unwrap } from "solid-js/store";
import styles from "./OverlayAttributeList.module.scss";
import { ImageOverlayAttributeMap, ImageOverlayNumberAttribute, ImageOverlaySelectAttribute } from "@core/types/imageOverlay";
import Select from "@core/components/Select/Select";
import Input from "@core/components/Input/Input";
import { DefaultColorPicker } from "@thednp/solid-color-picker";
import { beautifyCamelOrPascalCase } from "@core/helpers";

// Shared between the overlay's own right-click menu (ImageOverlayBase) and the
// Overlay Defaults settings page , both edit the same attribute-map shape,
// just backed by a different store (a placed item's attributes vs. the
// defaults a new item is created with).
function OverlayAttributeList(props: { attributes: ImageOverlayAttributeMap, onChange: (name: string, value: any) => void }) {
  const attributes = mapArray(() => Object.entries(props.attributes), ([name, value]) => ({ name, ...value }));

  return <div class={styles.AttributeList}>
    <For each={attributes()}>{attribute =>
      <div class={styles.AttributeRow} id={JSON.stringify(unwrap(attribute))}>
        <span class={styles.AttributeLabel}>{beautifyCamelOrPascalCase(attribute.name)}</span>
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
              <Input
                type="number"
                value={attribute.value as number}
                onChange={e => props.onChange(attribute.name, e.currentTarget.valueAsNumber ?? 0)}
                min={(attribute as ImageOverlayNumberAttribute).min}
                max={(attribute as ImageOverlayNumberAttribute).max}
                alignText="right"
                style={{ width: "70px" }}
                inputStyle={{ height: "26px", padding: "0 8px" }}
              />
            </Match>
            <Match when={attribute.type === "string"}>
              <Input
                value={attribute.value as string}
                onChange={e => props.onChange(attribute.name, e.currentTarget.value)}
                style={{ width: "110px" }}
                inputStyle={{ height: "26px", padding: "0 8px" }}
              />
            </Match>
            <Match when={attribute.type === "select"}>
              <Select
                value={attribute.value as string}
                items={(attribute as ImageOverlaySelectAttribute).options.map(option => ({ id: option, value: option, label: option }))}
                onItemClick={item => props.onChange(attribute.name, item.value)}
                style={{ "min-width": "110px", height: "26px", padding: "0 8px", "font-size": "12px" }}
              />
            </Match>
          </Switch>
        </div>
      </div>
    }</For>
  </div>;
}

export default OverlayAttributeList;
