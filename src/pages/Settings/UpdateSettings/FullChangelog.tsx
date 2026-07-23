import styles from "./FullChangelog.module.scss";
import { createMemo, For } from "solid-js";
import { NotesBlock, NotesBlocks, parseReleaseNotes } from "./ReleaseNotes";

type ChangelogSection = { version: string, blocks: NotesBlock[] };

// CHANGELOG.md's "## [x.y.z] - date" lines start a new version; everything under one is release-notes-shaped, so parseReleaseNotes handles it as-is.
function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let version: string | null = null;
  let body: string[] = [];

  function flush() {
    if (version !== null) sections.push({ version, blocks: parseReleaseNotes(body.join("\n")) });
    body = [];
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      flush();
      version = line.slice(3);
    } else if (version !== null) {
      body.push(rawLine);
    }
  }
  flush();

  return sections;
}

function FullChangelog(props: { text: string }) {
  const sections = createMemo(() => parseChangelog(props.text).filter(section => section.blocks.length > 0));

  return (
    <div class={styles.Changelog}>
      <For each={sections()}>{section =>
        <section class={styles.Section}>
          <h3 class={styles.VersionHeading}>{section.version}</h3>
          <NotesBlocks blocks={section.blocks} />
        </section>
      }</For>
    </div>
  );
}

export default FullChangelog;
