const WORKSPACE_PREFS_KEY = "chroma_explorer_workspace_v1";
const CACHE_TTL_MS = 30000;

const state = {
  chromaDir: "",
  collection: "",
  requestedCollection: "",
  sampleSize: 120,
  pageSize: 25,
  offset: 0,
  idContains: "",
  whereJson: "",
  total: 0,
  activeTab: "browse",
  activeFacetFilter: "",
  hasMorePageData: false,
  lastLoadedCount: 0,
  infiniteScroll: false,
  loadingBrowse: false,
  visibleBrowseItems: [],
  cache: new Map(),
};

const el = {
  chromaDir: document.getElementById("chromaDir"),
  collectionSelect: document.getElementById("collectionSelect"),
  sampleSize: document.getElementById("sampleSize"),
  applyWorkspace: document.getElementById("applyWorkspace"),
  status: document.getElementById("status"),
  emptyState: document.getElementById("emptyState"),
  kpiCollection: document.getElementById("kpiCollection"),
  kpiCount: document.getElementById("kpiCount"),
  kpiKeys: document.getElementById("kpiKeys"),
  pageSize: document.getElementById("pageSize"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  browseRange: document.getElementById("browseRange"),
  exportBrowseCsv: document.getElementById("exportBrowseCsv"),
  clearFilters: document.getElementById("clearFilters"),
  infiniteScrollMode: document.getElementById("infiniteScrollMode"),
  idContains: document.getElementById("idContains"),
  browseTableBody: document.getElementById("browseTableBody"),
  browseDetail: document.getElementById("browseDetail"),
  browseError: document.getElementById("browseError"),
  metadataKeys: document.getElementById("metadataKeys"),
  metadataFacets: document.getElementById("metadataFacets"),
  collectionMeta: document.getElementById("collectionMeta"),
  insightsError: document.getElementById("insightsError"),
};

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
}

function showPanelError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.classList.remove("hidden");
}

function clearPanelError(node) {
  if (!node) return;
  node.textContent = "";
  node.classList.add("hidden");
}

function q(text) {
  return encodeURIComponent(text);
}

function cacheGet(key) {
  const hit = state.cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    state.cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  state.cache.set(key, { ts: Date.now(), value });
}

function getFilterJson() {
  if (!state.whereJson.trim()) return "";
  try {
    const parsed = JSON.parse(state.whereJson);
    return JSON.stringify(parsed);
  } catch {
    state.whereJson = "";
    return "";
  }
}

function renderSkeleton(targetNode, count = 3) {
  targetNode.innerHTML = Array.from({ length: count })
    .map(() => "<article class='skeleton'></article>")
    .join("");
}

function updateBrowseMeta() {
  const start = state.total === 0 ? 0 : state.offset + 1;
  const visibleCount = state.lastLoadedCount || 0;
  const end = state.total === 0 ? 0 : Math.min(state.offset + visibleCount, state.total);
  el.browseRange.textContent = `Showing ${start}-${end} of ${state.total}`;
  el.prevPage.disabled = state.offset <= 0;
  el.nextPage.disabled = state.infiniteScroll || !state.hasMorePageData;
}

function saveWorkspacePrefs() {
  const payload = {
    chromaDir: state.chromaDir,
    collection: state.collection,
    sampleSize: state.sampleSize,
    pageSize: state.pageSize,
    infiniteScroll: state.infiniteScroll,
    idContains: state.idContains,
  };
  localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(payload));
}

function loadWorkspacePrefs() {
  const raw = localStorage.getItem(WORKSPACE_PREFS_KEY);
  if (!raw) return;
  try {
    const prefs = JSON.parse(raw);
    if (prefs.chromaDir) el.chromaDir.value = prefs.chromaDir;
    if (prefs.sampleSize) el.sampleSize.value = String(prefs.sampleSize);
    if (prefs.pageSize) el.pageSize.value = String(prefs.pageSize);
    if (prefs.collection) state.requestedCollection = prefs.collection;
    if (prefs.idContains) el.idContains.value = prefs.idContains;
    if (prefs.infiniteScroll) {
      state.infiniteScroll = !!prefs.infiniteScroll;
      el.infiniteScrollMode.value = state.infiniteScroll ? "on" : "off";
    }
  } catch {
    // Ignore broken local storage.
  }
}

function updateUrlState() {
  const params = new URLSearchParams();
  if (state.chromaDir) params.set("path", state.chromaDir);
  if (state.collection) params.set("collection", state.collection);
  if (state.activeTab) params.set("tab", state.activeTab);
  if (state.pageSize) params.set("page_size", String(state.pageSize));
  if (state.idContains) params.set("id_contains", state.idContains);
  if (state.whereJson) params.set("where", getFilterJson());
  params.set("infinite", state.infiniteScroll ? "1" : "0");
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path");
  const collection = params.get("collection");
  const tab = params.get("tab");
  const pageSize = params.get("page_size");
  const idContains = params.get("id_contains");
  const where = params.get("where");
  const infinite = params.get("infinite");

  if (path) el.chromaDir.value = path;
  if (collection) state.requestedCollection = collection;
  if (pageSize) el.pageSize.value = pageSize;
  if (idContains) {
    el.idContains.value = idContains;
    state.idContains = idContains;
  }
  if (where) state.whereJson = where;
  if (infinite === "1") {
    state.infiniteScroll = true;
    el.infiniteScrollMode.value = "on";
  }
  if (tab && ["browse", "insights"].includes(tab)) {
    state.activeTab = tab;
  }
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Request failed");
  }
  return payload;
}

async function getJsonWithTimeout(url, timeoutMs = 7000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getJson(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && (error.name === "AbortError" || String(error).toLowerCase().includes("aborted"))) {
      throw new Error(`Request timed out after ${Math.floor(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getCachedJson(url, timeoutMs = 7000) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const result = await getJsonWithTimeout(url, timeoutMs);
  cacheSet(url, result);
  return result;
}

function debounce(fn, delay = 320) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function renderBrowse(items, append = false) {
  if (!append) {
    el.browseTableBody.innerHTML = "";
    el.browseDetail.classList.add("hidden");
    el.browseDetail.innerHTML = "";
    state.visibleBrowseItems = [];
  }

  if (!items.length && !append) {
    el.browseTableBody.innerHTML = "<tr><td colspan='4'>No records found for this page/filter.</td></tr>";
    return;
  }

  items.forEach((item) => {
    state.visibleBrowseItems.push(item);
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Record ${item.id}`);
    row.innerHTML = `
      <td>${item.row}</td>
      <td>${item.id}</td>
      <td>${item.document_preview || ""}</td>
      <td>${(item.metadata_keys || []).join(", ")}</td>
    `;

    const openDetails = () => {
      el.browseDetail.classList.remove("hidden");
      el.browseDetail.innerHTML = `
        <h3>${item.id}</h3>
        <p>${item.document || ""}</p>
        <h3>Metadata</h3>
        <pre>${JSON.stringify(item.metadata || {}, null, 2)}</pre>
      `;
    };

    row.addEventListener("click", openDetails);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetails();
      }
    });

    el.browseTableBody.appendChild(row);
  });
}

function renderBrowseTableSkeleton(count = 4) {
  el.browseTableBody.innerHTML = Array.from({ length: count })
    .map(() => "<tr><td colspan='4'><div class='skeleton'></div></td></tr>")
    .join("");
}

async function renderEmptyState() {
  let html = `
    <strong>No collections found</strong>
    <p>Current path: <code>${state.chromaDir}</code></p>
  `;
  try {
    const data = await getCachedJson("/api/discover", 5000);
    const candidates = data.candidates || [];
    if (candidates.length) {
      html += "<p>Detected data paths:</p>";
      candidates.forEach((item, idx) => {
        html += `<button class="path-btn" data-idx="${idx}">${item.path}</button>`;
      });
      el.emptyState.innerHTML = html;
      el.emptyState.classList.remove("hidden");
      el.emptyState.querySelectorAll(".path-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const choice = candidates[Number(btn.dataset.idx)];
          if (!choice) return;
          el.chromaDir.value = choice.path;
          await applyWorkspace();
        });
      });
      return;
    }
  } catch (err) {
    html += `<p>${err.message}</p>`;
  }
  html += "<p>Set a valid Chroma path and click Apply.</p>";
  el.emptyState.innerHTML = html;
  el.emptyState.classList.remove("hidden");
}

async function loadCollections() {
  const url = `/api/collections?chroma_dir=${q(state.chromaDir)}`;
  const data = await getCachedJson(url, 8000);
  const collections = data.collections || [];
  el.collectionSelect.innerHTML = "";

  collections.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = entry.count == null ? entry.name : `${entry.name} (${entry.count})`;
    el.collectionSelect.appendChild(option);
  });

  if (!collections.length) {
    state.collection = "";
    state.total = 0;
    el.kpiCollection.textContent = "-";
    el.kpiCount.textContent = "0";
    el.kpiKeys.textContent = "0";
    renderBrowse([]);
    await renderEmptyState();
    setStatus("No collections found for selected path.", true);
    return false;
  }

  el.emptyState.classList.add("hidden");
  el.emptyState.innerHTML = "";
  const preferred = state.requestedCollection && collections.find((x) => x.name === state.requestedCollection);
  state.collection = preferred ? preferred.name : collections[0].name;
  state.requestedCollection = "";
  el.collectionSelect.value = state.collection;
  return true;
}

async function loadBrowse({ append = false } = {}) {
  if (!state.collection) return;
  clearPanelError(el.browseError);

  if (!append) {
    renderBrowseTableSkeleton(4);
  }

  state.loadingBrowse = true;
  try {
    const whereJson = getFilterJson();
    const offset = append ? state.offset + state.pageSize : state.offset;
    const url =
      `/api/collections/${q(state.collection)}/browse?chroma_dir=${q(state.chromaDir)}` +
      `&limit=${state.pageSize}&offset=${offset}&id_contains=${q(state.idContains)}` +
      `&where_json=${q(whereJson)}`;

    const data = await getCachedJson(url, 8000);
    state.total = data.total || 0;
    state.lastLoadedCount = (data.items || []).length;
    state.hasMorePageData = offset + state.pageSize < state.total && state.lastLoadedCount > 0;

    if (append) {
      state.offset = offset;
    }

    el.kpiCollection.textContent = state.collection;
    el.kpiCount.textContent = String(state.total);
    renderBrowse(data.items || [], append);
    updateBrowseMeta();
  } catch (error) {
    showPanelError(el.browseError, error.message);
    throw error;
  } finally {
    state.loadingBrowse = false;
  }
}

function renderFacets(facets) {
  el.metadataFacets.innerHTML = "";
  if (!facets.length) {
    el.metadataFacets.innerHTML = "<article class='facet'>No facet values detected in sample.</article>";
    return;
  }

  facets.slice(0, 12).forEach((facet) => {
    const card = document.createElement("article");
    card.className = "facet";
    const values = (facet.top_values || []).slice(0, 8);
    const valueButtons = values
      .map((entry) => {
        const where = JSON.stringify({ [facet.key]: entry.value });
        const activeClass = state.activeFacetFilter === where ? "active" : "";
        return `<button class="facet-btn ${activeClass}" data-where='${where.replace(/'/g, "&#39;")}'>${entry.value} (${entry.count})</button>`;
      })
      .join("");

    card.innerHTML = `
      <h4>${facet.key}</h4>
      <p class="sub">${facet.count} / sampled records</p>
      <div class="facet-values">${valueButtons || "<span class='chip'>No scalar values</span>"}</div>
    `;
    el.metadataFacets.appendChild(card);
  });

  el.metadataFacets.querySelectorAll(".facet-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const where = button.getAttribute("data-where") || "";
      state.activeFacetFilter = where;
      state.whereJson = where;
      state.offset = 0;
      try {
        clearPanelError(el.browseError);
        setStatus("Applying facet filter...");
        await loadBrowse();
        updateUrlState();
        setStatus("Facet filter applied");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

async function loadInsights() {
  if (!state.collection) return;
  clearPanelError(el.insightsError);
  try {
    const url = `/api/collections/${q(state.collection)}/insights?chroma_dir=${q(state.chromaDir)}&sample_size=${state.sampleSize}`;
    const data = await getCachedJson(url, 8000);
    const metadata = data.metadata || {};
    const keys = data.metadata_keys || [];
    el.kpiKeys.textContent = String(keys.length);
    el.metadataKeys.innerHTML = keys.length
      ? keys.map((key) => `<span class="chip">${key}</span>`).join("")
      : "<span class='chip'>No keys detected</span>";
    el.collectionMeta.textContent = JSON.stringify(metadata, null, 2);
    renderFacets(data.facets || []);
  } catch (error) {
    showPanelError(el.insightsError, error.message);
    throw error;
  }
}

function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (value) => {
    const str = value == null ? "" : String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };
  const header = keys.map(escape).join(",");
  const lines = rows.map((row) => keys.map((k) => escape(row[k])).join(","));
  return [header, ...lines].join("\n");
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    setStatus("No rows available for CSV export.", true);
    return;
  }
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setupInfiniteScroll() {
  const onScroll = debounce(async () => {
    if (!state.infiniteScroll || state.activeTab !== "browse") return;
    if (state.loadingBrowse || !state.hasMorePageData) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 240;
    if (!nearBottom) return;
    try {
      setStatus("Loading more records...");
      await loadBrowse({ append: true });
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  }, 120);
  window.addEventListener("scroll", onScroll, { passive: true });
}

async function applyWorkspace() {
  state.chromaDir = el.chromaDir.value.trim();
  state.sampleSize = Number(el.sampleSize.value || 120);
  state.pageSize = Number(el.pageSize.value || 25);
  state.idContains = el.idContains.value.trim();
  state.infiniteScroll = el.infiniteScrollMode.value === "on";
  state.offset = 0;
  setStatus("Loading...");

  const ok = await loadCollections();
  if (!ok) {
    updateUrlState();
    updateBrowseMeta();
    return;
  }

  await Promise.all([loadBrowse(), loadInsights()]);
  updateUrlState();
  saveWorkspacePrefs();
  setStatus("Ready");
}

function bindTabs() {
  const buttons = document.querySelectorAll(".tab-btn[data-tab]");
  const panels = document.querySelectorAll(".tab-panel");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      button.classList.add("active");
      const panel = document.getElementById(`tab-${button.dataset.tab}`);
      if (panel) panel.classList.add("active");
      state.activeTab = button.dataset.tab;
      updateUrlState();
    });
  });
  const current = Array.from(buttons).find((x) => x.dataset.tab === state.activeTab);
  if (current) current.click();
}

function bindEvents() {
  el.applyWorkspace.addEventListener("click", async () => {
    try {
      await applyWorkspace();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.collectionSelect.addEventListener("change", async (event) => {
    state.collection = event.target.value;
    state.offset = 0;
    try {
      await Promise.all([loadBrowse(), loadInsights()]);
      updateUrlState();
      saveWorkspacePrefs();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.pageSize.addEventListener("change", async () => {
    state.pageSize = Number(el.pageSize.value || 25);
    state.offset = 0;
    try {
      await loadBrowse();
      updateUrlState();
      saveWorkspacePrefs();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.infiniteScrollMode.addEventListener("change", () => {
    state.infiniteScroll = el.infiniteScrollMode.value === "on";
    updateBrowseMeta();
    updateUrlState();
    saveWorkspacePrefs();
  });

  const onIdFilterChange = debounce(async () => {
    state.idContains = el.idContains.value.trim();
    state.offset = 0;
    try {
      await loadBrowse();
      updateUrlState();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  }, 320);
  el.idContains.addEventListener("input", onIdFilterChange);

  el.prevPage.addEventListener("click", async () => {
    state.offset = Math.max(0, state.offset - state.pageSize);
    try {
      await loadBrowse();
      updateUrlState();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.nextPage.addEventListener("click", async () => {
    if (!state.hasMorePageData) return;
    state.offset += state.pageSize;
    try {
      await loadBrowse();
      updateUrlState();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.clearFilters.addEventListener("click", async () => {
    el.idContains.value = "";
    state.idContains = "";
    state.whereJson = "";
    state.activeFacetFilter = "";
    state.offset = 0;
    try {
      await Promise.all([loadBrowse(), loadInsights()]);
      updateUrlState();
      saveWorkspacePrefs();
      setStatus("Filters cleared");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.exportBrowseCsv.addEventListener("click", () => {
    const rows = state.visibleBrowseItems.map((x) => ({
      id: x.id,
      row: x.row,
      document_preview: x.document_preview || "",
      metadata: JSON.stringify(x.metadata || {}),
    }));
    downloadCsv("browse_results.csv", rows);
  });

  el.sampleSize.addEventListener("change", () => {
    state.sampleSize = Number(el.sampleSize.value || 120);
    saveWorkspacePrefs();
  });

  el.chromaDir.addEventListener("change", () => {
    state.chromaDir = el.chromaDir.value.trim();
    saveWorkspacePrefs();
  });
}

async function init() {
  loadWorkspacePrefs();
  loadStateFromUrl();
  bindTabs();
  bindEvents();
  setupInfiniteScroll();

  try {
    await applyWorkspace();
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
