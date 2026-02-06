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
import { Logger } from './common/Logger';
import { BlockDecorator } from './decorator/BlockDecorator';
import { BlockManager } from './manager/BlockManager';
import { CallGraphPanel } from './webview/CallGraphPanel';
import { FoldingManager } from './decorator/FoldingManager';

// Global flag to track if map has been opened in this session
let hasOpenedMapThisSession = false;

export function activate(context: vscode.ExtensionContext) {
    Logger.info('CodeBlocks extension is active');

    // BlockManager is the brain of the extension. 
    // It coordinates parsing, AI analysis, and graph generation.
    const manager = new BlockManager(context);

    // --- Commands Registration ---

    // 1. Toggle the Block Outline View (Tree View)
    let disposableToggle = vscode.commands.registerCommand('codeblocks.toggle', () => {
        manager.toggle();
    });

    // 2. Open Configuration Settings
    let disposableConfig = vscode.commands.registerCommand('codeblocks.configure', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'codeblocks');
    });

    // 3. Launch the Visual Graph (The Main Feature)
    let disposableGraph = vscode.commands.registerCommand('codeblocks.showGraph', () => {
        CallGraphPanel.createOrShow(context.extensionUri);
        hasOpenedMapThisSession = true;
    });

    context.subscriptions.push(disposableToggle, disposableConfig, disposableGraph);

    // --- Smart Auto-Open Logic ---
    // If the user launches VS Code with a code file open, we assume they might want context immediately.
    // We wait briefly (1.5s) to let VS Code settle, then open the graph automatically
    // unless it's a non-code file (JSON, Logs, etc.).
    if (!hasOpenedMapThisSession && vscode.window.activeTextEditor) {
        const lang = vscode.window.activeTextEditor.document.languageId;
        const invalidLangs = ['json', 'jsonc', 'log', 'output', 'plaintext'];

        if (!invalidLangs.includes(lang)) {
            setTimeout(() => {
                if (!hasOpenedMapThisSession) {
                    vscode.commands.executeCommand('codeblocks.showGraph');
                }
            }, 1500);
        }
    }

}

export function deactivate() { }
