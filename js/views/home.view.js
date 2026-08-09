/* =====================================================
   🏠 HOME VIEW (PRODUCTION SAFE + NAV READY)
===================================================== */

const HomeView = (() => {

  async function render(root) {

    if (!root) {
      window.dispatchEvent(new Event("APP_FIRST_RENDER_READY"));
      return;
    }

    root.innerHTML = `
      <section class="home-page">

        <!-- ================= BANNER ================= -->
        <div class="home-banner-section">
          <div id="banner"></div>
        </div>

        <!-- ================= CATEGORY ================= -->
        <div class="home-category-section">
          <div id="category-root"></div>
        </div>

        <!-- ================= CASINO ================= -->
        <div class="home-casino-section">
          <div id="casino-root"></div>
        </div>

        <!-- ================= FUTURE CONTENT ================= -->
        <div class="home-content"></div>

      </section>
    `;

    try {

      // ================= CATEGORY INIT =================
      window.Category?.init?.("category-root");

      // ================= BANNER + CASINO =================
      await Promise.allSettled([
        Promise.resolve(window.Banner?.init?.()),
        Promise.resolve(window.CasinoModule?.init?.("casino-root"))
      ]);

      // ================= CLICK SAFETY LAYER (NEW) =================
      bindHomeClickGuard(root);

    } catch (e) {
      console.error("❌ HomeView render error:", e);
    } finally {
      window.dispatchEvent(new Event("APP_FIRST_RENDER_READY"));
    }
  }

  /* =====================================================
     🛡️ CLICK GUARD (SAFE NAVIGATION CONTROL)
     - future proof for register/play links
  ===================================================== */
  function bindHomeClickGuard(root) {

    if (!root) return;

    root.addEventListener("click", (e) => {

      const link = e.target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href) return;

      // Let router/app.js handle decisions
      if (window.Router?.handleExternalClick) {
        window.Router.handleExternalClick(e, href);
      }

    }, true);
  }

  return { render };

})();

window.HomeView = HomeView;