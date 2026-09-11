/* =====================================================
   🎰 CASINO MODULE
   FINAL v6.00
   FIREBASE CATEGORY + ORDER SUPPORT

   CATEGORY RULES:

   Popular
   → Global clicks DESC

   For You
   → Existing logic preserved
   → foryou === true
   → clicks DESC
   → same clicks = order ASC
   → 30 second rotation preserved

   Bangla
   → bangla === true
   → order ASC

   Sports
   → sports === true
   → order ASC

   Crypto
   → crypto === true
   → order ASC

   All Casinos
   → All documents
   → order ASC
===================================================== */

const CasinoModule = (() => {

  /* =====================================================
     STATE
  ===================================================== */

  let root = null;
  let rawData = [];
  let currentView = "popular";

  let favorites = new Set();

  let forYouIndex = 0;
  let forYouTimer = null;


  /* =====================================================
     CONSTANTS
  ===================================================== */

  const IMAGE_PATH = "assets/sites/";

  const FAVORITE_KEY =
    "casino_favorites";


  /* =====================================================
     INIT
  ===================================================== */

  async function init(
    containerId = "casino-root"
  ) {

    root =
      document.getElementById(
        containerId
      );

    if (!root) {
      return;
    }


    rawData =
      await window.FirebaseService
        .getSites();


    if (!Array.isArray(rawData)) {
      rawData = [];
    }


    await loadGlobalClicks();


    /* =============================================
       GLOBAL SHARE

       Used by:
       - Favorites
       - Search
       - Other existing modules
    ============================================== */

    window.CASINO_DATA =
      rawData;


    syncFavorites();


    forYouIndex =
      getTimeBasedIndex();


    startForYouLoop();

    render();
  }


  /* =====================================================
     LOAD DATA SAFE

     Preserved for compatibility with existing project.
  ===================================================== */

  function loadData() {

    rawData =
      Array.isArray(
        window.CASINO_DATA
      )
        ? [...window.CASINO_DATA]
        : [];


    rawData.sort(
      (a, b) =>
        Number(b.createdAt || 0) -
        Number(a.createdAt || 0)
    );
  }


  /* =====================================================
     ORDER VALUE

     Valid examples:
       order: 1
       order: 2
       order: 3

     Invalid/missing order:
       Goes to the end.
  ===================================================== */

  function getOrderValue(item) {

    if (!item) {
      return Number.MAX_SAFE_INTEGER;
    }


    const value =
      Number(item.order);


    if (
      !Number.isFinite(value) ||
      value < 0
    ) {

      return Number.MAX_SAFE_INTEGER;
    }


    return value;
  }


  /* =====================================================
     ORDER SORT

     Primary:
       order ASC

     Tie breaker:
       name ASC

     This keeps output deterministic if two documents
     accidentally use the same order number.
  ===================================================== */

  function sortByOrder(data) {

    if (!Array.isArray(data)) {
      return [];
    }


    return [...data]
      .sort((a, b) => {

        const orderDifference =
          getOrderValue(a) -
          getOrderValue(b);


        if (orderDifference !== 0) {
          return orderDifference;
        }


        const nameA =
          String(a?.name || "")
            .toLowerCase();

        const nameB =
          String(b?.name || "")
            .toLowerCase();


        return nameA.localeCompare(
          nameB
        );
      });
  }


  /* =====================================================
     GLOBAL CLICK TRACK
  ===================================================== */

  async function loadGlobalClicks() {

    try {

      if (
        !window.FirebaseService
          ?.getGlobalClicks
      ) {

        rawData.forEach(item => {

          item.clicks =
            Number(
              item.clicks || 0
            );
        });

        return;
      }


      const globalClicks =
        await window.FirebaseService
          .getGlobalClicks();


      rawData.forEach(item => {

        item.clicks =
          Number(
            globalClicks?.[item.id] ||
            item.clicks ||
            0
          );

      });

    } catch (error) {

      console.error(
        "❌ Global click load failed:",
        error
      );


      rawData.forEach(item => {

        item.clicks =
          Number(
            item.clicks || 0
          );
      });
    }
  }


  /* =====================================================
     REGISTER CLICK
  ===================================================== */

  async function registerClick(id) {

    const item =
      rawData.find(
        x =>
          String(x.id) ===
          String(id)
      );


    if (!item) {
      return;
    }


    /* =============================================
       INSTANT LOCAL UPDATE
    ============================================== */

    item.clicks =
      Number(
        item.clicks || 0
      ) + 1;


    try {

      if (
        window.FirebaseService
          ?.incrementSiteClick
      ) {

        await window.FirebaseService
          .incrementSiteClick(
            id
          );
      }

    } catch (error) {

      console.error(
        "❌ Global click update failed:",
        error
      );
    }
  }


  /* =====================================================
     FAVORITES SYNC
  ===================================================== */

  function syncFavorites() {

    try {

      const saved =
        JSON.parse(
          localStorage.getItem(
            FAVORITE_KEY
          ) || "[]"
        );


      favorites =
        new Set(
          Array.isArray(saved)
            ? saved
            : []
        );

    } catch {

      favorites =
        new Set();
    }
  }


  /* =====================================================
     SAVE FAVORITES
  ===================================================== */

  function saveFavorites() {

    localStorage.setItem(
      FAVORITE_KEY,
      JSON.stringify(
        [...favorites]
      )
    );
  }


  /* =====================================================
     CHECK FAVORITE
  ===================================================== */

  function isFavorite(id) {

    return favorites.has(id);
  }


  /* =====================================================
     TOGGLE FAVORITE
  ===================================================== */

  function toggleFavorite(id) {

    if (!id) {
      return;
    }


    syncFavorites();


    if (
      favorites.has(id)
    ) {

      favorites.delete(id);

    } else {

      favorites.add(id);
    }


    saveFavorites();


    window.dispatchEvent(
      new CustomEvent(
        "FAVORITES_UPDATED"
      )
    );


    render();
  }


  /* =====================================================
     GET FAVORITES
  ===================================================== */

  function getFavorites() {

    return [...favorites];
  }


  /* =====================================================
     IMAGE
  ===================================================== */

  const getImage = (src) => {

    if (!src) {
      return "";
    }


    if (
      src.startsWith("http")
    ) {

      return src;
    }


    return IMAGE_PATH + src;
  };


  /* =====================================================
     CATEGORY FILTER HELPER

     Example:
       getCategoryData("bangla")
       getCategoryData("sports")
       getCategoryData("crypto")
  ===================================================== */

  function getCategoryData(
    fieldName
  ) {

    if (!fieldName) {
      return [];
    }


    const filtered =
      rawData.filter(
        item =>
          item?.[fieldName] === true
      );


    return sortByOrder(
      filtered
    );
  }


  /* =====================================================
     VIEW LOGIC
  ===================================================== */

  function getViewData() {

    /* =============================================
       POPULAR

       Ranking:
       clicks DESC

       Only items with at least 1 click are shown.
       Existing behavior preserved.
    ============================================== */

    if (
      currentView ===
      "popular"
    ) {

      return [...rawData]
        .filter(
          item =>
            Number(
              item.clicks || 0
            ) > 0
        )
        .sort(
          (a, b) => {

            const clickDifference =
              Number(
                b.clicks || 0
              ) -
              Number(
                a.clicks || 0
              );


            if (
              clickDifference !== 0
            ) {

              return clickDifference;
            }


            /*
             * Stable deterministic fallback only.
             * Main ranking remains clicks.
             */

            return (
              getOrderValue(a) -
              getOrderValue(b)
            );
          }
        );
    }


    /* =============================================
       FOR YOU

       IMPORTANT:
       Existing logic preserved.
    ============================================== */

    if (
      currentView ===
      "foryou"
    ) {

      return getForYouData();
    }


    /* =============================================
       BANGLA

       Firebase:
       bangla: true

       Ranking:
       order ASC
    ============================================== */

    if (
      currentView ===
      "bangla"
    ) {

      return getCategoryData(
        "bangla"
      );
    }


    /* =============================================
       SPORTS

       Firebase:
       sports: true

       Ranking:
       order ASC
    ============================================== */

    if (
      currentView ===
      "sports"
    ) {

      return getCategoryData(
        "sports"
      );
    }


    /* =============================================
       CRYPTO

       Firebase:
       crypto: true

       Ranking:
       order ASC
    ============================================== */

    if (
      currentView ===
      "crypto"
    ) {

      return getCategoryData(
        "crypto"
      );
    }


    /* =============================================
       ALL CASINOS

       All documents
       Ranking:
       order ASC
    ============================================== */

    if (
      currentView ===
      "all"
    ) {

      return sortByOrder(
        rawData
      );
    }


    /* =============================================
       FALLBACK

       Unknown view:
       safely return All Casinos ordering.
    ============================================== */

    return sortByOrder(
      rawData
    );
  }


  /* =====================================================
     FOR YOU BASE DATA

     EXISTING LOGIC PRESERVED

     FIREBASE FIELD:
       foryou: true / false

     RULES:
       1. Only foryou === true
       2. Higher clicks first
       3. Same clicks -> existing order
       4. Zero clicks -> automatically last
  ===================================================== */

  function getForYouBaseData() {

    return [...rawData]

      /* =============================================
         Firebase field is exactly:
         foryou
      ============================================== */

      .filter(
        item =>
          item.foryou === true
      )

      .sort((a, b) => {

        const clickDifference =
          Number(
            b.clicks || 0
          ) -
          Number(
            a.clicks || 0
          );


        if (
          clickDifference !== 0
        ) {

          return clickDifference;
        }


        return (
          Number(
            a.order || 0
          ) -
          Number(
            b.order || 0
          )
        );
      });
  }


  /* =====================================================
     FOR YOU DATA + ROTATION

     EXISTING LOGIC PRESERVED
  ===================================================== */

  function getForYouData() {

    const selectedData =
      getForYouBaseData();


    const total =
      selectedData.length;


    if (!total) {
      return [];
    }


    const safeIndex =
      forYouIndex % total;


    const result = [];


    for (
      let i = 0;
      i < total;
      i++
    ) {

      result.push(
        selectedData[
          (safeIndex + i) %
          total
        ]
      );
    }


    return result;
  }


  /* =====================================================
     FOR YOU TIME INDEX

     ROTATION = 30 SECONDS

     EXISTING LOGIC PRESERVED
  ===================================================== */

  function getTimeBasedIndex() {

    const total =
      getForYouBaseData()
        .length;


    if (!total) {
      return 0;
    }


    return (
      Math.floor(
        Date.now() / 30000
      ) % total
    );
  }


  /* =====================================================
     RENDER
  ===================================================== */

  function render() {

    if (!root) {
      return;
    }


    const data =
      getViewData();


    root.innerHTML = `
      <div class="casino-grid">

        ${data.map(item => `
          <div
            class="casino-card"
            data-id="${item.id}"
          >

            <div class="card-front">

              <img
                class="casino-img"
                src="${getImage(item.image)}"
                alt="${item.name || ""}"
              />

              <div class="site-name">
                ${item.name || ""}
              </div>

              <div
                class="fav-btn"
                data-id="${item.id}"
              >
                ${isFavorite(item.id) ? "❤️" : "🤍"}
              </div>

              <a
                class="play-btn"
                href="${item.link || "#"}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Play Now
              </a>

            </div>

            <div class="card-back">

              <img
                class="back-img"
                src="${getImage(
                  item.backImage ||
                  item.backimage ||
                  "11webback.webp"
                )}"
                alt="${item.name || ""}"
              />

            </div>

          </div>
        `).join("")}

      </div>
    `;


    bindEvents();
  }


  /* =====================================================
     EVENTS
  ===================================================== */

  function bindEvents() {

    if (!root) {
      return;
    }


    /* =============================================
       CARD FLIP
    ============================================== */

    root
      .querySelectorAll(
        ".casino-card"
      )
      .forEach(card => {

        card.onclick = (e) => {

          if (
            e.target.closest(
              ".fav-btn"
            )
          ) {
            return;
          }


          if (
            e.target.closest(
              ".play-btn"
            )
          ) {
            return;
          }


          card.classList.toggle(
            "flipped"
          );
        };
      });


    /* =============================================
       FAVORITE BUTTON
    ============================================== */

    root
      .querySelectorAll(
        ".fav-btn"
      )
      .forEach(btn => {

        btn.onclick = (e) => {

          e.preventDefault();

          e.stopPropagation();


          toggleFavorite(
            btn.dataset.id
          );
        };
      });


    /* =============================================
       PLAY BUTTON
    ============================================== */

    root
      .querySelectorAll(
        ".play-btn"
      )
      .forEach(btn => {

        btn.onclick =
          async (e) => {

            e.stopPropagation();


            const id =
              btn
                .closest(
                  ".casino-card"
                )
                ?.dataset.id;


            /*
             * Do not await here before navigation.
             * User's link should remain responsive.
             */

            registerClick(id);


            const item =
              rawData.find(
                x =>
                  String(x.id) ===
                  String(id)
              );


            if (
              item &&
              window.HistoryModule
                ?.addEntry
            ) {

              window.HistoryModule
                .addEntry({
                  id: item.id,
                  name: item.name,
                  link: item.link
                });
            }
          };
      });
  }


  /* =====================================================
     FOR YOU ROTATION LOOP

     EVERY 30 SECONDS

     EXISTING LOGIC PRESERVED
  ===================================================== */

  function startForYouLoop() {

    if (forYouTimer) {

      clearInterval(
        forYouTimer
      );
    }


    forYouTimer =
      setInterval(() => {

        if (
          currentView !==
          "foryou"
        ) {
          return;
        }


        const total =
          getForYouBaseData()
            .length;


        if (!total) {
          return;
        }


        forYouIndex =
          (
            forYouIndex + 1
          ) % total;


        render();

      }, 30000);
  }


  /* =====================================================
     SET VIEW
  ===================================================== */

  async function setView(
    view
  ) {

    const allowedViews =
      new Set([
        "popular",
        "foryou",
        "bangla",
        "sports",
        "crypto",
        "all"
      ]);


    currentView =
      allowedViews.has(view)
        ? view
        : "popular";


    /* =============================================
       POPULAR

       Refresh latest global click data.
    ============================================== */

    if (
      currentView ===
      "popular"
    ) {

      await loadGlobalClicks();
    }


    /* =============================================
       FOR YOU

       Existing time-based index preserved.
    ============================================== */

    if (
      currentView ===
      "foryou"
    ) {

      forYouIndex =
        getTimeBasedIndex();
    }


    render();
  }


  /* =====================================================
     EXPORT
  ===================================================== */

  return {

    init,

    setView,

    toggleFavorite,

    registerClick,

    isFavorite,

    getFavorites,

    loadData

  };

})();


/* =====================================================
   GLOBAL EXPORT
===================================================== */

window.CasinoModule =
  CasinoModule;