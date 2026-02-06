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

export class FoldingManager {
    public async foldBlocks(editor: vscode.TextEditor, symbols: vscode.DocumentSymbol[]) {
        // We want to fold the BODIES of the symbols, keeping the headers visible.
        // VS Code's 'editor.fold' command works on selection.

        const rangesToFold: vscode.Range[] = [];
        this._collectFoldRanges(symbols, rangesToFold);

        if (rangesToFold.length === 0) {
            return;
        }

        // Apply folding by placing cursors at the START of each range we want to fold.
        // VS Code's 'editor.fold' works on the current cursor position(s).

        const originalSelection = editor.selection;

        // Create selections at the start of each block
        editor.selections = rangesToFold.map(r => new vscode.Selection(r.start, r.start));

        // Fold the regions at these cursors
        await vscode.commands.executeCommand('editor.fold');

        // Restore selection
        editor.selection = originalSelection;
    }

    public async unfoldAll(editor: vscode.TextEditor) {
        await vscode.commands.executeCommand('editor.unfoldAll');
    }

    private _collectFoldRanges(symbols: vscode.DocumentSymbol[], ranges: vscode.Range[]) {
        for (const symbol of symbols) {
            // Logic: Fold the range that is NOT the selectionRange (header).
            // Usually symbol.range covers the whole block.
            // symbol.selectionRange covers just the name.
            // We want to fold from the end of selectionRange to end of symbol.range.

            // However, VS Code 'editor.fold' folds the region containing the cursor. 
            // If we select the lines inside the body, it should fold them.

            // Heuristic: Identify the "body" range.
            // Start: Line AFTER the header (or same line if block starts there).
            // End: End of the block.

            if (symbol.range.end.line > symbol.selectionRange.end.line) {
                // It spans multiple lines
                ranges.push(symbol.range);
            }

            if (symbol.children) {
                this._collectFoldRanges(symbol.children, ranges);
            }
        }
    }
}
