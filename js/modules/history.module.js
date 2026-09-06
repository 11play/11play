/* =====================================================
   📜 HISTORY MODULE
   LocalStorage based
   Safe for SPA
   No router dependency
===================================================== */

const HistoryModule = (() => {

  /* -----------------------------
     STORAGE KEY
  ----------------------------- */
  const STORAGE_KEY = "history_items_v1";

  /* -----------------------------
     LOAD ALL HISTORY
  ----------------------------- */
  function getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("HistoryModule.getAll error:", err);
      return [];
    }
  }

  /* -----------------------------
     SAVE ALL HISTORY
  ----------------------------- */
  function saveAll(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.error("HistoryModule.saveAll error:", err);
    }
  }

  /* -----------------------------
     ADD ENTRY
     Play Now click হলে এটা call হবে
  ----------------------------- */
  function addEntry(item) {
    if (!item || !item.id) return;

    const all = getAll();

    /* duplicate item থাকলে আগে remove */
    const filtered = all.filter(x => String(x.id) !== String(item.id));

    /* current time save */
    const now = new Date();

    const entry = {
      id: item.id,
      name: item.name || "Unknown Site",
      link: item.link || "#",
      createdAt: now.getTime()
    };

    /* latest item উপরে থাকবে */
    filtered.unshift(entry);

    /* limit রাখা */
    const limited = filtered.slice(0, 100);

    saveAll(limited);
  }

  /* -----------------------------
     REMOVE ONE ITEM
  ----------------------------- */
  function remove(id) {
    const all = getAll();
    const filtered = all.filter(x => String(x.id) !== String(id));
    saveAll(filtered);
  }

  /* -----------------------------
     CLEAR ALL
  ----------------------------- */
  function clearAll() {
    saveAll([]);
  }

  /* -----------------------------
     FORMAT DATE
     Example: 24/6/2026
  ----------------------------- */
  function formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString("en-GB");
  }

  /* -----------------------------
     FORMAT TIME
     Example: 9:16:45 PM
  ----------------------------- */
  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }

  /* -----------------------------
     PUBLIC API
  ----------------------------- */
  return {
    getAll,
    addEntry,
    remove,
    clearAll,
    formatDate,
    formatTime
  };

})();

window.HistoryModule = HistoryModule;