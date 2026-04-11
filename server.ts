import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Simulation State
  let trafficDensity = 0.5;
  let grid: any = [];
  let vehicles: any[] = [];
  let ambulance: any = null;
  let roadBlocks: Set<string> = new Set();

  // Initialize Grid (10x10)
  const GRID_SIZE = 10;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid.push({
        id: `${x}-${y}`,
        x,
        y,
        signal: "RED", // RED or GREEN
        congestion: Math.random(),
      });
    }
  }

  // Simulation Loop
  setInterval(() => {
    // Update traffic
    // Update signals based on ambulance position
    if (ambulance && ambulance.path.length > 0) {
      const nextNode = ambulance.path[0];
      // Green corridor logic
      grid.forEach((node: any) => {
        if (node.id === nextNode) {
          node.signal = "GREEN";
        } else {
          // Normal traffic light cycle or stay red for ambulance
          // For simplicity, we'll just manage the corridor here
        }
      });
    }

    io.emit("sim_update", { grid, vehicles, ambulance, roadBlocks });
  }, 1000);

  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.emit("init", { grid, GRID_SIZE });

    socket.on("set_ambulance", (data) => {
      ambulance = data;
    });

    socket.on("toggle_block", (nodeId) => {
      if (roadBlocks.has(nodeId)) roadBlocks.delete(nodeId);
      else roadBlocks.add(nodeId);
      io.emit("blocks_updated", Array.from(roadBlocks));
    });

    socket.on("update_density", (val) => {
      trafficDensity = val;
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
