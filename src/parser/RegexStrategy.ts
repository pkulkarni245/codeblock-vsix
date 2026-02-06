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

export class RegexStrategy {

    public static getSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const languageId = document.languageId;
        const text = document.getText();
        console.log(`[RegexStrategy] Parsing document with languageId: '${languageId}', length: ${text.length}`);

        if (languageId === 'shellscript') {
            return this.parseShell(text);
        } else if (languageId === 'sql') {
            return this.parseSql(text);
        } else if (languageId === 'python') {
            return this.parsePython(text);
        } else {
            console.log(`[RegexStrategy] No heuristic parser for '${languageId}'`);
        }

        return [];
    }

    private static parsePython(text: string): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        const lines = text.split('\n');

        // Stack to track hierarchy: { indentLevel, symbol }
        const stack: { indent: number, symbol: vscode.DocumentSymbol }[] = [];

        // Regex for: class Name: OR def name():
        const defRegex = /^(\s*)(class|def)\s+([a-zA-Z_]\w*)/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip empty lines or comments for indentation checks (simplification)
            if (!line.trim() || line.trim().startsWith('#')) continue;

            const match = line.match(defRegex);
            if (match) {
                // console.log(`[RegexStrategy] Match: ${match[0]}`); // Commented out to avoid spam, uncomment if needed
                const indentStr = match[1];
                const type = match[2]; // class or def
                const name = match[3];
                const indent = indentStr.length; // assuming spaces; tabs are rarer in py

                const kind = type === 'class' ? vscode.SymbolKind.Class : vscode.SymbolKind.Method;

                // Determine range (start line to... for now, just the line)
                const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));
                const selectionRange = new vscode.Range(new vscode.Position(i, indent), new vscode.Position(i, line.length));

                const symbol = new vscode.DocumentSymbol(name, type, kind, range, selectionRange);

                // Find parent based on indentation
                // Pop items from stack that are deeper or equal indentation (siblings or children of previous siblings)
                while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
                    stack.pop();
                }

                if (stack.length > 0) {
                    stack[stack.length - 1].symbol.children.push(symbol);
                } else {
                    symbols.push(symbol);
                }

                stack.push({ indent, symbol });
            }
        }
        return symbols;
    }

    private static parseShell(text: string): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        const lines = text.split('\n');

        // Regex for: function name() { OR name() { OR function name {
        const funcRegex = /^(?:function\s+)?([\w-]+)\s*(?:\(\))?\s*\{/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.trim().match(funcRegex);

            if (match) {
                const name = match[1];
                const startPos = new vscode.Position(i, line.indexOf(name));
                const endPos = new vscode.Position(i, line.length);
                const range = new vscode.Range(startPos, endPos); // Simplified range (one line)

                // Using generic "Function" kind (11)
                const symbol = new vscode.DocumentSymbol(
                    name,
                    'Shell Function',
                    vscode.SymbolKind.Function,
                    range,
                    range
                );
                symbols.push(symbol);
            }
        }
        return symbols;
    }

    private static parseSql(text: string): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        const lines = text.split('\n');

        // Regex for: CREATE [OR REPLACE] TYPE name
        const createRegex = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(\w+)\s+([.\w]+)/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(createRegex);

            if (match) {
                const type = match[1].toUpperCase(); // TABLE, VIEW, PROCEDURE
                const name = match[2];

                const startPos = new vscode.Position(i, 0);
                const endPos = new vscode.Position(i, line.length);
                const range = new vscode.Range(startPos, endPos);

                let kind = vscode.SymbolKind.File;
                if (type === 'FUNCTION' || type === 'PROCEDURE') kind = vscode.SymbolKind.Function;
                if (type === 'TABLE' || type === 'view') kind = vscode.SymbolKind.Struct;

                const symbol = new vscode.DocumentSymbol(
                    name,
                    `SQL ${type}`,
                    kind,
                    range,
                    range
                );
                symbols.push(symbol);
            }
        }
        return symbols;
    }
}
