/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Activity, 
  AlertTriangle, 
  Navigation, 
  Settings, 
  Shield, 
  Zap, 
  Volume2, 
  Map as MapIcon,
  BarChart3,
  Flame,
  Plus
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import { cn } from "./lib/utils";
import { aStar, Node } from "./lib/pathfinding";

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GRID_SIZE = 10;
const NODE_SPACING = 60;
const PADDING = 40;

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [gridNodes, setGridNodes] = useState<Map<string, Node>>(new Map());
  const [ambulance, setAmbulance] = useState<{
    currentId: string;
    targetId: string;
    path: string[];
    progress: number;
    priority: "NORMAL" | "CRITICAL";
  } | null>(null);
  const [roadBlocks, setRoadBlocks] = useState<Set<string>>(new Set());
  const [trafficDensity, setTrafficDensity] = useState(0.5);
  const [metrics, setMetrics] = useState<{ time: number; efficiency: number }[]>([]);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [logs, setLogs] = useState<{ id: string; msg: string; type: "info" | "alert" | "success" }[]>([]);

  const addLog = (msg: string, type: "info" | "alert" | "success" = "info") => {
    setLogs(prev => [{ id: Math.random().toString(), msg, type }, ...prev].slice(0, 10));
  };

  useEffect(() => {
    const s = io();
    setSocket(s);

    s.on("init", (data) => {
      const nodes = new Map<string, Node>();
      data.grid.forEach((n: any) => {
        nodes.set(n.id, { ...n, isBlocked: false });
      });
      setGridNodes(nodes);
      addLog("System Initialized. Grid Ready.", "success");
    });

    s.on("sim_update", (data) => {
      // Update congestion randomly for simulation
      setGridNodes(prev => {
        const next = new Map(prev);
        next.forEach((node: Node) => {
          node.congestion = Math.max(0, Math.min(1, node.congestion + (Math.random() - 0.5) * 0.1));
        });
        return next;
      });
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Ambulance Movement Simulation
  useEffect(() => {
    if (!ambulance) return;

    const interval = setInterval(() => {
      setAmbulance(prev => {
        if (!prev || prev.path.length === 0) return prev;

        const nextProgress = prev.progress + (prev.priority === "CRITICAL" ? 0.2 : 0.1);
        
        if (nextProgress >= 1) {
          const newPath = [...prev.path];
          const reachedId = newPath.shift();
          
          if (reachedId && isVoiceEnabled) {
            const utterance = new SpeechSynthesisUtterance(`Approaching intersection ${reachedId}`);
            utterance.rate = 1.2;
            window.speechSynthesis.speak(utterance);
          }

          if (newPath.length === 0) {
            addLog(`Ambulance reached destination: ${prev.targetId}`, "success");
            return null;
          }

          return { ...prev, currentId: reachedId!, path: newPath, progress: 0 };
        }

        return { ...prev, progress: nextProgress };
      });

      // Update metrics
      setMetrics(prev => [
        ...prev, 
        { time: prev.length, efficiency: 80 + Math.random() * 20 }
      ].slice(-20));

    }, 500);

    return () => clearInterval(interval);
  }, [ambulance, isVoiceEnabled]);

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    addLog("AI Analysis started...", "info");
    try {
      const gridState = Array.from(gridNodes.values()).map((n: Node) => ({
        id: n.id,
        congestion: n.congestion,
        isBlocked: n.isBlocked
      }));

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this traffic grid state and provide a 2-sentence strategic recommendation for emergency corridor optimization. Grid state: ${JSON.stringify(gridState.slice(0, 20))}...`,
        config: {
          systemInstruction: "You are a smart city traffic optimization AI. Be concise and professional."
        }
      });

      const analysis = response.text;
      setAiAnalysis(analysis);
      addLog("AI Analysis complete", "success");
    } catch (error) {
      console.error(error);
      addLog("AI Analysis failed", "alert");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNodeClick = (id: string) => {
    if (!ambulance) {
      // Start new ambulance run
      const targetId = `${Math.floor(Math.random() * GRID_SIZE)}-${Math.floor(Math.random() * GRID_SIZE)}`;
      const path = aStar("0-0", targetId, gridNodes, GRID_SIZE);
      if (path) {
        setAmbulance({
          currentId: "0-0",
          targetId,
          path,
          progress: 0,
          priority: "CRITICAL"
        });
        addLog(`Emergency dispatch to ${targetId}`, "alert");
      }
    } else {
      // Toggle roadblock
      setRoadBlocks(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        
        // Update nodes
        setGridNodes(nodes => {
          const n = new Map(nodes);
          const node = n.get(id) as Node;
          if (node) node.isBlocked = !node.isBlocked;
          return n;
        });

        // Re-route if needed
        if (ambulance && ambulance.path.includes(id)) {
          const newPath = aStar(ambulance.currentId, ambulance.targetId, gridNodes, GRID_SIZE);
          if (newPath) {
            setAmbulance({ ...ambulance, path: newPath });
            addLog("Road blocked! Recalculating route...", "alert");
          }
        }

        return next;
      });
    }
  };

  const getHeatmapColor = (congestion: number) => {
    if (!showHeatmap) return "var(--line)";
    const r = Math.floor(congestion * 255);
    const g = Math.floor((1 - congestion) * 255);
    return `rgb(${r}, ${g}, 50)`;
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white font-sans selection:bg-red-500/30">
      {/* Sidebar */}
      <div className="w-80 border-r border-neutral-800 flex flex-col bg-neutral-900/50 backdrop-blur-xl">
        <div className="p-6 border-b border-neutral-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Shield className="w-6 h-6 text-red-500" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">CORRIDOR AI</h1>
          </div>
          <p className="text-xs text-neutral-500 font-mono uppercase tracking-widest">Emergency Response System v4.0</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Controls */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
              <Settings className="w-3 h-3" /> System Controls
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span>TRAFFIC DENSITY</span>
                  <span>{Math.round(trafficDensity * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="1" step="0.1" 
                  value={trafficDensity}
                  onChange={(e) => setTrafficDensity(parseFloat(e.target.value))}
                  className="w-full accent-red-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-neutral-800/50 rounded-lg border border-neutral-700/50">
                <div className="flex items-center gap-2">
                  <Volume2 className={cn("w-4 h-4", isVoiceEnabled ? "text-red-500" : "text-neutral-600")} />
                  <span className="text-sm font-medium">Voice Alerts</span>
                </div>
                <button 
                  onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    isVoiceEnabled ? "bg-red-500" : "bg-neutral-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    isVoiceEnabled ? "left-6" : "left-1"
                  )} />
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-neutral-800/50 rounded-lg border border-neutral-700/50">
                <div className="flex items-center gap-2">
                  <Flame className={cn("w-4 h-4", showHeatmap ? "text-orange-500" : "text-neutral-600")} />
                  <span className="text-sm font-medium">Traffic Heatmap</span>
                </div>
                <button 
                  onClick={() => setShowHeatmap(!showHeatmap)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    showHeatmap ? "bg-orange-500" : "bg-neutral-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    showHeatmap ? "left-6" : "left-1"
                  )} />
                </button>
              </div>
            </div>
          </section>

          {/* Metrics */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="w-3 h-3" /> Efficiency Metrics
            </h3>
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics}>
                  <defs>
                    <linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="efficiency" stroke="#ef4444" fillOpacity={1} fill="url(#colorEff)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-neutral-800/50 rounded-lg border border-neutral-700/50">
                <p className="text-[10px] text-neutral-500 font-mono uppercase">Time Saved</p>
                <p className="text-lg font-bold text-green-500">12.4m</p>
              </div>
              <div className="p-3 bg-neutral-800/50 rounded-lg border border-neutral-700/50">
                <p className="text-[10px] text-neutral-500 font-mono uppercase">Avg Speed</p>
                <p className="text-lg font-bold text-blue-500">64km/h</p>
              </div>
            </div>
          </section>

          {/* AI Analysis */}
          {aiAnalysis && (
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-blue-500 uppercase tracking-widest flex items-center gap-2">
                <Zap className="w-3 h-3" /> AI Recommendation
              </h3>
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30 text-[11px] leading-relaxed text-blue-100 italic">
                "{aiAnalysis}"
              </div>
            </section>
          )}

          {/* Logs */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3 h-3" /> System Logs
            </h3>
            <div className="space-y-2 font-mono text-[10px]">
              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div 
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "p-2 rounded border-l-2",
                      log.type === "alert" ? "bg-red-500/10 border-red-500 text-red-200" :
                      log.type === "success" ? "bg-green-500/10 border-green-500 text-green-200" :
                      "bg-neutral-800 border-neutral-600 text-neutral-400"
                    )}
                  >
                    {log.msg}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className="h-16 border-b border-neutral-800 flex items-center justify-between px-8 bg-black/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">Grid Status: Operational</span>
            </div>
            <div className="h-4 w-[1px] bg-neutral-800" />
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">Active Corridor: {ambulance ? "YES" : "NO"}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={handleAIAnalysis}
              disabled={isAnalyzing}
              className={cn(
                "px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-bold flex items-center gap-2 transition-all",
                isAnalyzing && "opacity-50 cursor-not-allowed"
              )}
            >
              <Zap className={cn("w-3 h-3", isAnalyzing && "animate-spin")} />
              {isAnalyzing ? "ANALYZING..." : "AI ANALYZE"}
            </button>
            <button 
              onClick={() => {
                setAmbulance(null);
                setRoadBlocks(new Set());
                setGridNodes(prev => {
                  const next = new Map(prev);
                  next.forEach((n: Node) => n.isBlocked = false);
                  return next;
                });
                addLog("System Reset", "info");
              }}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-md text-xs font-bold transition-colors"
            >
              RESET GRID
            </button>
            <button 
              onClick={() => {
                const start = "0-0";
                const end = `${GRID_SIZE-1}-${GRID_SIZE-1}`;
                const path = aStar(start, end, gridNodes, GRID_SIZE);
                if (path) {
                  setAmbulance({
                    currentId: start,
                    targetId: end,
                    path,
                    progress: 0,
                    priority: "CRITICAL"
                  });
                  addLog("Emergency dispatch initiated", "alert");
                }
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-md text-xs font-bold flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-500/20"
            >
              <Navigation className="w-3 h-3" /> DISPATCH AMBULANCE
            </button>
          </div>
        </header>

        {/* Map Visualization */}
        <div className="flex-1 overflow-hidden relative bg-[radial-gradient(circle_at_center,_#1a1a1a_0%,_#000_100%)]">
          <svg 
            viewBox={`0 0 ${GRID_SIZE * NODE_SPACING + PADDING * 2} ${GRID_SIZE * NODE_SPACING + PADDING * 2}`}
            className="w-full h-full p-8"
          >
            {/* Grid Lines */}
            {Array.from({ length: GRID_SIZE }).map((_, i) => (
              <React.Fragment key={i}>
                <line 
                  x1={PADDING} y1={PADDING + i * NODE_SPACING} 
                  x2={PADDING + (GRID_SIZE - 1) * NODE_SPACING} y2={PADDING + i * NODE_SPACING} 
                  className="grid-line opacity-20" 
                />
                <line 
                  x1={PADDING + i * NODE_SPACING} y1={PADDING} 
                  x2={PADDING + i * NODE_SPACING} y2={PADDING + (GRID_SIZE - 1) * NODE_SPACING} 
                  className="grid-line opacity-20" 
                />
              </React.Fragment>
            ))}

            {/* Path */}
            {ambulance && ambulance.path.length > 0 && (
              <polyline
                points={ambulance.path.map(id => {
                  const [x, y] = id.split("-").map(Number);
                  return `${PADDING + x * NODE_SPACING},${PADDING + y * NODE_SPACING}`;
                }).join(" ")}
                fill="none"
                className="path-line"
              />
            )}

            {/* Nodes */}
            {Array.from(gridNodes.values()).map((node: Node) => (
              <g 
                key={node.id} 
                className="cursor-pointer group"
                onClick={() => handleNodeClick(node.id)}
              >
                <circle 
                  cx={PADDING + node.x * NODE_SPACING} 
                  cy={PADDING + node.y * NODE_SPACING} 
                  r={4} 
                  fill={getHeatmapColor(node.congestion)}
                  className="transition-all duration-500"
                />
                {/* Traffic Signal */}
                <circle 
                  cx={PADDING + node.x * NODE_SPACING} 
                  cy={PADDING + node.y * NODE_SPACING} 
                  r={8} 
                  fill="none"
                  stroke={ambulance?.path.includes(node.id) ? "var(--success)" : "var(--accent)"}
                  strokeWidth={2}
                  className={cn(
                    "opacity-0 group-hover:opacity-100 transition-opacity",
                    ambulance?.path.includes(node.id) && "opacity-40 animate-pulse"
                  )}
                />
                {/* Roadblock */}
                {node.isBlocked && (
                  <g transform={`translate(${PADDING + node.x * NODE_SPACING - 8}, ${PADDING + node.y * NODE_SPACING - 8})`}>
                    <rect width="16" height="16" fill="#ef4444" rx="2" />
                    <line x1="4" y1="4" x2="12" y2="12" stroke="white" strokeWidth="2" />
                    <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="2" />
                  </g>
                )}
              </g>
            ))}

            {/* Ambulance */}
            {ambulance && (
              <motion.g
                initial={false}
                animate={{
                  x: PADDING + (parseInt(ambulance.currentId.split("-")[0]) + (ambulance.path[0] ? (parseInt(ambulance.path[0].split("-")[0]) - parseInt(ambulance.currentId.split("-")[0])) * ambulance.progress : 0)) * NODE_SPACING,
                  y: PADDING + (parseInt(ambulance.currentId.split("-")[1]) + (ambulance.path[0] ? (parseInt(ambulance.path[0].split("-")[1]) - parseInt(ambulance.currentId.split("-")[1])) * ambulance.progress : 0)) * NODE_SPACING
                }}
                transition={{ duration: 0.5, ease: "linear" }}
              >
                <circle r={12} fill="white" className="shadow-xl" />
                <text x="-6" y="5" fontSize="10" className="pointer-events-none">🚑</text>
                <circle r={20} fill="none" stroke="white" strokeWidth="1" className="animate-ping opacity-20" />
              </motion.g>
            )}
          </svg>

          {/* Legend */}
          <div className="absolute bottom-8 left-8 p-4 bg-neutral-900/80 backdrop-blur-md border border-neutral-800 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Traffic Signal (RED)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Green Corridor Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-[10px] font-mono text-neutral-400 uppercase">High Congestion</span>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <footer className="h-12 border-t border-neutral-800 flex items-center px-8 bg-neutral-900/30 font-mono text-[10px] text-neutral-500 gap-8">
          <div className="flex items-center gap-2">
            <span className="text-neutral-600">LAT:</span> 28.6139° N
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-600">LONG:</span> 77.2090° E
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-600">NODES:</span> {gridNodes.size}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-600">ALGO:</span> A* DYNAMIC
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>EMERGENCY PRIORITY: ENABLED</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
