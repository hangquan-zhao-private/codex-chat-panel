import * as vscode from 'vscode';
import { CodexPanelProvider } from './panelProvider';

export function activate(ctx: vscode.ExtensionContext): void {
  const provider = new CodexPanelProvider(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CodexPanelProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => provider.dispose() },
    vscode.commands.registerCommand('codexStudio.newChat', () => provider.newChat()),
    vscode.commands.registerCommand('codexStudio.showHistory', () => provider.showHistory()),
    vscode.commands.registerCommand('codexStudio.askAboutSelection', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.selection.isEmpty) return;
      const file = vscode.workspace.asRelativePath(ed.document.uri);
      const start = ed.selection.start.line + 1;
      const end = ed.selection.end.line + 1;
      const lang = ed.document.languageId;
      const code = ed.document.getText(ed.selection);
      await vscode.commands.executeCommand(`${CodexPanelProvider.viewId}.focus`);
      provider.prefill(`${file}:${start}-${end}\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`);
    })
  );
}

export function deactivate(): void {}
