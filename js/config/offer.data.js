"use strict";

/* =========================================================
   11PLAY — OFFER DATA CONFIGURATION
   File: js/config/offer.data.js

   Current Offer:
   - New user 500 BDT cash bonus
   - Site link must be collected from Live Chat first
   - Registration must be completed on the provided site
   - OTP verification is required
   - Full account requirements must be completed
   - The mobile number must support Nagad / bKash / Rocket
   - Offer must be claimed through Live Chat

   Important:
   - File-controlled only
   - No Firebase dependency
   - No referral tracking
   - No wallet/reward system
========================================================= */

(() => {
    "use strict";

    const OFFER_DATA =
        Object.freeze({

            /* =============================================
               OFFER STATE
            ============================================= */

            enabled:
                true,

            id:
                "11play-500-bdt-new-user-offer",

            /* =============================================
               MAIN CONTENT
            ============================================= */

            title:
                "নতুন ইউজারের জন্য ৫০০৳ ক্যাশ বোনাস",

            description:
                "নতুন ইউজার শর্ত পূরণ করে রেজিস্ট্রেশন সম্পন্ন করলে 11Play থেকে ৫০০৳ ক্যাশ বোনাস পেতে পারবেন। অফার গ্রহণের আগে অবশ্যই Live Chat-এ যোগাযোগ করে নির্ধারিত সাইটের লিংক নিতে হবে।",

            /* =============================================
               OFFER IMAGE
            ============================================= */

            image:
                "assets/images/offers/11play-500-bdt-offer.png",

            imageAlt:
                "11Play নতুন ইউজারের জন্য ৫০০ টাকা ক্যাশ বোনাস অফার",

            /* =============================================
               RULES / HOW TO CLAIM
            ============================================= */

            rules:
                Object.freeze([
                    "প্রথমে 11Play Live Chat-এ যোগাযোগ করে অফারের জন্য নির্ধারিত সাইটের লিংক নিতে হবে।",

                    "Live Chat থেকে দেওয়া লিংকের মাধ্যমে নতুন একাউন্ট রেজিস্ট্রেশন করতে হবে।",

                    "একাউন্টের OTP verification সম্পূর্ণ করতে হবে।",

                    "সাইটের প্রয়োজনীয় account information ও registration requirements সম্পূর্ণ করতে হবে।",

                    "রেজিস্ট্রেশনে এমন মোবাইল নাম্বার ব্যবহার করতে হবে যেটিতে Nagad, bKash অথবা Rocket মোবাইল ব্যাংকিং সুবিধা রয়েছে।",

                    "রেজিস্ট্রেশন সম্পন্ন করার পর ৫০০৳ অফার claim করার জন্য আবার 11Play Live Chat-এ যোগাযোগ করতে হবে।",

                    "অফারটি শুধুমাত্র শর্ত পূরণকারী নতুন ইউজারের জন্য প্রযোজ্য।"
                ]),

            /* =============================================
               IMPORTANT NOTE
            ============================================= */

            note:
                "Live Chat থেকে সাইটের লিংক নেওয়ার আগে রেজিস্ট্রেশন করবেন না। ৫০০৳ ক্যাশ বোনাস পেতে সব শর্ত পূরণ এবং Live Chat-এর মাধ্যমে offer claim সম্পন্ন করতে হবে।",

            /* =============================================
               REGISTER ACTION

               Direct registration URL intentionally নেই।
               User must collect the current site link
               through Live Chat first.
            ============================================= */

            button:
                Object.freeze({
                    label:
                        "Live Chat থেকে সাইটের লিংক নিন",

                    url:
                        "",

                    openInNewTab:
                        true
                }),

            /* =============================================
               LIVE CHAT ACTION
            ============================================= */

            liveChat:
                Object.freeze({
                    label:
                        "Offer Claim — Live Chat",

                    page:
                        "live-chat"
                })
        });

    /* =====================================================
       GLOBAL EXPORT
    ===================================================== */

    window.OfferData =
        OFFER_DATA;
})();