export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'reasoning'; text: string }
  | {
      id: string;
      kind: 'command';
      tool: string;
      command: string;
      output?: string;
      exitCode?: number | null;
      status: 'running' | 'completed' | 'failed';
    }
  | { id: string; kind: 'file_change'; changes: { path: string; kind: string }[]; status: string }
  | { id: string; kind: 'todo'; items: { text: string; completed: boolean }[] }
  | { id: string; kind: 'error'; text: string };

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  startedAt: string;
  updatedAt: number;
}

export interface Usage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export interface ModelInfo {
  slug: string;
  name: string;
  description: string;
  efforts: string[];
  defaultEffort: string;
}

export type Permission = 'read-only' | 'workspace-write' | 'workspace-write-network' | 'danger-full-access';

export interface Options {
  models: ModelInfo[];
  model: string;
  effort: string;
  permission: Permission;
  defaultModel: string;
  defaultEffort: string;
}

export type ToWebview =
  | { type: 'init'; folders: string[]; cwd: string }
  | { type: 'options'; options: Options }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'loadChat'; sessionId: string | null; cwd: string; items: ChatItem[] }
  | { type: 'upsert'; item: ChatItem }
  | { type: 'running'; running: boolean }
  | { type: 'usage'; usage: Usage }
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'prefill'; text: string }
  | { type: 'showView'; view: 'chat' | 'history' };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'openSession'; id: string }
  | { type: 'refreshSessions' }
  | { type: 'setOptions'; model?: string; effort?: string; permission?: Permission }
  | { type: 'openFile'; path: string };
