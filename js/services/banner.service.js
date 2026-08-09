
const BannerService = (() => {

  async function getBanners() {
    return await window.FirebaseService.getBanners();
  }

  return { getBanners };

})();

window.BannerService = BannerService;
