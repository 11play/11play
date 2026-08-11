/* =====================================================
   📜 HISTORY VIEW
   Clean History UI
   No image required
   Site name + date + time + play now + delete
===================================================== */

const HistoryView = (() => {

  let root = null;

  /* -----------------------------
     RENDER ENTRY
  ----------------------------- */
  function render(container) {
    root = container;
    if (!root) return;

    draw();
    bindEvents();
  }

  /* -----------------------------
     DRAW UI
  ----------------------------- */
  function draw() {
    const items = window.HistoryModule?.getAll?.() || [];

    root.innerHTML = `
      <section class="history-page">

        <!-- Header -->
        <div class="history-header">
          <h2 class="history-title-main">History</h2>
          <button class="history-clear-all-btn" id="historyClearAllBtn">
            Clear All
          </button>
        </div>

        <!-- Empty State -->
        ${
          items.length === 0
            ? `
              <div class="history-empty">
                No History Found
              </div>
            `
            : `
              <div class="history-list">
                ${items.map(item => `
                  <div class="history-card" data-id="${item.id}">
                    
                    <!-- Top content -->
                    <div class="history-card-top">

                      <!-- Left info -->
                      <div class="history-card-info">
                        <div class="history-site-name">
                          ${escapeHtml(item.name || "Unknown Site")}
                        </div>

                        <div class="history-meta-row">
                          <span class="history-meta-icon">📅</span>
                          <span class="history-meta-text">
                            ${window.HistoryModule.formatDate(item.createdAt)}
                          </span>
                        </div>

                        <div class="history-meta-row">
                          <span class="history-meta-icon">🕒</span>
                          <span class="history-meta-text">
                            ${window.HistoryModule.formatTime(item.createdAt)}
                          </span>
                        </div>
                      </div>

                      <!-- Right delete -->
                      <button class="history-delete-btn"
                              data-id="${item.id}"
                              title="Delete History"
                              aria-label="Delete History">
                        🗑️
                      </button>
                    </div>

                    <!-- Bottom play button -->
                    <div class="history-card-bottom">
                      <button class="history-play-btn"
                              data-link="${escapeAttr(item.link || "#")}">
                        Play Now
                      </button>
                    </div>

                  </div>
                `).join("")}
              </div>
            `
        }

      </section>
    `;
  }

  /* -----------------------------
     BIND EVENTS
  ----------------------------- */
  function bindEvents() {
    if (!root) return;

    /* Clear All */
    const clearAllBtn = root.querySelector("#historyClearAllBtn");
    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        const ok = confirm("Clear all history?");
        if (!ok) return;

        window.HistoryModule?.clearAll?.();
        draw();
        bindEvents();
      };
    }

    /* Delete single */
    root.querySelectorAll(".history-delete-btn").forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const id = btn.dataset.id;
        const card = btn.closest(".history-card");

        if (!id || !card) return;

        /* red flash animation */
        card.classList.add("history-removing");

        setTimeout(() => {
          window.HistoryModule?.remove?.(id);
          draw();
          bindEvents();
        }, 260);
      };
    });

    /* Play Now from history */
    root.querySelectorAll(".history-play-btn").forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const link = btn.dataset.link;
        if (!link) return;

        window.open(link, "_blank", "noopener,noreferrer");
      };
    });
  }

  /* -----------------------------
     SAFE HTML ESCAPE
  ----------------------------- */
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /* -----------------------------
     SAFE ATTRIBUTE ESCAPE
  ----------------------------- */
  function escapeAttr(value) {
    return String(value).replaceAll('"', "&quot;");
  }

  /* -----------------------------
     PUBLIC API
  ----------------------------- */
  return {
    render
  };

})();

window.HistoryView = HistoryView;