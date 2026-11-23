import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import type { ChatItem, SessionSummary } from './protocol';

const CONTEXT_PREFIXES = [
  '<environment_context',
  '<user_instructions',
  '<permissions',
  '<turn_aborted',
  '<INSTRUCTIONS>',
  '# AGENTS.md',
  '<user_shell_command',
];
const MAX_OUTPUT = 4000;

export function isContextMessage(text: string): boolean {
  const t = text.trimStart();
  return CONTEXT_PREFIXES.some((p) => t.startsWith(p));
}

export function truncate(s: string, max = MAX_OUTPUT): string {
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more chars)` : s;
}

interface CacheEntry {
  mtime: number;
  summary: SessionSummary | null;
}

export class SessionStore {
  private cache = new Map<string, CacheEntry>();
  private files = new Map<string, string>();

  constructor(private readonly getDir: () => string) {}

  get dir(): string {
    return this.getDir() || path.join(os.homedir(), '.codex', 'sessions');
  }

  async list(): Promise<SessionSummary[]> {
    const files = await walk(this.dir);
    const names = await this.readThreadNames();
    const out: SessionSummary[] = [];
    await Promise.all(
      files.map(async (file) => {
        const st = await fs.promises.stat(file).catch(() => null);
        if (!st) return;
        let entry = this.cache.get(file);
        if (!entry || entry.mtime !== st.mtimeMs) {
          entry = { mtime: st.mtimeMs, summary: await readSummary(file, st.mtimeMs) };
          this.cache.set(file, entry);
        }
        if (!entry.summary) return;
        const s = { ...entry.summary, updatedAt: st.mtimeMs };
        const name = names.get(s.id);
        if (name) s.title = name;
        this.files.set(s.id, file);
        out.push(s);
      })
    );
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<{ cwd: string; items: ChatItem[] } | null> {
    if (!this.files.has(id)) await this.list();
    const file = this.files.get(id);
    if (!file) return null;
    return parseSession(file);
  }

  private async readThreadNames(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const indexFile = path.join(path.dirname(this.dir), 'session_index.jsonl');
    const text = await fs.promises.readFile(indexFile, 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const d = JSON.parse(line);
        if (d.id && d.thread_name) map.set(d.id, d.thread_name);
      } catch {
        // ignore malformed line
      }
    }
    return map;
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

async function readSummary(file: string, mtime: number): Promise<SessionSummary | null> {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let summary: SessionSummary | null = null;
  let lines = 0;
  try {
    for await (const line of rl) {
      if (++lines > 400) break;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type === 'session_meta' && !summary) {
        const p = d.payload ?? {};
        summary = {
          id: p.id ?? p.session_id,
          cwd: p.cwd ?? '',
          startedAt: p.timestamp ?? d.timestamp ?? '',
          updatedAt: mtime,
          title: '',
        };
        if (!summary.id) return null;
      } else if (summary && d.type === 'response_item' && d.payload?.type === 'message' && d.payload.role === 'user') {
        const text = contentText(d.payload.content);
        if (text && !isContextMessage(text)) {
          summary.title = text.trim().split('\n')[0].slice(0, 120);
          break;
        }
      }
    }
  } finally {
    rl.close();
  }
  if (summary && !summary.title) summary.title = 'Untitled session';
  return summary;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

function describeCall(name: string, raw: unknown): string {
  if (typeof raw !== 'string') return JSON.stringify(raw ?? '');
  try {
    const args = JSON.parse(raw);
    if (Array.isArray(args.command)) return args.command.join(' ');
    if (typeof args.cmd === 'string') return args.cmd;
    if (typeof args.command === 'string') return args.command;
    return JSON.stringify(args);
  } catch {
    return raw;
  }
}

function outputText(o: unknown): string {
  if (typeof o === 'string') {
    try {
      const j = JSON.parse(o);
      if (typeof j?.output === 'string') return j.output;
    } catch {
      // plain string output
    }
    return o;
  }
  if (Array.isArray(o)) return contentText(o);
  if (o && typeof (o as any).output === 'string') return (o as any).output;
  return JSON.stringify(o ?? '');
}

async function parseSession(file: string): Promise<{ cwd: string; items: ChatItem[] }> {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const items: ChatItem[] = [];
  const calls = new Map<string, Extract<ChatItem, { kind: 'command' }>>();
  let cwd = '';
  let n = 0;
  for await (const line of rl) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const p = d.payload ?? {};
    const id = `h${n++}`;
    if (d.type === 'session_meta') {
      cwd = p.cwd ?? cwd;
      continue;
    }
    if (d.type !== 'response_item') continue;
    switch (p.type) {
      case 'message': {
        const text = contentText(p.content);
        if (!text) break;
        if (p.role === 'user' && !isContextMessage(text)) items.push({ id, kind: 'user', text });
        else if (p.role === 'assistant') items.push({ id, kind: 'assistant', text });
        break;
      }
      case 'reasoning': {
        const text = (p.summary ?? []).map((s: any) => s?.text ?? '').join('\n\n').trim();
        if (text) items.push({ id, kind: 'reasoning', text });
        break;
      }
      case 'function_call':
      case 'custom_tool_call':
      case 'local_shell_call': {
        const name = p.name ?? 'shell';
        const item: Extract<ChatItem, { kind: 'command' }> = {
          id,
          kind: 'command',
          tool: name,
          command: truncate(describeCall(name, p.arguments ?? p.input ?? p.action?.command), 2000),
          status: 'completed',
        };
        if (p.call_id) calls.set(p.call_id, item);
        items.push(item);
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output': {
        const item = calls.get(p.call_id);
        if (item) item.output = truncate(outputText(p.output));
        break;
      }
    }
  }
  return { cwd, items };
}
