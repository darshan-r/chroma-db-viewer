const SAVED_QUERIES_KEY = "chroma_explorer_saved_queries_v1";
const WORKSPACE_PREFS_KEY = "chroma_explorer_workspace_v1";
const CACHE_TTL_MS = 30000;

const state = {
  chromaDir: "",
  collection: "",
  requestedCollection: "",
  sampleSize: 120,
  embeddingModel: "all-MiniLM-L6-v2",
  pageSize: 25,
  offset: 0,
  idContains: "",
  total: 0,
  activeTab: "browse",
  activeFacetFilter: "",
  hasMorePageData: false,
  lastLoadedCount: 0,
  infiniteScroll: false,
  loadingBrowse: false,
  visibleBrowseItems: [],
  lastSearchMatches: [],
  cache: new Map(),
};

const el = {
  chromaDir: document.getElementById("chromaDir"),
  collectionSelect: document.getElementById("collectionSelect"),
  sampleSize: document.getElementById("sampleSize"),
  searchEmbeddingModel: document.getElementById("searchEmbeddingModel"),
  applyWorkspace: document.getElementById("applyWorkspace"),
  runHealth: document.getElementById("runHealth"),
  healthPanel: document.getElementById("healthPanel"),
  healthError: document.getElementById("healthError"),
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
  queryText: document.getElementById("queryText"),
  runSearch: document.getElementById("runSearch"),
  exportSearchCsv: document.getElementById("exportSearchCsv"),
  saveQuery: document.getElementById("saveQuery"),
  savedQueries: document.getElementById("savedQueries"),
  loadQuery: document.getElementById("loadQuery"),
  deleteQuery: document.getElementById("deleteQuery"),
  topK: document.getElementById("topK"),
  whereJson: document.getElementById("whereJson"),
  whereValidation: document.getElementById("whereValidation"),
  searchResults: document.getElementById("searchResults"),
  searchError: document.getElementById("searchError"),
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

function safeJsonString(value) {
  if (!value || !value.trim()) return "";
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch {
    return value.trim();
  }
}

function validateWhereJsonField() {
  const value = el.whereJson.value.trim();
  if (!value) {
    el.whereValidation.textContent = 'Optional JSON object filter. Example: {"source":"notes.md"}';
    el.whereValidation.classList.remove("ok", "bad");
    return true;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      el.whereValidation.textContent = "Valid JSON filter object.";
      el.whereValidation.classList.remove("bad");
      el.whereValidation.classList.add("ok");
      return true;
    }
    el.whereValidation.textContent = "Invalid filter: JSON must be an object.";
    el.whereValidation.classList.remove("ok");
    el.whereValidation.classList.add("bad");
    return false;
  } catch {
    el.whereValidation.textContent = "Invalid JSON syntax.";
    el.whereValidation.classList.remove("ok");
    el.whereValidation.classList.add("bad");
    return false;
  }
}

function renderSkeleton(targetNode, count = 3) {
  targetNode.innerHTML = Array.from({ length: count }).map(() => "<article class='skeleton'></article>").join("");
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
    embeddingModel: state.embeddingModel,
    pageSize: state.pageSize,
    infiniteScroll: state.infiniteScroll,
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
    if (prefs.embeddingModel) el.searchEmbeddingModel.value = prefs.embeddingModel;
    if (prefs.pageSize) el.pageSize.value = String(prefs.pageSize);
    if (prefs.collection) state.requestedCollection = prefs.collection;
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
  if (el.queryText.value.trim()) params.set("query", el.queryText.value.trim());
  if (el.whereJson.value.trim()) params.set("where", safeJsonString(el.whereJson.value));
  if (el.topK.value) params.set("topk", String(el.topK.value));
  if (el.pageSize.value) params.set("page_size", String(el.pageSize.value));
  if (el.idContains.value.trim()) params.set("id_contains", el.idContains.value.trim());
  params.set("infinite", state.infiniteScroll ? "1" : "0");
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path");
  const collection = params.get("collection");
  const tab = params.get("tab");
  const query = params.get("query");
  const where = params.get("where");
  const topk = params.get("topk");
  const pageSize = params.get("page_size");
  const idContains = params.get("id_contains");
  const infinite = params.get("infinite");

  if (path) el.chromaDir.value = path;
  if (collection) state.requestedCollection = collection;
  if (query) el.queryText.value = query;
  if (where) el.whereJson.value = where;
  if (topk) el.topK.value = topk;
  if (pageSize) el.pageSize.value = pageSize;
  if (idContains) el.idContains.value = idContains;
  if (infinite === "1") {
    state.infiniteScroll = true;
    el.infiniteScrollMode.value = "on";
  }
  if (tab && ["browse", "search", "insights"].includes(tab)) {
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
  if (!validateWhereJsonField()) {
    showPanelError(el.browseError, "Invalid metadata filter JSON.");
    setStatus("Fix metadata filter JSON to continue.", true);
    return;
  }
  if (!append) {
    renderBrowseTableSkeleton(4);
  }
  state.loadingBrowse = true;
  try {
    const whereJson = safeJsonString(el.whereJson.value);
    const offset = append ? state.offset + state.pageSize : state.offset;
    const url =
      `/api/collections/${q(state.collection)}/browse?chroma_dir=${q(state.chromaDir)}` +
      `&limit=${state.pageSize}&offset=${offset}&id_contains=${q(state.idContains)}&where_json=${q(whereJson)}`;
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
      el.whereJson.value = where;
      validateWhereJsonField();
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
    const keys = data.metadata_keys || [];
    el.kpiKeys.textContent = String(keys.length);
    el.metadataKeys.innerHTML = keys.length
      ? keys.map((key) => `<span class="chip">${key}</span>`).join("")
      : "<span class='chip'>No keys detected</span>";
    el.collectionMeta.textContent = JSON.stringify(data.metadata || {}, null, 2);
    renderFacets(data.facets || []);
  } catch (error) {
    showPanelError(el.insightsError, error.message);
    throw error;
  }
}

async function runSearch() {
  if (!state.collection) return;
  clearPanelError(el.searchError);
  const query = el.queryText.value.trim();
  if (!query) {
    showPanelError(el.searchError, "Enter a query to search.");
    setStatus("Enter a query to search.", true);
    return;
  }
  if (!validateWhereJsonField()) {
    showPanelError(el.searchError, "Invalid metadata filter JSON.");
    setStatus("Fix metadata filter JSON to search.", true);
    return;
  }

  renderSkeleton(el.searchResults, 3);
  try {
    const body = {
      chroma_dir: state.chromaDir,
      query,
      top_k: Number(el.topK.value || 8),
      embedding_model: state.embeddingModel,
      where_json: safeJsonString(el.whereJson.value),
    };
    const cacheKey = `POST:/api/collections/${state.collection}/search:${JSON.stringify(body)}`;
    let data = cacheGet(cacheKey);
    if (!data) {
      data = await getJson(`/api/collections/${q(state.collection)}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      cacheSet(cacheKey, data);
    }
    const matches = data.matches || [];
    state.lastSearchMatches = matches;
    if (!matches.length) {
      el.searchResults.innerHTML = "<article class='item'>No matches.</article>";
      return;
    }
    el.searchResults.innerHTML = matches
      .map(
        (m) => `
        <article class="item">
          <div class="item-top">
            <span class="item-id">#${m.rank} ${m.id}</span>
            <span>distance ${m.distance ?? "-"}</span>
          </div>
          <p>${m.document_preview || ""}</p>
          <details class="advanced">
            <summary>Details</summary>
            <p>${m.document || ""}</p>
            <pre>${JSON.stringify(m.metadata || {}, null, 2)}</pre>
          </details>
        </article>
      `
      )
      .join("");
  } catch (error) {
    showPanelError(el.searchError, error.message);
    throw error;
  }
}

function renderSavedQueries() {
  const saved = JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || "[]");
  el.savedQueries.innerHTML = "<option value=''>Saved queries</option>";
  saved.forEach((entry, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = entry.name;
    el.savedQueries.appendChild(option);
  });
}

function saveCurrentQuery() {
  const query = el.queryText.value.trim();
  if (!query) {
    setStatus("Enter a query first, then save it.", true);
    return;
  }
  const name = window.prompt("Preset name:", query.slice(0, 30));
  if (!name) return;
  const saved = JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || "[]");
  saved.unshift({
    name: name.trim(),
    query,
    topK: Number(el.topK.value || 8),
    whereJson: el.whereJson.value || "",
  });
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(saved.slice(0, 20)));
  renderSavedQueries();
  setStatus("Query preset saved");
}

function loadSelectedQuery() {
  const idx = Number(el.savedQueries.value);
  if (Number.isNaN(idx)) return;
  const saved = JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || "[]");
  const item = saved[idx];
  if (!item) return;
  el.queryText.value = item.query || "";
  el.topK.value = String(item.topK || 8);
  el.whereJson.value = item.whereJson || "";
  validateWhereJsonField();
  setStatus(`Loaded preset: ${item.name}`);
  updateUrlState();
}

function deleteSelectedQuery() {
  const idx = Number(el.savedQueries.value);
  if (Number.isNaN(idx)) return;
  const saved = JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || "[]");
  if (!saved[idx]) return;
  const removed = saved[idx].name;
  saved.splice(idx, 1);
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(saved));
  renderSavedQueries();
  setStatus(`Deleted preset: ${removed}`);
}

function renderHealth(payload) {
  const toBadge = (value) => (value ? "<span class='ok'>OK</span>" : "<span class='bad'>Issue</span>");
  el.healthPanel.innerHTML = `
    <div class="health-cell">Path: ${toBadge(payload.path_exists)}</div>
    <div class="health-cell">DB file: ${toBadge(payload.db_file_exists)}</div>
    <div class="health-cell">Connect: ${toBadge(payload.db_connectable)}</div>
    <div class="health-cell">Collections: ${payload.collections_count ?? 0}</div>
    <div class="health-cell">Collection: ${payload.collection_accessible == null ? "-" : toBadge(payload.collection_accessible)}</div>
    <div class="health-cell">Embedding: ${payload.embedding_model_loadable == null ? "-" : toBadge(payload.embedding_model_loadable)}</div>
    <div class="health-cell">Query compat: ${payload.query_compatible == null ? "-" : toBadge(payload.query_compatible)}</div>
  `;
}

async function runHealthCheck(includeEmbeddingCheck = false) {
  clearPanelError(el.healthError);
  const url =
    `/api/health?chroma_dir=${q(state.chromaDir)}` +
    `&collection_name=${q(state.collection || "")}&embedding_model=${q(state.embeddingModel)}` +
    `&include_embedding_check=${includeEmbeddingCheck ? "true" : "false"}`;
  try {
    const payload = await getCachedJson(url, includeEmbeddingCheck ? 15000 : 5000);
    renderHealth(payload);
    if (payload.errors && payload.errors.length) {
      showPanelError(el.healthError, payload.errors[0]);
    }
  } catch (error) {
    showPanelError(el.healthError, error.message);
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
  state.embeddingModel = (el.searchEmbeddingModel.value || "all-MiniLM-L6-v2").trim();
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
  runHealthCheck(false).catch(() => {
    setStatus("Ready (health check timed out; click Check for full diagnostics)", false);
  });
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
      document.getElementById(`tab-${button.dataset.tab}`).classList.add("active");
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

  el.runHealth.addEventListener("click", async () => {
    try {
      state.embeddingModel = (el.searchEmbeddingModel.value || "all-MiniLM-L6-v2").trim();
      setStatus("Running full health check...");
      await runHealthCheck(true);
      setStatus("Health check complete");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.collectionSelect.addEventListener("change", async (event) => {
    state.collection = event.target.value;
    state.offset = 0;
    try {
      await Promise.all([loadBrowse(), loadInsights()]);
      runHealthCheck(false).catch(() => {});
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
    el.whereJson.value = "";
    state.idContains = "";
    state.activeFacetFilter = "";
    state.offset = 0;
    validateWhereJsonField();
    try {
      await Promise.all([loadBrowse(), loadInsights()]);
      updateUrlState();
      saveWorkspacePrefs();
      setStatus("Filters cleared");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.runSearch.addEventListener("click", async () => {
    state.embeddingModel = (el.searchEmbeddingModel.value || "all-MiniLM-L6-v2").trim();
    try {
      setStatus("Searching...");
      await runSearch();
      updateUrlState();
      saveWorkspacePrefs();
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  el.queryText.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    el.runSearch.click();
  });

  el.saveQuery.addEventListener("click", saveCurrentQuery);
  el.loadQuery.addEventListener("click", loadSelectedQuery);
  el.deleteQuery.addEventListener("click", deleteSelectedQuery);

  el.exportBrowseCsv.addEventListener("click", () => {
    const rows = state.visibleBrowseItems.map((x) => ({
      id: x.id,
      row: x.row,
      document_preview: x.document_preview || "",
      metadata: JSON.stringify(x.metadata || {}),
    }));
    downloadCsv("browse_results.csv", rows);
  });

  el.exportSearchCsv.addEventListener("click", () => {
    const rows = state.lastSearchMatches.map((x) => ({
      rank: x.rank,
      id: x.id,
      distance: x.distance,
      document_preview: x.document_preview || "",
      metadata: JSON.stringify(x.metadata || {}),
    }));
    downloadCsv("search_results.csv", rows);
  });

  el.whereJson.addEventListener("input", validateWhereJsonField);
  el.searchEmbeddingModel.addEventListener("change", () => {
    state.embeddingModel = (el.searchEmbeddingModel.value || "all-MiniLM-L6-v2").trim();
    saveWorkspacePrefs();
  });
  el.sampleSize.addEventListener("change", () => {
    state.sampleSize = Number(el.sampleSize.value || 120);
    saveWorkspacePrefs();
  });
  el.chromaDir.addEventListener("change", () => {
    state.chromaDir = el.chromaDir.value.trim();
    saveWorkspacePrefs();
  });

  [el.queryText, el.whereJson, el.topK].forEach((node) =>
    node.addEventListener("change", () => updateUrlState())
  );
}

async function init() {
  loadWorkspacePrefs();
  loadStateFromUrl();
  bindTabs();
  bindEvents();
  setupInfiniteScroll();
  renderSavedQueries();
  validateWhereJsonField();
  try {
    await applyWorkspace();
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
