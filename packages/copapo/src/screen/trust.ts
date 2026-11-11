import { relative } from 'node:path';
import type { TextUIApp } from '@textui/core';
import type { Trust } from '../trust.js';

/**
 * "Trust this folder?" over the screen, on textui's `ConfirmDialog`: `true` to trust, `false` not to, and
 * `undefined` when Escape dismissed it, which is no answer and saves nothing. `confirm()` cannot tell the last two apart.
 */
export function askTrust(app: TextUIApp, trust: Pick<Trust, 'folder' | 'gated'>): Promise<boolean | undefined> {
  const files = trust.gated.map((path) => relative(trust.folder, path) || path);
  // The question is in the message: a theme with no frame (paper) draws no title.
  const message = files.length > 0
    ? `Trust this folder? ${trust.folder} holds ${files.join(', ')}. Trusting it loads them; copapo keeps the answer.`
    : `Trust this folder? ${trust.folder}. Trusting it loads its .copapo.json and .agents/skills; copapo keeps the answer.`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean | undefined): void => {
      if (settled) return;
      settled = true;
      handle.dispose();
      resolve(value);
    };
    const handle = app.layers.open({
      id: 'copapo:trust',
      layer: 'modal',
      scrim: true,
      trapFocus: true,
      dismissOnEscape: true,
      onClose: () => finish(undefined),
      node: {
        component: 'ConfirmDialog',
        title: 'Folder trust',
        message,
        confirmLabel: 'Trust',
        cancelLabel: "Don't trust",
        onConfirm: { handler: () => finish(true) },
        onCancel: { handler: () => finish(false) },
      },
    });
  });
}
