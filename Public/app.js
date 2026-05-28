// Socket.IO connection
const socket = io();

// Room selection from query string (?room=team-alpha)
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "default-room";

let roomState = {
  id: roomId,
  roadmap: null,
  iterations: [],
  features: [],
  selectedIterationId: null
};

const $ = (id) => document.getElementById(id);

// Connect and join room
socket.emit("room:join", { roomId });

socket.on("room:state", (state) => {
  roomState = state;
  if (!roomState.selectedIterationId && roomState.iterations?.length) {
    roomState.selectedIterationId = roomState.iterations[0].id;
  }
  renderFromState();
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
    info.textContent = `Disconnected – trying to reconnect… (room: ${roomId})`;
  }
});

// ---- Helpers ----
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

// ---- Roadmap form ----
$("generateIterationsBtn").addEventListener("click", () => {
  const name = $("roadmapName").value.trim() || roomId;
  const startDate = $("startDate").value;
  const endDate = $("endDate").value;
  const iterLengthDays = Number($("iterLength").value || 0);
  const numIterations = Number($("numIterations").value || 0);
  const piSize = Number($("piSize").value || 0);

  const errEl = $("roadmapError");
  errEl.classList.add("hidden");
  errEl.textContent = "";

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (!start || !end) {
    errEl.textContent = "Please provide both start and end dates.";
    errEl.classList.remove("hidden");
    return;
  }
  if (end < start) {
    errEl.textContent = "End date must be on or after start date.";
    errEl.classList.remove("hidden");
    return;
  }
  if (iterLengthDays <= 0 || numIterations <= 0 || piSize <= 0) {
    errEl.textContent = "Iteration length, number of iterations and PI size must be positive.";
    errEl.classList.remove("hidden");
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
});

// ---- Feature form ----
$("addFeatureBtn").addEventListener("click", () => {
  const name = $("featureName").value.trim();
  const type = $("featureType").value;
  const estimate = $("featureEstimate").value.trim();
  const priority = $("featurePriority").value.trim();
  const description = $("featureDescription").value.trim();
  const errEl = $("featureError");

  errEl.classList.add("hidden");
  errEl.textContent = "";

  if (!name) {
    errEl.textContent = "Feature name is required.";
    errEl.classList.remove("hidden");
    return;
  }

  const selectedIterIds = Array.from(
    document.querySelectorAll("#iterationMultiSelect input[type=checkbox]:checked")
  ).map((c) => c.value);

  socket.emit("room:addFeature", {
    roomId,
    featureInput: {
      name,
      type,
      estimate,
      priority,
      description,
      iterationIds: selectedIterIds
    }
  });

  clearFeatureForm();
});

$("clearFormBtn").addEventListener("click", clearFeatureForm);

function clearFeatureForm() {
  $("featureName").value = "";
  $("featureType").value = "Feature";
  $("featureEstimate").value = "";
  $("featurePriority").value = "";
  $("featureDescription").value = "";
  document
    .querySelectorAll("#iterationMultiSelect input[type=checkbox]")
    .forEach((c) => (c.checked = false));
  const errEl = $("featureError");
  errEl.classList.add("hidden");
  errEl.textContent = "";
}

// Delegate feature-iteration checkbox changes
$("featuresList").addEventListener("change", (e) => {
  const target = e.target;
  if (target.tagName !== "INPUT" || target.type !== "checkbox") return;

  const featureId = target.getAttribute("data-feature-id");
  const iterId = target.getAttribute("data-iter-id");
  if (!featureId || !iterId) return;

  const feature = roomState.features.find((f) => f.id === featureId);
  if (!feature) return;

  let iterationIds = feature.iterationIds || [];

  if (target.checked) {
    if (!iterationIds.includes(iterId)) {
      iterationIds = [...iterationIds, iterId];
    }
  } else {
    iterationIds = iterationIds.filter((id) => id !== iterId);
  }

  socket.emit("room:updateFeatureIterations", {
    roomId,
    featureId,
    iterationIds
  });
});

// ---- Rendering ----
function renderFromState() {
  renderRoadmapFormFromState();
  renderIterations();
  renderIterationMultiSelect();
  renderFeatures();
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
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const selectedId =
    roomState.selectedIterationId || iterations[0]?.id;
  roomState.selectedIterationId = selectedId;

  iterations.forEach((iter) => {
    const card = document.createElement("div");
    card.className =
      "min-w-[180px] rounded-xl border px-3 py-2.5 text-sm bg-slate-950 border-slate-800 cursor-pointer transition transform hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/60 " +
      (iter.id === selectedId
        ? "border-blue-500 ring-1 ring-blue-500/70"
        : "");

    card.dataset.id = iter.id;

    const featuresInIter = roomState.features.filter((f) =>
      (f.iterationIds || []).includes(iter.id)
    );

    card.innerHTML = `
      <div class="font-semibold text-slate-50 text-[0.9rem]">
        ${escapeHtml(iter.name)}
      </div>
      <div class="text-[0.7rem] text-slate-400">
        ${formatDate(iter.startDate)} → ${formatDate(iter.endDate)}
      </div>
      <div class="mt-0.5 text-[0.7rem] text-slate-400">
        PI ${iter.piIndex}
      </div>
      <div class="mt-1 text-[0.7rem] text-slate-400">
        ${
          featuresInIter.length
            ? `${featuresInIter.length} feature${
                featuresInIter.length > 1 ? "s" : ""
              }`
            : "<span class='text-slate-500'>No features</span>"
        }
      </div>
    `;

    card.addEventListener("click", () => {
      roomState.selectedIterationId = iter.id;
      renderIterations();
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

  const featuresInIter = roomState.features.filter((f) =>
    (f.iterationIds || []).includes(iter.id)
  );

  const featureChips = featuresInIter
    .map(
      (f) => `
      <span class="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[0.7rem] text-slate-300">
        <span class="truncate max-w-[140px]">${escapeHtml(f.name)}</span>
      </span>
    `
    )
    .join("");

  details.innerHTML = `
    <div class="mt-2 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2.5">
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <h3 class="text-sm font-semibold text-slate-50">
          ${escapeHtml(iter.name)} details
        </h3>
        <span class="text-[0.7rem] text-slate-400">
          ${formatDate(iter.startDate)} → ${formatDate(iter.endDate)} · PI ${
    iter.piIndex
  }
        </span>
      </div>
      ${
        featuresInIter.length
          ? `<div class="text-[0.7rem] text-slate-400 mb-1">Assigned features:</div>
             <div class="flex flex-wrap gap-1">${featureChips}</div>`
          : `<div class="text-xs text-slate-500 italic">No features assigned yet.</div>`
      }
    </div>
  `;
}

function renderIterationMultiSelect() {
  const container = $("iterationMultiSelect");
  container.innerHTML = "";

  const iterations = roomState.iterations || [];
  if (!iterations.length) {
    container.innerHTML =
      `<span class="text-xs text-slate-500 italic">Define iterations to enable assignment.</span>`;
    return;
  }

  iterations.forEach((it) => {
    const label = document.createElement("label");
    label.className =
      "inline-flex items-center gap-1.5 text-[0.7rem] text-slate-300";

    label.innerHTML = `
      <input
        type="checkbox"
        class="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
        value="${it.id}"
      />
      <span>${escapeHtml(it.name)}</span>
    `;
    container.appendChild(label);
  });
}

function renderFeatures() {
  const list = $("featuresList");
  const summary = $("featuresSummary");
  list.innerHTML = "";

  const features = roomState.features || [];
  const count = features.length;
  summary.textContent = `${count} feature${count === 1 ? "" : "s"}`;

  if (!count) {
    list.innerHTML =
      `<div class="text-xs text-slate-500 italic">No features yet. Add some using the form above.</div>`;
    return;
  }

  features.forEach((f) => {
    const item = document.createElement("div");
    item.className =
      "rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs";

    const iterNames =
      (f.iterationIds || [])
        .map((id) => (roomState.iterations || []).find((i) => i.id === id))
        .filter(Boolean)
        .map((i) => i.name) || [];

    item.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-0.5">
        <div
          class="font-semibold text-slate-50 text-[0.8rem] truncate"
          title="${escapeHtml(f.name)}"
        >
          ${escapeHtml(f.name)}
        </div>
        <span class="inline-flex items-center rounded-full border border-slate-700 px-2 py-0.5 text-[0.68rem] text-slate-300">
          ${escapeHtml(f.type || "Feature")}
        </span>
      </div>
      <div class="flex flex-wrap gap-1 mt-0.5">
        ${
          f.estimate
            ? `<span class="inline-flex items-center rounded-full border border-slate-700 px-1.5 py-0.5 text-[0.68rem] text-slate-300">Estimate: ${escapeHtml(
                f.estimate
              )}</span>`
            : ""
        }
        ${
          f.priority
            ? `<span class="inline-flex items-center rounded-full border border-slate-700 px-1.5 py-0.5 text-[0.68rem] text-slate-300">Priority: ${escapeHtml(
                f.priority
              )}</span>`
            : ""
        }
        ${
          iterNames.length
            ? `<span class="inline-flex items-center rounded-full border border-slate-700 px-1.5 py-0.5 text-[0.68rem] text-slate-300">Iterations: ${iterNames
                .map((n) => escapeHtml(n))
                .join(", ")}</span>`
            : `<span class="inline-flex items-center rounded-full border border-slate-700 px-1.5 py-0.5 text-[0.68rem] text-slate-400">Unassigned</span>`
        }
      </div>
      ${
        f.description
          ? `<div class="mt-1 text-[0.72rem] text-slate-300 whitespace-pre-wrap">
               ${escapeHtml(f.description)}
             </div>`
          : ""
      }
      <div class="mt-1 text-[0.7rem] text-slate-400">
        Assign/remove iterations:
      </div>
      <div class="mt-0.5 flex flex-wrap gap-1">
        ${renderFeatureIterCheckboxes(f)}
      </div>
    `;

    list.appendChild(item);
  });
}

function renderFeatureIterCheckboxes(feature) {
  const iterations = roomState.iterations || [];
  if (!iterations.length) {
    return `<span class="text-xs text-slate-500 italic">No iterations defined yet.</span>`;
  }
  const ids = new Set(feature.iterationIds || []);
  return iterations
    .map((it) => {
      const checked = ids.has(it.id) ? "checked" : "";
      return `
        <label class="inline-flex items-center gap-1.5 text-[0.7rem] text-slate-300">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
            data-feature-id="${feature.id}"
            data-iter-id="${it.id}"
            ${checked}
          />
          <span>${escapeHtml(it.name)}</span>
        </label>
      `;
    })
    .join("");
}

// Initial render
renderFromState();