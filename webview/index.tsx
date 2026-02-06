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

// =========================================================================
// CodeBlocks Visualization Logic (Frontend)
// =========================================================================
// This component renders the Interactive Graph.
// 
// Architecture:
// 1. Receives Graph Data (Nodes/Edges) from the Extension Backend.
// 2. Uses `dagre` for automatic layout calculation (positioning).
// 3. Renders the interactive map using `reactflow`.
// 4. Handles user interactions (clicks, double-clicks) and sends commands back to VS Code.
//
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Position,
    Handle,
    useReactFlow,
    ReactFlowProvider,
    Panel
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import './style.css';

declare function acquireVsCodeApi(): any;

// Acquire the VS Code Webview API (allows messaging)
const vscode = acquireVsCodeApi();

// --- 1. Custom Group Node Component ---
// This renders the "Boxes" (Files, Folders, Clusters).
const GroupNode = ({ data, style }: any) => {
    // Distinguish types
    const isFolder = data.type === 'folder';
    const isFile = data.type === 'file';

    let backgroundColor = 'var(--vscode-editor-lineHighlightBackground)';
    let borderColor = 'var(--vscode-editorWidget-border)';
    let borderStyle = 'dashed';
    let icon = '';

    // Style according to Logic Type
    if (isFolder) {
        backgroundColor = 'transparent';
        borderColor = 'var(--vscode-editorGroup-border)';
        icon = '📁 ';
    } else if (isFile) {
        backgroundColor = 'var(--vscode-sideBar-background)'; // Theme-aware container color
        borderColor = 'var(--vscode-editorWidget-border)';
        borderStyle = 'solid';
        icon = '📄 ';
    } else {
        // Class or other group
        backgroundColor = 'var(--vscode-editor-lineHighlightBackground)'; // Theme-aware grouping color
        icon = '📦 ';
    }

    return (
        <div style={{
            ...style,
            border: `2px ${borderStyle} ${borderColor}`,
            borderRadius: '8px',
            backgroundColor: backgroundColor,
            width: '100%',
            height: '100%',
            position: 'relative',
            pointerEvents: 'all'
        }}>
            {/* Invisible Handles for Edges connecting to the Class itself */}
            <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />

            {/* Label Header */}
            <div style={{
                position: 'absolute',
                top: '-25px',
                left: '0px',
                padding: '4px 8px',
                background: 'var(--vscode-editor-background)',
                color: 'var(--vscode-textPreformat-foreground)',
                fontWeight: 'bold',
                fontSize: '12px',
                borderRadius: '4px',
                border: `1px solid ${borderColor}`,
                pointerEvents: 'all',
                whiteSpace: 'nowrap'
            }}>
                {icon}{data.label}
            </div>
        </div>
    );
};

// --- 2. Custom Component Node ---
const ComponentNode = ({ data, style }: any) => {
    return (
        <div style={{
            ...style,
            background: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-editorWidget-border)',
            borderRadius: '6px',
            padding: '8px 12px',
            minWidth: '150px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            fontSize: '12px',
            color: 'var(--vscode-editor-foreground)',
            fontFamily: 'var(--vscode-font-family)'
        }}>
            <Handle type="target" position={Position.Top} style={{ background: '#555' }} />

            <div style={{ fontWeight: 'bold', marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '6px' }}>📦</span>
                {data.label}
            </div>
            {data.detail && (
                <div style={{ fontSize: '10px', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                    {data.detail}
                </div>
            )}

            <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
        </div>
    );
};

// --- 3. System Node (Conceptual Architecture) ---
// (Moved inside or defined properly)
const SystemNode = ({ data, style }: any) => {
    return (
        <div style={{
            ...style,
            backgroundColor: 'var(--vscode-editor-background)',
            border: '2px solid var(--vscode-editorWidget-border)',
            borderRadius: '12px',
            width: '100%',
            height: '100%',
            position: 'relative',
            pointerEvents: 'none'
        }}>
            <div style={{
                position: 'absolute',
                top: '-35px',
                left: '0',
                padding: '6px 12px',
                background: 'var(--vscode-editor-background)',
                border: '2px solid var(--vscode-editorWidget-border)',
                borderRadius: '8px',
                color: 'var(--vscode-textLink-foreground)',
                fontWeight: '900',
                fontSize: '16px',
                pointerEvents: 'all',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
            }}>
                <span style={{ fontSize: '18px', marginRight: '8px' }}>🏢</span>
                {data.label}
            </div>
            {/* Show "Collapsed" indicator if not expanded? passed via data? */}
            {!data.isExpanded && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic', fontSize: '12px'
                }}>
                    Double-click to expand
                </div>
            )}
        </div>
    );
};


// --- 4. Process Node (Flowchart) ---
// --- 4. Process Node (Flowchart) ---
const ProcessNode = ({ data, style }: any) => {
    // Shapes based on type
    const safeType = (data.type || 'process').toLowerCase();
    const isStart = safeType === 'start';
    const isEnd = safeType === 'end';
    const isDecision = safeType === 'decision';
    // Default to Process (Cyan)

    let borderColor = 'var(--vscode-terminal-ansiCyan)';
    let glowColor = 'var(--vscode-terminal-ansiCyan)';
    let bgOpacity = '0.05';

    if (isStart) {
        borderColor = 'var(--vscode-terminal-ansiGreen)';
        glowColor = 'var(--vscode-terminal-ansiGreen)';
        bgOpacity = '0.1';
    } else if (isEnd) {
        borderColor = 'var(--vscode-terminal-ansiRed)';
        glowColor = 'var(--vscode-terminal-ansiRed)';
        bgOpacity = '0.1';
    } else if (isDecision) {
        borderColor = 'var(--vscode-terminal-ansiYellow)';
        glowColor = 'var(--vscode-terminal-ansiYellow)';
        bgOpacity = '0.1';
    }

    const borderRadius = (isStart || isEnd) ? '25px' : '6px';
    const borderStyle = isDecision ? 'double' : 'solid';
    // Use Terminal Colors for BG 
    const bg = `color-mix(in srgb, ${borderColor} ${Number(bgOpacity) * 100}%, var(--vscode-editor-background))`;

    return (
        <div style={{
            ...style,
            background: bg,
            border: `2px ${borderStyle} ${borderColor}`,
            borderRadius: borderRadius,
            padding: '12px',
            minWidth: '160px',
            textAlign: 'center',
            boxShadow: `0 4px 15px color-mix(in srgb, ${glowColor} 20%, transparent)`, // Vibrant Glow
            transform: isDecision ? 'skewX(-10deg)' : 'none', // Faux decision shape
            color: 'var(--vscode-editor-foreground)',
            fontFamily: 'var(--vscode-font-family)'
        }}>
            <Handle type="target" position={Position.Top} style={{ background: borderColor }} />

            <div style={{ fontWeight: 'bold', marginBottom: '6px', transform: isDecision ? 'skewX(10deg)' : 'none' }}>
                {data.label}
            </div>
            {data.description && (
                <div style={{ fontSize: '10px', opacity: 0.9, transform: isDecision ? 'skewX(10deg)' : 'none' }}>
                    {data.description}
                </div>
            )}

            <div style={{ marginTop: '8px', fontSize: '9px', opacity: 0.6, transform: isDecision ? 'skewX(10deg)' : 'none' }}>
                {data.files?.length > 0 ? `${data.files.length} source file(s)` : ''}
            </div>

            <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
        </div>
    );
};

// Layout Config
const nodeWidth = 180;
const nodeHeight = 90;

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'TB', expandedIds: Set<string>) => {
    const dagreGraph = new dagre.graphlib.Graph({ compound: true });
    // INCREASED SPACING to prevent overlaps
    dagreGraph.setGraph({ rankdir: direction, ranker: 'network-simplex', marginx: 40, marginy: 40, ranksep: 80, nodesep: 50 });
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // Filter nodes: If parent is collapsed, children are "hidden" from layout engine?
    // Actually, simply setting 'hidden' in ReactFlow property is not enough for Dagre.
    // We must NOT add the children to dagreGraph if parent is collapsed.
    // BUT we must render the parent.

    // 1. Determine visibility
    const visibleNodes = new Set<string>();
    nodes.forEach(n => {
        if (!n.parentNode) {
            visibleNodes.add(n.id); // Roots always visible
        } else {
            // Check if all ancestors are expanded
            // For now, just direct parent.
            if (expandedIds.has(n.parentNode)) {
                visibleNodes.add(n.id);
            }
        }
    });

    // 2. Add Nodes to Dagre (Sorted for stability)
    const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

    sortedNodes.forEach((node) => {
        if (visibleNodes.has(node.id)) {
            // If it is a Group and COLLAPSED, give it fixed size.
            // If Expanded, let compound layout handle it (small size initially, grows with children).
            const isGroup = node.type === 'group' || node.type === 'system';
            const isExpanded = expandedIds.has(node.id);

            let w = 180, h = 50;

            // DYNAMIC SIZING for PROCESSS NODES
            if (!isGroup) {
                const labelLen = node.data.label ? node.data.label.length : 10;
                const descLen = node.data.description ? node.data.description.length : 0;
                // Heuristic: ~8px per char + padding
                w = Math.max(180, labelLen * 9, descLen * 6);
                h = node.data.description ? 100 : 70;
            }

            if (isGroup) {
                if (isExpanded) {
                    w = 10; h = 10; // Compound will expand
                } else {
                    w = 300; h = 100; // Fixed Collapsed Size
                }
            }

            dagreGraph.setNode(node.id, { width: w, height: h, label: node.data.label });

            if (node.parentNode && visibleNodes.has(node.parentNode)) {
                dagreGraph.setParent(node.id, node.parentNode);
            }
        }
    });

    // 3. Add Edges
    edges.forEach((edge) => {
        // Only add edge if both source and target are visible?
        // OR: If source/target is hidden, we should route edge to the visible Ancestor?
        // That's complex "Edge Aggregation".
        // For Valid Architecture View, aggregating edges is KEY.
        // But backend already aggregated at Component Level (or System Level?).
        // If Backend aggregated at Component Level, and Components are hidden, we need to show edges between SYSTEMS.
        // Wait. Backend GIVES us System Nodes and Component Nodes.
        // Does Backend give System->System edges? NO.
        // Backend gives Component->Component edges.

        // Front-end aggregation:
        // Find visible ancestor for Source. Find visible ancestor for Target.
        // Create (virtual) edge between them.

        // SIMPLIFICATION:
        // If source hidden, map to parent.
        // If target hidden, map to parent.

        if (expandedIds.size === 0) { // Initial state: All systems collapsed
            // Map edges to Systems
        }
    });

    // SKIP complicated edge aggregation in frontend for now. 
    // Simply: Only draw edges where both nodes are visible.
    // This implies we might lose arrows if we collapse system.
    // USER WANT: "High level architecture diagram". 
    // This implies arrows between SYSTEMS should be visible when collapsed.
    // Backend should provide these?
    // Let's rely on Backend having provided high-level edges? No, user tasks said "Component->Component".
    // I can stick to expanding logic for now. 
    // If I collapse a System, the edges disappear. That's acceptable for "Drill Down" MVP.
    // Better: Allow seeing connections inside.

    edges.forEach((edge) => {
        if (visibleNodes.has(edge.source) && visibleNodes.has(edge.target)) {
            dagreGraph.setEdge(edge.source, edge.target);
        }
    });

    dagre.layout(dagreGraph);

    // Apply positions
    const layoutedNodes = nodes.map((node) => {
        // ... (Similar logic, only for visible nodes)
        if (!visibleNodes.has(node.id)) {
            return { ...node, hidden: true };
        }

        const nodeWithPosition = dagreGraph.node(node.id);
        if (!nodeWithPosition) return { ...node, hidden: true }; // Should not happen

        node.targetPosition = direction === 'LR' ? Position.Left : Position.Top;
        node.sourcePosition = direction === 'LR' ? Position.Right : Position.Bottom;
        node.hidden = false;

        const absoluteX = nodeWithPosition.x - nodeWithPosition.width / 2;
        const absoluteY = nodeWithPosition.y - nodeWithPosition.height / 2;

        // Pass info to data for render
        node.data = { ...node.data, isExpanded: expandedIds.has(node.id) };

        if (node.parentNode && visibleNodes.has(node.parentNode)) {
            const parent = dagreGraph.node(node.parentNode);
            node.position = {
                x: absoluteX - (parent.x - parent.width / 2),
                y: absoluteY - (parent.y - parent.height / 2)
            };
        } else {
            node.position = { x: absoluteX, y: absoluteY };
        }

        if (node.type === 'group' || node.type === 'system') {
            node.style = { ...node.style, width: nodeWithPosition.width, height: nodeWithPosition.height };
        }
        return node;
    });

    return { nodes: layoutedNodes, edges };
};

function CallGraphContent() {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    // Ref to track expansion state across stale closures (fixes View Reset)
    const expandedIdsRef = useRef<Set<string>>(new Set());

    const [selectedNode, setSelectedNode] = useState<any>(null);
    const [codePreview, setCodePreview] = useState<{ content: string, startLine: number } | string>('Loading...');
    const [hoveredNode, setHoveredNode] = useState<any>(null);

    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [isLoading, setIsLoading] = useState<boolean>(true); // NEW: Loading State

    // Raw Data for Toggle Layouts
    const [rawNodes, setRawNodes] = useState<any[]>([]);
    const [rawEdges, setRawEdges] = useState<any[]>([]);

    // Refs
    const hasLoaded = useRef(false);
    const clickTimeout = useRef<any>(null);
    const { fitView } = useReactFlow();

    // Register Custom Types
    const nodeTypes = useMemo(() => ({
        group: GroupNode,
        component: ComponentNode,
        system: SystemNode,
        process: ProcessNode,
        decision: ProcessNode, // Map 'decision' to ProcessNode logic
        start: ProcessNode,    // Map 'start' to ProcessNode logic
        end: ProcessNode       // Map 'end' to ProcessNode logic
    }), []);

    // Race Condition Handling
    const activeRequestId = useRef<string | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'updateGraph') {
                // STRICT FILTER: If we are in Drill Down Mode (activeRequestId is set),
                // we ONLY accept updates matching that specific ID.
                if (activeRequestId.current) {
                    if (message.requestId !== activeRequestId.current) {
                        console.log('Ignored update during active drill-down', message.requestId);
                        return;
                    }
                } else {
                    if (viewStack.length > 0) {
                        console.log('Ignored background update while deep in hierarchy');
                        return;
                    }
                }

                setIsLoading(false); // Stop loading on update

                const { nodes: rNodes, edges: rEdges } = message.data;

                // FRONTEND DATA NORMALIZATION (Prevent White Nodes)
                const safeNodes = rNodes.map((n: any) => {
                    const knownTypes = ['group', 'component', 'system', 'process', 'decision', 'start', 'end'];
                    const type = (n.type || 'process').toLowerCase();
                    return {
                        ...n,
                        type: knownTypes.includes(type) ? type : 'process',
                        data: {
                            ...n.data,
                            type: knownTypes.includes(type) ? type : 'process' // Also update data for styling
                        }
                    };
                });

                setRawNodes(safeNodes);
                setRawEdges(rEdges);

                // Auto-Expand Logic:
                // Use Ref current value to persist manual expansions!
                let nextExpanded = new Set(expandedIdsRef.current);

                const rootNodes = safeNodes.filter((n: any) => !n.parentNode);
                if (rootNodes.length === 1 && nextExpanded.size === 0) {
                    // Only auto-expand root if nothing else is expanded (initial load)
                    nextExpanded.add(rootNodes[0].id);
                }

                // Update State AND Ref
                expandedIdsRef.current = nextExpanded;
                setExpandedIds(nextExpanded);

                // Trigger Layout with NEW data
                triggerLayout(safeNodes, rEdges, nextExpanded);

                // Initial Fit View
                if (!hasLoaded.current && safeNodes.length > 0) {
                    setTimeout(() => {
                        fitView({ padding: 0.2 });
                        hasLoaded.current = true;
                    }, 150);
                }
            } else if (message.command === 'codeResponse') {
                // Handle object response or string fallback
                if (typeof message.data === 'string') {
                    setCodePreview(message.data);
                } else {
                    setCodePreview(message.data || 'No code found.');
                }
            }
        };

        window.addEventListener('message', handleMessage);

        // Notify ready ONLY ONCE
        vscode.postMessage({ command: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, []); // Empty dependency array fixed the reset loop!

    // State for History (Drill Down)
    const [viewStack, setViewStack] = useState<any[]>([]);
    const [currentLabel, setCurrentLabel] = useState('System Overview');

    const goBack = () => {
        if (viewStack.length === 0) return;

        // CANCEL pending requests
        activeRequestId.current = null;

        const prev = viewStack[viewStack.length - 1];
        setRawNodes(prev.nodes);
        setRawEdges(prev.edges);
        triggerLayout(prev.nodes, prev.edges, new Set()); // Reset expansion on back
        setViewStack(viewStack.slice(0, -1));
        setCurrentLabel(prev.label);
    };

    const triggerLayout = (n: any[], e: any[], exp: Set<string>) => {
        const layout = getLayoutedElements([...n], [...e], 'TB', exp);
        setNodes(layout.nodes);
        setEdges(layout.edges);
    };

    const onNodeClick = useCallback((event: any, node: any) => {
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
        }
        clickTimeout.current = setTimeout(() => {
            console.log('Processed Single Click');
            setSelectedNode(node);

            const loc = node.data.location ||
                (node.data.files && node.data.files.length > 0 ? { file: node.data.files[0], line: 0 } : null);

            if (loc) {
                setCodePreview('Loading code...');
                vscode.postMessage({
                    command: 'fetchCode',
                    location: loc
                });
            } else {
                setCodePreview('No source location available.');
            }
            clickTimeout.current = null;
        }, 250);
    }, []);

    const onNodeDoubleClick = useCallback((event: any, node: any) => {
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
        }

        // 1. Drill Down (System Node OR Process Node)
        if (node.type === 'system' || node.type === 'process') {
            console.log('Drilling down into:', node.data.label);

            // Only drill down if we have files
            if (!node.data.files || node.data.files.length === 0) {
                vscode.postMessage({ command: 'jumpTo', location: node.data.location });
                return;
            }

            // Save current state
            setViewStack(prev => [...prev, { nodes: rawNodes, edges: rawEdges, label: currentLabel }]);
            setCurrentLabel(node.data.label);

            // Generate Request ID
            const requestId = Date.now().toString();
            activeRequestId.current = requestId;

            vscode.postMessage({
                command: 'drillDown',
                filePaths: node.data.files,
                label: node.data.label,
                nodeType: node.type, // 'system' or 'process'
                requestId: requestId
            });
            setIsLoading(true); // Start loading
            return;
        }

        // 2. Toggle Expansion (Group Node)
        if (node.type === 'group') {
            const newExpanded = new Set(expandedIdsRef.current); // Use Ref!
            if (newExpanded.has(node.id)) {
                newExpanded.delete(node.id);
            } else {
                newExpanded.add(node.id);
            }
            expandedIdsRef.current = newExpanded; // Update Ref
            setExpandedIds(newExpanded);          // Update State
            triggerLayout(rawNodes, rawEdges, newExpanded);
            return;
        }

        // 3. Jump to Code (Precise Location)
        if (node.data.location) {
            vscode.postMessage({
                command: 'jumpTo',
                location: node.data.location
            });
            return;
        }

        // 4. Jump to Code (File Fallback for Process Nodes)
        if (node.data.files && node.data.files.length > 0) {
            vscode.postMessage({
                command: 'jumpTo',
                location: { file: node.data.files[0], line: 0 }
            });
        }
    }, [expandedIds, rawNodes, rawEdges, currentLabel, viewStack]);


    const onEdgeDoubleClick = useCallback((event: any, edge: any) => {
        if (edge.data && edge.data.location) {
            console.log('Jumping to Edge source:', edge.data.location);
            vscode.postMessage({
                command: 'jumpTo',
                location: edge.data.location
            });
        }
    }, []);

    const onNodeMouseEnter = useCallback((event: any, node: any) => {
        setHoveredNode(node);
        setTooltipPos({ x: event.clientX + 15, y: event.clientY + 15 });
    }, []);

    const onNodeMouseLeave = useCallback(() => {
        setHoveredNode(null);
    }, []);

    const onPaneMouseMove = useCallback((event: any) => {
        if (hoveredNode) {
            setTooltipPos({ x: event.clientX + 15, y: event.clientY + 15 });
        }
    }, [hoveredNode]);

    const closeModal = () => {
        setSelectedNode(null);
        setCodePreview('');
    };

    const openInEditor = () => {
        if (selectedNode) {
            const tempLoc = selectedNode.data.location || (selectedNode.data.files && selectedNode.data.files[0] ? { file: selectedNode.data.files[0], line: 0 } : null);
            if (tempLoc) {
                vscode.postMessage({
                    command: 'jumpTo',
                    location: tempLoc
                });
            }
            closeModal();
        }
    };

    return (
        <div style={{ height: '100%', width: '100%' }} onMouseMove={onPaneMouseMove}>



            {(nodes.length === 0 && !isLoading) && (
                <div className="waiting-message" style={{ position: 'absolute', top: 50, left: 20, zIndex: 10, color: 'var(--vscode-descriptionForeground)' }}>
                    Waiting for graph data...
                </div>
            )}

            {/* LOADING OVERLAY */}
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 9999, // On top of map
                    background: 'rgba(0, 0, 0, 0.4)', // Semi-transparent dim
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: 'var(--vscode-editor-foreground)',
                    pointerEvents: 'all' // Block interaction
                }}>
                    <div className="spinner"></div>
                    <div style={{ marginTop: '15px', fontWeight: 'bold', fontSize: '14px' }}>
                        Analyzing Workspace...
                    </div>
                </div>
            )}

            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeDoubleClick={onEdgeDoubleClick}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}

                fitView
                // Allow Deep Zoom
                minZoom={0.1}
                // GLOBAL EDGE STYLES (Fixed White Elements)
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                    style: { stroke: 'var(--vscode-editor-foreground)', strokeOpacity: 0.6 },
                    labelStyle: { fill: 'var(--vscode-editor-foreground)', fontWeight: 700 },
                    labelBgStyle: { fill: 'var(--vscode-editor-background)', fillOpacity: 0.8, stroke: 'var(--vscode-editorWidget-border)' },
                    labelShowBg: true,
                }}
            >
                <Background />
                <Controls />
                <MiniMap />

                {/* Navigation Panel */}
                <Panel position="top-left" style={{ display: 'flex', alignItems: 'center', pointerEvents: 'all' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--vscode-editor-background)',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        border: '1px solid var(--vscode-widget-border)',
                        color: 'var(--vscode-foreground)'
                    }}>
                        {viewStack.length > 0 && (
                            <button onClick={goBack} style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--vscode-textLink-foreground)',
                                cursor: 'pointer',
                                marginRight: '10px',
                                fontWeight: 'bold',
                                fontSize: '14px',
                                paddingRight: '10px',
                                borderRight: '1px solid var(--vscode-widget-border)'
                            }}>
                                ⬅ Back
                            </button>
                        )}
                        <span style={{ fontWeight: 'bold', fontSize: '12px' }}>
                            {viewStack.length === 0 ? '🏢 ' : '⚡ '}
                            {currentLabel}
                        </span>
                    </div>
                </Panel>

                <Panel position="top-right">
                    <button
                        className="btn"
                        onClick={() => {
                            // Reset Layout: Re-run Dagre to fix any manual drags
                            triggerLayout(nodes, edges, expandedIds);
                            setTimeout(() => fitView({ padding: 0.2 }), 50);
                        }}
                        style={{
                            background: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            border: 'none',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontWeight: 'bold'
                        }}
                    >
                        Reset Layout
                    </button>
                </Panel>
            </ReactFlow>

            {/* CUSTOM TOOLTIP */}
            {hoveredNode && (
                <div style={{
                    position: 'fixed',
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    zIndex: 9999,
                    background: 'var(--vscode-sideBar-background)',
                    border: '1px solid var(--vscode-editorWidget-border)',
                    boxShadow: '0 4px 8px rgba(0,0,0,0.5)',
                    padding: '12px',
                    borderRadius: '6px',
                    pointerEvents: 'none',
                    fontSize: '12px',
                    maxWidth: '350px',
                    color: 'var(--vscode-editor-foreground)',
                    fontFamily: 'var(--vscode-font-family)'
                }}>
                    {/* Header */}
                    <div style={{ fontWeight: 'bold', marginBottom: '4px', borderBottom: '1px solid var(--vscode-editorWidget-border)', paddingBottom: '4px' }}>
                        {hoveredNode.data.label} <span style={{ opacity: 0.6, fontWeight: 'normal' }}>({hoveredNode.type})</span>
                    </div>

                    {/* Description (Only if provided and different from label) */}
                    {hoveredNode.data.description && hoveredNode.data.description !== hoveredNode.data.label && (
                        <div style={{ marginBottom: '8px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' }}>
                            {hoveredNode.data.description}
                        </div>
                    )}

                    {/* Component Details */}
                    {hoveredNode.type === 'component' && (
                        <>
                            {hoveredNode.data.detail && hoveredNode.data.detail !== 'External' && (
                                <div style={{ marginBottom: '2px' }}>
                                    <span style={{ color: 'var(--vscode-textLink-foreground)' }}>Sig:</span> <span style={{ fontFamily: 'monospace' }}>{hoveredNode.data.detail}</span>
                                </div>
                            )}
                            {hoveredNode.data.location?.fileLabel && (
                                <div style={{ marginBottom: '2px', opacity: 0.8 }}>
                                    <span>File:</span> {hoveredNode.data.location.fileLabel}
                                </div>
                            )}
                            {(hoveredNode.data.incomingCount > 0 || hoveredNode.data.outgoingCount > 0) && (
                                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.6 }}>
                                    Calls: {hoveredNode.data.incomingCount} In / {hoveredNode.data.outgoingCount} Out
                                </div>
                            )}
                            <div style={{ marginTop: '8px', color: 'var(--vscode-textLink-foreground)', fontSize: '11px' }}>
                                Double-click to open code
                            </div>
                        </>
                    )}

                    {/* System/Process Details */}
                    {(hoveredNode.type === 'system' || hoveredNode.type === 'process') && (
                        <>
                            {hoveredNode.data.files && hoveredNode.data.files.length > 0 && (
                                <div style={{ marginBottom: '4px' }}>
                                    Contains {hoveredNode.data.files.length} source file(s).
                                </div>
                            )}
                            <div style={{ marginTop: '8px', color: 'var(--vscode-textLink-foreground)', fontSize: '11px' }}>
                                Double-click to drill down
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* MODAL OVERLAY */}
            {selectedNode && (
                <div className="modal-backdrop" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <span>{selectedNode.data.label}</span>
                            <button className="btn" onClick={closeModal} style={{ background: 'none', color: 'inherit' }}>X</button>
                        </div>
                        <div style={{ padding: '0 15px', color: '#888', fontSize: '11px', marginTop: '5px' }}>
                            {selectedNode.data.location?.fileLabel}
                        </div>
                        <div className="modal-body">
                            {selectedNode.data.description && (
                                <div style={{
                                    marginBottom: '10px',
                                    paddingBottom: '10px',
                                    fontStyle: 'italic',
                                    color: 'var(--vscode-textPreformat-foreground)',
                                    borderBottom: '1px solid var(--vscode-editorWidget-border)'
                                }}>
                                    🤖 {selectedNode.data.description}
                                </div>
                            )}
                            {/* CODE PREVIEW WITH LINE NUMBERS */}
                            {typeof codePreview === 'string' ? (
                                <div style={{ color: 'var(--vscode-errorForeground)', padding: '10px' }}>{codePreview}</div>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    fontFamily: 'var(--vscode-editor-font-family)',
                                    fontSize: '12px',
                                    border: '1px solid var(--vscode-editorWidget-border)',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}>
                                    {/* Line Numbers Column */}
                                    <div style={{
                                        padding: '10px 5px',
                                        textAlign: 'right',
                                        background: 'var(--vscode-editor-lineHighlightBackground)',
                                        color: 'var(--vscode-editorLineNumber-foreground)',
                                        borderRight: '1px solid var(--vscode-editorWidget-border)',
                                        userSelect: 'none',
                                        minWidth: '40px'
                                    }}>
                                        {codePreview.content.split('\n').map((_, i) => (
                                            <div key={i} style={{ lineHeight: '1.5' }}>{codePreview.startLine + i}</div>
                                        ))}
                                    </div>
                                    {/* Code Content Column */}
                                    <div style={{
                                        padding: '10px',
                                        background: 'var(--vscode-editor-background)',
                                        color: 'var(--vscode-editor-foreground)',
                                        overflowX: 'auto',
                                        whiteSpace: 'pre',
                                        flex: 1
                                    }}>
                                        {codePreview.content.split('\n').map((line, i) => (
                                            <div key={i} style={{ lineHeight: '1.5' }}>{line}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeModal}>Close</button>
                            <button className="btn btn-primary" onClick={openInEditor}>Open Code</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const CallGraph = () => (
    <ReactFlowProvider>
        <CallGraphContent />
    </ReactFlowProvider>
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<CallGraph />);
