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
import * as crypto from 'crypto';

export class SummaryService {
    private _apiKey: string | undefined;
    private _context: vscode.ExtensionContext;
    private _cache: Map<string, string>;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._apiKey = vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
        // Load cache from workspace state or initialize empty
        const savedCache = this._context.workspaceState.get<any>('codeblocks.summaryCache');
        this._cache = savedCache ? new Map(Object.entries(savedCache)) : new Map();
    }

    public async getSummaries(symbols: vscode.DocumentSymbol[], document: vscode.TextDocument): Promise<Map<string, string>> {
        const summaries = new Map<string, string>();

        // Flatten symbols to process
        const allSymbols: vscode.DocumentSymbol[] = [];
        this._collectSymbols(symbols, allSymbols);

        let newSummariesCount = 0;

        for (const symbol of allSymbols) {
            const rangeKey = this._getSymbolKey(symbol);
            const code = document.getText(symbol.range);
            const hash = this._computeHash(code);

            // CHECK CACHE
            if (this._cache.has(hash)) {
                // Cache hit
                summaries.set(rangeKey, this._cache.get(hash)!);
            } else {
                // Cache miss - call LLM
                const summary = await this._generateSummary(code);
                this._cache.set(hash, summary);
                summaries.set(rangeKey, summary);
                newSummariesCount++;
            }
        }

        if (newSummariesCount > 0) {
            this._saveCache();
        }

        return summaries;
    }

    private _saveCache() {
        // Convert Map to Object for storage
        const obj = Object.fromEntries(this._cache);
        this._context.workspaceState.update('codeblocks.summaryCache', obj);
    }

    private _computeHash(text: string): string {
        return crypto.createHash('md5').update(text).digest('hex');
    }

    private _getSymbolKey(symbol: vscode.DocumentSymbol): string {
        return `${symbol.name}:${symbol.range.start.line}:${symbol.range.start.character}`;
    }

    private _collectSymbols(symbols: vscode.DocumentSymbol[], target: vscode.DocumentSymbol[]) {
        for (const s of symbols) {
            target.push(s);
            if (s.children) {
                this._collectSymbols(s.children, target);
            }
        }
    }

    private async _generateSummary(code: string): Promise<string> {
        if (!this._apiKey) {
            return "No API Key (Cached)";
        }

        try {
            return await this._callLLM(code);
        } catch (e) {
            console.error('LLM Error:', e);
            return 'Error generating summary.';
        }
    }

    private async _callLLM(code: string): Promise<string> {
        const provider = vscode.workspace.getConfiguration('codeblocks').get('llm.provider');

        if (provider === 'openai') {
            return this._callOpenAI(code);
        } else {
            return this._callGemini(code);
        }
    }

    private async _callGemini(code: string): Promise<string> {
        if (!this._apiKey) return "No API Key";

        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._apiKey}`;

        const prompt = `Summarize this code function in 6 words or less. Be concise. No quotes. \n\nCode:\n${code}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Gemini API Error (${response.status}): ${errorText}`);
                return `API Error ${response.status}`;
            }

            const data = await response.json() as any;
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            return text ? text.trim() : "No summary generated";
        } catch (error) {
            console.error(error);
            return "Network Error";
        }
    }

    private async _callOpenAI(code: string): Promise<string> {
        if (!this._apiKey) return "No API Key";

        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gpt-4o-mini';
        const url = 'https://api.openai.com/v1/chat/completions';

        const prompt = `Summarize this code function in 6 words or less. Be concise. No quotes. \n\nCode:\n${code}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this._apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: "You are a helpful coding assistant. Summarize code functions in 6 words or less. Plain text only." },
                        { role: "user", content: prompt }
                    ],
                    max_tokens: 20
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`OpenAI API Error (${response.status}): ${errorText}`);
                return `API Error ${response.status}`;
            }

            const data = await response.json() as any;
            return data?.choices?.[0]?.message?.content?.trim() || "No summary generated";
        } catch (error) {
            console.error(error);
            return "Network Error";
        }
    }
}
