window.AppConfig = {

  /* =========================
     🌐 APP BASIC INFO
  ========================= */
  appName: "11Play",
  shortName: "11Play",
  tagline: "Smart Web Access",
  version: "1.0.0",

  baseUrl: "https://11play.github.io/11play/",

  /* =========================
     🔍 SEO CONFIG
  ========================= */
  seo: {
    defaultTitle: "11Play | Smart Web Access",

    defaultDescription:
      "11Play is a Smart Web Access platform that brings gaming-site access, user support, optional Google profiles and promotional offers together in one place.",

    keywords: [
      "11Play",
      "11play",
      "11 Play",
      "11Play Smart Web Access",
      "11play smart web access",
      "১১প্লে",
      "স্মার্ট ওয়েব এক্সেস"
    ],

    brand: {
      name: "11Play",
      subtitle: "Smart Web Access",

      alternateNames: [
        "11play",
        "11 Play",
        "১১প্লে",
        "স্মার্ট ওয়েব এক্সেস"
      ]
    }
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

    // Internal SPA routes only
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

    // External domains allowed in app context
    externalAllowed: [
      "youtube.com",
      "facebook.com",
      "instagram.com"
    ],

    // Payment / sensitive-destination detection only.
    // 11Play itself does not process deposits,
    // withdrawals, banking or cash transactions.
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

    // browser | app-webview
    openExternalIn: "browser",

    forceSPAInternal: true
  }

};