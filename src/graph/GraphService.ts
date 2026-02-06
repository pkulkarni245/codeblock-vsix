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
import * as path from 'path';
import { SymbolParser } from '../parser/SymbolParser';

interface GraphNode {
    id: string;
    label: string;
    type: string;
    filePath: string;
    line: number;
    kind: vscode.SymbolKind;
    detail?: string;
    children?: GraphNode[];
}

interface Edge {
    source: string;
    target: string;
    label?: string; // e.g., "calls", "imports"
}

export class GraphService {
    private _context: vscode.ExtensionContext;
    private _nodeIdMap = new Map<string, string>(); // "path:line" -> "nodeId"

    constructor(context?: vscode.ExtensionContext) {
        this._context = context!;
    }

    // Generate Graph Data for React Flow
    // Supports:
    // 1. Files + Classes + Functions (Default)
    // 2. Semantic Modules (Architecture View)
    // 3. Flattened Component View (includeFiles=false)
    public async generateGraph(
        files: { document: vscode.TextDocument, symbols: vscode.DocumentSymbol[] }[],
        cachedSummaries?: Map<string, string>,
        semanticMap?: Map<string, string>, // File -> Module Name
        virtualRootLabel?: string, // e.g., "Backend"
        includeFiles: boolean = true // If false, we hide File Nodes and map components directly to Module/System
    ): Promise<{ nodes: any[], edges: any[] }> {

        const nodes: any[] = [];
        const edges: any[] = [];
        this._nodeIdMap.clear();

        const fileMap = new Map<string, string>(); // uri -> fileNodeId
        const classMap = new Map<string, string>(); // "uri::ClassName" -> classNodeId
        const symbolOwnerMap = new Map<string, string>(); // symbolId -> ownerId (Class or File, or Module)

        // 1. Create Nodes
        // Group by Semantic Modules if provided
        const moduleGroups = new Map<string, string>(); // ModuleName -> GroupId

        // Initial Parent is either "Start" or "Virtual Root"
        const ROOT_ID = 'root-system';

        if (virtualRootLabel) {
            // Create Virtual Root Node
            nodes.push({
                id: ROOT_ID,
                type: 'group',
                data: { label: virtualRootLabel, type: 'system' },
                style: { backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '2px dashed #444', color: '#fff' },
                position: { x: 0, y: 0 }
            });
        }

        for (const file of files) {
            const { document, symbols } = file;
            const uriStr = document.uri.toString();
            const fsPath = document.uri.fsPath;

            // Determine Parent (Module or Workspace Root)
            let parentId = virtualRootLabel ? ROOT_ID : undefined;

            if (semanticMap && semanticMap.has(fsPath)) {
                const moduleName = semanticMap.get(fsPath)!;
                if (!moduleGroups.has(moduleName)) {
                    const groupId = `mod-${moduleName.replace(/\s+/g, '-').toLowerCase()}`;
                    nodes.push({
                        id: groupId,
                        type: 'group',
                        data: { label: moduleName, type: 'system' }, // 'system' type triggers drill down
                        style: { backgroundColor: 'rgba(100, 149, 237, 0.1)', border: '1px solid #6495ED', color: '#fff' },
                        position: { x: 0, y: 0 }
                    });
                    moduleGroups.set(moduleName, groupId);
                }
                parentId = moduleGroups.get(moduleName);
            }

            const fileId = `file-${uriStr}`;
            fileMap.set(uriStr, fileId);

            // Create Node Object (Mutable)
            const fileNode: any = {
                id: fileId,
                type: 'group', // Default to container
                parentNode: parentId,
                data: { label: path.basename(fsPath), type: 'file' },
                style: { backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid #555', padding: '10px' },
                position: { x: 0, y: 0 }
            };

            // Only add File Node if includeFiles is TRUE
            if (includeFiles) {
                nodes.push(fileNode);
            }

            let hasChildren = false;

            // Process Symbols to Find Classes (Components)
            const processSymbols = (items: vscode.DocumentSymbol[], ownerId: string, systemParentId: string) => {
                for (const item of items) {
                    const id = this._getNodeId(document.uri, item);

                    if (item.kind === vscode.SymbolKind.Class || item.kind === vscode.SymbolKind.Interface) {
                        hasChildren = true;

                        // FLATTENING LOGIC:
                        // If includeFiles=true, parent is File (ownerId).
                        // If includeFiles=false, parent is System (systemParentId).
                        const activeParentId = includeFiles ? ownerId : systemParentId;

                        // Create Class Node (ALWAYS create it, just change parent)
                        nodes.push({
                            id: id,
                            parentNode: activeParentId,
                            extent: 'parent', // Constrain to parent
                            data: { label: item.name, detail: item.detail, kind: 'Class', type: 'component' },
                            type: 'component',
                            style: { background: '#222', border: '1px solid #888', padding: '8px', borderRadius: '4px' },
                            position: { x: 0, y: 0 }
                        });
                        classMap.set(`${uriStr}::${item.name}`, id);
                        symbolOwnerMap.set(id, id); // Class owns itself

                        if (item.children) {
                            item.children.forEach(child => {
                                const childId = this._getNodeId(document.uri, child);
                                symbolOwnerMap.set(childId, id);
                            });
                        }

                    } else if (item.kind === vscode.SymbolKind.Function || item.kind === vscode.SymbolKind.Method || item.kind === vscode.SymbolKind.Constant || item.kind === vscode.SymbolKind.Variable) {
                        // FUNCTION / VARIABLE (Top Level or Class Level)

                        const isTopLevel = ownerId === fileId; // If owner is file, it's top level

                        // If includeFiles=false, we MUST render top level functions/constants as nodes
                        if (isTopLevel && !includeFiles) {
                            // Create Component Node for this Top-Level Function
                            nodes.push({
                                id: id,
                                parentNode: systemParentId, // Attach directly to System
                                extent: 'parent',
                                data: { label: item.name, detail: item.detail || 'Function', kind: vscode.SymbolKind[item.kind], type: 'component' },
                                type: 'component',
                                style: { background: '#252526', border: '1px solid #555', padding: '6px', borderRadius: '4px' },
                                position: { x: 0, y: 0 }
                            });
                            symbolOwnerMap.set(id, id); // It owns itself

                            // Map children
                            if (item.children) {
                                const assignOwner = (subItems: vscode.DocumentSymbol[]) => {
                                    subItems.forEach(sub => {
                                        const subId = this._getNodeId(document.uri, sub);
                                        symbolOwnerMap.set(subId, id);
                                        if (sub.children) assignOwner(sub.children);
                                    });
                                };
                                assignOwner(item.children);
                            }
                        } else {
                            // Standard Mapping (Hidden inside File/Class) - Do NOT create Node
                            const activeParent = includeFiles ? ownerId : systemParentId;
                            symbolOwnerMap.set(id, activeParent);

                            if (item.children) {
                                const assignOwner = (subItems: vscode.DocumentSymbol[]) => {
                                    subItems.forEach(sub => {
                                        const subId = this._getNodeId(document.uri, sub);
                                        symbolOwnerMap.set(subId, activeParent);
                                        if (sub.children) assignOwner(sub.children);
                                    });
                                };
                                assignOwner(item.children);
                            }
                        }
                    }
                }
            };
            processSymbols(symbols, fileId, parentId || ROOT_ID); // Use ROOT_ID if no parent

            // CONVERT TO LEAF IF EMPTY (Only if includeFiles)
            if (includeFiles && !hasChildren) {
                fileNode.type = 'component'; // Render as leaf component
                fileNode.data.detail = 'Source File';
                fileNode.style = undefined; // Reset style to let ComponentNode handle it
                // Map the file itself as the owner for edges (since we map function calls to 'parentId')
                // Wait, functions mapped to 'parentId' (fileId) will now be "Self-Loops" or "Internal"?
                // If I have Function A calls Function B (both in this file), both owned by fileId.
                // Edge: fileId -> fileId. (Excluded by self-loop check).
                // External calls: fileId -> OtherId. This works perfectly.
            }
        }

        // 2. Compute Aggregated Edges
        // Iterate all functions again -> get outgoing calls -> find Target Symbol -> Find Owner -> Create Edge (Owner A -> Owner B)
        const edgeMap = new Map<string, { count: number, calls: Set<string>, location?: any }>(); // "sourceId|targetId" -> { count, calls, location? }

        const callsPromises: Promise<void>[] = [];
        const visitedSymbols = new Set<string>();

        for (const file of files) {
            const { document, symbols } = file;
            const uriStr = document.uri.toString();
            const fileId = fileMap.get(uriStr);

            if (!fileId) continue; // Should not happen

            const processCalls = (items: vscode.DocumentSymbol[]) => {
                for (const item of items) {
                    const id = this._getNodeId(document.uri, item);
                    if (visitedSymbols.has(id)) continue;
                    visitedSymbols.add(id);

                    // Skip variables, only functions/methods have logic?
                    // Actually, variables might be initialized with calls.
                    // Let's check calls for everything.

                    const p = this._aggregateOutgoingCalls(document, item, id, symbolOwnerMap, edgeMap);
                    callsPromises.push(p);

                    if (item.children) processCalls(item.children);
                }
            };
            processCalls(symbols);
        }

        // Wait for all Call Hierarchy lookups (Parallel)
        await Promise.all(callsPromises);

        // Convert Edge Map to Edges
        edgeMap.forEach((meta, key) => {
            const [source, target] = key.split('|');
            // If source === target, it's an internal call (Self Loop), skip for Component Graph
            if (source !== target) {
                edges.push({
                    id: `e-${source}-${target}`,
                    source: source,
                    target: target,
                    label: meta.count > 1 ? `${meta.count} calls` : undefined, // Simplify label
                    animated: true,
                    style: { stroke: '#666', strokeWidth: 1.5 },
                    data: { calls: Array.from(meta.calls) } // Store details
                });
            }
        });


        // 3. Post-Process: Semantic Edge Labeling (Batch LLM) - Only if API Key
        // const semanticService = ...
        // await semanticService.labelEdges(edges, files); // TODO

        return { nodes, edges };
    }

    public convertProcessToReactFlow(processData: { nodes: any[], edges: any[] }): { nodes: any[], edges: any[] } {
        const nodes = processData.nodes.map((n, i) => ({
            id: n.id,
            type: n.type || 'process', // ReactFlow Type (used for nodeTypes lookup)
            data: {
                label: n.label,
                description: n.description,
                files: n.files,
                type: n.type || 'process' // Pass type to Data for ProcessNode logic
            },
            position: { x: 0, y: i * 150 }, // Initial layout, Dagre will fix
            style: undefined // Let Frontend ProcessNode handle styling!
        }));

        const edges = processData.edges.map(e => ({
            id: `e-${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: true,
            type: 'smoothstep'
        }));

        return { nodes, edges };
    }

    private async _aggregateOutgoingCalls(
        document: vscode.TextDocument,
        symbol: vscode.DocumentSymbol,
        symbolId: string,
        ownerMap: Map<string, string>,
        edgeMap: Map<string, { count: number, calls: Set<string>, location?: any }>
    ) {
        // Find Owner of THIS symbol
        const sourceOwnerId = ownerMap.get(symbolId);
        if (!sourceOwnerId) return; // Should be mapped

        try {
            // Use Call Hierarchy to get Outgoing Calls
            // NOTE: prepareCallHierarchy needs a Range.
            // Be careful triggering this for EVERY symbol on a large workspace. This is the bottleneck.
            // Optimization: Only do this for Methods/Functions?
            if (symbol.kind !== vscode.SymbolKind.Method && symbol.kind !== vscode.SymbolKind.Function) return;

            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.executePrepareCallHierarchy',
                document.uri,
                symbol.selectionRange.start
            );

            if (!items || items.length === 0) return;

            const rootItem = items[0];
            const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                'vscode.provideOutgoingCalls',
                rootItem
            );

            if (!outgoing) return;

            for (const call of outgoing) {
                const targetUri = call.to.uri;
                const targetRange = call.to.selectionRange;
                // We need to match this to a known Node ID.
                // We don't have the Symbol Object easily here, but we have the Range.
                // We can construct the ID if we know the mapping logic.
                // Problem: _getNodeId requires the DocumentSymbol object (for detail/kind hacks).
                // Solution: We need a reverse map: "URI:StartLine" -> NodeId
                const targetKey = `${targetUri.toString()}:${targetRange.start.line}`;
                const targetNodeId = this._nodeIdMap.get(targetKey);

                if (targetNodeId) {
                    const targetOwnerId = ownerMap.get(targetNodeId);

                    if (targetOwnerId && sourceOwnerId !== targetOwnerId) {
                        const edgeKey = `${sourceOwnerId}|${targetOwnerId}`;
                        const existing = edgeMap.get(edgeKey);
                        const callDesc = `${symbol.name} -> ${call.to.name}`;

                        if (existing) {
                            existing.count++;
                            existing.calls.add(callDesc);
                        } else {
                            edgeMap.set(edgeKey, { count: 1, calls: new Set([callDesc]) });
                        }
                    }
                }
            }

        } catch (e) {
            // Ignore (Call Hierarchy not supported for language, etc.)
        }
    }

    // Helper to generate consistent IDs
    private _getNodeId(uri: vscode.Uri, symbol: vscode.DocumentSymbol): string {
        // Ensure uniqueness even if same name
        const id = `${uri.toString()}::${symbol.name}::${symbol.range.start.line}`;
        // Store for Reverse Lookup (Call Hierarchy)
        const key = `${uri.toString()}:${symbol.selectionRange.start.line}`;
        this._nodeIdMap.set(key, id);
        return id;
    }
}
