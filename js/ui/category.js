/* =====================================================
   🎯 CATEGORY MODULE (PRODUCTION SAFE + ROUTER READY)
===================================================== */

const Category = (() => {

  let activeTab = "foryou";
  let root = null;

  /* =====================================================
     INIT
  ===================================================== */
  function init(containerId = "category-root") {

    root = document.getElementById(containerId);
    if (!root) return;

    render();
  }

  /* =====================================================
     RENDER UI
  ===================================================== */
  function render() {

    root.innerHTML = `
      <div class="category-bar">

        <button class="category-tab ${activeTab === "foryou" ? "active" : ""}" data-tab="foryou">
          ✨ For You
        </button>

        <button class="category-tab ${activeTab === "popular" ? "active" : ""}" data-tab="popular">
          🔥 Popular
        </button>

        <button class="category-tab ${activeTab === "all" ? "active" : ""}" data-tab="all">
          🎰 All Casinos
        </button>

      </div>
    `;

    bindEvents();
  }

  /* =====================================================
     EVENTS
  ===================================================== */
  function bindEvents() {

    const buttons = root.querySelectorAll(".category-tab");

    buttons.forEach(btn => {

      btn.onclick = () => {

        const tab = btn.dataset.tab;

        if (tab === activeTab) return;

        activeTab = tab;

        render();

        /* =====================================================
           🔥 CASINO MODULE CONNECT (existing logic preserved)
        ===================================================== */
        if (window.CasinoModule?.setView) {
          window.CasinoModule.setView(activeTab);
        }

        /* =====================================================
           🚦 ROUTER SAFE EVENT LAYER (NEW - NO BREAK)
        ===================================================== */
        if (window.Router?.handleCategoryChange) {
          window.Router.handleCategoryChange(activeTab);
        }

        /* =====================================================
           🌐 GLOBAL EVENT (FUTURE EXTENSION)
        ===================================================== */
        window.dispatchEvent(new CustomEvent("CATEGORY_CHANGED", {
          detail: { tab: activeTab }
        }));

      };

    });

  }

  /* =====================================================
     RESET (HOME FIX)
  ===================================================== */
  function reset() {
    activeTab = "foryou";
    render();

    if (window.CasinoModule?.setView) {
      window.CasinoModule.setView("foryou");
    }

    if (window.Router?.handleCategoryChange) {
      window.Router.handleCategoryChange("foryou");
    }

    window.dispatchEvent(new CustomEvent("CATEGORY_CHANGED", {
      detail: { tab: activeTab }
    }));
  }

  /* =====================================================
     GET ACTIVE
  ===================================================== */
  function getActive() {
    return activeTab;
  }

  /* =====================================================
     EXPORT
  ===================================================== */
  return {
    init,
    reset,
    getActive
  };

})();

window.Category = Category;