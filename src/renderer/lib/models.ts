import type { ModelAlias } from '../types';

// Model aliases understood by `claude --model`.

export const MODELS: { value: ModelAlias; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export const DEFAULT_PROJECT_MODEL: ModelAlias = 'sonnet';
export const DEFAULT_ASK_MODEL: ModelAlias = 'haiku';
