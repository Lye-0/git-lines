import type { ExtensionToWebviewMessage } from '../../src/webview/messageProtocol';

export type GraphMessage = Extract<ExtensionToWebviewMessage, { type: 'graph' }>;
export type DetailMessage = Extract<ExtensionToWebviewMessage, { type: 'detail' }>['detail'];
export type DetailEventMessage = NonNullable<Extract<ExtensionToWebviewMessage, { type: 'detail' }>['event']>;
