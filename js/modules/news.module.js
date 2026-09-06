const NewsModule = (() => {

  let cache = [];

  /* ===============================
     LOAD FROM FIREBASE (FIXED)
  =============================== */
  async function load() {

    // prevent unnecessary re-fetch
    if (cache.length > 0) return cache;

    const data = await window.FirebaseService.getNews();

    // 🔥 FIX: safe filter + sort
    cache = (data || [])
      .filter(n => n.active !== false)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return cache;
  }

  /* ===============================
     GET CACHE
  =============================== */
  function getAll() {
    return cache;
  }

  return { load, getAll };

})();

window.NewsModule = NewsModule;