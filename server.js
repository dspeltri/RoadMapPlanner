const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const ROOMS_FILE = path.join(__dirname, "rooms.json");

// ---- In-memory rooms state ----
/** @type {Record<string, any>} */
let rooms = {};

// Load persisted state on startup
function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const raw = fs.readFileSync(ROOMS_FILE, "utf8");
      rooms = JSON.parse(raw) || {};
      console.log(`Loaded ${Object.keys(rooms).length} rooms from rooms.json`);
    } else {
      rooms = {};
    }
  } catch (err) {
    console.error("Error loading rooms file:", err);
    rooms = {};
  }
}

function saveRooms() {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing rooms file:", err);
  }
}

// Ensure a room exists
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      roadmap: null,
      iterations: [],
      features: [],
      updatedAt: new Date().toISOString()
    };
  }
  return rooms[roomId];
}

// ---- Setup Express + Socket.IO ----
loadRooms();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Simple REST endpoint for debugging
app.get("/api/rooms/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// ---- Socket.IO ----
io.on("connection", (socket) => {
  console.log("Client connected", socket.id);

  // Client joins a room
  socket.on("room:join", ({ roomId }) => {
    if (!roomId) {
      socket.emit("error", { message: "roomId is required" });
      return;
    }

    socket.join(roomId);
    const room = getOrCreateRoom(roomId);

    console.log(`Socket ${socket.id} joined room ${roomId}`);

    // Send current room state to the newly joined client
    socket.emit("room:state", room);
  });

  // Create/update roadmap + regenerate iterations
  socket.on("room:setRoadmap", ({ roomId, roadmapInput }) => {
    const room = getOrCreateRoom(roomId);
    if (!roadmapInput) return;

    const {
      name,
      startDate,
      endDate,
      iterLengthDays,
      numIterations,
      piSize
    } = roadmapInput;

    // Basic validation
    if (!startDate || !endDate || !iterLengthDays || !numIterations || !piSize) {
      return;
    }

    room.roadmap = {
      id: room.roadmap?.id || `roadmap_${roomId}`,
      name: name || room.roadmap?.name || roomId,
      startDate,
      endDate,
      iterLengthDays,
      numIterations,
      piSize
    };

    // Generate iterations based on roadmap
    room.iterations = generateIterations(room.roadmap);

    // Clean up feature assignments to non-existing iterations
    const validIterIds = new Set(room.iterations.map((it) => it.id));
    room.features.forEach((f) => {
      f.iterationIds = (f.iterationIds || []).filter((id) =>
        validIterIds.has(id)
      );
    });

    room.updatedAt = new Date().toISOString();
    rooms[roomId] = room;
    saveRooms();

    io.to(roomId).emit("room:state", room);
  });

  // Add feature
  socket.on("room:addFeature", ({ roomId, featureInput }) => {
    const room = getOrCreateRoom(roomId);
    if (!featureInput || !featureInput.name) return;

    const featureId = `feat_${Math.random().toString(36).slice(2, 9)}`;
    const roadmapId = room.roadmap?.id || `roadmap_${roomId}`;

    const newFeature = {
      id: featureId,
      roadmapId,
      name: featureInput.name,
      type: featureInput.type || "Feature",
      estimate: featureInput.estimate || "",
      priority: featureInput.priority || "",
      description: featureInput.description || "",
      iterationIds: featureInput.iterationIds || []
    };

    room.features.push(newFeature);
    room.updatedAt = new Date().toISOString();
    rooms[roomId] = room;
    saveRooms();

    io.to(roomId).emit("room:state", room);
  });

  // Update feature's iteration assignments
  socket.on("room:updateFeatureIterations", ({ roomId, featureId, iterationIds }) => {
    const room = getOrCreateRoom(roomId);
    const feature = room.features.find((f) => f.id === featureId);
    if (!feature) return;
    const validIterIds = new Set(room.iterations.map((it) => it.id));
    feature.iterationIds = (iterationIds || []).filter((id) =>
      validIterIds.has(id)
    );
    room.updatedAt = new Date().toISOString();
    rooms[roomId] = room;
    saveRooms();

    io.to(roomId).emit("room:state", room);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected", socket.id);
  });
});

// Iteration generation utility
function generateIterations(roadmap) {
  const result = [];
  const start = new Date(roadmap.startDate + "T00:00:00");
  const end = new Date(roadmap.endDate + "T00:00:00");
  let current = new Date(start);

  for (let i = 1; i <= roadmap.numIterations; i++) {
    const iterStart = new Date(current);
    const iterEnd = new Date(iterStart);
    iterEnd.setDate(iterEnd.getDate() + roadmap.iterLengthDays - 1);
    if (iterEnd > end) iterEnd.setTime(end.getTime());

    const piIndex = Math.ceil(i / roadmap.piSize);
    result.push({
      id: `iter_${i}`,
      roadmapId: roadmap.id,
      name: `Iteration ${i}`,
      startDate: iterStart.toISOString().slice(0, 10),
      endDate: iterEnd.toISOString().slice(0, 10),
      seq: i,
      piIndex
    });

    current.setDate(iterEnd.getDate() + 1);
    if (current > end) break;
  }

  return result;
}

// Start server
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});