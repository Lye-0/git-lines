/// <reference types="vite/client" />

declare global {
  interface Window {
    acquireVsCodeApi: () => { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
  }
}

export {};
