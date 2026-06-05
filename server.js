const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const {
  loadRooms,
  getOrCreateRoom,
  updateRoom,
  getRooms
} = require("./roomStore");

const PORT = process.env.PORT || 3000;

// Room ID pattern (simple hardening)
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

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
  const room = getRooms()[roomId];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// ---- Validation helpers ----
function validateRoomId(roomId) {
  if (!roomId) return "roomId is required.";
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return "Invalid roomId format. Use letters, numbers, '-', '_' only, max 64 chars.";
  }
  return null;
}

function validateRoadmapInput(input) {
  const errors = [];
  if (!input) {
    errors.push("Missing roadmapInput.");
    return errors;
  }

  const { startDate, endDate, iterLengthDays, numIterations, piSize } = input;

  if (!startDate || !endDate) {
    errors.push("Start date and end date are required.");
  }

  const iterLength = Number(iterLengthDays);
  const numIter = Number(numIterations);
  const pi = Number(piSize);

  if (!Number.isInteger(iterLength) || iterLength <= 0) {
    errors.push("Iteration length must be a positive integer.");
  }
  if (!Number.isInteger(numIter) || numIter <= 0) {
    errors.push("Number of iterations must be a positive integer.");
  }
  if (!Number.isInteger(pi) || pi <= 0) {
    errors.push("PI size must be a positive integer.");
  }

  // Basic sanity limits
  if (numIter > 200) {
    errors.push("Number of iterations is too large (> 200).");
  }
  if (iterLength > 365) {
    errors.push("Iteration length is too large (> 365 days).");
  }

  return errors;
}

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
      id: `iter_${roadmap.id}_${i}`, // namespace by roadmap
      roadmapId: roadmap.id,
      name: `Iteration ${i}`,       // UI renames to Sprint when needed
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

// ---- Socket.IO ----
io.on("connection", (socket) => {
  console.log("Client connected", socket.id);

  // Client joins a room
  socket.on("room:join", ({ roomId }) => {
    const idError = validateRoomId(roomId);
    if (idError) {
      socket.emit("room:error", { message: idError });
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
    const idError = validateRoomId(roomId);
    if (idError) {
      socket.emit("room:error", { message: idError });
      return;
    }

    const errors = validateRoadmapInput(roadmapInput);
    if (errors.length) {
      socket.emit("room:error", { message: errors.join(" ") });
      return;
    }

    const room = updateRoom(roomId, (room) => {
      const {
        name,
        startDate,
        endDate,
        iterLengthDays,
        numIterations,
        piSize
      } = roadmapInput;

      room.roadmap = {
        id: room.roadmap?.id || `roadmap_${roomId}`,
        name: name || room.roadmap?.name || roomId,
        startDate,
        endDate,
        iterLengthDays: Number(iterLengthDays),
        numIterations: Number(numIterations),
        piSize: Number(piSize)
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
    });

    io.to(roomId).emit("room:state", room);
  });

  // (Optional) feature-related events are kept for future use but unused by UI now.
  socket.on("room:addFeature", ({ roomId, featureInput }) => {
    const idError = validateRoomId(roomId);
    if (idError) {
      socket.emit("room:error", { message: idError });
      return;
    }

    // Very lightweight check – full validation could be added if you re-enable feature UI
    if (!featureInput || !featureInput.name) {
      socket.emit("room:error", { message: "Feature name is required." });
      return;
    }

    const room = updateRoom(roomId, (room) => {
      const featureId = `feat_${Math.random().toString(36).slice(2, 9)}`;
      const roadmapId = room.roadmap?.id || `roadmap_${roomId}`;
      const validIterIds = new Set(room.iterations.map((it) => it.id));

      const iterationIds = (featureInput.iterationIds || []).filter((id) =>
        validIterIds.has(id)
      );

      const newFeature = {
        id: featureId,
        roadmapId,
        name: featureInput.name.trim(),
        type: featureInput.type || "Feature",
        estimate: featureInput.estimate || "",
        priority: featureInput.priority || "",
        description: featureInput.description || "",
        iterationIds
      };

      room.features.push(newFeature);
    });

    io.to(roomId).emit("room:state", room);
  });

  socket.on("room:updateFeatureIterations", ({ roomId, featureId, iterationIds }) => {
    const idError = validateRoomId(roomId);
    if (idError) {
      socket.emit("room:error", { message: idError });
      return;
    }

    const room = updateRoom(roomId, (room) => {
      const feature = room.features.find((f) => f.id === featureId);
      if (!feature) {
        return;
      }
      const validIterIds = new Set(room.iterations.map((it) => it.id));
      feature.iterationIds = (iterationIds || []).filter((id) =>
        validIterIds.has(id)
      );
    });

    io.to(roomId).emit("room:state", room);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected", socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
