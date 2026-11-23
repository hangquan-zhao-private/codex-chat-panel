import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ChildProcess } from 'child_process';
import type { FromWebview, Options, Permission, ToWebview } from './protocol';
import { SessionStore } from './sessionStore';
import { resolveCodexPath, runCodex } from './codexRunner';
import { readCodexDefaults, readModels } from './models';

const SANDBOXES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const PERMISSIONS = new Set<Permission>(['read-only', 'workspace-write', 'workspace-write-network', 'danger-full-access']);
const SAFE_VALUE = /^[\w.:-]{0,64}$/;

export class CodexPanelProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codexStudio.panel';
  private view?: vscode.WebviewView;
  private child: ChildProcess | null = null;
  private sessionId: string | null = null;
  private cwd: string;
  private pending: ToWebview[] = [];
  private ready = false;
  private store: SessionStore;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.store = new SessionStore(() => this.config().get<string>('sessionsDir', ''));
    this.cwd = this.folders()[0] ?? os.homedir();
    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('codexStudio') && this.ready) void this.sendOptions();
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    const root = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    view.webview.html = this.html(view.webview, root);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidDispose(() => (this.view = undefined));
  }

  newChat(): void {
    this.stop();
    this.sessionId = null;
    this.cwd = this.activeFolder();
    this.post({ type: 'loadChat', sessionId: null, cwd: this.cwd, items: [] });
    this.post({ type: 'showView', view: 'chat' });
  }

  showHistory(): void {
    this.post({ type: 'showView', view: 'history' });
    void this.sendSessions();
  }

  prefill(text: string): void {
    this.post({ type: 'showView', view: 'chat' });
    this.post({ type: 'prefill', text });
  }

  dispose(): void {
    this.stop();
  }

  private config() {
    return vscode.workspace.getConfiguration('codexStudio');
  }

  private folders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  private activeFolder(): string {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const f = uri && vscode.workspace.getWorkspaceFolder(uri);
    return f?.uri.fsPath ?? this.folders()[0] ?? this.cwd;
  }

  private post(msg: ToWebview): void {
    if (this.view && this.ready) void this.view.webview.postMessage(msg);
    else this.pending.push(msg);
  }

  private async sendSessions(): Promise<void> {
    try {
      this.post({ type: 'sessions', sessions: await this.store.list() });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Codex Chat: failed to read sessions: ${e.message}`);
    }
  }

  private async onMessage(m: FromWebview): Promise<void> {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.post({ type: 'init', folders: this.folders(), cwd: this.cwd });
        this.pending.splice(0).forEach((p) => this.post(p));
        void this.sendSessions();
        void this.sendOptions();
        break;
      case 'setOptions':
        await this.setOptions(m);
        break;
      case 'send':
        if (typeof m.text === 'string' && m.text.trim()) this.send(m.text);
        break;
      case 'stop':
        this.stop();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'refreshSessions':
        void this.sendSessions();
        break;
      case 'openSession':
        if (typeof m.id === 'string') await this.openSession(m.id);
        break;
      case 'openFile':
        if (typeof m.path === 'string') await this.openFile(m.path);
        break;
    }
  }

  private permission(): Permission {
    const cfg = this.config();
    const sandbox = cfg.get<string>('sandbox', 'workspace-write');
    if (sandbox === 'workspace-write' && cfg.get<boolean>('networkAccess', false)) return 'workspace-write-network';
    return SANDBOXES.has(sandbox) ? (sandbox as Permission) : 'workspace-write';
  }

  private async sendOptions(): Promise<void> {
    const cfg = this.config();
    const [models, defaults] = await Promise.all([readModels(), readCodexDefaults()]);
    const options: Options = {
      models,
      model: cfg.get<string>('model', ''),
      effort: cfg.get<string>('reasoningEffort', ''),
      permission: this.permission(),
      defaultModel: defaults.model,
      defaultEffort: defaults.effort,
    };
    this.post({ type: 'options', options });
  }

  private async setOptions(m: Extract<FromWebview, { type: 'setOptions' }>): Promise<void> {
    const cfg = this.config();
    const target = vscode.ConfigurationTarget.Global;
    if (typeof m.model === 'string' && SAFE_VALUE.test(m.model)) await cfg.update('model', m.model, target);
    if (typeof m.effort === 'string' && SAFE_VALUE.test(m.effort)) await cfg.update('reasoningEffort', m.effort, target);
    if (m.permission && PERMISSIONS.has(m.permission)) {
      if (m.permission === 'danger-full-access' && this.permission() !== 'danger-full-access') {
        const ok = await vscode.window.showWarningMessage(
          'Full access lets Codex run any command and edit any file without a sandbox. Continue?',
          { modal: true },
          'Enable full access'
        );
        if (!ok) return this.sendOptions();
      }
      const network = m.permission === 'workspace-write-network';
      await cfg.update('sandbox', network ? 'workspace-write' : m.permission, target);
      await cfg.update('networkAccess', network, target);
    }
    await this.sendOptions();
  }

  private async openSession(id: string): Promise<void> {
    this.stop();
    const s = await this.store.load(id);
    if (!s) {
      vscode.window.showWarningMessage('Codex Chat: session not found.');
      return;
    }
    this.sessionId = id;
    this.cwd = s.cwd || this.cwd;
    this.post({ type: 'loadChat', sessionId: id, cwd: this.cwd, items: s.items });
    this.post({ type: 'showView', view: 'chat' });
  }

  private async openFile(p: string): Promise<void> {
    const abs = path.resolve(this.cwd, p);
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(abs), { preview: true });
    } catch {
      vscode.window.showWarningMessage(`Codex Chat: cannot open ${abs}`);
    }
  }

  private send(text: string): void {
    if (this.child) return;
    const cfg = this.config();
    const sandbox = cfg.get<string>('sandbox', 'workspace-write');
    const model = cfg.get<string>('model', '').trim();
    const effort = cfg.get<string>('reasoningEffort', '').trim();
    this.post({ type: 'upsert', item: { id: `u${Date.now()}`, kind: 'user', text } });
    this.post({ type: 'running', running: true });
    this.child = runCodex(
      {
        codexPath: resolveCodexPath(cfg.get<string>('codexPath', 'codex')),
        cwd: this.cwd,
        prompt: text,
        sessionId: this.sessionId,
        sandbox: SANDBOXES.has(sandbox) ? sandbox : 'workspace-write',
        network: cfg.get<boolean>('networkAccess', false),
        model: SAFE_VALUE.test(model) ? model : '',
        effort: SAFE_VALUE.test(effort) ? effort : '',
      },
      {
        onItem: (item) => this.post({ type: 'upsert', item }),
        onSessionStarted: (id) => {
          this.sessionId = id;
          this.post({ type: 'sessionStarted', sessionId: id });
        },
        onUsage: (usage) => this.post({ type: 'usage', usage }),
        onExit: (err) => {
          this.child = null;
          if (err) this.post({ type: 'upsert', item: { id: `e${Date.now()}`, kind: 'error', text: err } });
          this.post({ type: 'running', running: false });
          void this.sendSessions();
        },
      }
    );
  }

  private stop(): void {
    const c = this.child;
    if (!c) return;
    c.kill('SIGINT');
    setTimeout(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM');
    }, 2000);
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data: https:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
