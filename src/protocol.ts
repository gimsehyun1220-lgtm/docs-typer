export type Phase = 'idle' | 'running' | 'paused' | 'stopped' | 'complete' | 'review';
export type Target = { tabId: number; url: string; title: string };
export type Snapshot = {
  phase: Phase;
  done: number;
  total: number;
  message?: string;
  target?: Target;
};
export type PanelCommand =
  | { type: 'target' }
  | { type: 'start'; target: Target; text: string; wpm: number }
  | { type: 'speed'; wpm: number }
  | { type: 'pause' | 'resume' | 'stop' };
export type WorkerMessage =
  | { type: 'state'; state: Snapshot }
  | { type: 'target'; target?: Target }
  | { type: 'error'; message: string };
