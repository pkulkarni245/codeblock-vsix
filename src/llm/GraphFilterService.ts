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

export class GraphFilterService {
    private _apiKey: string | undefined;

    constructor() {
        this._apiKey = vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
    }

    public async filterFiles(filePaths: string[]): Promise<string[]> {
        if (!this._apiKey || filePaths.length === 0) {
            console.log('[GraphFilterService] No API Key or empty list. Returning original list.');
            return filePaths;
        }

        // Limit to reasonable batch size for now (e.g. 100 files)
        // If more, we might need multiple calls or just fallback to regex for the rest.
        // For efficiency, let's take the first 100 or random 100? No, let's just process the first 150.
        // Or process all in chunks.

        const chunks: string[][] = [];
        const chunkSize = 100;
        for (let i = 0; i < filePaths.length; i += chunkSize) {
            chunks.push(filePaths.slice(i, i + chunkSize));
        }

        const allowedPaths: string[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "CodeBlocks: Intelligently filtering files...",
            cancellable: false
        }, async (progress) => {
            for (const chunk of chunks) {
                try {
                    const filtered = await this._callLLM(chunk);
                    allowedPaths.push(...filtered);
                } catch (e) {
                    console.error('[GraphFilterService] Failed to filter chunk:', e);
                    // On error, include safe defaults? Or all? 
                    // Let's include all to be safe against data loss, or just the ones we suspect?
                    // Safe fallback: Include everything in this chunk.
                    allowedPaths.push(...chunk);
                }
            }
        });

        return allowedPaths;
    }

    private async _callLLM(paths: string[]): Promise<string[]> {
        const provider = vscode.workspace.getConfiguration('codeblocks').get('llm.provider');
        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gemini-1.5-flash';
        const modelStr = String(model);

        const prompt = `
You are a Software Architect.
Context: I am generating a high-level Functional Architecture Graph of a project.
Task: Filter the following list of file paths.
Criteria:
- KEEP: Core business logic, source code, controllers, services, models, views, components.
- DISCARD: Config files (webpack, tsconfig, etc.), build scripts, tests, specs, mocks, fixtures, generic utilities, boilerplate, documentation.

Input Files:
${JSON.stringify(paths)}

Output:
Return strictly a JSON array of strings containing ONLY the kept file paths. Do not include markdown formatting.
`;

        if (provider === 'openai') {
            return this._callOpenAI(prompt, modelStr);
        } else {
            return this._callGemini(prompt, modelStr);
        }
    }

    private async _callGemini(prompt: string, model: string): Promise<string[]> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini status ${response.status}`);
        }

        const data = await response.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return this._parseJson(text);
    }

    private async _callOpenAI(prompt: string, model: string): Promise<string[]> {
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this._apiKey}`
            },
            body: JSON.stringify({
                model: model === 'gemini-1.5-flash' ? 'gpt-4o-mini' : model, // Fallback if model name mismatch
                messages: [
                    { role: "system", content: "You are a JSON generator." },
                    { role: "user", content: prompt }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI status ${response.status}`);
        }

        const data = await response.json() as any;
        const text = data?.choices?.[0]?.message?.content;
        return this._parseJson(text);
    }

    private _parseJson(text: string | undefined): string[] {
        if (!text) return [];
        try {
            // Strip markdown block if present
            const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(clean);
        } catch (e) {
            console.error('JSON Parse Error:', e);
            return [];
        }
    }
}
