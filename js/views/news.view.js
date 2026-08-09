const NewsView = (() => {

  let root = null;
  let expanded = {};
  let bound = false;

  /* ===============================
     RENDER ENTRY (FIXED FIREBASE VERSION)
  =============================== */
  async function render(container) {

    root = container;
    if (!root) return;

    // 🔥 FIX: ensure Firebase data loads first
    await NewsModule.load();

    draw();

    // safe event binding (ONLY ONCE)
    if (!bound) {
      bindEvents();
      bound = true;
    }

    // live update
    window.removeEventListener("NEWS_UPDATED", handleUpdate);
    window.addEventListener("NEWS_UPDATED", handleUpdate);
  }

  /* ===============================
     HANDLE UPDATE EVENT
  =============================== */
  function handleUpdate() {
    draw();
  }

  /* ===============================
     DRAW UI
  =============================== */
  function draw() {

    const posts = NewsModule?.getAll?.() || [];

    root.innerHTML = `
      <section class="news-page">

        <div class="news-header">
          <h2>News</h2>
          <p>Latest Updates</p>
        </div>

        ${
          posts.length === 0
            ? `<div class="news-empty">No News</div>`
            : `
              <div class="news-feed">
                ${posts.map(renderCard).join("")}
              </div>
            `
        }

      </section>
    `;
  }

  /* ===============================
     SINGLE CARD
  =============================== */
  function renderCard(p) {

    const full = p.description || "";
    const short = full.slice(0, 120);
    const isOpen = !!expanded[p.id];

    const linkText = p.linkLabel || "Register Now";

    return `
      <div class="news-card" data-id="${p.id}">

        ${p.image ? `<img class="news-image" src="${p.image}" loading="lazy">` : ""}

        <div class="news-title">${p.title || ""}</div>

        <div class="news-description">
          ${isOpen ? full : short + (full.length > 120 ? "..." : "")}
        </div>

        ${
          full.length > 120
            ? `<button class="see-more" data-id="${p.id}">
                ${isOpen ? "Show Less" : "See More"}
               </button>`
            : ""
        }

        <a class="news-link cta-btn"
           href="${p.link || '#'}"
           target="_blank"
           rel="noopener noreferrer">
          ${linkText}
        </a>

        <div class="news-separator"></div>

      </div>
    `;
  }

  /* ===============================
     EVENTS
  =============================== */
  function bindEvents() {

    if (!root) return;

    root.addEventListener("click", (e) => {

      const btn = e.target.closest(".see-more");
      if (!btn) return;

      const id = btn.dataset.id;
      expanded[id] = !expanded[id];

      draw();
    });
  }

  return { render };

})();

window.NewsView = NewsView;