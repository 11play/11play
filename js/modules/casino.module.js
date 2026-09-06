/* =====================================================  
   🎰 CASINO MODULE (FINAL v5.10 FIREBASE FORYOU FIX)  
   FIX: GLOBAL POPULAR + SELECTED FORYOU + 30S ROTATION  
===================================================== */  
  
const CasinoModule = (() => {  
  
  let root = null;  
  let rawData = [];  
  let currentView = "popular";  
  
  let favorites = new Set();  
  
  let forYouIndex = 0;  
  let forYouTimer = null;  
  
  const IMAGE_PATH = "assets/sites/";  
  const FAVORITE_KEY = "casino_favorites";  
  
  /* =====================================================  
     INIT  
  ===================================================== */  
  async function init(containerId = "casino-root") {  
  
    root = document.getElementById(containerId);  
    if (!root) return;  
  
    rawData = await window.FirebaseService.getSites();  
  
    await loadGlobalClicks();  
  
    // GLOBAL SHARE FOR FAVORITES + SEARCH  
    window.CASINO_DATA = rawData;  
  
    syncFavorites();  
  
    forYouIndex = getTimeBasedIndex();  
  
    startForYouLoop();  
    render();  
  }  
  
  /* =====================================================  
     LOAD DATA SAFE  
  ===================================================== */  
  function loadData() {  
  
    rawData = Array.isArray(window.CASINO_DATA)  
      ? [...window.CASINO_DATA]  
      : [];  
  
    rawData.sort((a, b) =>  
      (b.createdAt || 0) - (a.createdAt || 0)  
    );  
  }  
  
  /* =====================================================  
     GLOBAL CLICK TRACK  
  ===================================================== */  
  async function loadGlobalClicks() {  
  
    try {  
  
      if (!window.FirebaseService?.getGlobalClicks) return;  
  
      const globalClicks =  
        await window.FirebaseService.getGlobalClicks();  
  
      rawData.forEach(item => {  
  
        item.clicks = Number(  
          globalClicks[item.id] ||  
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
        item.clicks = Number(item.clicks || 0);  
      });  
    }  
  }  
  
  async function registerClick(id) {  
  
    const item = rawData.find(  
      x => String(x.id) === String(id)  
    );  
  
    if (!item) return;  
  
    // instant UI update  
    item.clicks = Number(item.clicks || 0) + 1;  
  
    try {  
  
      if (window.FirebaseService?.incrementSiteClick) {  
        await window.FirebaseService.incrementSiteClick(id);  
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
  
      const saved = JSON.parse(  
        localStorage.getItem(FAVORITE_KEY) || "[]"  
      );  
  
      favorites = new Set(  
        Array.isArray(saved) ? saved : []  
      );  
  
    } catch {  
  
      favorites = new Set();  
    }  
  }  
  
  function saveFavorites() {  
  
    localStorage.setItem(  
      FAVORITE_KEY,  
      JSON.stringify([...favorites])  
    );  
  }  
  
  function isFavorite(id) {  
    return favorites.has(id);  
  }  
  
  function toggleFavorite(id) {  
  
    if (!id) return;  
  
    syncFavorites();  
  
    if (favorites.has(id)) {  
      favorites.delete(id);  
    } else {  
      favorites.add(id);  
    }  
  
    saveFavorites();  
  
    window.dispatchEvent(  
      new CustomEvent("FAVORITES_UPDATED")  
    );  
  
    render();  
  }  
  
  function getFavorites() {  
    return [...favorites];  
  }  
  
  /* =====================================================  
     IMAGE  
  ===================================================== */  
  const getImage = (src) => {  
  
    if (!src) return "";  
  
    if (src.startsWith("http")) {  
      return src;  
    }  
  
    return IMAGE_PATH + src;  
  };  
  
  /* =====================================================  
     VIEW LOGIC  
  ===================================================== */  
  function getViewData() {  
  
    /* -------------------------
       ALL CASINOS
    ------------------------- */  
    if (currentView === "all") {  
      return rawData;  
    }  
  
    /* -------------------------
       POPULAR
    ------------------------- */  
    if (currentView === "popular") {  
  
      return [...rawData]  
        .filter(  
          item => Number(item.clicks || 0) > 0  
        )  
        .sort(  
          (a, b) =>  
            Number(b.clicks || 0) -  
            Number(a.clicks || 0)  
        );  
    }  
  
    /* -------------------------
       FOR YOU
    ------------------------- */  
    if (currentView === "foryou") {  
      return getForYouData();  
    }  
  
    return rawData;  
  }  
  
  /* =====================================================  
     FOR YOU BASE DATA  
  
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
  
      // IMPORTANT:
      // Firebase field is exactly "foryou"
      .filter(item => item.foryou === true)  
  
      .sort((a, b) => {  
  
        const clickDifference =  
          Number(b.clicks || 0) -  
          Number(a.clicks || 0);  
  
        if (clickDifference !== 0) {  
          return clickDifference;  
        }  
  
        return (  
          Number(a.order || 0) -  
          Number(b.order || 0)  
        );  
      });  
  }  
  
  /* =====================================================  
     FOR YOU DATA + ROTATION  
  ===================================================== */  
  function getForYouData() {  
  
    const selectedData = getForYouBaseData();  
  
    const total = selectedData.length;  
  
    if (!total) return [];  
  
    const safeIndex = forYouIndex % total;  
  
    const result = [];  
  
    for (let i = 0; i < total; i++) {  
  
      result.push(  
        selectedData[(safeIndex + i) % total]  
      );  
    }  
  
    return result;  
  }  
  
  /* =====================================================  
     FOR YOU TIME INDEX  
     ROTATION = 30 SECONDS  
  ===================================================== */  
  function getTimeBasedIndex() {  
  
    const total = getForYouBaseData().length;  
  
    if (!total) return 0;  
  
    return (  
      Math.floor(Date.now() / 30000) % total  
    );  
  }  
  
  /* =====================================================  
     RENDER  
  ===================================================== */  
  function render() {  
  
    if (!root) return;  
  
    const data = getViewData();  
  
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
                href="${item.link}"  
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
  
    if (!root) return;  
  
    root  
      .querySelectorAll(".casino-card")  
      .forEach(card => {  
  
        card.onclick = (e) => {  
  
          if (e.target.closest(".fav-btn")) return;  
          if (e.target.closest(".play-btn")) return;  
  
          card.classList.toggle("flipped");  
        };  
      });  
  
    root  
      .querySelectorAll(".fav-btn")  
      .forEach(btn => {  
  
        btn.onclick = (e) => {  
  
          e.preventDefault();  
          e.stopPropagation();  
  
          toggleFavorite(btn.dataset.id);  
        };  
      });  
  
    root  
      .querySelectorAll(".play-btn")  
      .forEach(btn => {  
  
        btn.onclick = async (e) => {  
  
          e.stopPropagation();  
  
          const id = btn  
            .closest(".casino-card")  
            ?.dataset.id;  
  
          registerClick(id);  
  
          const item = rawData.find(  
            x =>  
              String(x.id) ===  
              String(id)  
          );  
  
          if (  
            item &&  
            window.HistoryModule?.addEntry  
          ) {  
  
            window.HistoryModule.addEntry({  
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
  ===================================================== */  
  function startForYouLoop() {  
  
    if (forYouTimer) {  
      clearInterval(forYouTimer);  
    }  
  
    forYouTimer = setInterval(() => {  
  
      if (currentView !== "foryou") return;  
  
      const total = getForYouBaseData().length;  
  
      if (!total) return;  
  
      forYouIndex =  
        (forYouIndex + 1) % total;  
  
      render();  
  
    }, 30000);  
  }  
  
  /* =====================================================  
     SET VIEW  
  ===================================================== */  
  async function setView(view) {  
  
    currentView = view;  
  
    if (view === "popular") {  
      await loadGlobalClicks();  
    }  
  
    if (view === "foryou") {  
      forYouIndex = getTimeBasedIndex();  
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
    getFavorites  
  };  
  
})();  
  
window.CasinoModule = CasinoModule;