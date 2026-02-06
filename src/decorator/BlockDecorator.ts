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

export class BlockDecorator {
    private _lowComplexity: vscode.TextEditorDecorationType;
    private _medComplexity: vscode.TextEditorDecorationType;
    private _highComplexity: vscode.TextEditorDecorationType;

    constructor() {
        // GREEN: Low Complexity (Short, clean)
        this._lowComplexity = vscode.window.createTextEditorDecorationType({
            backgroundColor: '#57bb8a11',
            isWholeLine: true,
            border: '1px solid #57bb8a',
            borderRadius: '4px',
            overviewRulerColor: '#57bb8a',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        // YELLOW: Medium Complexity
        this._medComplexity = vscode.window.createTextEditorDecorationType({
            backgroundColor: '#fbbc0411',
            isWholeLine: true,
            border: '1px solid #fbbc04',
            borderRadius: '4px',
            overviewRulerColor: '#fbbc04',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        // RED: High Complexity (Long, potentially confusing)
        this._highComplexity = vscode.window.createTextEditorDecorationType({
            backgroundColor: '#e67c7311',
            isWholeLine: true,
            border: '1px solid #e67c73',
            borderRadius: '4px',
            overviewRulerColor: '#e67c73',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }

    public decorate(editor: vscode.TextEditor, symbols: vscode.DocumentSymbol[], summaries?: Map<string, string>) {
        const low: vscode.DecorationOptions[] = [];
        const med: vscode.DecorationOptions[] = [];
        const high: vscode.DecorationOptions[] = [];

        this._collect(symbols, low, med, high, summaries);

        editor.setDecorations(this._lowComplexity, low);
        editor.setDecorations(this._medComplexity, med);
        editor.setDecorations(this._highComplexity, high);
    }

    public clear(editor: vscode.TextEditor) {
        editor.setDecorations(this._lowComplexity, []);
        editor.setDecorations(this._medComplexity, []);
        editor.setDecorations(this._highComplexity, []);
    }

    private _collect(
        symbols: vscode.DocumentSymbol[],
        low: vscode.DecorationOptions[],
        med: vscode.DecorationOptions[],
        high: vscode.DecorationOptions[],
        summaries?: Map<string, string>
    ) {
        for (const symbol of symbols) {
            const lineRange = symbol.selectionRange;

            // COMPLEXITY HEURISTIC: Line Count
            // In a real app, we'd parse cyclomatic complexity.
            // Here: < 15 lines = Low, 15-40 = Med, > 40 = High
            const lineCount = symbol.range.end.line - symbol.range.start.line;
            let complexityLabel = '';

            // 1. Prepare Content
            let afterContent = '';
            let hoverMessage: vscode.MarkdownString | undefined;

            if (summaries) {
                const key = `${symbol.name}:${symbol.range.start.line}:${symbol.range.start.character}`;
                const summary = summaries.get(key);
                if (summary) {
                    afterContent = `  ---------- 🤖 ${summary}`;
                    hoverMessage = new vscode.MarkdownString(`**${symbol.name}**\n\n${summary}`);
                }
            } else {
                // Add Line Count info implicitly
                afterContent = `  [${lineCount} lines]`;
            }

            const option: vscode.DecorationOptions = {
                range: lineRange,
                hoverMessage: hoverMessage,
                renderOptions: {
                    after: {
                        contentText: afterContent,
                        color: '#888888', // Subtle text
                        fontStyle: 'italic',
                        margin: '0 0 0 10px'
                    }
                }
            };

            // 2. Classify
            if (lineCount < 15) {
                low.push(option);
            } else if (lineCount < 40) {
                med.push(option);
            } else {
                high.push(option);
            }

            if (symbol.children) {
                this._collect(symbol.children, low, med, high, summaries);
            }
        }
    }
}
