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

export class GraphSemanticsService {
    private _apiKey: string | undefined;

    constructor() {
        this._apiKey = vscode.workspace.getConfiguration('codeblocks').get('llm.apiKey');
    }

    public async labelEdges(edges: any[], nodes: any[]): Promise<any[]> {
        if (!this._apiKey || edges.length === 0) {
            return edges;
        }

        // Limit to top 20 edges to avoid slow perf?
        // Or batch.

        // Prepare prompt
        const edgeContexts = edges.map(edge => {
            const sourceNode = nodes.find(n => n.id === edge.source);
            const targetNode = nodes.find(n => n.id === edge.target);
            const calls = edge.data?.calls || [];
            if (!sourceNode || !targetNode || calls.length === 0) return null;

            return {
                id: edge.id,
                source: sourceNode.data.label,
                target: targetNode.data.label,
                calls: calls.slice(0, 5) // Limit context
            };
        }).filter(x => x !== null);

        if (edgeContexts.length === 0) return edges;

        // Call LLM
        try {
            const labels = await this._callLLM(edgeContexts);

            // Apply labels
            const newEdges = [...edges];
            for (const labelData of labels) {
                const edge = newEdges.find(e => e.id === labelData.id);
                if (edge && labelData.label) {
                    edge.label = labelData.label;
                }
            }
            return newEdges;
        } catch (e) {
            console.error('[GraphSemantics] LLM Labeling failed:', e);
            return edges;
        }
    }

    private async _callLLM(contexts: any[]): Promise<{ id: string, label: string }[]> {
        const provider = vscode.workspace.getConfiguration('codeblocks').get('llm.provider');
        const model = vscode.workspace.getConfiguration('codeblocks').get('llm.model') || 'gemini-1.5-flash';
        const modelStr = String(model);

        const prompt = `
You are a Software Architect.
Task: Generate concise semantic labels (1-3 words) for the relationships between components.
Context: I have a list of component interactions.
Input:
${JSON.stringify(contexts)}

Instructions:
- Look at the 'source', 'target', and 'calls'.
- Infer the high-level purpose (e.g., "Authenticates", "Fetches Data", "Parses", "Renders").
- Return a JSON array: [{ "id": "edge-id", "label": "Semantic Label" }]
- Be concise. Verbs preferred.
`;

        // ... (Re-use call logic from GraphFilterService or similar)
        // Ideally we should have a shared LLMClient. For now, copying to be safe/fast.
        // Actually, importing SummaryService or reusing?
        // Let's implement fetch.

        if (provider === 'openai') {
            return this._callOpenAI(prompt, modelStr);
        } else {
            return this._callGemini(prompt, modelStr);
        }
    }

    private async _callGemini(prompt: string, model: string): Promise<any[]> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) return [];
        const data = await response.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return this._parseJson(text);
    }

    private async _callOpenAI(prompt: string, model: string): Promise<any[]> {
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
            body: JSON.stringify({
                model: model === 'gemini-1.5-flash' ? 'gpt-4o-mini' : model,
                messages: [{ role: "system", content: "You are a JSON generator." }, { role: "user", content: prompt }]
            })
        });
        if (!response.ok) return [];
        const data = await response.json() as any;
        return this._parseJson(data?.choices?.[0]?.message?.content);
    }

    private _parseJson(text: string | undefined): any[] {
        if (!text) return [];
        try {
            const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(clean);
        } catch (e) { return []; }
    }
}
