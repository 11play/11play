/* =====================================================
   🎯 CATEGORY MODULE
   PRODUCTION SAFE + ROUTER READY + ACTIVE TAB CENTERING

   Categories:
   - Popular
   - For You
   - Bangla
   - Sports
   - Crypto
   - All Casinos

   Behavior:
   - Popular remains default on initial load
   - Initial Popular is NOT auto-centered
   - Clicking any category activates it
   - Selected category smoothly moves toward screen center
   - Category bar scroll position is NOT reset on every click
   - Popular / For You / Firebase logic remains unchanged
===================================================== */

const Category = (() => {

  /* =====================================================
     STATE
  ===================================================== */

  let activeTab = "popular";
  let root = null;


  /* =====================================================
     CATEGORY CONFIG
  ===================================================== */

  const categories = [
    {
      key: "popular",
      label: "Popular",
      icon: "🔥"
    },
    {
      key: "foryou",
      label: "For You",
      icon: "✨"
    },
    {
      key: "bangla",
      label: "Bangla",
      icon: "🇧🇩"
    },
    {
      key: "sports",
      label: "Sports",
      icon: "⚽"
    },
    {
      key: "crypto",
      label: "Crypto",
      icon: "₿"
    },
    {
      key: "all",
      label: "All Casinos",
      icon: "🎰"
    }
  ];


  /* =====================================================
     INIT
  ===================================================== */

  function init(
    containerId = "category-root"
  ) {

    root =
      document.getElementById(
        containerId
      );


    if (!root) {
      return;
    }


    render();


    /*
     * IMPORTANT:
     * Do NOT center Popular here.
     *
     * Initial category position should remain
     * naturally aligned from the beginning.
     */

    const bar =
      getCategoryBar();


    if (bar) {
      bar.scrollLeft = 0;
    }
  }


  /* =====================================================
     RENDER UI

     Full rendering happens only when needed.
     Category clicks themselves do NOT rebuild the bar.
  ===================================================== */

  function render() {

    if (!root) {
      return;
    }


    const tabsHtml =
      categories
        .map(category => {

          const isActive =
            activeTab ===
            category.key;


          return `
            <button
              class="category-tab ${isActive ? "active" : ""}"
              data-tab="${category.key}"
              type="button"
              aria-pressed="${isActive ? "true" : "false"}"
            >
              <span class="category-tab-icon">
                ${category.icon}
              </span>

              <span class="category-tab-label">
                ${category.label}
              </span>
            </button>
          `;

        })
        .join("");


    root.innerHTML = `
      <div class="category-bar">
        ${tabsHtml}
      </div>
    `;


    bindEvents();
  }


  /* =====================================================
     GET CATEGORY BAR
  ===================================================== */

  function getCategoryBar() {

    if (!root) {
      return null;
    }


    return root.querySelector(
      ".category-bar"
    );
  }


  /* =====================================================
     UPDATE ACTIVE TAB UI

     No full re-render here.

     This is important because rebuilding the category bar
     would reset horizontal scroll position.
  ===================================================== */

  function updateActiveTabUI() {

    if (!root) {
      return;
    }


    const buttons =
      root.querySelectorAll(
        ".category-tab"
      );


    buttons.forEach(button => {

      const isActive =
        button.dataset.tab ===
        activeTab;


      button.classList.toggle(
        "active",
        isActive
      );


      button.setAttribute(
        "aria-pressed",
        isActive
          ? "true"
          : "false"
      );
    });
  }


  /* =====================================================
     CENTER SELECTED TAB

     Selected category moves horizontally toward the
     center of the visible category bar.

     Example:

     Popular | For You | Bangla | Sports | Crypto | All

                         ↓ click Crypto

              Sports | [Crypto] | All Casinos

     Browser scroll limits are respected automatically.
  ===================================================== */

  function centerTab(
    tab,
    behavior = "smooth"
  ) {

    if (!root || !tab) {
      return;
    }


    const bar =
      getCategoryBar();


    const button =
      root.querySelector(
        `.category-tab[data-tab="${tab}"]`
      );


    if (
      !bar ||
      !button
    ) {
      return;
    }


    /*
     * Wait until the browser has completed
     * the active-state layout update.
     */

    requestAnimationFrame(() => {

      const buttonCenter =
        button.offsetLeft +
        (
          button.offsetWidth /
          2
        );


      const visibleCenter =
        bar.clientWidth / 2;


      let targetScrollLeft =
        buttonCenter -
        visibleCenter;


      /*
       * Prevent scrolling beyond either edge.
       */

      const maximumScroll =
        Math.max(
          0,
          bar.scrollWidth -
          bar.clientWidth
        );


      targetScrollLeft =
        Math.max(
          0,
          Math.min(
            targetScrollLeft,
            maximumScroll
          )
        );


      try {

        bar.scrollTo({
          left: targetScrollLeft,
          behavior
        });

      } catch {

        /*
         * Fallback for older WebView versions.
         */

        bar.scrollLeft =
          targetScrollLeft;
      }

    });
  }


  /* =====================================================
     EVENTS
  ===================================================== */

  function bindEvents() {

    if (!root) {
      return;
    }


    const buttons =
      root.querySelectorAll(
        ".category-tab"
      );


    buttons.forEach(button => {

      button.onclick = () => {

        const tab =
          button.dataset.tab;


        if (!tab) {
          return;
        }


        /* =============================================
           VALIDATE CATEGORY
        ============================================== */

        const isValidCategory =
          categories.some(
            category =>
              category.key ===
              tab
          );


        if (!isValidCategory) {
          return;
        }


        /* =============================================
           CURRENT ACTIVE TAB

           If user taps the already-active category,
           simply bring it toward center.

           No Firebase/data reload is triggered.
        ============================================== */

        if (
          tab ===
          activeTab
        ) {

          centerTab(
            tab,
            "smooth"
          );

          return;
        }


        /* =============================================
           CHANGE ACTIVE CATEGORY
        ============================================== */

        activeTab = tab;


        /* =============================================
           UPDATE ACTIVE HIGHLIGHT

           Important:
           Do NOT call render() here.
        ============================================== */

        updateActiveTabUI();


        /* =============================================
           CENTER SELECTED CATEGORY
        ============================================== */

        centerTab(
          activeTab,
          "smooth"
        );


        /* =============================================
           🎰 CASINO MODULE
        ============================================== */

        if (
          window.CasinoModule
            ?.setView
        ) {

          window.CasinoModule
            .setView(
              activeTab
            );
        }


        /* =============================================
           🚦 ROUTER
        ============================================== */

        if (
          window.Router
            ?.handleCategoryChange
        ) {

          window.Router
            .handleCategoryChange(
              activeTab
            );
        }


        /* =============================================
           🌐 GLOBAL EVENT
        ============================================== */

        window.dispatchEvent(
          new CustomEvent(
            "CATEGORY_CHANGED",
            {
              detail: {
                tab: activeTab
              }
            }
          )
        );

      };

    });
  }


  /* =====================================================
     RESET

     Home/reset:
     - Popular becomes active
     - Category bar returns to beginning
     - Popular is NOT forced into center
  ===================================================== */

  function reset() {

    activeTab =
      "popular";


    /*
     * If UI already exists,
     * update it without rebuilding.
     */

    if (
      root &&
      getCategoryBar()
    ) {

      updateActiveTabUI();


      const bar =
        getCategoryBar();


      if (bar) {

        try {

          bar.scrollTo({
            left: 0,
            behavior: "smooth"
          });

        } catch {

          bar.scrollLeft = 0;
        }
      }

    } else {

      render();
    }


    /* =============================================
       CASINO MODULE
    ============================================== */

    if (
      window.CasinoModule
        ?.setView
    ) {

      window.CasinoModule
        .setView(
          "popular"
        );
    }


    /* =============================================
       ROUTER
    ============================================== */

    if (
      window.Router
        ?.handleCategoryChange
    ) {

      window.Router
        .handleCategoryChange(
          "popular"
        );
    }


    /* =============================================
       GLOBAL EVENT
    ============================================== */

    window.dispatchEvent(
      new CustomEvent(
        "CATEGORY_CHANGED",
        {
          detail: {
            tab: activeTab
          }
        }
      )
    );
  }


  /* =====================================================
     GET ACTIVE CATEGORY
  ===================================================== */

  function getActive() {

    return activeTab;
  }


  /* =====================================================
     GET AVAILABLE CATEGORIES
  ===================================================== */

  function getCategories() {

    return categories.map(
      category => ({
        ...category
      })
    );
  }


  /* =====================================================
     EXPORT
  ===================================================== */

  return {
    init,
    reset,
    getActive,
    getCategories
  };

})();


/* =====================================================
   GLOBAL EXPORT
===================================================== */

window.Category =
  Category;