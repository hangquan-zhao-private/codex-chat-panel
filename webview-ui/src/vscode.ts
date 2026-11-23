import type { FromWebview } from '../../src/protocol';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const api = acquireVsCodeApi();

export function post(msg: FromWebview): void {
  api.postMessage(msg);
}
