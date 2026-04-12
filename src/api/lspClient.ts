import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useIDEStore, type LspStatus } from "../store/useIDEStore";

type LspCallback = (result: any, error?: any) => void;

interface PendingRequest {
  id: number;
  resolve: LspCallback;
  reject: (err: any) => void;
  timer: any; // for timeout
}

export class LspClient {
  private requestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private unlistenRx?: UnlistenFn;
  private onDiagnosticsCb?: (uri: string, diagnostics: any[]) => void;
  
  public isInitialized = false;

  // The active file being tracked by didOpen
  private activeDocumentUri: string | null = null;
  private activeDocumentVersion = 1;

  constructor(onDiagnostics?: (uri: string, diags: any[]) => void) {
    this.onDiagnosticsCb = onDiagnostics;
    this.setupListeners();
  }

  private async setupListeners() {
    this.unlistenRx = await listen<string>("lsp-rx", (event) => {
      try {
        const payloadStr = event.payload;
        this.logLsp('in', payloadStr);
        const msg = JSON.parse(payloadStr);
        
        // Is it a response to a request we sent?
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!;
          clearTimeout(req.timer); // Clear the timeout to prevent memory leak
          this.pendingRequests.delete(msg.id);
          
          if (msg.error) {
            req.reject(msg.error);
          } else {
            req.resolve(msg.result);
          }
        } 
        // Is it a server notification?
        else if (msg.method === "textDocument/publishDiagnostics") {
          if (this.onDiagnosticsCb && msg.params) {
            this.onDiagnosticsCb(msg.params.uri, msg.params.diagnostics);
          }
        }
      } catch (err) {
        console.error("Failed to parse LSP payload", err, event.payload);
      }
    });
  }

  private logLsp(dir: 'in'|'out'|'info'|'err', msg: string) {
    const ts = new Date().toTimeString().slice(0, 8);
    useIDEStore.getState().addLspLog({ dir, msg, time: ts });
  }

  private setStatus(status: LspStatus) {
    useIDEStore.getState().setLspStatus(status);
  }

  public async start(projectPath: string): Promise<boolean> {
    this.setStatus('starting');
    
    try {
      this.logLsp('info', `Checking if rust-analyzer is installed...`);
      const installed = await invoke<boolean>("check_lsp_installed");
      if (!installed) {
        this.logLsp('err', `rust-analyzer not found!`);
        this.setStatus('not_installed');
        return false;
      }

      this.logLsp('info', `Starting rust-analyzer for ${projectPath}`);
      await invoke("start_lsp", { projectPath });

      // Detect the cargo target for ESP/embedded projects
      let cargoTarget: string | null = null;
      try {
        cargoTarget = await invoke<string | null>("detect_cargo_target", { projectPath });
        if (cargoTarget) {
          this.logLsp('info', `Detected cargo target: ${cargoTarget}`);
        }
      } catch (e) {
        // Not critical, rust-analyzer will use default
      }

      // Send initialize request with rust-analyzer specific settings
      await this.sendRequest("initialize", {
        processId: null,
        rootUri: `file://${projectPath}`,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: true } },
            hover: { dynamicRegistration: true, contentFormat: ["markdown", "plaintext"] },
            signatureHelp: { dynamicRegistration: true },
            synchronization: { didSave: true, dynamicRegistration: true },
            publishDiagnostics: { relatedInformation: true }
          },
          workspace: {
            workspaceFolders: true
          }
        },
        initializationOptions: {
          cargo: {
            ...(cargoTarget ? { target: cargoTarget } : {}),
            allTargets: false,
            features: "all"
          },
          checkOnSave: {
            allTargets: false,
            ...(cargoTarget ? { targets: cargoTarget } : {})
          },
          check: {
            allTargets: false,
            ...(cargoTarget ? { targets: cargoTarget } : {})
          },
          diagnostics: {
            experimental: { enable: true }
          }
        },
        trace: "off",
        workspaceFolders: [{ uri: `file://${projectPath}`, name: "workspace" }]
      }, 60000); // 60s timeout — rust-analyzer needs time to index

      // Send initialized notification
      await this.sendNotification("initialized", {});
      this.isInitialized = true;
      this.setStatus('ready');
      this.logLsp('info', `Initialization successful`);
      return true;
    } catch (e) {
      console.error("LSP Start failed:", e);
      this.logLsp('err', `LSP Start failed: ${e}`);
      this.setStatus('error');
      return false;
    }
  }

  public async stop() {
    this.setStatus('idle');
    this.logLsp('info', `Stopping LSP...`);
    try {
      await invoke("stop_lsp");
    } catch (e) {
      console.error("LSP Stop failed:", e);
    }
    if (this.unlistenRx) {
      this.unlistenRx();
    }
    this.isInitialized = false;
    
    // Clear dangling promises to prevent memory leaks!
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error("LSP stopped"));
    }
    this.pendingRequests.clear();
  }

  // ──── DOCUMENT SYNC ──────────────────────────────────────────

  public async didOpen(filePath: string, text: string) {
    if (!this.isInitialized) return;
    this.activeDocumentUri = `file://${filePath}`;
    this.activeDocumentVersion = 1;
    
    await this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: this.activeDocumentUri,
        languageId: "rust",
        version: this.activeDocumentVersion,
        text: text
      }
    });
  }

  public async didClose(filePath: string) {
    if (!this.isInitialized) return;
    await this.sendNotification("textDocument/didClose", {
      textDocument: {
        uri: `file://${filePath}`
      }
    });
  }

  public async didChange(text: string) {
    if (!this.isInitialized || !this.activeDocumentUri) return;
    this.activeDocumentVersion++;
    
    await this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri: this.activeDocumentUri,
        version: this.activeDocumentVersion
      },
      contentChanges: [{ text: text }]
    });
  }

  public async didSave() {
    if (!this.isInitialized || !this.activeDocumentUri) return;
    await this.sendNotification("textDocument/didSave", {
      textDocument: { uri: this.activeDocumentUri }
    });
  }

  // ──── CORE IPC WRAPPERS ──────────────────────────────────────
  public sendNotification(method: string, params: any): Promise<void> {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params
    });
    this.logLsp('out', payload);
    return invoke("send_lsp_message", { message: payload });
  }

  public sendRequest(method: string, params: any, timeoutMs = 10000): Promise<any> {
    const id = this.requestId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    
    this.logLsp('out', payload);
    
    return new Promise((resolve, reject) => {
      // Memory Leak Prevention: 10s timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { id, resolve, reject, timer });

      invoke("send_lsp_message", { message: payload }).catch(err => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }
}
