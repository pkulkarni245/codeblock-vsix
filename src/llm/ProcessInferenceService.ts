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

export interface ProcessNode {
    id: string;
    label: string;
    type: 'process' | 'decision' | 'start' | 'end' | 'database' | 'system';
    files: string[]; // Files associated with this step
    description?: string;
}

export interface ProcessEdge {
    source: string;
    target: string;
    label?: string;
}

export interface ProcessGraphData {
    nodes: ProcessNode[];
    edges: ProcessEdge[];
}

export class ProcessInferenceService {
    private _apiKey: string | undefined;
    private _cache: Map<string, { data: ProcessGraphData, checksum: string }> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this._apiKey = vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
    }

    private _getApiKey(): string | undefined {
        return vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
    }

    public hasApiKey(): boolean {
        return !!this._getApiKey();
    }

    /**
     * Level 0: Global System Architecture
     * Input: All Files (Structure Only)
     * Output: 5-8 Major System Nodes (Clusters) with interactions.
     */
    public async generateSystemFlow(filePaths: string[]): Promise<ProcessGraphData | null> {
        const apiKey = this._getApiKey();
        if (!apiKey || filePaths.length === 0) return null;

        // Cache Key for System Flow (using top level directories or specific key)
        const cacheKey = 'SYSTEM_FLOW_ROOT';
        // We can't easily checksum ALL files efficiently. 
        // Let's use file count + list hash as a proxy? Or simply strict timeout cache?
        // Better: Use the sorted file paths string as a checksum/key itself (if file list changes, we re-gen).
        // If content changes, System Architecture rarely changes. So file list is good enough proxy.
        const pathKey = filePaths.sort().join('|');
        if (this._cache.has(cacheKey)) {
            const entry = this._cache.get(cacheKey)!;
            if (entry.checksum === pathKey) {
                return entry.data;
            }
        }

        const prompt = `
You are a Principal Software Architect.
Task: Analyze the entire codebase and identify the MAJOR FUNCTIONAL SUBSYSTEMS (Level 0 Architecture).
Goal: Group the code into 4-8 High-Level System Nodes (e.g., "Frontend", "User Auth", "Payment Core", "Data Layer", "Ext Integration").
Focus: High-level boundaries and data flow between these systems.

Files:
${filePaths.slice(0, 300).map(p => vscode.workspace.asRelativePath(p)).join('\n')}
${filePaths.length > 300 ? '... (and more files truncated for brevity)' : ''}

Output JSON Format:
{
  "nodes": [
    { "id": "1", "label": "Authentication System", "type": "system", "files": ["src/auth.ts", "src/login.tsx"], "description": "Handles identity and access. Manages JWT tokens and user sessions." },
    { "id": "2", "label": "Database Layer", "type": "database", "files": ["src/db/*"], "description": "Postgres models and ORM logic." }
  ],
  "edges": [
    { "source": "1", "target": "2", "label": "Validates Creds" }
  ]
}
Do NOT return markdown. Only JSON.
`;
        try {
            const data = await this._callLLM(prompt);
            this._cache.set(cacheKey, { data, checksum: pathKey });
            return data;
        } catch (e) {
            console.error('[SystemFlow] Failed:', e);
            return null;
        }
    }

    /**
     * Level 1: Subsystem Process Flow
     * Input: Subset of files (and their content)
     * Output: Detailed logic steps (Process Nodes).
     */
    public async generateSubsystemFlow(filePaths: string[]): Promise<ProcessGraphData | null> {
        const apiKey = this._getApiKey();
        if (!apiKey || filePaths.length === 0) return null;

        const sortedPaths = filePaths.sort();
        const cacheKey = sortedPaths.join('|');
        const checksum = await this._computeChecksum(sortedPaths);

        if (this._cache.has(cacheKey)) {
            const entry = this._cache.get(cacheKey)!;
            if (entry.checksum === checksum) {
                console.log('[ProcessInference] Cache Hit for', cacheKey.substring(0, 50));
                return entry.data;
            }
        }

        // Read file contents (truncated) to give LLM context
        const fileContext = await this._readFiles(filePaths);

        const prompt = `
You are a Lead Software Architect.
Task: Create a Detailed Process Flow Diagram for this specific module/subsystem.
Goal: Map out the execution flow / logical steps (Level 1 Flow).
Node Types: 'start', 'end', 'process', 'decision', 'database'.

Code Context:
${fileContext}

Instructions:
1. Analyze the code logic deeply.
2. Identify key Logical Steps.
3. Map steps to specific files.
4. **CRITICAL**: Provide a **DETAILED** technical description for each node (2-3 sentences). Explain *what* it does and *why*. Do NOT generic descriptions.

Output JSON Format:
{
  "nodes": [
    { "id": "1", "label": "Receive Request", "type": "start", "files": ["src/server.ts"], "description": "API Entry point. Parses JSON body and validates headers." },
    { "id": "2", "label": "Validate?", "type": "decision", "files": ["src/validator.ts"], "description": "Checks against UserSchema. Returns 400 if invalid." }
  ],
  "edges": [
    { "source": "1", "target": "2", "label": "next" }
  ]
}
Do NOT return markdown. Only JSON.
`;
        try {
            console.log('[ProcessInference] Prompting LLM for Subsystem Flow...');
            const data = await this._callLLM(prompt);
            console.log(`[ProcessInference] LLM Response: ${data.nodes?.length} nodes, ${data.edges?.length} edges.`);

            // Check for trivial response
            if (!data.nodes || data.nodes.length < 2) {
                console.warn('[ProcessInference] Trivial or Empty Response received from LLM.');
            }

            this._cache.set(cacheKey, { data, checksum });
            return data;
        } catch (e) {
            console.error('[SubsystemFlow] Failed:', e);
            return null;
        }
    }

    private async _computeChecksum(paths: string[]): Promise<string> {
        let sum = '';
        for (const p of paths) {
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
                sum += `${p}:${stat.mtime}|`;
            } catch (e) {
                sum += `${p}:missing|`;
            }
        }
        return sum;
    }

    private async _callLLM(prompt: string): Promise<ProcessGraphData> {
        const provider = vscode.workspace.getConfiguration('codeblocks').get('llm.provider');
        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gemini-1.5-flash';

        // Ensure model is string
        const modelStr = String(model);

        let jsonStr = '{}';
        if (provider === 'openai') {
            jsonStr = await this._callOpenAI(prompt, modelStr);
        } else {
            jsonStr = await this._callGemini(prompt, modelStr);
        }

        return this._parseJson(jsonStr);
    }

    private async _callGemini(prompt: string, model: string): Promise<string> {
        const apiKey = this._getApiKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
        const apiKey = this._getApiKey();
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model === 'gemini-1.5-flash' ? 'gpt-4o-mini' : model,
                messages: [{ role: "system", content: "You are a JSON generator." }, { role: "user", content: prompt }]
            })
        });
        if (!response.ok) throw new Error('OpenAI API Error');
        const data = await response.json() as any;
        return data?.choices?.[0]?.message?.content || '{}';
    }

    private _parseJson(text: string): ProcessGraphData {
        try {
            const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const obj = JSON.parse(clean);

            // Validate
            if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
                return { nodes: [], edges: [] };
            }

            const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';

            obj.nodes.forEach((n: any) => {
                if (Array.isArray(n.files)) {
                    n.files = n.files.map((f: string) => {
                        const cleanF = f.replace(/\*+/g, '');
                        return vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(root), cleanF).fsPath).fsPath;
                    });
                }
            });

            return obj;
        } catch (e) {
            console.error('Process JSON Parse Error', e);
            return { nodes: [], edges: [] };
        }
    }

    private async _readFiles(paths: string[]): Promise<string> {
        let output = '';
        const MAX_CHARS = 100000; // 100k chars ~ 25k tokens. Safe for Gemini 1.5.
        let currentChars = 0;

        // Prioritize: Read up to 50 files?
        for (const p of paths.slice(0, 50)) {
            if (currentChars >= MAX_CHARS) break;

            try {
                const uri = vscode.Uri.file(p);
                const uint8 = await vscode.workspace.fs.readFile(uri);
                const content = new TextDecoder().decode(uint8);

                // Truncate individual huge files
                const truncated = content.length > 8000 ? content.substring(0, 8000) + '...[TRUNCATED]' : content;

                if (currentChars + truncated.length > MAX_CHARS) {
                    // Fit what we can
                    const remaining = MAX_CHARS - currentChars;
                    output += `\n--- FILE: ${vscode.workspace.asRelativePath(p)} ---\n${truncated.substring(0, remaining)}\n...[MAX CONTEXT REACHED]`;
                    break;
                }

                output += `\n--- FILE: ${vscode.workspace.asRelativePath(p)} ---\n${truncated}\n`;
                currentChars += truncated.length;
            } catch (e) {
                // ignore
            }
        }
        return output;
    }

    public generateHeuristicFlow(filePaths: string[], label: string): ProcessGraphData {
        // Create a simple deterministic flow based on file count
        const nodes: ProcessNode[] = [];
        const edges: ProcessEdge[] = [];

        // Start Node
        nodes.push({ id: 'start', label: `Start ${label}`, type: 'start', files: [], description: 'Process Initiation' });

        // Create a node for each file (up to 5 key files?)
        // Or better: Create a node for each "entry point" file (index, main, server)

        let previousId = 'start';

        filePaths.slice(0, 5).forEach((fp, index) => {
            const name = vscode.workspace.asRelativePath(fp).split('/').pop() || 'File';
            const id = `step_${index}`;

            nodes.push({
                id: id,
                label: `Execute ${name}`,
                type: 'process',
                files: [fp],
                description: 'Process Logic Step'
            });

            edges.push({ source: previousId, target: id, label: index === 0 ? 'init' : 'next' });
            previousId = id;
        });

        // End Node
        nodes.push({ id: 'end', label: 'End Process', type: 'end', files: [], description: 'Completion' });
        edges.push({ source: previousId, target: 'end', label: 'finish' });

        return { nodes, edges };
    }
}
