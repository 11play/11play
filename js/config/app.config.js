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
    defaultTitle: "11Play | Official Website",
    defaultDescription: "11Play is the official Smart Web Access platform for trusted gaming-site access, account services, reviews, app access and special offers.",
    keywords: [
      "11Play",
      "11 Play",
      "11Play Smart Web Access",
      "11Play Official Website",
      "11Play App",
      "11Play Account",
      "11Play Reviews",
      "11Play Offers"
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
