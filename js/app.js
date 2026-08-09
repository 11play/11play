(function () {

  console.log("🚀 APP BOOT START");

  function waitForCore(callback) {

    const check = () => {

      if (
        window.Router &&
        window.State &&
        window.Events &&
        window.Utils &&
        window.ProfileService
      ) {
        callback();
      } else {
        setTimeout(check, 50);
      }

    };

    check();
  }

  function init() {

    try {

      console.log("⚙️ INIT CORE SYSTEM");

      // CORE INIT
      window.State?.init?.();
      window.Events?.init?.();
      window.Utils?.init?.();

      // LAYOUT
      window.Shell?.init?.();
      window.Topbar?.init?.();
      window.Navbar?.init?.();
      window.Menu?.init?.();

      // ROUTER INIT (CRITICAL)
      window.Router?.init?.();

      // SAFE DEFAULT ROUTE
      setTimeout(() => {
        window.Router?.navigate?.("home", true);
      }, 100);

      console.log("✅ APP READY");

    } catch (e) {
      console.error("❌ APP BOOT ERROR:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    waitForCore(init);
  });

})();
