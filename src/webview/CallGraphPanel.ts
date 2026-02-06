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
import * as path from 'path';
import { Logger } from '../common/Logger';

/**
 * Manages the WebView panel for the Call Graph Visualization.
 * Handles:
 * 1. Creating/Revealing the panel.
 * 2. Bi-directional communication (Extension <-> WebView).
 * 3. Loading HTML content with secure content policies.
 */
export class CallGraphPanel {
    public static currentPanel: CallGraphPanel | undefined;
    public static readonly viewType = 'codeblocksGraph';
    public static onWebviewReady: (() => void) | undefined;
    public static onDrillDown: ((nodeId: string) => void) | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CallGraphPanel.currentPanel) {
            CallGraphPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            CallGraphPanel.viewType,
            'CodeBlocks Graph',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'dist')
                ]
            }
        );

        CallGraphPanel.currentPanel = new CallGraphPanel(panel, extensionUri);
    }

    public static postMessage(message: any) {
        if (CallGraphPanel.currentPanel) {
            CallGraphPanel.currentPanel._panel.webview.postMessage(message);
        }
    }

    public static onMessage: (message: any) => void | Promise<void> | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // --- Message Passing (Webview <-> Extension) ---
        // We listen for messages from the React Frontend (webview/index.tsx).
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;

                    // Frontend wants to navigate the editor to a specific file/line
                    case 'jumpTo':
                        this._jumpToLocation(message.location);
                        return;

                    // Frontend is fully loaded and ready to receive data
                    case 'ready':
                        if (CallGraphPanel.onWebviewReady) {
                            CallGraphPanel.onWebviewReady();
                        }
                        return;

                    // Frontend requesting code content for the "Code Preview" modal
                    case 'fetchCode':
                        this._fetchCode(message.location).then(code => {
                            this._panel.webview.postMessage({ command: 'codeResponse', data: code });
                        });
                        return;

                    default:
                        if (CallGraphPanel.onMessage) {
                            CallGraphPanel.onMessage(message);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public updateGraph(data: any, requestId?: string) {
        this._panel.webview.postMessage({ command: 'updateGraph', data: data, requestId });
    }

    private async _fetchCode(location: any): Promise<{ content: string, startLine: number } | string> {
        try {
            if (!location || !location.file) return 'No file path provided.';
            const uri = vscode.Uri.file(location.file);
            const doc = await vscode.workspace.openTextDocument(uri);
            // Read 50 lines from start
            // Read Exact Range if available
            const startLine = location.line;
            const endLine = typeof location.endLine === 'number'
                ? location.endLine
                : Math.min(doc.lineCount - 1, startLine + 50);

            const content = doc.getText(new vscode.Range(startLine, 0, endLine + 1, 0));
            return { content, startLine: startLine + 1 }; // 1-based for display
        } catch (e) {
            return 'Error fetching code: ' + e;
        }
    }

    // Decoration type for highlighting
    private _highlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 215, 0, 0.1)', // Faint Gold
        border: '1px solid rgba(255, 215, 0, 0.2)',
        isWholeLine: true
    });

    private async _jumpToLocation(location: any) {
        try {
            // DEFENSIVE CHECK: Prevent crash if location is null
            if (!location || !location.file) {
                Logger.error('[CallGraphPanel] Invalid location object:', location);
                return;
            }
            Logger.info(`[CallGraphPanel] Jumping to: ${location.file} (${location.line}:${location.character})`);

            const uri = vscode.Uri.file(location.file);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);

            const line = location.line || 0;
            const char = location.character || 0;

            const pos = new vscode.Position(line, char);
            const range = new vscode.Range(pos, pos);

            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(pos, pos);

            // Smart Unfold:
            // 1. Ensure the editor has focus
            await vscode.window.showTextDocument(doc);

            // 2. Unfold the specific block.
            // If we have endLine, define the full block range.
            if (typeof location.endLine === 'number') {
                // Temporarily select the whole block to force unfold everything inside it
                editor.selection = new vscode.Selection(line, char, location.endLine, 1000);
                await vscode.commands.executeCommand('editor.unfoldRecursively');
            } else {
                // Fallback: Try to unfold at the definition line
                await vscode.commands.executeCommand('editor.unfold', { levels: 1, direction: 'up', selection: range });
            }

            // 3. Reset selection and apply Highlight
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

            // Apply Faint Highlighting from user request
            // Highlight entire function/block if possible, or just the line + 5?
            // "differentiation from the rest of the code"
            let highlightRange;
            if (typeof location.endLine === 'number') {
                highlightRange = new vscode.Range(line, 0, location.endLine, 1000);
            } else {
                highlightRange = new vscode.Range(line, 0, line + 15, 0); // Default 15 lines
            }

            editor.setDecorations(this._highlightDecoration, [highlightRange]);

            // Remove after 3 seconds ("reasonable amount of time")
            setTimeout(() => {
                editor.setDecorations(this._highlightDecoration, []);
            }, 3000);

        } catch (e) {
            console.error('Jump Error:', e);
            vscode.window.showErrorMessage('Could not jump to code location: ' + e);
        }
    }

    public dispose() {
        CallGraphPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!-- RELAXED CSP FOR DEBUGGING -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeBlocks Map</title>
                <style>
                    body, html, #root {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        margin: 0;
                        padding: 0;
                        background-color: transparent;
                        overflow: hidden;
                    }
                </style>
            </head>
            <body>
                <div id="root"></div>
                <!-- DEBUG OVERLAY (Hidden by default, used for catastrophic failure diagnostics) -->
                <!-- <div id="debug-overlay" style="position:fixed;top:0;left:0;color:red;z-index:9999;pointer-events:none;background:rgba(0,0,0,0.8);padding:5px;">HTML Loaded.</div> -->
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
