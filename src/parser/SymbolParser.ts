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
import { RegexStrategy } from './RegexStrategy';

export class SymbolParser {
    public static async getFileSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        console.log(`[SymbolParser] Getting symbols for ${document.uri} (${document.languageId})`);
        try {
            let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            console.log(`[SymbolParser] Native symbols found: ${symbols ? symbols.length : 0}`);

            if (!symbols || symbols.length === 0) {
                console.log('[SymbolParser] Using key RegexStrategy...');
                symbols = RegexStrategy.getSymbols(document);
                console.log(`[SymbolParser] Regex symbols found: ${symbols.length}`);
            }

            return this.filterSymbols(symbols || []);
        } catch (e) {
            console.error('[SymbolParser] Error fetching symbols:', e);
            return [];
        }
    }

    private static filterSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
        const filtered: vscode.DocumentSymbol[] = [];

        // Allowed kinds
        const allowed = new Set([
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Constructor,
            vscode.SymbolKind.Struct,
            vscode.SymbolKind.Interface,
            vscode.SymbolKind.Module,
            vscode.SymbolKind.Package,
            vscode.SymbolKind.Object, // JSON/JS
            vscode.SymbolKind.Property // CSS/JSON
        ]);

        for (const symbol of symbols) {
            if (allowed.has(symbol.kind)) {

                // Extra Filter: Remove obvious imports/exports if they sneak in as Properties/Modules
                const name = symbol.name.toLowerCase();
                if (name === 'import' || name === 'export' || name === 'require' || name === 'module.exports') {
                    continue;
                }

                // Recursively filter children
                if (symbol.children) {
                    symbol.children = this.filterSymbols(symbol.children);
                }
                filtered.push(symbol);
            }
            // If it's a container (like a Module/Package) but not allowed itself, 
            // we might want its children? For now, simpler to just include it if it has useful children?
            // User asked to remove imports/vars. Modules are okay but maybe noise. 
            // Let's stick to strict allowed list for now.
        }
        return filtered;
    }
}
