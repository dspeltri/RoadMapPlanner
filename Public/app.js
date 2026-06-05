// Socket.IO connection
const socket = io();

// Room selection from query string (?room=team-alpha)
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "default-room";

let roomState = {
  id: roomId,
  roadmap: null,
  iterations: [],
  features: [],              // kept for counts/future use
  selectedIterationId: null,
  pendingIterationId: null,
  methodology: "safe"        // "safe" or "agile"
};

const $ = (id) => document.getElementById(id);

// ------------------ SIDEBAR & NAVIGATION ------------------

const sidebar = $("sidebar");
const toggleSidebarBtn = $("toggleSidebarBtn");

toggleSidebarBtn.addEventListener("click", () => {
  const collapsed = sidebar.getAttribute("data-collapsed") === "true";
  if (collapsed) {
    sidebar.setAttribute("data-collapsed", "false");
    sidebar.classList.remove("collapsed");
    toggleSidebarBtn.textContent = "‹";
    toggleSidebarBtn.title = "Collapse sidebar";
  } else {
    sidebar.setAttribute("data-collapsed", "true");
    sidebar.classList.add("collapsed");
    toggleSidebarBtn.textContent = "›";
    toggleSidebarBtn.title = "Expand sidebar";
  }
});

const navRoadmap = $("navRoadmap");
const navCalendar = $("navCalendar");
const viewRoadmap = $("viewRoadmap");
const viewCalendar = $("viewCalendar");

function setActiveView(view) {
  if (view === "roadmap") {
    viewRoadmap.style.display = "";
    viewCalendar.style.display = "none";
    navRoadmap.classList.add("active");
    navCalendar.classList.remove("active");
  } else {
    viewRoadmap.style.display = "none";
    viewCalendar.style.display = "";
    navCalendar.classList.add("active");
    navRoadmap.classList.remove("active");
  }
}

navRoadmap.addEventListener("click", () => setActiveView("roadmap"));
navCalendar.addEventListener("click", () => setActiveView("calendar"));
setActiveView("roadmap");

// ------------------ METHODOLOGY LABEL HANDLING ------------------

const methodologySelect = $("methodologySelect");

function applyMethodologyLabels() {
  const mode = roomState.methodology || "safe";
  const isAgile = mode === "agile";

  const noun = isAgile ? "Sprint" : "Iteration";
  const nounPlural = isAgile ? "Sprints" : "Iterations";
  const nounLower = isAgile ? "sprints" : "iterations";

  const modeLabelTitle = $("modeLabelTitle");
  const modeLabelInline = $("modeLabelInline");
  const modeLabelInlineCalendar = $("modeLabelInlineCalendar");
  const iterationsTitle = $("iterationsTitle");
  const iterLengthLabel = $("iterLengthLabel");
  const numIterationsLabel = $("numIterationsLabel");
  const iterationsHeadingLabel = $("iterationsHeadingLabel");

  if (modeLabelTitle) modeLabelTitle.textContent = nounPlural;
  if (modeLabelInline) modeLabelInline.textContent = nounLower;
  if (modeLabelInlineCalendar) modeLabelInlineCalendar.textContent = nounLower;
  if (iterationsTitle) iterationsTitle.textContent = nounPlural;
  if (iterLengthLabel) iterLengthLabel.textContent = `${noun} length (days)`;
  if (numIterationsLabel) numIterationsLabel.textContent = `Number of ${nounLower}`;
  if (iterationsHeadingLabel) iterationsHeadingLabel.textContent = nounPlural;
}

methodologySelect.addEventListener("change", () => {
  roomState.methodology = methodologySelect.value;
  applyMethodologyLabels();
  renderIterations();
  renderIterationDetails();
});

// ------------------ SOCKET & STATE ------------------

socket.emit("room:join", { roomId });

socket.on("room:state", (state) => {
  roomState = {
    ...roomState,
    ...state,
    methodology: roomState.methodology || "safe",
    selectedIterationId:
      roomState.selectedIterationId ||
      (state.iterations && state.iterations[0]?.id) ||
      null
  };

  methodologySelect.value = roomState.methodology;
  applyMethodologyLabels();
  renderFromState();
});

socket.on("room:error", (err) => {
  console.error("Room error:", err);
  const banner = $("roadmapServerError");
  const text = $("roadmapServerErrorText");
  if (banner && text) {
    text.textContent = err.message || "Unknown error.";
    banner.style.display = "flex";
  }
});

socket.on("connect", () => {
  const info = $("roomInfo");
  if (info) {
    info.textContent = `Connected to room: ${roomId}`;
  }
});

socket.on("disconnect", () => {
  const info = $("roomInfo");
  if (info) {
    info.textContent = `Disconnected — reconnecting…`;
  }
});

// ------------------ HELPERS ------------------

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return dateStr;
}

// ------------------ ROADMAP FORM ------------------

$("generateIterationsBtn").addEventListener("click", () => {
  const name = $("roadmapName").value.trim() || roomId;
  const startDate = $("startDate").value;
  const endDate = $("endDate").value;
  const iterLengthDays = Number($("iterLength").value || 0);
  const numIterations = Number($("numIterations").value || 0);
  const piSize = Number($("piSize").value || 0);

  const errEl = $("roadmapError");
  const serverErr = $("roadmapServerError");
  if (serverErr) serverErr.style.display = "none";

  errEl.style.display = "none";
  errEl.textContent = "";

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (!start || !end) {
    errEl.textContent = "Please provide both start and end dates.";
    errEl.style.display = "block";
    return;
  }
  if (end < start) {
    errEl.textContent = "End date must be on or after start date.";
    errEl.style.display = "block";
    return;
  }
  if (iterLengthDays <= 0 || numIterations <= 0 || piSize <= 0) {
    errEl.textContent = "Length, number and PI size must be positive.";
    errEl.style.display = "block";
    return;
  }

  socket.emit("room:setRoadmap", {
    roomId,
    roadmapInput: {
      name,
      startDate,
      endDate,
      iterLengthDays,
      numIterations,
      piSize
    }
  });

  roomState.pendingIterationId = null;
});

// ------------------ RENDERING ------------------

function renderFromState() {
  renderRoadmapFormFromState();
  renderIterations();
  renderIterationDetails();
}

function renderRoadmapFormFromState() {
  const rm = roomState.roadmap;
  if (!rm) return;
  $("roadmapName").value = rm.name || "";
  $("startDate").value = rm.startDate || "";
  $("endDate").value = rm.endDate || "";
  $("iterLength").value = rm.iterLengthDays || 14;
  $("numIterations").value = rm.numIterations || 5;
  $("piSize").value = rm.piSize || 5;
}

function renderIterations() {
  const container = $("iterationsContainer");
  const empty = $("iterationsEmpty");
  const details = $("iterationDetails");
  container.innerHTML = "";
  details.innerHTML = "";

  const iterations = roomState.iterations || [];

  if (!iterations.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const selectedId =
    roomState.selectedIterationId || iterations[0]?.id;
  roomState.selectedIterationId = selectedId;

  const isAgile = roomState.methodology === "agile";
  const noun = isAgile ? "Sprint" : "Iteration";

  iterations.forEach((iter) => {
    const card = document.createElement("div");
    card.className =
      "iter-card" + (iter.id === selectedId ? " selected" : "");
    card.dataset.id = iter.id;

    const featuresInIter = (roomState.features || []).filter((f) =>
      (f.iterationIds || []).includes(iter.id)
    );

    card.innerHTML = `
      <div class="iter-card-header">
        <div>
          <div class="iter-title">${noun} ${iter.seq}</div>
          <div class="iter-dates">${formatDate(iter.startDate)} → ${formatDate(iter.endDate)}</div>
          <div class="iter-meta">PI ${iter.piIndex}</div>
        </div>
        <button
          class="iter-plus-btn"
          data-action="add-feature"
          title="Plan work for this ${noun.toLowerCase()}"
        >
          +
        </button>
      </div>
      <div class="iter-features">
        ${
          featuresInIter.length
            ? `${featuresInIter.length} feature${featuresInIter.length > 1 ? "s" : ""} planned`
            : "<span style='color:#82939a'>No work items yet</span>"
        }
      </div>
    `;

    card.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.getAttribute("data-action") === "add-feature") {
        return;
      }
      roomState.selectedIterationId = iter.id;
      renderIterations();
    });

    const plusBtn = card.querySelector("[data-action='add-feature']");
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      roomState.selectedIterationId = iter.id;
      roomState.pendingIterationId = iter.id;
      renderIterations();
      // Future: open feature UI; for now it's just visual context
    });

    container.appendChild(card);
  });

  renderIterationDetails();
}

function renderIterationDetails() {
  const details = $("iterationDetails");
  const iter = (roomState.iterations || []).find(
    (i) => i.id === roomState.selectedIterationId
  );
  if (!iter) {
    details.innerHTML = "";
    return;
  }

  const isAgile = roomState.methodology === "agile";
  const noun = isAgile ? "Sprint" : "Iteration";

  const featuresInIter = (roomState.features || []).filter((f) =>
    (f.iterationIds || []).includes(iter.id)
  );

  const featureSummary =
    featuresInIter.length === 0
      ? "No work items planned yet."
      : `${featuresInIter.length} work item${featuresInIter.length > 1 ? "s" : ""} planned.`;

  details.innerHTML = `
    <div class="details-panel">
      <div class="details-header">
        <h4>${noun} ${iter.seq} overview</h4>
        <span>${formatDate(iter.startDate)} → ${formatDate(iter.endDate)} · PI ${iter.piIndex}</span>
      </div>
      <div class="details-body">
        <div class="details-row">
          <div>
            <div class="details-label">Roadmap</div>
            <div class="details-meta">${escapeHtml(roomState.roadmap?.name || roomId)}</div>
          </div>
          <div>
            <div class="details-label">Mode</div>
            <div class="details-meta">${roomState.methodology === "agile" ? "Agile (Sprints)" : "SAFe (Iterations)"}</div>
          </div>
        </div>
        <div style="margin-top:8px;font-size:12px;">
          ${escapeHtml(featureSummary)}
        </div>
      </div>
    </div>
  `;
}

// Initial labels + render
applyMethodologyLabels();
renderFromState();
