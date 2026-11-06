import styles from "./TagFilters.module.scss";
import { TagValueTypeMap } from "../../../types";
import useTagFilterState from "../../../states/tagFilterState";
import FilterGroupView from "./FilterGroupView/FilterGroupView";
import SavedFilterBar from "./SavedFilterBar/SavedFilterBar";

// The Advanced panel: saved filters on top, then the condition tree.
function TagFilters(props: { tagMap: TagValueTypeMap }) {
  const { root } = useTagFilterState;

  return (
    <div class={styles.TagFilters}>
      <SavedFilterBar />
      <FilterGroupView node={root} tagMap={props.tagMap} />
    </div>
  );
}

export default TagFilters;
