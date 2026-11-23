import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatItem, Usage } from './protocol';
import { truncate } from './sessionStore';

export interface RunOptions {
  codexPath: string;
  cwd: string;
  prompt: string;
  sessionId: string | null;
  sandbox: string;
  network: boolean;
  model: string;
  effort: string;
}

export interface RunHandlers {
  onItem(item: ChatItem): void;
  onSessionStarted(id: string): void;
  onUsage(usage: Usage): void;
  onExit(error: string | null): void;
}

export function resolveCodexPath(configured: string): string {
  if (configured && configured !== 'codex') return configured;
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  dirs.push(path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin');
  for (const d of dirs) {
    const p = path.join(d, process.platform === 'win32' ? 'codex.cmd' : 'codex');
    if (d && fs.existsSync(p)) return p;
  }
  return 'codex';
}

let turnCounter = 0;

export function runCodex(opts: RunOptions, h: RunHandlers): ChildProcess {
  const turn = ++turnCounter;
  const common = ['--json', '--skip-git-repo-check', '-c', `sandbox_mode="${opts.sandbox}"`];
  if (opts.model) common.push('-m', opts.model);
  if (opts.effort) common.push('-c', `model_reasoning_effort="${opts.effort}"`);
  if (opts.network && opts.sandbox === 'workspace-write') {
    common.push('-c', 'sandbox_workspace_write.network_access=true');
  }
  const args = opts.sessionId
    ? ['exec', 'resume', ...common, opts.sessionId, '-']
    : ['exec', ...common, '-'];

  const child = spawn(opts.codexPath, args, { cwd: opts.cwd, env: process.env });
  let stderr = '';
  let buf = '';
  let failure: string | null = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'thread.started':
          if (ev.thread_id) h.onSessionStarted(ev.thread_id);
          break;
        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
          const item = toChatItem(ev.item, `t${turn}-`);
          if (item) h.onItem(item);
          break;
        }
        case 'turn.completed':
          if (ev.usage) h.onUsage(ev.usage);
          break;
        case 'turn.failed':
          failure = ev.error?.message ?? 'Turn failed';
          break;
        case 'error':
          failure = ev.message ?? 'Unknown error';
          break;
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c: string) => {
    stderr = (stderr + c).slice(-4000);
  });
  child.on('error', (err) => {
    failure = `Failed to start codex (${opts.codexPath}): ${err.message}`;
  });
  child.on('close', (code, signal) => {
    if (signal) return h.onExit(null);
    if (!failure && code !== 0) failure = stderr.trim() || `codex exited with code ${code}`;
    h.onExit(failure);
  });

  child.stdin.end(opts.prompt);
  return child;
}

function toChatItem(it: any, prefix: string): ChatItem | null {
  if (!it?.id) return null;
  const id = prefix + it.id;
  switch (it.type) {
    case 'agent_message':
      return { id, kind: 'assistant', text: it.text ?? '' };
    case 'reasoning':
      return it.text ? { id, kind: 'reasoning', text: it.text } : null;
    case 'command_execution':
      return {
        id,
        kind: 'command',
        tool: 'shell',
        command: it.command ?? '',
        output: it.aggregated_output ? truncate(it.aggregated_output) : undefined,
        exitCode: it.exit_code ?? null,
        status: it.status === 'in_progress' ? 'running' : it.status === 'failed' ? 'failed' : 'completed',
      };
    case 'file_change':
      return { id, kind: 'file_change', changes: it.changes ?? [], status: it.status ?? '' };
    case 'mcp_tool_call':
      return {
        id,
        kind: 'command',
        tool: `${it.server ?? 'mcp'}.${it.tool ?? ''}`,
        command: it.arguments ? truncate(JSON.stringify(it.arguments), 2000) : '',
        status: it.status === 'in_progress' ? 'running' : it.status === 'failed' ? 'failed' : 'completed',
      };
    case 'web_search':
      return { id, kind: 'command', tool: 'web_search', command: it.query ?? '', status: 'completed' };
    case 'todo_list':
      return { id, kind: 'todo', items: it.items ?? [] };
    case 'error':
      return { id, kind: 'error', text: it.message ?? 'Error' };
    default:
      return null;
  }
}
