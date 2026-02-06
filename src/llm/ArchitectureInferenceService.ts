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

export class ArchitectureInferenceService {
    private _apiKey: string | undefined;
    private _cache: Map<string, string>; // filePath -> moduleName

    constructor(context: vscode.ExtensionContext) {
        this._apiKey = vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
        const savedCache = context.workspaceState.get<any>('codeblocks.archCache');
        this._cache = savedCache ? new Map(Object.entries(savedCache)) : new Map();
    }

    public hasApiKey(): boolean {
        return !!this._apiKey;
    }

    public async inferModules(filePaths: string[]): Promise<Map<string, string>> {
        if (!this._apiKey || filePaths.length === 0) {
            console.log('[ArchInference] No API Key or empty files. Using Heuristic Fallback.');
            return this._fallbackHeuristic(filePaths);
        }

        // Check which files are missing from cache
        const missingFiles = filePaths.filter(f => !this._cache.has(f));

        if (missingFiles.length === 0) {
            return this._getMapForFiles(filePaths);
        }

        // Process missing files in one batch (or chunks) to get the "Big Picture"
        // Ideally we send ALL files (even cached ones?) to let LLM see the whole context?
        // Yes, for architecture, context matters. "Auth.ts" might be "Core" or "Auth" depending on other files.
        // A full re-inference is better for correctness, but expensive.
        // Let's try sending ALL paths to get a consistent grouping.
        // We will cache the result to avoid re-running on every view open, 
        // but maybe invalidate if file count changes significantly?

        // For now: Always infer for the active set of files to ensure coherence.
        try {
            const mapping = await this._callLLM(filePaths);
            // Update cache
            mapping.forEach((mod, file) => this._cache.set(file, mod));
            // Persist cache? Maybe not needed if we re-run often. 
            // Actually, saving it helps if we want to fallback.
            return mapping;
        } catch (e) {
            console.error('[ArchInference] Failed:', e);
            // Fallback: return heuristic map (directory-based)
            return this._fallbackHeuristic(filePaths);
        }
    }

    private _fallbackHeuristic(filePaths: string[]): Map<string, string> {
        console.log('[ArchInference] Using Heuristic Layer Classifier');
        const map = new Map<string, string>();

        for (const filePath of filePaths) {
            const lower = filePath.toLowerCase();
            const fileName = filePath.split(/[/\\]/).pop() || '';
            let moduleName = 'Core / Utilities'; // Default

            // 1. PRESENTATION LAYER
            if (
                lower.includes('/ui/') || lower.includes('/components/') || lower.includes('/views/') || lower.includes('/pages/') ||
                fileName.endsWith('.tsx') || fileName.endsWith('.vue') || fileName.endsWith('.svelte') || lower.includes('frontend')
            ) {
                moduleName = 'Presentation Layer';
            }
            // 2. BUSINESS LOGIC / SERVICE LAYER
            else if (
                lower.includes('/services/') || lower.includes('/controllers/') || lower.includes('/managers/') ||
                lower.includes('/hooks/') || lower.includes('/logic/') || lower.includes('/domain/') ||
                fileName.includes('service') || fileName.includes('controller') || fileName.includes('manager')
            ) {
                moduleName = 'Business Logic';
            }
            // 3. DATA LAYER
            else if (
                lower.includes('/api/') || lower.includes('/db/') || lower.includes('/models/') || lower.includes('/store/') ||
                lower.includes('/graphql/') || lower.includes('/queries/') || lower.includes('/repositories/') ||
                fileName.includes('repository') || fileName.includes('store') || fileName.includes('schema')
            ) {
                moduleName = 'Data Layer';
            }
            // 4. INFRASTRUCTURE / CONFIG
            else if (
                lower.includes('/config/') || lower.includes('/utils/') || lower.includes('/lib/') || lower.includes('/helpers/') ||
                lower.includes('/types/') || lower.includes('/interfaces/') || lower.includes('config')
            ) {
                moduleName = 'Infrastructure';
            }
            // 5. TESTS (Optional - maybe hide or group?)
            else if (
                lower.includes('/tests/') || lower.includes('/__tests__/') || fileName.includes('.test.') || fileName.includes('.spec.')
            ) {
                moduleName = 'Tests';
            }

            map.set(filePath, moduleName);
        }

        return map;
    }

    private _capitalize(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    private _getMapForFiles(files: string[]): Map<string, string> {
        const result = new Map<string, string>();
        files.forEach(f => {
            if (this._cache.has(f)) result.set(f, this._cache.get(f)!);
        });
        return result;
    }

    private async _callLLM(paths: string[]): Promise<Map<string, string>> {
        const provider = vscode.workspace.getConfiguration('codeblocks').get('llm.provider');
        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gemini-1.5-flash';
        const modelStr = String(model);

        // Limit paths to avoid token overflow (Safe limit for most models)
        // If we have > 300 files, we only analyze the top 300. The rest will fall back to "Other Components".
        const safePaths = paths.slice(0, 300);
        const inputList = safePaths.map(p => vscode.workspace.asRelativePath(p)).join('\n');

        const prompt = `
You are a Principal Software Architect.
Task: Analyze the following file list and group them into 3 to 8 High-Level Conceptual Modules (e.g., "Identity Service", "Data Access", "UI Components", "Core/Shared", "API Layer").
Context: Ignore the folder structure if it doesn't match the logical purpose. Focus on functionality.

Files:
${inputList}

Output:
A JSON object mapping each file path to its inferred Module Name.
Format: { "src/auth/login.ts": "Identity Service", ... }
Do NOT return markdown. Just the JSON.
`;

        let jsonStr = '';
        if (provider === 'openai') {
            jsonStr = await this._callOpenAI(prompt, modelStr);
        } else {
            jsonStr = await this._callGemini(prompt, modelStr);
        }

        return this._parseJsonMap(jsonStr, paths);
    }

    private async _callGemini(prompt: string, model: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) throw new Error('Gemini API Error');
        const data = await response.json() as any;
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    }

    private async _callOpenAI(prompt: string, model: string): Promise<string> {
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
            body: JSON.stringify({
                model: model === 'gemini-1.5-flash' ? 'gpt-4o-mini' : model,
                messages: [{ role: "system", content: "You are a JSON generator." }, { role: "user", content: prompt }]
            })
        });
        if (!response.ok) throw new Error('OpenAI API Error');
        const data = await response.json() as any;
        return data?.choices?.[0]?.message?.content || '{}';
    }

    private _parseJsonMap(text: string, originalPaths: string[]): Map<string, string> {
        const map = new Map<string, string>();
        try {
            const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const obj = JSON.parse(clean);

            // The LLM returns relative paths. We need to match them back to absolute paths.
            // Map: Relative -> Module
            const relMap = new Map<string, string>();
            Object.entries(obj).forEach(([k, v]) => relMap.set(k, v as string));

            // Match original absolute paths
            for (const absPath of originalPaths) {
                const rel = vscode.workspace.asRelativePath(absPath);
                if (relMap.has(rel)) {
                    map.set(absPath, relMap.get(rel)!);
                } else {
                    // Try partial match? Or default.
                    // If not found, maybe leave undefined (GraphService handles it).
                }
            }
        } catch (e) {
            console.error('Architecture JSON Parse Error', e);
        }
        return map;
    }
}
