// roomStore.js
const fs = require("fs");
const path = require("path");

const ROOMS_FILE = path.join(__dirname, "rooms.json");

// In‑memory rooms state
/** @type {Record<string, any>} */
let rooms = {};
let saveScheduled = false;

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

// Debounced async save
function scheduleSaveRooms() {
  if (saveScheduled) return;
  saveScheduled = true;
  setTimeout(async () => {
    saveScheduled = false;
    try {
      await fs.promises.writeFile(
        ROOMS_FILE,
        JSON.stringify(rooms, null, 2),
        "utf8"
      );
    } catch (err) {
      console.error("Error writing rooms file:", err);
    }
  }, 200);
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

/**
 * Update a room using an updater function.
 * Ensures updatedAt and persistence.
 * @param {string} roomId
 * @param {(room: any) => void} updater
 * @returns {any} updated room
 */
function updateRoom(roomId, updater) {
  const room = getOrCreateRoom(roomId);
  updater(room);
  room.updatedAt = new Date().toISOString();
  rooms[roomId] = room;
  scheduleSaveRooms();
  return room;
}

// Simple access to all rooms (for REST debug endpoint)
function getRooms() {
  return rooms;
}

module.exports = {
  loadRooms,
  getOrCreateRoom,
  updateRoom,
  getRooms
};