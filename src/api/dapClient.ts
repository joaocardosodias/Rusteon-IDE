import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useDebugStore } from '../store/useDebugStore';

// Tipos mínimos do DAP Protocol (Microsoft)
interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

interface DAPRequest extends DAPMessage {
  type: 'request';
  command: string;
  arguments?: any;
}

interface DAPResponse extends DAPMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: any;
}

interface DAPEvent extends DAPMessage {
  type: 'event';
  event: string;
  body?: any;
}

export class DapClient {
  private static seq = 1;
  private static unlistenRx?: UnlistenFn;
  private static unlistenDisconnect?: UnlistenFn;
  private static pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: any) => void }>();

  public static async init() {
    if (this.unlistenRx) return; // already initialized

    this.unlistenRx = await listen<string>('dap-rx', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        this.handleMessage(payload);
      } catch (err) {
        console.error('Failed to parse DAP message:', event.payload, err);
      }
    });

    this.unlistenDisconnect = await listen('dap-disconnected', () => {
      console.warn('DAP connection lost / disconnected');
      useDebugStore.getState().reset();
    });
  }

  public static async cleanup() {
    if (this.unlistenRx) {
      this.unlistenRx();
      this.unlistenRx = undefined;
    }
    if (this.unlistenDisconnect) {
      this.unlistenDisconnect();
      this.unlistenDisconnect = undefined;
    }
    useDebugStore.getState().reset();
  }

  private static async sendRequest(command: string, args?: any): Promise<any> {
    const request: DAPRequest = {
      seq: this.seq++,
      type: 'request',
      command,
      arguments: args,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.seq, { resolve, reject });
      invoke('send_dap_message', { message: JSON.stringify(request) }).catch((err) => {
        this.pendingRequests.delete(request.seq);
        reject(err);
      });
    });
  }

  private static handleMessage(msg: any) {
    if (msg.type === 'response') {
      const resp = msg as DAPResponse;
      const pending = this.pendingRequests.get(resp.request_seq);
      if (pending) {
        this.pendingRequests.delete(resp.request_seq);
        if (resp.success) {
          pending.resolve(resp.body);
        } else {
          pending.reject(resp.message || 'DAP request failed');
        }
      }
    } else if (msg.type === 'event') {
      const ev = msg as DAPEvent;
      this.handleEvent(ev);
    }
  }

  private static handleEvent(ev: DAPEvent) {
    const store = useDebugStore.getState();

    switch (ev.event) {
      case 'initialized':
        console.log('[DAP] Initialized EVENT received');
        // Upon initialization, we MUST send configuration done so the target can start running
        this.sendRequest('configurationDone').catch(console.error);
        break;

      case 'stopped':
        console.log('[DAP] Target paused/stopped:', ev.body);
        store.setState('paused');
        // The IDE should now request Threads -> StackTrace -> Scopes -> Variables
        // We will trigger that from the UI side (React) effectively reacting to 'paused' state
        break;

      case 'continued':
        console.log('[DAP] Target running via continued event');
        store.setState('running');
        store.setActiveLine(null);
        break;

      case 'output':
        // Output event is used for RTT output!
        // The formatting inside ev.body.output will have the RTT payload
        if (ev.body?.output) {
          // TODO: Pipe to our Console 
          console.log('%c[RTT]', 'color: cyan', ev.body.output.trim());
        }
        break;

      case 'terminated':
      case 'exited':
        console.log('[DAP] Session ended');
        store.reset();
        break;
        
      default:
        console.log('[DAP Event Unhandled]', ev.event, ev.body);
    }
  }

  // --- MÉTODOS DE AÇÃO ---

  public static async initialize() {
    return this.sendRequest('initialize', {
      clientID: 'rusteon-ide',
      clientName: 'Rusteon IDE built-in DAP',
      adapterID: 'probe-rs',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
    });
  }

  public static async launch(elfPath: string) {
    return this.sendRequest('launch', {
      program: elfPath,
      cwd: "",
      flashingConfig: {
        flashingEnabled: true,
        resetAfterFlashing: true,
      },
      // specific probe-rs config
      chip: 'esp32', // TODO: Make this dynamic from target eventually
    });
  }

  public static async setBreakpoints(filePath: string, lines: number[]) {
    return this.sendRequest('setBreakpoints', {
      source: { path: filePath },
      breakpoints: lines.map(line => ({ line }))
    });
  }

  public static async continue(threadId: number = 1) {
    return this.sendRequest('continue', { threadId });
  }

  public static async next(threadId: number = 1) {
    return this.sendRequest('next', { threadId });
  }

  public static async stepIn(threadId: number = 1) {
    return this.sendRequest('stepIn', { threadId });
  }

  public static async stackTrace(threadId: number = 1) {
    return this.sendRequest('stackTrace', { threadId });
  }
}
