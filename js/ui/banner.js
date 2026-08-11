/* =====================================================
   🎯 BANNER MODULE (PRODUCTION SAFE + NAV READY)
===================================================== */

const Banner = (() => {

  let root;
  let track;
  let index = 0;
  let timer = null;
  let startX = 0;
  let data = [];

  /* ================= INIT ================= */
  async function init() {

    root = document.getElementById("banner");
    if (!root) return;

    data = await loadBanners();

    if (!data || data.length === 0) {
      root.innerHTML = `<div class="banner-empty">No Banner</div>`;
      return;
    }

    render();
    bindEvents();
    startAuto();
  }

  /* ================= LOAD DATA ================= */
  async function loadBanners() {

    if (window.BannerService?.getBanners) {
      const res = await window.BannerService.getBanners();
      if (res && res.length) return res;
    }

    if (window.BANNER_DATA) return window.BANNER_DATA;

    return [];
  }

  /* ================= RENDER ================= */
  function render() {

    root.innerHTML = `
      <div class="banner-viewport">
        <div class="banner-track">

          ${data.map((item) => `
            <div class="banner-slide">

              <div class="banner-box">

                <img src="${item.image}" class="banner-img"/>

                <div class="banner-overlay"></div>

                <div class="banner-content">

                  <div class="banner-site">
                    ${item.siteName || ""}
                  </div>

                  <!-- ================= CTA BUTTON ================= -->
                  ${
                    item.link
                      ? `<a class="banner-btn"
                           href="${item.link}"
                           target="_blank"
                           rel="noopener noreferrer"
                           data-external="true">
                           ${item.buttonText || "Play Now"}
                         </a>`
                      : ""
                  }

                </div>

              </div>

            </div>
          `).join("")}

        </div>
      </div>

      <div class="banner-dots">
        ${data.map((_, i) => `
          <span class="dot ${i === index ? "active" : ""}"></span>
        `).join("")}
      </div>

      <div class="banner-divider"></div>
    `;

    track = root.querySelector(".banner-track");
    updatePosition();
  }

  /* ================= POSITION ================= */
  function updatePosition() {
    if (!track) return;
    track.style.transform = `translateX(-${index * 100}%)`;
  }

  /* ================= NAV ================= */
  function next() {
    index = (index + 1) % data.length;
    updatePosition();
    updateDots();
  }

  function prev() {
    index = (index - 1 + data.length) % data.length;
    updatePosition();
    updateDots();
  }

  function updateDots() {
    const dots = root.querySelectorAll(".dot");
    dots.forEach((d, i) => {
      d.classList.toggle("active", i === index);
    });
  }

  /* ================= AUTO ================= */
  function startAuto() {
    stopAuto();
    timer = setInterval(next, 6000);
  }

  function stopAuto() {
    if (timer) clearInterval(timer);
  }

  /* ================= EVENTS ================= */
  function bindEvents() {

    const viewport = root.querySelector(".banner-viewport");
    if (!viewport) return;

    /* ================= SWIPE ================= */
    viewport.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      stopAuto();
    });

    viewport.addEventListener("touchend", (e) => {

      const endX = e.changedTouches[0].clientX;
      const diff = startX - endX;

      if (Math.abs(diff) > 40) {
        if (diff > 0) next();
        else prev();
      }

      startAuto();
    });

    /* ================= CLICK SAFETY LAYER (NEW) ================= */
    root.addEventListener("click", (e) => {

      const link = e.target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href) return;

      // allow router to decide in future
      if (window.Router?.handleExternalClick) {
        window.Router.handleExternalClick(e, href);
      }

    }, true);

  }

  return { init };

})();

window.Banner = Banner;