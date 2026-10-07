import { MODELS } from '../../lib/models';
import type { ModelAlias } from '../../types';

/** Dropdown of Claude model aliases. */
interface ModelSelectProps {
  id?: string;
  value: ModelAlias;
  onChange: (value: ModelAlias) => void;
  className?: string;
}

export function ModelSelect({ id, value, onChange, className }: ModelSelectProps) {
  return (
    <select id={id} className={className} title="AI Model" value={value} onChange={(e) => onChange(e.target.value as ModelAlias)}>
      {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}
