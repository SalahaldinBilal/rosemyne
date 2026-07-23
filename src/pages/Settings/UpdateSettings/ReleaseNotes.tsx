import styles from "./ReleaseNotes.module.scss";
import { createMemo, For } from "solid-js";

export type NotesBlock =
  | { type: "heading", text: string }
  | { type: "list", items: string[] }
  | { type: "text", text: string };

// CHANGELOG.md entries follow Keep a Changelog: "### " subheadings and "- "
// bullet lists: this file is our own generated changelog notes (see
// scripts/deploy.ts), not arbitrary markdown, so a full parser is overkill.
export function parseReleaseNotes(notes: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let currentList: string[] | null = null;

  function flushList() {
    if (currentList && currentList.length > 0) blocks.push({ type: "list", items: currentList });
    currentList = null;
  }

  for (const rawLine of notes.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
    } else if (line.startsWith("### ")) {
      flushList();
      blocks.push({ type: "heading", text: line.slice(4) });
    } else if (line.startsWith("- ")) {
      currentList ??= [];
      currentList.push(line.slice(2));
    } else {
      flushList();
      blocks.push({ type: "text", text: line });
    }
  }
  flushList();

  return blocks;
}

export function NotesBlocks(props: { blocks: NotesBlock[] }) {
  return (
    <div class={styles.Notes}>
      <For each={props.blocks}>{block => {
        switch (block.type) {
          case "heading": return <div class={styles.Heading}>{block.text}</div>;
          case "list": return (
            <ul class={styles.List}>
              <For each={block.items}>{item => <li>{item}</li>}</For>
            </ul>
          );
          case "text": return <p class={styles.Text}>{block.text}</p>;
        }
      }}</For>
    </div>
  );
}

function ReleaseNotes(props: { notes: string }) {
  const blocks = createMemo(() => parseReleaseNotes(props.notes));
  return <NotesBlocks blocks={blocks()} />;
}

export default ReleaseNotes;
