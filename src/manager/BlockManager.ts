/*
 * Copyright 2026 Pavan Kulkarni
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as vscode from 'vscode';
import { Logger } from '../common/Logger';
import { SymbolParser } from '../parser/SymbolParser';
import { BlockDecorator } from '../decorator/BlockDecorator';
import { FoldingManager } from '../decorator/FoldingManager';
import { SummaryService } from '../llm/SummaryService';
import { GraphFilterService } from '../llm/GraphFilterService';
import { CallGraphPanel } from '../webview/CallGraphPanel';
import { GraphService } from '../graph/GraphService';
import { ArchitectureInferenceService } from '../llm/ArchitectureInferenceService';
import { ProcessInferenceService } from '../llm/ProcessInferenceService';

// =========================================================================
// The BlockManager: Central Intelligence
// =========================================================================
// This class coordinates the entire analysis pipeline:
// 1. Scanning: Uses `SymbolParser` to read VS Code Document Symbols.
// 2. Logic: Uses `GraphService` to build the graph structure.
// 3. Drill-Down: Handles requests to zoom into specific modules.
//
export class BlockManager {
    private _context: vscode.ExtensionContext;
    private _decorator: BlockDecorator;
    private _folder: FoldingManager;
    private _summaryService: SummaryService;
    private _graphService: GraphService;
    private _archService: ArchitectureInferenceService;
    private _processService: ProcessInferenceService;
    private _fileCache = new Map<string, { document: vscode.TextDocument, symbols: vscode.DocumentSymbol[] }>();

    private _isBlockMode: boolean = false;
    private _currentEditor: vscode.TextEditor | undefined;
    private _disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._decorator = new BlockDecorator();
        this._folder = new FoldingManager();
        this._summaryService = new SummaryService(context);
        this._graphService = new GraphService(context);
        this._archService = new ArchitectureInferenceService(context);
        this._processService = new ProcessInferenceService(context);

        // Initialize with current active if available
        this._currentEditor = vscode.window.activeTextEditor;

        // --- Event Listeners ---

        // Setup Graph Handshake: When the webview loads, we start the scan.
        CallGraphPanel.onWebviewReady = async () => {
            Logger.info('[BlockManager] Webview is ready. Initializing Workspace Scan...');

            // Show loading state
            CallGraphPanel.postMessage({ command: 'setLoading', data: true });
            // 1. Ensure we are in Block Mode (so scanning works)
            this._isBlockMode = true;

            // 3. Start Scan
            await this._scanWorkspace();
        };

        // Listen to Webview Messages (Drill Down)
        CallGraphPanel.onMessage = async (message) => {
            if (message.command === 'drillDown') {
                const filePaths = message.filePaths; // Sent from frontend
                const label = message.label;
                const requestId = message.requestId;
                const nodeType = message.nodeType; // 'system' or 'process'

                if (filePaths && filePaths.length > 0) {
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Analyzing ${label}...`,
                        cancellable: false
                    }, async () => {

                        // STRATEGY: 
                        // If System Node (Level 0) -> Generate Process Flow (Level 1)
                        // If Process Node (Level 1) -> Generate Component Graph (Level 2)

                        if (nodeType === 'process') {
                            // LEVEL 2: COMPONENT GRAPH
                            const filesToAnalyze = await this._loadSymbolsForFiles(filePaths);
                            if (filesToAnalyze.length > 0) {
                                // Pass 'label' as virtualRootLabel to avoid "Backend" folder Loop
                                // Use includeFiles=false for consistent Flattened View
                                const componentData = await this._graphService.generateGraph(filesToAnalyze, undefined, undefined, label, false);
                                CallGraphPanel.currentPanel?.updateGraph(componentData, requestId);
                            }

                        } else {
                            // LEVEL 1: PROCESS FLOW (Default for System Nodes)
                            // AI GENERATION
                            const subsystemData = await this._processService.generateSubsystemFlow(filePaths);

                            // STRICTER CHECK: Require at least 2 nodes for a valid flow
                            if (subsystemData && subsystemData.nodes && subsystemData.nodes.length > 1) {
                                console.log(`[DrillDown] System Flow Success: ${subsystemData.nodes.length} nodes.`);
                                const data = this._graphService.convertProcessToReactFlow(subsystemData);
                                CallGraphPanel.currentPanel?.updateGraph(data, requestId);
                            } else {
                                // FALLBACK: If Process Flow fails or is trivial
                                console.log('[DrillDown] Process Flow failed or empty. Trying Heuristic Flow...');

                                // EMERGENCY FALLBACK: Deterministic Heuristic Flow
                                const heuristicData = this._processService.generateHeuristicFlow(filePaths, label || 'Process');

                                if (heuristicData && heuristicData.nodes.length > 0) {
                                    console.log(`[DrillDown] Using Heuristic Flow: ${heuristicData.nodes.length} nodes.`);
                                    const data = this._graphService.convertProcessToReactFlow(heuristicData);
                                    CallGraphPanel.currentPanel?.updateGraph(data, requestId);
                                } else {
                                    // FINAL FALLBACK to Component Structure
                                    console.log('[DrillDown] Process Flow unavailable. Showing Component View.');
                                    vscode.window.showWarningMessage('Process Flow unavailable. Showing Component View.');

                                    const filesToAnalyze = await this._loadSymbolsForFiles(filePaths);

                                    // User requested "Architecture" not "Files".
                                    console.log('[DrillDown] Generating Flattened Graph (includeFiles=false)');
                                    const componentData = await this._graphService.generateGraph(filesToAnalyze, undefined, undefined, label, false);
                                    CallGraphPanel.currentPanel?.updateGraph(componentData, requestId);
                                }
                            }
                        }
                    });
                }
            }
        };

        // Register Event Listeners
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                if (editor) {
                    this._currentEditor = editor;
                    if (this._isBlockMode) {
                        await this._processEditor(editor);
                    }
                }
            }),
            // Re-process on save (to update blocks/summaries)
            vscode.workspace.onDidSaveTextDocument(async (doc) => {
                if (this._isBlockMode && vscode.window.activeTextEditor?.document === doc) {
                    await this._processEditor(vscode.window.activeTextEditor);
                }
            })
        );
    }

    private async _loadSymbolsForFiles(filePaths: string[]): Promise<{ document: vscode.TextDocument, symbols: vscode.DocumentSymbol[] }[]> {
        const filesToAnalyze: { document: vscode.TextDocument, symbols: vscode.DocumentSymbol[] }[] = [];
        for (const fp of filePaths) {
            try {
                const uri = vscode.Uri.file(fp);
                const document = await vscode.workspace.openTextDocument(uri);
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                ) || [];
                filesToAnalyze.push({ document, symbols });
            } catch (e) {
                console.error('Failed to load file for drill down:', fp, e);
            }
        }
        return filesToAnalyze;
    }


    public async showGraph() {
        // Cache current editor before switching focus to panel
        if (vscode.window.activeTextEditor) {
            this._currentEditor = vscode.window.activeTextEditor;
        }

        CallGraphPanel.createOrShow(this._context.extensionUri);

        // Force update graph if panel is already open (not waiting for ready)
        if (this._currentEditor) {
            await this._updateGraphOnly(this._currentEditor);
        }
    }

    public async toggle() {
        this._isBlockMode = !this._isBlockMode;

        if (this._isBlockMode) {
            vscode.window.showInformationMessage('Code Blocks Mode: ON');

            // 1. Process Active Editor (Priority)
            if (vscode.window.activeTextEditor) {
                this._currentEditor = vscode.window.activeTextEditor;
                await this._processEditor(vscode.window.activeTextEditor, false);
            }

            // 2. Background Scan (Rest of Folder)
            this._scanWorkspace();

        } else {
            vscode.window.showInformationMessage('Code Blocks Mode: OFF');
            this._clearAll();
        }
    }

    private async _processEditor(editor: vscode.TextEditor, silent: boolean = true) {
        // Basic check to avoid processing non-code files
        if (editor.document.uri.scheme !== 'file') return;

        console.log(`[BlockManager] Processing ${editor.document.fileName}...`);
        const uriStr = editor.document.uri.toString();

        try {
            const symbols = await SymbolParser.getFileSymbols(editor.document);
            if (!symbols || symbols.length === 0) {
                console.log('[BlockManager] No symbols found.');
                // Clean up cache if no symbols
                this._fileCache.delete(uriStr);
                if (!silent) {
                    vscode.window.showWarningMessage('No code blocks found in this file. (Is language support active?)');
                }
                return;
            }

            console.log(`[BlockManager] Found ${symbols.length} symbols.`);
            // Update Cache
            this._fileCache.set(uriStr, { document: editor.document, symbols });

            // 1. Decorate (Visuals)
            this._decorator.decorate(editor, symbols);

            // 2. Fold
            await this._folder.foldBlocks(editor, symbols);

            // 3. Summaries (Async Update)
            let cachedSummaries: Map<string, string> | undefined;
            try {
                // Get cached summaries synchronously if possible, or wait?
                cachedSummaries = await this._summaryService.getSummaries(symbols, editor.document);

                if (vscode.window.activeTextEditor === editor && this._isBlockMode) {
                    this._decorator.decorate(editor, symbols, cachedSummaries);
                }
            } catch (e) {
                console.log('[BlockManager] Summary fetch failed/skipped:', e);
            }

            // 4. Update Graph if open (Async)
            if (CallGraphPanel.currentPanel) {
                this._refreshGraph();
            }
        } catch (e) {
            console.error('[BlockManager] Error processing editor:', e);
        }
    }

    // Explicitly update graph without decorating
    private async _updateGraphOnly(editor: vscode.TextEditor) {
        console.log(`[BlockManager] Updating graph for ${editor.document.fileName}`);
        try {
            const symbols = await SymbolParser.getFileSymbols(editor.document);
            if (!symbols || symbols.length === 0) return;

            // Cache it
            this._fileCache.set(editor.document.uri.toString(), { document: editor.document, symbols });

            // Refresh
            await this._refreshGraph();
        } catch (e) {
            console.error(e);
        }
    }

    private async _refreshGraph() {
        if (!CallGraphPanel.currentPanel) return;

        const allFiles = Array.from(this._fileCache.values());
        const paths = allFiles.map(f => f.document.uri.fsPath);

        console.log(`[BlockManager Debug] Refreshing Graph for ${paths.length} files.`);

        // 1. Try Process Flow (System Level)
        try {
            console.log('[BlockManager Debug] Attempting System Flow Generation...');
            const processData = await this._processService.generateSystemFlow(paths);
            if (processData && processData.nodes.length > 0) {
                console.log(`[BlockManager Debug] System Flow Success: ${processData.nodes.length} nodes.`);
                const data = this._graphService.convertProcessToReactFlow(processData);
                CallGraphPanel.currentPanel.updateGraph(data);
                return;
            } else {
                console.log('[BlockManager Debug] System Flow returned empty or null.');
            }
        } catch (e) { console.error('[BlockManager Debug] System Flow failed', e); }

        // 2. Fallback to Architecture / Component Graph
        console.log('[BlockManager Debug] Fallback to Architecture Inference...');
        const archMap = await this._archService.inferModules(paths);
        console.log(`[BlockManager Debug] Architecture Map size: ${archMap.size}`);

        // Collect summaries if available (lazy)
        let summaries = new Map<string, string>();

        console.log('[BlockManager Debug] Generating Graph with Arch Map...');
        // Pass includeFiles=false to ensure we see High Level Architecture Only
        const data = await this._graphService.generateGraph(allFiles, summaries, archMap, undefined, false);
        console.log(`[BlockManager Debug] Graph Generated: ${data.nodes.length} nodes (Types: ${data.nodes.map(n => n.type).join(', ')})`);

        CallGraphPanel.currentPanel.updateGraph(data);
    }

    private async _scanWorkspace() {
        // Find all code files (inc. Web Artifacts), excluding build/test folders
        const ignore = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/test/**,**/tests/**,**/__tests__/**,**/.git/**,**/.vscode/**}';
        const allFiles = await vscode.workspace.findFiles('**/*.{ts,py,js,tsx,jsx,java,c,cpp,cs,go,rs,html,css,scss,json}', ignore);

        // Intelligent Filter
        const filterService = new GraphFilterService();
        const paths = allFiles.map(f => f.fsPath);
        const filteredPaths = await filterService.filterFiles(paths);
        const filteredSet = new Set(filteredPaths);

        const files = allFiles.filter(f => filteredSet.has(f.fsPath));

        console.log(`[BlockManager] Background scanning ${files.length} files(filtered from ${allFiles.length})...`);

        for (const file of files) {
            if (!this._isBlockMode) break; // Stop if turned off

            try {
                // We parse to warm up the cache
                const doc = await vscode.workspace.openTextDocument(file);
                const symbols = await SymbolParser.getFileSymbols(doc);
                if (symbols.length > 0) {
                    this._fileCache.set(file.toString(), { document: doc, symbols });
                }
            } catch (e) {
                // Ignore errors for background files
            }
        }

        // Final update after scan
        await this._refreshGraph();
        console.log('[BlockManager] Background scan complete.');
    }

    private _clearAll() {
        if (vscode.window.activeTextEditor) {
            this._decorator.clear(vscode.window.activeTextEditor);
            this._folder.unfoldAll(vscode.window.activeTextEditor);
        }
    }

    public dispose() {
        this._isBlockMode = false;
        this._disposables.forEach(d => d.dispose());
    }
}
