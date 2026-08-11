/* =====================================================
❤️ FAVORITES VIEW (FINAL FIX v6.2 STABLE)
SYNC SAFE • GLOBAL CASINO DATA FIX • EMPTY FIX
===================================================== */

const FavoritesView = (() => {

  let root = null;
  const STORAGE_KEY = "casino_favorites";

  function render(container) {

    root = container;
    if (!root) return;

    const data = loadFavorites();

    root.innerHTML = `
      <section class="favorites-page">

        <div class="page-header">
          <h2>❤️ Favorites</h2>
          <p>Saved Casinos</p>
        </div>

        ${
          data.length === 0
            ? `<div class="empty-state">No favorites found</div>`
            : `
          <div class="favorites-grid casino-grid">

            ${data.map(item => `
              <div class="casino-card" data-id="${item.id}">

                <div class="card-front">

                  <img class="casino-img"
                       src="${getImage(item.image)}" />

                  <div class="site-name">
                    ${item.name || ""}
                  </div>

                  <div class="fav-btn" data-id="${item.id}">
                    ❤️
                  </div>

                  <a class="play-btn"
                     href="${item.link}"
                     target="_blank"
                     rel="noopener"
                     onclick="event.stopPropagation(); CasinoModule?.registerClick?.('${item.id}')">
                     Play Now
                  </a>

                </div>

                <div class="card-back">
                  <img class="back-img"
                       src="${getImage(item.backImage || '11webback.webp')}" />
                </div>

              </div>
            `).join("")}

          </div>
        `}
      </section>
    `;

    bindEvents();
  }

  /* =====================================================
     FIX: GLOBAL DATA SAFE
  ===================================================== */
  function loadFavorites() {

    let saved = [];

    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) saved = [];
    } catch {
      saved = [];
    }

    // 🔥 FIX: MUST USE GLOBAL SYNC
    const all =
      window.CASINO_DATA ||
      window.FirebaseService?.cachedSites ||
      [];

    return saved
      .map(id => all.find(x => x.id === id))
      .filter(Boolean)
      .reverse();
  }

  function getImage(src) {
    if (!src) return "";
    if (src.startsWith("http")) return src;
    return "assets/sites/" + src;
  }

  function bindEvents() {

    if (!root) return;

    root.querySelectorAll(".casino-card").forEach(card => {

      card.onclick = (e) => {
        if (e.target.closest(".fav-btn")) return;
        if (e.target.closest(".play-btn")) return;
        card.classList.toggle("flipped");
      };
    });

    root.querySelectorAll(".fav-btn").forEach(btn => {

      btn.onclick = (e) => {

        e.preventDefault();
        e.stopPropagation();

        const id = btn.dataset.id;

        let saved = [];

        try {
          saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
          if (!Array.isArray(saved)) saved = [];
        } catch {
          saved = [];
        }

        saved = saved.filter(x => x !== id);

        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

        render(root);

        window.dispatchEvent(new CustomEvent("FAVORITES_UPDATED"));
      };
    });
  }

  return { render };

})();

window.FavoritesView = FavoritesView;