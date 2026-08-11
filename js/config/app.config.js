window.AppConfig = {

  /* =========================
     🌐 APP BASIC INFO
  ========================= */
  appName: "11Play",
  shortName: "11play",
  version: "1.0.0",

  baseUrl: "https://11play.github.io/11play/",

  /* =========================
     🔍 SEO CONFIG
  ========================= */
  seo: {
    defaultTitle: "11Play - Smart Web Access",
    defaultDescription: "11Play - News, Casino, Login and Smart Updates Platform",
    keywords: [
      "11Play",
      "Play11",
      "web11",
      "11hub",
      "50web",
      "11 Play",
      "casino",
      "bet",
      "login",
      "news",
      "1111",
      "one web"
    ]
  },

  /* =========================
     📰 NEWS CONFIG
  ========================= */
  news: {
    pageSize: 10,
    excerptLength: 120,
    enableLazyLoad: true
  },

  /* =========================
     🎨 UI CONFIG
  ========================= */
  ui: {
    theme: "dark",
    primaryColor: "#0b66ff",
    enableAnimations: true
  },

  /* =========================
     🔥 FIREBASE FLAGS
  ========================= */
  firebase: {
    enableAuth: true,
    enableFirestore: true
  },

  /* =========================
     ⚙️ FEATURE FLAGS
  ========================= */
  features: {
    newsFeed: true,
    casinoModule: true,
    profileSystem: true,
    offerSystem: true,
    liveChat: true,
    inviteShare: true,
    favorites: true,
    history: true
  },

  /* =========================
     🚦 NAVIGATION RULES
  ========================= */
  navigation: {

    // internal SPA routes only
    internalRoutes: [
      "home",
      "news",
      "search",
      "favorites",
      "history",
      "profile",
      "offer",
      "live-chat"
    ],

    // external domains allowed in app context
    externalAllowed: [
      "youtube.com",
      "facebook.com",
      "instagram.com"
    ],

    // payment / sensitive detection keywords
    paymentKeywords: [
      "payment",
      "pay",
      "checkout",
      "bank",
      "upi",
      "stripe",
      "paypal",
      "wallet"
    ],

    // behavior rules
    openExternalIn: "browser", // browser | app-webview (future android control)
    forceSPAInternal: true
  }

};