/* =====================================================
   🔍 SEARCH VIEW (FINAL v4 STABLE SYNC FIXED)
   FULL CASINO MODULE INTEGRATION • NO BREAK • NO DESYNC
===================================================== */

const SearchView = (() => {

  let root = null;
  let inputEl = null;
  let resultsEl = null;

  let data = [];

  /* =====================================================
     INIT RENDER
  ===================================================== */
  function render(container) {

    root = container;
    if (!root) return;

    data = window.CASINO_DATA || [];

    root.innerHTML = `
      <section class="search-page">

        <div class="search-box-wrapper">
          <input id="searchInput" type="text" placeholder="Search casino..." />
        </div>

        <div id="searchResults" class="casino-grid"></div>

      </section>
    `;

    inputEl = document.getElementById("searchInput");
    resultsEl = document.getElementById("searchResults");

    bindSearch();
    renderResults(data);
  }

  /* =====================================================
     SEARCH ENGINE (RANK + FUZZY SAFE)
  ===================================================== */
  function search(query) {

    if (!query) return data;

    query = query.toLowerCase();

    return [...data]
      .map(item => {

        const name = (item.name || "").toLowerCase();

        let score = 0;

        if (name === query) score = 100;
        else if (name.startsWith(query)) score = 80;
        else if (name.includes(query)) score = 60;
        else score = fuzzy(name, query);

        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  /* =====================================================
     FUZZY MATCH
  ===================================================== */
  function fuzzy(text, q) {

    let i = 0;
    let score = 0;

    for (let c of text) {
      if (c === q[i]) {
        score += 10;
        i++;
      }
      if (i >= q.length) break;
    }

    return score;
  }

  /* =====================================================
     INPUT BIND
  ===================================================== */
  function bindSearch() {

    let timer;

    inputEl.addEventListener("input", (e) => {

      clearTimeout(timer);

      timer = setTimeout(() => {
        renderResults(search(e.target.value.trim()));
      }, 120);

    });

    setTimeout(() => inputEl.focus(), 150);
  }

  /* =====================================================
     IMAGE FIX (SAFE)
  ===================================================== */
  function getImage(src) {

    if (!src) return "";

    if (src.startsWith("http")) return src;

    return "assets/sites/" + src;
  }

  /* =====================================================
     RESULTS RENDER (FULL SYNC FIX)
  ===================================================== */
  function renderResults(list) {

    if (!resultsEl) return;

    resultsEl.innerHTML = list.map(item => `

      <div class="casino-card" data-id="${item.id}">

        <div class="card-front">

          <img class="casino-img"
               src="${getImage(item.image)}" />

          <div class="site-name">${item.name || ""}</div>

          <!-- FAVORITE (SYNCED WITH CASINO MODULE) -->
          <div class="fav-btn" data-id="${item.id}">
            ${window.CasinoModule?.isFavorite?.(item.id) ? "❤️" : "🤍"}
          </div>

          <!-- PLAY (CLICK TRACK SAFE) -->
          <a class="play-btn"
             href="${item.link}"
             target="_blank"
             rel="noopener noreferrer"
             onclick="event.stopPropagation(); CasinoModule?.registerClick?.('${item.id}')">
             Play Now
          </a>

        </div>

        <div class="card-back">
          <img class="back-img"
               src="${getImage(item.backImage || '11webback.webp')}" />
        </div>

      </div>

    `).join("");

    bindEvents(list);
  }

  /* =====================================================
     EVENTS (FULL CASINO COMPATIBLE)
  ===================================================== */
  function bindEvents(list) {

    if (!resultsEl) return;

    // FLIP (NO BREAK)
    resultsEl.querySelectorAll(".casino-card").forEach(card => {

      card.onclick = (e) => {

        if (e.target.closest(".fav-btn")) return;
        if (e.target.closest(".play-btn")) return;

        card.classList.toggle("flipped");
      };
    });

    // FAVORITE SYNC FIX (IMPORTANT PART)
    resultsEl.querySelectorAll(".fav-btn").forEach(btn => {

      btn.onclick = (e) => {

        e.stopPropagation();

        const id = btn.dataset.id;

        if (!window.CasinoModule) return;

        // force sync latest state before toggle
        window.CasinoModule.loadFavorites?.();

        window.CasinoModule.toggleFavorite?.(id);

        // instant UI refresh in search
        renderResults(list);
      };
    });

    // PLAY CLICK (ENSURE TRACK)
    resultsEl.querySelectorAll(".play-btn").forEach(btn => {

      btn.onclick = (e) => {
        e.stopPropagation();

        const id = btn.closest(".casino-card")?.dataset.id;
        window.CasinoModule?.registerClick?.(id);
      };
    });
  }

  return { render };

})();

window.SearchView = SearchView;