import Select, { type MultiValue, type StylesConfig } from "react-select";

export interface Opt { value: string; label: string }

interface Props {
  options: Opt[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  placeholder: string; // shown when nothing is selected
}

// match the surrounding filter panel: 12px text, soft borders, blue accents
const styles: StylesConfig<Opt, true> = {
  control: (base, s) => ({
    ...base, minHeight: 34, fontSize: 12, borderRadius: 6,
    borderColor: s.isFocused ? "#9cc2dd" : "#cfd8e2", boxShadow: "none",
    "&:hover": { borderColor: "#9cc2dd" },
  }),
  valueContainer: (base) => ({ ...base, padding: "1px 6px", gap: 4 }),
  placeholder: (base) => ({ ...base, color: "#8896a6" }),
  multiValue: (base) => ({ ...base, background: "#e4eef8", border: "1px solid #bcd6ef", borderRadius: 10 }),
  multiValueLabel: (base) => ({ ...base, color: "#285a86", fontSize: 11, padding: "1px 3px 1px 7px" }),
  multiValueRemove: (base) => ({ ...base, color: "#5a7ea3", borderRadius: "0 10px 10px 0", "&:hover": { background: "#c9ddf2", color: "#1b2733" } }),
  menu: (base) => ({ ...base, fontSize: 12, zIndex: 12, boxShadow: "0 6px 20px rgba(27,39,51,.15)" }),
  option: (base, s) => ({
    ...base, color: "#3a4855",
    background: s.isSelected ? "#e4eef8" : s.isFocused ? "#eef3f8" : "#fff",
    "&:active": { background: "#d8e9f5" },
  }),
};

export default function MultiSelect({ options, selected, onToggle, placeholder }: Props) {
  const value = options.filter((o) => selected.has(o.value));

  // react-select hands back the whole new selection; diff it against the current
  // set and emit a single onToggle per changed value to fit the toggle-based API.
  const onChange = (next: MultiValue<Opt>) => {
    const after = new Set(next.map((o) => o.value));
    for (const o of options) {
      if (after.has(o.value) !== selected.has(o.value)) onToggle(o.value);
    }
  };

  return (
    <Select<Opt, true>
      isMulti options={options} value={value} onChange={onChange}
      placeholder={placeholder} styles={styles}
      classNamePrefix="rs" closeMenuOnSelect={false}
      noOptionsMessage={() => null} menuPlacement="auto" />
  );
}
