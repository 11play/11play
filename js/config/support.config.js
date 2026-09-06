"use strict";

/* =========================================================
   11PLAY — SUPPORT / LIVE CHAT CONFIGURATION
   File: js/config/support.config.js

   Responsibilities:
   - Store 11Play Live Chat display configuration
   - Keep support text file-controlled
   - Provide Live Chat page title, description and topics
   - Allow support-content changes through normal Git commits
   - Keep Live Chat independent from Firebase

   Current Live Chat provider:
   - tawk.to

   Important:
   - This file contains configuration data only
   - tawk.to loading/opening is handled by:
     js/account/live-chat/live-chat.module.js
   - No external chat URL is required here
   - No Firebase read/write occurs here
   - No Firebase Cloud Functions are used here
   - No authentication logic occurs here
   - No referral/reward/wallet logic occurs here
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       SUPPORT CONFIGURATION
    ===================================================== */

    const SUPPORT_CONFIG =
        Object.freeze({
            /* ---------------------------------------------
               LIVE CHAT STATE

               true  = Live Chat page/button is available
               false = Live Chat unavailable state is shown
            --------------------------------------------- */

            enabled:
                true,

            /* ---------------------------------------------
               PROVIDER INFORMATION

               Display/configuration metadata only.
               The actual tawk.to Property ID and Widget ID
               remain inside live-chat.module.js.
            --------------------------------------------- */

            provider:
                "tawk",

            /* ---------------------------------------------
               PAGE INFORMATION
            --------------------------------------------- */

            title:
                "11Play Live Chat",

            subtitle:
                "Need help? Contact our support team.",

            description:
                "Use Live Chat to contact 11Play support for assistance with offers, account information, mobile number support, or general questions.",

            /* ---------------------------------------------
               BUTTON
            --------------------------------------------- */

            button:
                Object.freeze({
                    label:
                        "Start Live Chat"
                }),

            /* ---------------------------------------------
               SUPPORT AVAILABILITY TEXT

               Display text only.
               No guaranteed response time is claimed.
            --------------------------------------------- */

            availability:
                Object.freeze({
                    title:
                        "11Play Support",

                    text:
                        "Start Live Chat whenever you need assistance."
                }),

            /* ---------------------------------------------
               SUPPORT TOPICS
            --------------------------------------------- */

            topics:
                Object.freeze([
                    "500 BDT Offer information",

                    "How to start or claim the Offer",

                    "Account assistance",

                    "Mobile number assistance",

                    "Registration or target-site guidance",

                    "General 11Play support"
                ]),

            /* ---------------------------------------------
               IMPORTANT NOTE
            --------------------------------------------- */

            note:
                "For the current 500 BDT new-user Offer, contact 11Play Live Chat before registering through the supplied target-site link. Never send your password, PIN, OTP, recovery code, or other private authentication information."
        });

    /* =====================================================
       GLOBAL EXPORT
    ===================================================== */

    window.SupportConfig =
        SUPPORT_CONFIG;
})();