import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ModelInfo } from './protocol';

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

export async function readModels(): Promise<ModelInfo[]> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(path.join(codexHome(), 'models_cache.json'), 'utf8'));
    const list: any[] = Array.isArray(raw?.models) ? raw.models : [];
    return list
      .filter((m) => m?.slug && m.visibility !== 'hide')
      .map((m) => ({
        slug: String(m.slug),
        name: String(m.display_name ?? m.slug),
        description: String(m.description ?? ''),
        efforts: (m.supported_reasoning_levels ?? []).map((l: any) => String(l.effort)).filter(Boolean),
        defaultEffort: String(m.default_reasoning_level ?? ''),
      }));
  } catch {
    return [];
  }
}

// Only top-level keys (before the first [table]) are the active defaults.
export async function readCodexDefaults(): Promise<{ model: string; effort: string }> {
  const text = await fs.promises.readFile(path.join(codexHome(), 'config.toml'), 'utf8').catch(() => '');
  const top = text.split(/^\s*\[/m)[0];
  const get = (key: string) => top.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? '';
  return { model: get('model'), effort: get('model_reasoning_effort') };
}
