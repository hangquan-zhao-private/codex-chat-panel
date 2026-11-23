import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem, Options, Permission, SessionSummary, ToWebview, Usage } from '../../src/protocol';
import { post } from './vscode';

type View = 'chat' | 'history';

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function App() {
  const [view, setView] = useState<View>('chat');
  const [folders, setFolders] = useState<string[]>([]);
  const [cwd, setCwd] = useState('');
  const [items, setItems] = useState<ChatItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [draft, setDraft] = useState('');
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent<ToWebview>) => {
      const m = e.data;
      switch (m.type) {
        case 'init':
          setFolders(m.folders);
          setCwd(m.cwd);
          break;
        case 'sessions':
          setSessions(m.sessions);
          break;
        case 'options':
          setOptions(m.options);
          break;
        case 'loadChat':
          setItems(m.items);
          setSessionId(m.sessionId);
          setCwd(m.cwd);
          setUsage(null);
          break;
        case 'upsert':
          setItems((prev) => {
            const i = prev.findIndex((x) => x.id === m.item.id);
            if (i < 0) return [...prev, m.item];
            const next = prev.slice();
            next[i] = m.item;
            return next;
          });
          break;
        case 'running':
          setRunning(m.running);
          break;
        case 'usage':
          setUsage(m.usage);
          break;
        case 'sessionStarted':
          setSessionId(m.sessionId);
          break;
        case 'prefill':
          setDraft((d) => (d ? d + '\n' : '') + m.text);
          break;
        case 'showView':
          setView(m.view);
          break;
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    post({ type: 'send', text });
    setDraft('');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="tabs">
          <button className={view === 'chat' ? 'tab active' : 'tab'} onClick={() => setView('chat')}>
            Chat
          </button>
          <button
            className={view === 'history' ? 'tab active' : 'tab'}
            onClick={() => {
              setView('history');
              post({ type: 'refreshSessions' });
            }}
          >
            History
          </button>
        </div>
        <button className="icon-btn" title="New chat" onClick={() => post({ type: 'newChat' })}>
          <PlusIcon />
        </button>
      </header>

      {view === 'chat' ? (
        <>
          <ChatView items={items} running={running} onSuggest={setDraft} />
          <Composer
            draft={draft}
            setDraft={setDraft}
            running={running}
            onSend={send}
            cwd={cwd}
            usage={usage}
            resumed={!!sessionId}
            options={options}
          />
        </>
      ) : (
        <HistoryView sessions={sessions} folders={folders} currentId={sessionId} />
      )}
    </div>
  );
}

/* ---------------- Chat ---------------- */

const SUGGESTIONS = [
  'Explain the structure of this project',
  'Find and fix bugs in the current code',
  'Write tests for the main module',
  'Summarize recent git changes',
];

function ChatView({
  items,
  running,
  onSuggest,
}: {
  items: ChatItem[];
  running: boolean;
  onSuggest: (s: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (!items.length && !running) {
    return (
      <div className="empty">
        <div className="logo">
          <LogoIcon />
        </div>
        <h2>What can Codex do for you?</h2>
        <p>Ask anything about this folder. Conversations are saved per folder.</p>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="messages" ref={ref} onScroll={onScroll}>
      {items.map((it) => (
        <Item key={it.id} item={it} />
      ))}
      {running && (
        <div className="working">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
          <span className="shimmer">Codex is working…</span>
        </div>
      )}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="row user">
          <div className="bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="row assistant">
          <div className="avatar">
            <LogoIcon />
          </div>
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          </div>
        </div>
      );
    case 'reasoning':
      return (
        <details className="card reasoning">
          <summary>
            <SparkIcon /> Thinking
          </summary>
          <div className="md muted">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          </div>
        </details>
      );
    case 'command':
      return (
        <details className={`card command ${item.status}`}>
          <summary>
            <span className={`status ${item.status}`} />
            <span className="tool">{item.tool}</span>
            <code className="cmd">{item.command.split('\n')[0]}</code>
            {item.exitCode != null && item.exitCode !== 0 && <span className="badge err">exit {item.exitCode}</span>}
          </summary>
          {item.command.includes('\n') && <pre className="term input">{item.command}</pre>}
          {item.output && <pre className="term">{item.output}</pre>}
        </details>
      );
    case 'file_change':
      return (
        <div className="card files">
          <div className="card-title">
            <FileIcon /> {item.changes.length} file{item.changes.length === 1 ? '' : 's'} changed
          </div>
          {item.changes.map((c) => (
            <button key={c.path} className="file" onClick={() => post({ type: 'openFile', path: c.path })}>
              <span className={`badge ${c.kind}`}>{c.kind}</span>
              {c.path}
            </button>
          ))}
        </div>
      );
    case 'todo':
      return (
        <div className="card todo">
          <div className="card-title">Plan</div>
          {item.items.map((t, i) => (
            <div key={i} className={t.completed ? 'todo-item done' : 'todo-item'}>
              <span className="check">{t.completed ? '✓' : ''}</span>
              {t.text}
            </div>
          ))}
        </div>
      );
    case 'error':
      return <div className="card error">{item.text}</div>;
  }
}

function Composer({
  draft,
  setDraft,
  running,
  onSend,
  cwd,
  usage,
  resumed,
  options,
}: {
  draft: string;
  setDraft: (s: string) => void;
  running: boolean;
  onSend: () => void;
  cwd: string;
  usage: Usage | null;
  resumed: boolean;
  options: Options | null;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [draft]);

  return (
    <div className="composer-wrap">
      <div className={running ? 'composer busy' : 'composer'}>
        <textarea
          ref={ta}
          value={draft}
          placeholder={resumed ? 'Continue this conversation…' : 'Ask Codex… (Enter to send, Shift+Enter for newline)'}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="composer-bar">
          {options && <OptionPickers o={options} disabled={running} />}
          {running ? (
            <button className="send stop" title="Stop" onClick={() => post({ type: 'stop' })}>
              <StopIcon />
            </button>
          ) : (
            <button className="send" title="Send" disabled={!draft.trim()} onClick={onSend}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <div className="meta">
        <span className="folder" title={cwd}>
          <FolderIcon /> {basename(cwd)}
        </span>
        {usage && (
          <span title="Tokens: input / output">
            {fmt(usage.input_tokens)} in · {fmt(usage.output_tokens)} out
          </span>
        )}
      </div>
    </div>
  );
}

const fmt = (n?: number) => (n == null ? '–' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

const PERMISSIONS: { value: Permission; label: string; hint: string }[] = [
  { value: 'read-only', label: 'Access: Read only', hint: 'Can read files, cannot edit or run writes' },
  { value: 'workspace-write', label: 'Access: Workspace', hint: 'Can edit files in this folder, no network' },
  { value: 'workspace-write-network', label: 'Access: Workspace + Net', hint: 'Can edit files in this folder and use the network' },
  { value: 'danger-full-access', label: 'Access: Full (allow all)', hint: 'No sandbox: any file, any command' },
];

function OptionPickers({ o, disabled }: { o: Options; disabled: boolean }) {
  const effectiveModel = o.model || o.defaultModel;
  const info = o.models.find((m) => m.slug === effectiveModel);
  const efforts = info?.efforts.length ? info.efforts : ['low', 'medium', 'high'];
  const defaultEffort = o.defaultEffort || info?.defaultEffort || '';
  const known = o.models.some((m) => m.slug === o.model);
  const perm = PERMISSIONS.find((p) => p.value === o.permission);

  return (
    <div className="pickers">
      <label className="pill" title={info?.description || 'Model'}>
        <CpuIcon />
        <select
          value={o.model}
          disabled={disabled}
          onChange={(e) => post({ type: 'setOptions', model: e.target.value })}
        >
          <option value="">{o.defaultModel ? `Default (${o.defaultModel})` : 'Default model'}</option>
          {o.model && !known && <option value={o.model}>{o.model}</option>}
          {o.models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="pill" title="Reasoning effort (how hard the model thinks)">
        <SparkIcon />
        <select
          value={o.effort}
          disabled={disabled}
          onChange={(e) => post({ type: 'setOptions', effort: e.target.value })}
        >
          <option value="">{defaultEffort ? `Thinking: ${defaultEffort} (default)` : 'Thinking: default'}</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              Thinking: {e}
            </option>
          ))}
        </select>
      </label>
      <label className={`pill perm ${o.permission}`} title={perm?.hint}>
        <ShieldIcon />
        <select
          value={o.permission}
          disabled={disabled}
          onChange={(e) => post({ type: 'setOptions', permission: e.target.value as Permission })}
        >
          {PERMISSIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/* ---------------- History ---------------- */

function HistoryView({
  sessions,
  folders,
  currentId,
}: {
  sessions: SessionSummary[];
  folders: string[];
  currentId: string | null;
}) {
  const [scope, setScope] = useState<'folder' | 'all'>(folders.length ? 'folder' : 'all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inWorkspace = (cwd: string) => folders.some((f) => cwd === f || cwd.startsWith(f + '/') || cwd.startsWith(f + '\\'));
    const filtered = sessions.filter(
      (s) => (scope === 'all' || inWorkspace(s.cwd)) && (!q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q))
    );
    const map = new Map<string, SessionSummary[]>();
    for (const s of filtered) {
      const key = s.cwd || '(unknown folder)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()];
  }, [sessions, folders, scope, query]);

  return (
    <div className="history">
      <div className="history-tools">
        <div className="search">
          <SearchIcon />
          <input value={query} placeholder="Search conversations" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="segmented">
          <button className={scope === 'folder' ? 'on' : ''} onClick={() => setScope('folder')} disabled={!folders.length}>
            This folder
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All folders
          </button>
        </div>
      </div>

      <div className="groups">
        {!groups.length && (
          <div className="no-results">
            {scope === 'folder' ? 'No conversations in this folder yet.' : 'No conversations found.'}
          </div>
        )}
        {groups.map(([cwd, list]) => {
          const isCollapsed = collapsed[cwd];
          return (
            <section key={cwd} className="group">
              <button className="group-head" title={cwd} onClick={() => setCollapsed((c) => ({ ...c, [cwd]: !isCollapsed }))}>
                <span className={isCollapsed ? 'chev' : 'chev open'}>›</span>
                <FolderIcon />
                <span className="group-name">{basename(cwd)}</span>
                <span className="count">{list.length}</span>
              </button>
              {!isCollapsed &&
                list.map((s) => (
                  <button
                    key={s.id}
                    className={s.id === currentId ? 'session current' : 'session'}
                    onClick={() => post({ type: 'openSession', id: s.id })}
                  >
                    <span className="session-title">{s.title}</span>
                    <span className="session-time">{relTime(s.updatedAt)}</span>
                  </button>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString();
}

/* ---------------- Icons ---------------- */

const svg = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const LogoIcon = () => (
  <svg {...svg} width={18} height={18}>
    <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" />
    <path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" />
  </svg>
);
const PlusIcon = () => <svg {...svg}><path d="M12 5v14M5 12h14" /></svg>;
const SendIcon = () => <svg {...svg}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
const StopIcon = () => <svg {...svg}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>;
const FolderIcon = () => <svg {...svg} width={12} height={12}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
const FileIcon = () => <svg {...svg} width={12} height={12}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>;
const SearchIcon = () => <svg {...svg} width={12} height={12}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
const SparkIcon = () => <svg {...svg} width={12} height={12}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>;
const CpuIcon = () => <svg {...svg} width={12} height={12}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>;
const ShieldIcon = () => <svg {...svg} width={12} height={12}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></svg>;
