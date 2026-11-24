interface BrowserEvent<Args extends unknown[]> {
  addListener(callback: (...args: Args) => void): void;
}

interface ExtensionPort {
  name: string;
  sender?: { id?: string; url?: string };
  postMessage(message: unknown): void;
  onMessage: BrowserEvent<[unknown]>;
  onDisconnect: BrowserEvent<[]>;
}

interface BrowserTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
}

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    connect(options: { name: string }): ExtensionPort;
    onConnect: BrowserEvent<[ExtensionPort]>;
    onInstalled: BrowserEvent<[]>;
    onStartup: BrowserEvent<[]>;
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  tabs: {
    query(options: { active: boolean; lastFocusedWindow: boolean }): Promise<BrowserTab[]>;
    onActivated: BrowserEvent<[{ tabId: number; windowId: number }]>;
    onUpdated: BrowserEvent<[number, { url?: string; status?: string }]>;
    onRemoved: BrowserEvent<[number]>;
    onReplaced: BrowserEvent<[number, number]>;
  };
  windows: {
    onFocusChanged: BrowserEvent<[number]>;
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId: number }, method: string, params?: Record<string, unknown>): Promise<unknown>;
    onDetach: BrowserEvent<[{ tabId?: number }, string]>;
  };
};
