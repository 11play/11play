"use strict";

/* =========================================================
   11PLAY — PRODUCTION VALIDATOR
   File: scripts/validate-production.js

   Purpose:
   - Fail CI before deployment when production-critical
     files, URLs, assets, Firestore configuration, HTML
     references, JSON/JSON-LD, sitemap entries or generated
     review files are inconsistent.
   - Validate the current Firebase Spark architecture.
   - Validate the current Profile + Offer Paid Admin system.
   - Validate the current tawk.to Live Chat integration.
   - Reject references to removed legacy account systems.
   - Keep the deferred APK completely untouched/uninspected.

   Current account architecture:
   - Verified Google authentication
   - profileUsers/{uid}
   - profileEmails/{email}
   - profileOfferStatus/{uid}
   - Firebase Spark / direct Firestore
   - No deployed Cloud Functions
   - No referral system
   - No reward wallet
   - No withdrawal system
   - No activity/device qualification system

   Current Live Chat architecture:
   - tawk.to hosted chat
   - Lazy-loaded from LiveChatModule
   - No Firebase chat collection
   - No external chatUrl configuration
   - No new-tab Live Chat navigation

   Node.js 22+
   No external npm package required.
========================================================= */

const fs =
    require("node:fs");

const path =
    require("node:path");

const vm =
    require("node:vm");

/* =========================================================
   GLOBAL CONFIGURATION
========================================================= */

const ROOT =
    path.resolve(
        __dirname,
        ".."
    );

const BASE_URL =
    "https://11play.github.io/11play";

const CANONICAL_HOME =
    `${BASE_URL}/`;

const ADMIN_EMAIL =
    "casinobuzzbd@gmail.com";

const TAWK_PROPERTY_ID =
    "6a7b56cdc010c21d4b633898";

const TAWK_WIDGET_ID =
    "1jvosm4vd";

const TAWK_HOST =
    "https://embed.tawk.to/";

const CONFIG =
    Object.freeze({
        telegram:
            "https://t.me/play11play",

        website:
            CANONICAL_HOME,

        youtube:
            "https://youtube.com/@11play-app",

        socialPages:
            Object.freeze([
                "whatsapp",
                "facebook",
                "twitter"
            ]),

        ignoredDirectories:
            new Set([
                ".git",
                ".firebase",
                "node_modules",
                "_site",
                "functions",
                "tests"
            ]),

        ignoredFiles:
            new Set([
                "11play.apk"
            ]),

        templateFiles:
            new Set([
                "reviews/index.template.html",
                "reviews/review-template.html"
            ]),

        requiredFiles:
            Object.freeze([
                /* -------------------------
                   Root production surface
                ------------------------- */

                "index.html",
                "manifest.json",
                "robots.txt",
                "sitemap.xml",

                /* -------------------------
                   Firebase
                ------------------------- */

                "firebase.json",
                "firestore.rules",
                "firestore.indexes.json",
                ".firebaserc",

                /* -------------------------
                   Main configuration
                ------------------------- */

                "js/config/firebase.config.js",
                "js/config/app.config.js",
                "js/config/menu.config.js",
                "js/config/banner.data.js",
                "js/config/offer.data.js",
                "js/config/support.config.js",

                /* -------------------------
                   Main shared client
                ------------------------- */

                "js/core/router.js",
                "js/core/share.js",

                "js/services/firebase.service.js",
                "js/services/auth.service.js",
                "js/services/profile.service.js",

                "js/account/shared/auth.guard.js",

                "js/account/firebase/functions.client.js",
                "js/account/firebase/profile.db.js",

                /* -------------------------
                   Profile
                ------------------------- */

                "js/account/profile/avatar.js",
                "js/account/profile/username.js",
                "js/account/profile/profile.view.js",
                "js/account/profile/profile.ui.js",
                "js/account/profile/profile.module.js",

                /* -------------------------
                   Offer
                ------------------------- */

                "js/account/offer/offer.view.js",
                "js/account/offer/offer.module.js",

                /* -------------------------
                   Live Chat
                ------------------------- */

                "js/account/live-chat/live-chat.view.js",
                "js/account/live-chat/live-chat.module.js",

                "js/account/router.js",

                /* -------------------------
                   Offer assets
                ------------------------- */

                "assets/images/offers/11play-500-bdt-offer.png",
                "assets/seo/11play-500-bdt-offer-share.png",

                /* -------------------------
                   Public pages
                ------------------------- */

                "pages/about.html",
                "pages/privacy-policy.html",
                "pages/terms.html",
                "pages/contact.html",

                /* -------------------------
                   Admin
                ------------------------- */

                "admin/index.html",
                "admin/css/admin.css",
                "admin/js/admin.api.js",
                "admin/js/admin.auth.js",
                "admin/js/admin.users.js",
                "admin/js/admin.app.js",

                /* -------------------------
                   Reviews
                ------------------------- */

                "reviews/index.html",
                "reviews/index.template.html",
                "reviews/review.css",
                "reviews/review-search.js",
                "reviews/assets/megacricketworld.webp",

                /* -------------------------
                   Build / CI
                ------------------------- */

                "scripts/build-reviews.js",
                "scripts/validate-production.js",
                ".github/workflows/build-reviews.yml",
                "package.json"
            ]),

        /*
         * These files belong to removed systems.
         *
         * Validation fails if they are reintroduced into
         * the production tree.
         */

        obsoleteFiles:
            Object.freeze([
                /* Empty compatibility files removed */

                "js/core/state.js",
                "js/core/events.js",
                "js/core/utils.js",
                "js/services/api.service.js",

                /* Removed account database modules */

                "js/account/firebase/activity.db.js",
                "js/account/firebase/referral.db.js",
                "js/account/firebase/reward.db.js",
                "js/account/firebase/wallet.db.js",
                "js/account/firebase/withdraw.db.js",

                /* Removed referral modules */

                "js/account/referral/referral.capture.js",

                /* Removed Admin feature modules */

                "admin/js/admin.referrals.js",
                "admin/js/admin.withdrawals.js",
                "admin/js/admin.transactions.js"
            ]),

        jsonFiles:
            Object.freeze([
                "manifest.json",
                "firebase.json",
                "firestore.indexes.json",
                ".firebaserc",
                "package.json"
            ])
    });

/* =========================================================
   VALIDATION STATE
========================================================= */

let errorCount =
    0;

let warningCount =
    0;

let checkCount =
    0;

/* =========================================================
   LOGGING
========================================================= */

function info(message) {
    console.log(
        `[Production Validator] ${message}`
    );
}

function pass(message) {
    checkCount +=
        1;

    console.log(
        `[PASS] ${message}`
    );
}

function warn(message) {
    warningCount +=
        1;

    console.warn(
        `[WARN] ${message}`
    );
}

function fail(message) {
    errorCount +=
        1;

    console.error(
        `[FAIL] ${message}`
    );
}

/* =========================================================
   PATH / FILE HELPERS
========================================================= */

function absolute(relativePath) {
    return path.resolve(
        ROOT,
        relativePath
    );
}

function relative(filePath) {
    return path
        .relative(
            ROOT,
            filePath
        )
        .split(
            path.sep
        )
        .join("/");
}

function exists(relativePath) {
    return fs.existsSync(
        absolute(
            relativePath
        )
    );
}

function isFile(relativePath) {
    try {
        return fs
            .statSync(
                absolute(
                    relativePath
                )
            )
            .isFile();
    } catch {
        return false;
    }
}

function read(relativePath) {
    return fs.readFileSync(
        absolute(
            relativePath
        ),
        "utf8"
    );
}

function normalizeRelative(value) {
    return String(
        value ||
        ""
    )
        .split(
            path.sep
        )
        .join("/")
        .replace(
            /^\.\//,
            ""
        );
}

function shouldIgnore(relativePath) {
    const normalized =
        normalizeRelative(
            relativePath
        );

    if (
        CONFIG.ignoredFiles.has(
            normalized
        )
    ) {
        return true;
    }

    const parts =
        normalized.split("/");

    return parts.some(
        part =>
            CONFIG
                .ignoredDirectories
                .has(
                    part
                )
    );
}

function walk(
    directory = ROOT
) {
    const output =
        [];

    for (
        const entry
        of fs.readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )
    ) {
        const fullPath =
            path.join(
                directory,
                entry.name
            );

        const relativePath =
            relative(
                fullPath
            );

        if (
            shouldIgnore(
                relativePath
            )
        ) {
            continue;
        }

        if (
            entry.isDirectory()
        ) {
            output.push(
                ...walk(
                    fullPath
                )
            );

            continue;
        }

        if (
            entry.isFile()
        ) {
            output.push(
                relativePath
            );
        }
    }

    return output.sort();
}

function stripQueryAndHash(value) {
    return String(
        value ||
        ""
    )
        .split(
            "#",
            1
        )[0]
        .split(
            "?",
            1
        )[0]
        .trim();
}

function isExternalReference(value) {
    return (
        /^(?:https?:)?\/\//i.test(
            value
        ) ||
        /^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(
            value
        )
    );
}

function resolveLocalReference(
    sourceFile,
    reference
) {
    const cleanReference =
        stripQueryAndHash(
            reference
        );

    if (
        !cleanReference ||
        cleanReference ===
            "."
    ) {
        return null;
    }

    if (
        cleanReference.startsWith(
            "#"
        ) ||
        isExternalReference(
            cleanReference
        )
    ) {
        return null;
    }

    let resolved;

    if (
        cleanReference.startsWith(
            "/11play/"
        )
    ) {
        resolved =
            path.resolve(
                ROOT,

                decodeURIComponent(
                    cleanReference.slice(
                        "/11play/"
                            .length
                    )
                )
            );
    } else if (
        cleanReference ===
            "/11play" ||
        cleanReference ===
            "/11play/"
    ) {
        resolved =
            ROOT;
    } else if (
        cleanReference.startsWith(
            "/"
        )
    ) {
        return {
            invalidRootRelative:
                true,

            reference:
                cleanReference
        };
    } else {
        resolved =
            path.resolve(
                path.dirname(
                    absolute(
                        sourceFile
                    )
                ),

                decodeURIComponent(
                    cleanReference
                )
            );
    }

    const rootPrefix =
        `${ROOT}${path.sep}`;

    if (
        resolved !==
            ROOT &&
        !resolved.startsWith(
            rootPrefix
        )
    ) {
        return {
            outsideRoot:
                true,

            reference:
                cleanReference,

            resolved
        };
    }

    return {
        reference:
            cleanReference,

        resolved
    };
}

function localTargetExists(
    resolution
) {
    if (
        !resolution ||
        resolution.invalidRootRelative ||
        resolution.outsideRoot
    ) {
        return false;
    }

    if (
        !fs.existsSync(
            resolution.resolved
        )
    ) {
        return false;
    }

    const stats =
        fs.statSync(
            resolution.resolved
        );

    if (
        stats.isDirectory()
    ) {
        return fs.existsSync(
            path.join(
                resolution.resolved,
                "index.html"
            )
        );
    }

    return stats.isFile();
}

function isNonEmptyFile(
    relativePath
) {
    if (
        !isFile(
            relativePath
        )
    ) {
        return false;
    }

    return (
        fs
            .statSync(
                absolute(
                    relativePath
                )
            )
            .size >
        0
    );
}

/* =========================================================
   JAVASCRIPT COMMENT STRIPPING
========================================================= */

function stripJavaScriptComments(
    source
) {
    const input =
        String(
            source ||
            ""
        );

    let output =
        "";

    let state =
        "code";

    let escaped =
        false;

    for (
        let index =
            0;

        index <
            input.length;

        index +=
            1
    ) {
        const current =
            input[index];

        const next =
            input[
                index +
                1
            ];

        if (
            state ===
            "line-comment"
        ) {
            if (
                current ===
                "\n"
            ) {
                output +=
                    "\n";

                state =
                    "code";
            } else {
                output +=
                    " ";
            }

            continue;
        }

        if (
            state ===
            "block-comment"
        ) {
            if (
                current ===
                    "*" &&
                next ===
                    "/"
            ) {
                output +=
                    "  ";

                index +=
                    1;

                state =
                    "code";

                continue;
            }

            output +=
                current ===
                    "\n"
                    ? "\n"
                    : " ";

            continue;
        }

        if (
            state ===
            "single-string"
        ) {
            output +=
                current;

            if (
                escaped
            ) {
                escaped =
                    false;

                continue;
            }

            if (
                current ===
                "\\"
            ) {
                escaped =
                    true;

                continue;
            }

            if (
                current ===
                "'"
            ) {
                state =
                    "code";
            }

            continue;
        }

        if (
            state ===
            "double-string"
        ) {
            output +=
                current;

            if (
                escaped
            ) {
                escaped =
                    false;

                continue;
            }

            if (
                current ===
                "\\"
            ) {
                escaped =
                    true;

                continue;
            }

            if (
                current ===
                '"'
            ) {
                state =
                    "code";
            }

            continue;
        }

        if (
            state ===
            "template-string"
        ) {
            output +=
                current;

            if (
                escaped
            ) {
                escaped =
                    false;

                continue;
            }

            if (
                current ===
                "\\"
            ) {
                escaped =
                    true;

                continue;
            }

            if (
                current ===
                "`"
            ) {
                state =
                    "code";
            }

            continue;
        }

        if (
            current ===
                "/" &&
            next ===
                "/"
        ) {
            output +=
                "  ";

            index +=
                1;

            state =
                "line-comment";

            continue;
        }

        if (
            current ===
                "/" &&
            next ===
                "*"
        ) {
            output +=
                "  ";

            index +=
                1;

            state =
                "block-comment";

            continue;
        }

        if (
            current ===
            "'"
        ) {
            output +=
                current;

            state =
                "single-string";

            escaped =
                false;

            continue;
        }

        if (
            current ===
            '"'
        ) {
            output +=
                current;

            state =
                "double-string";

            escaped =
                false;

            continue;
        }

        if (
            current ===
            "`"
        ) {
            output +=
                current;

            state =
                "template-string";

            escaped =
                false;

            continue;
        }

        output +=
            current;
    }

    return output;
}

/* =========================================================
   REQUIRED / OBSOLETE FILES
========================================================= */

function validateRequiredFiles() {
    const missing =
        [];

    const empty =
        [];

    for (
        const file
        of CONFIG.requiredFiles
    ) {
        if (
            !isFile(
                file
            )
        ) {
            missing.push(
                file
            );

            continue;
        }

        if (
            !isNonEmptyFile(
                file
            )
        ) {
            empty.push(
                file
            );
        }
    }

    if (
        missing.length
    ) {
        fail(
            `Required production files missing:\n- ${missing.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "All required production files are present."
        );
    }

    if (
        empty.length
    ) {
        fail(
            `Required production files are empty:\n- ${empty.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Required production files are non-empty."
        );
    }
}

function validateObsoleteFilesRemoved() {
    const found =
        CONFIG.obsoleteFiles
            .filter(
                file =>
                    exists(
                        file
                    )
            );

    if (
        found.length
    ) {
        fail(
            `Removed/obsolete production files still exist:\n- ${found.join(
                "\n- "
            )}`
        );

        return;
    }

    pass(
        "Removed legacy and empty compatibility files are absent."
    );
}

/* =========================================================
   JSON VALIDATION
========================================================= */

function parseJsonFile(file) {
    try {
        return JSON.parse(
            read(
                file
            )
        );
    } catch (error) {
        fail(
            `${file} contains invalid JSON: ${error.message}`
        );

        return null;
    }
}

function validateJsonFiles() {
    let valid =
        true;

    for (
        const file
        of CONFIG.jsonFiles
    ) {
        if (
            !exists(
                file
            )
        ) {
            valid =
                false;

            continue;
        }

        try {
            JSON.parse(
                read(
                    file
                )
            );
        } catch (error) {
            valid =
                false;

            fail(
                `${file} contains invalid JSON: ${error.message}`
            );
        }
    }

    if (
        valid
    ) {
        pass(
            "Production JSON files parse successfully."
        );
    }
}

/* =========================================================
   FIREBASE CONFIGURATION
========================================================= */

function validateFirebaseConfigFiles() {
    const firebase =
        parseJsonFile(
            "firebase.json"
        );

    const firebaserc =
        parseJsonFile(
            ".firebaserc"
        );

    const indexes =
        parseJsonFile(
            "firestore.indexes.json"
        );

    if (
        !firebase ||
        !firebaserc ||
        !indexes
    ) {
        return;
    }

    if (
        firebase
            ?.firestore
            ?.rules !==
            "firestore.rules" ||
        firebase
            ?.firestore
            ?.indexes !==
            "firestore.indexes.json"
    ) {
        fail(
            "firebase.json must point Firestore to firestore.rules and firestore.indexes.json."
        );
    } else {
        pass(
            "firebase.json Firestore source paths are correct."
        );
    }

    if (
        firebaserc
            ?.projects
            ?.default !==
        "web11-one"
    ) {
        fail(
            '.firebaserc default Firebase project must be "web11-one".'
        );
    } else {
        pass(
            "Firebase default project is web11-one."
        );
    }

    if (
        !Array.isArray(
            indexes.indexes
        )
    ) {
        fail(
            "firestore.indexes.json must contain an indexes array."
        );
    } else if (
        indexes.indexes.length !==
        0
    ) {
        fail(
            "Current 11Play architecture must not require composite Firestore indexes."
        );
    } else {
        pass(
            "No composite Firestore indexes are configured."
        );
    }

    if (
        !Array.isArray(
            indexes.fieldOverrides
        )
    ) {
        fail(
            "firestore.indexes.json must contain a fieldOverrides array."
        );
    } else if (
        indexes.fieldOverrides.length !==
        0
    ) {
        warn(
            `firestore.indexes.json contains ${indexes.fieldOverrides.length} field override(s).`
        );
    } else {
        pass(
            "No Firestore field overrides are configured."
        );
    }
}

/* =========================================================
   FIRESTORE RULES CONTRACT
========================================================= */

function validateFirestoreRulesContract() {
    const rules =
        read(
            "firestore.rules"
        );

    const requiredTokens = [
        "rules_version = '2'",
        "profileUsers",
        "profileEmails",
        "profileOfferStatus",
        ADMIN_EMAIL,
        "google.com",
        "schemaVersion"
    ];

    const missing =
        requiredTokens.filter(
            token =>
                !rules.includes(
                    token
                )
        );

    if (
        missing.length
    ) {
        fail(
            `firestore.rules is missing current production contract token(s):\n- ${missing.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Firestore Rules contain the current Profile/Email/Offer contract."
        );
    }

    const legacyMatchPatterns = [
        /match\s+\/profileReferralCodes\b/,
        /match\s+\/profileMobiles\b/,
        /match\s+\/profileDevices\b/,
        /match\s+\/profileReferrals\b/,
        /match\s+\/profileReferralStats\b/,
        /match\s+\/profileActivity\b/,
        /match\s+\/profileWallets\b/,
        /match\s+\/profileWalletTransactions\b/,
        /match\s+\/profileRewardEvents\b/,
        /match\s+\/profileWithdrawals\b/,
        /match\s+\/profileAuditLogs\b/
    ];

    const foundLegacy =
        legacyMatchPatterns
            .filter(
                pattern =>
                    pattern.test(
                        rules
                    )
            )
            .map(
                pattern =>
                    pattern.source
            );

    if (
        foundLegacy.length
    ) {
        fail(
            "firestore.rules still contains explicit legacy account collection rules."
        );
    } else {
        pass(
            "Firestore Rules do not explicitly authorize removed legacy account collections."
        );
    }

    if (
        !rules.includes(
            "isMobileLocked"
        ) ||
        !rules.includes(
            "mobileLocked"
        )
    ) {
        fail(
            "Firestore Rules must enforce the current one-time mobile lock fields."
        );
    } else {
        pass(
            "Firestore Rules contain current one-time mobile lock enforcement."
        );
    }
}

/* =========================================================
   MANIFEST / ROBOTS
========================================================= */

function validateManifest() {
    const manifest =
        parseJsonFile(
            "manifest.json"
        );

    if (
        !manifest
    ) {
        return;
    }

    if (
        manifest.start_url !==
        "/11play/"
    ) {
        fail(
            'manifest.json start_url must be "/11play/".'
        );
    } else {
        pass(
            "Manifest start_url matches GitHub Project Pages path."
        );
    }

    if (
        manifest.scope !==
        "/11play/"
    ) {
        fail(
            'manifest.json scope must be "/11play/".'
        );
    } else {
        pass(
            "Manifest scope matches GitHub Project Pages path."
        );
    }

    const icons =
        Array.isArray(
            manifest.icons
        )
            ? manifest.icons
            : [];

    if (
        !icons.length
    ) {
        fail(
            "manifest.json must define at least one app icon."
        );

        return;
    }

    const failures =
        [];

    for (
        const icon
        of icons
    ) {
        const source =
            String(
                icon?.src ||
                ""
            ).trim();

        const resolution =
            resolveLocalReference(
                "manifest.json",
                source
            );

        if (
            !resolution ||
            !localTargetExists(
                resolution
            )
        ) {
            failures.push(
                source ||
                "(empty)"
            );
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Manifest icon files are missing:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Manifest icon files exist."
        );
    }
}

function validateRobots() {
    const robots =
        read(
            "robots.txt"
        );

    const expected =
        `Sitemap: ${BASE_URL}/sitemap.xml`;

    if (
        !robots.includes(
            expected
        )
    ) {
        fail(
            `robots.txt must contain: ${expected}`
        );
    } else {
        pass(
            "robots.txt points to the canonical sitemap."
        );
    }
}

/* =========================================================
   MENU CONFIG
========================================================= */

function loadMenuConfig() {
    const sandbox = {
        window: {}
    };

    vm.createContext(
        sandbox
    );

    try {
        vm.runInContext(
            read(
                "js/config/menu.config.js"
            ),

            sandbox,

            {
                filename:
                    "js/config/menu.config.js",

                timeout:
                    1000
            }
        );
    } catch (error) {
        fail(
            `js/config/menu.config.js could not be evaluated: ${error.message}`
        );

        return null;
    }

    if (
        !Array.isArray(
            sandbox
                .window
                .MenuConfig
        )
    ) {
        fail(
            "window.MenuConfig must be an array."
        );

        return null;
    }

    return sandbox
        .window
        .MenuConfig;
}

function findMenuItem(
    menu,
    page
) {
    return (
        menu.find(
            item =>
                item &&
                item.page ===
                    page
        ) ||
        null
    );
}

function isValidProductionHttpsUrl(
    value
) {
    const stringValue =
        String(
            value ||
            ""
        ).trim();

    if (
        !stringValue
    ) {
        return false;
    }

    try {
        const url =
            new URL(
                stringValue
            );

        return (
            url.protocol ===
                "https:" &&
            Boolean(
                url.hostname
            )
        );
    } catch {
        return false;
    }
}

function validateMenuConfig() {
    const menu =
        loadMenuConfig();

    if (
        !menu
    ) {
        return;
    }

    const exactUrlExpectations = {
        telegram:
            CONFIG.telegram,

        website:
            CONFIG.website,

        youtube:
            CONFIG.youtube
    };

    for (
        const [
            page,
            expectedUrl
        ]
        of Object.entries(
            exactUrlExpectations
        )
    ) {
        const item =
            findMenuItem(
                menu,
                page
            );

        if (
            !item
        ) {
            fail(
                `Menu item missing: ${page}`
            );

            continue;
        }

        if (
            String(
                item.url ||
                ""
            ) !==
            expectedUrl
        ) {
            fail(
                `Menu ${page} URL must be: ${expectedUrl}`
            );

            continue;
        }

        pass(
            `Menu ${page} URL is production-ready.`
        );
    }

    /*
     * WhatsApp / Facebook / Twitter are no longer expected
     * to remain blank. Their exact destination may change,
     * but each production menu entry must contain a real
     * HTTPS URL.
     */

    for (
        const page
        of CONFIG.socialPages
    ) {
        const item =
            findMenuItem(
                menu,
                page
            );

        if (
            !item
        ) {
            fail(
                `Menu item missing: ${page}`
            );

            continue;
        }

        const url =
            String(
                item.url ||
                ""
            ).trim();

        if (
            !isValidProductionHttpsUrl(
                url
            )
        ) {
            fail(
                `Menu ${page} must contain a valid production HTTPS URL.`
            );

            continue;
        }

        pass(
            `Menu ${page} contains a production HTTPS URL.`
        );
    }

    const apk =
        findMenuItem(
            menu,
            "download-apk"
        );

    if (
        !apk
    ) {
        fail(
            "Download APK menu item is missing."
        );
    } else if (
        String(
            apk.url ||
            ""
        ) !==
        "11play.apk"
    ) {
        fail(
            'Download APK menu path must remain exactly "11play.apk" during the deferred APK phase.'
        );
    } else {
        pass(
            "Deferred APK menu path remains unchanged."
        );
    }

    /*
     * Current Profile/Offer/Live Chat account menu items
     * must remain present.
     */

    for (
        const page
        of [
            "profile",
            "offer",
            "live-chat"
        ]
    ) {
        if (
            !findMenuItem(
                menu,
                page
            )
        ) {
            fail(
                `Current account menu item missing: ${page}`
            );
        } else {
            pass(
                `Current account menu item exists: ${page}`
            );
        }
    }

    /*
     * Removed financial/referral routes must not be exposed
     * in the menu.
     */

    const forbiddenPages =
        new Set([
            "referral",
            "referrals",
            "reward",
            "wallet",
            "withdraw",
            "withdrawal",
            "withdrawals",
            "activity"
        ]);

    const legacyItems =
        menu.filter(
            item =>
                forbiddenPages.has(
                    String(
                        item?.page ||
                        ""
                    )
                        .trim()
                        .toLowerCase()
                )
        );

    if (
        legacyItems.length
    ) {
        fail(
            `Removed account menu routes are still exposed: ${legacyItems
                .map(
                    item =>
                        item.page
                )
                .join(", ")}`
        );
    } else {
        pass(
            "No removed referral/wallet/withdrawal routes are exposed in the menu."
        );
    }
}

/* =========================================================
   ROOT HTML CONTRACT
========================================================= */

function validateRootHtmlContract() {
    const html =
        read(
            "index.html"
        );

    const requiredScripts = [
        "js/config/support.config.js",
        "js/core/router.js",
        "js/core/share.js",
        "js/services/firebase.service.js",
        "js/services/auth.service.js",
        "js/services/profile.service.js",
        "js/account/shared/auth.guard.js",
        "js/account/firebase/functions.client.js",
        "js/account/firebase/profile.db.js",
        "js/account/profile/profile.module.js",
        "js/account/offer/offer.module.js",
        "js/account/live-chat/live-chat.view.js",
        "js/account/live-chat/live-chat.module.js",
        "js/account/router.js"
    ];

    const missingScripts =
        requiredScripts.filter(
            script =>
                !html.includes(
                    script
                )
        );

    if (
        missingScripts.length
    ) {
        fail(
            `index.html is missing current production script reference(s):\n- ${missingScripts.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "index.html contains current Profile/Offer/Live Chat production scripts."
        );
    }

    const removedReferences = [
        "js/core/state.js",
        "js/core/events.js",
        "js/core/utils.js",
        "js/services/api.service.js"
    ];

    const foundRemoved =
        removedReferences.filter(
            reference =>
                html.includes(
                    reference
                )
        );

    if (
        foundRemoved.length
    ) {
        fail(
            `index.html still references deleted compatibility file(s):\n- ${foundRemoved.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "index.html no longer references deleted empty compatibility files."
        );
    }

    if (
        html.includes(
            "?ref="
        )
    ) {
        fail(
            'index.html must not expose legacy "?ref=" referral links.'
        );
    } else {
        pass(
            "index.html contains no legacy referral query parameter."
        );
    }

    if (
        !html.includes(
            "assets/seo/11play-500-bdt-offer-share.png"
        )
    ) {
        fail(
            "index.html must use the current 500 BDT Offer social-share image."
        );
    } else {
        pass(
            "index.html uses the current 500 BDT Offer share image."
        );
    }

    /*
     * The tawk.to widget is intentionally lazy-loaded from
     * LiveChatModule. The raw embed script must not be added
     * directly to index.html, otherwise a global floating
     * widget may appear outside the Live Chat workflow.
     */

    if (
        html.includes(
            TAWK_HOST
        )
    ) {
        fail(
            "index.html must not directly embed tawk.to. LiveChatModule must lazy-load the widget."
        );
    } else {
        pass(
            "index.html does not directly embed the tawk.to widget."
        );
    }
}

/* =========================================================
   SUPPORT / LIVE CHAT CONFIG
========================================================= */

function loadSupportConfig() {
    const sandbox = {
        window: {}
    };

    vm.createContext(
        sandbox
    );

    try {
        vm.runInContext(
            read(
                "js/config/support.config.js"
            ),

            sandbox,

            {
                filename:
                    "js/config/support.config.js",

                timeout:
                    1000
            }
        );
    } catch (error) {
        fail(
            `js/config/support.config.js could not be evaluated: ${error.message}`
        );

        return null;
    }

    const config =
        sandbox
            .window
            .SupportConfig;

    if (
        !config ||
        typeof config !==
            "object"
    ) {
        fail(
            "window.SupportConfig must be an object."
        );

        return null;
    }

    return config;
}

function validateLiveChatContract() {
    const config =
        loadSupportConfig();

    const view =
        read(
            "js/account/live-chat/live-chat.view.js"
        );

    const module =
        read(
            "js/account/live-chat/live-chat.module.js"
        );

    if (
        config
    ) {
        if (
            config.enabled !==
            true
        ) {
            fail(
                "SupportConfig.enabled must be true for production Live Chat."
            );
        } else {
            pass(
                "Production Live Chat is enabled."
            );
        }

        if (
            String(
                config.provider ||
                ""
            )
                .trim()
                .toLowerCase() !==
            "tawk"
        ) {
            fail(
                'SupportConfig.provider must be exactly "tawk".'
            );
        } else {
            pass(
                "SupportConfig uses the tawk provider."
            );
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    config,
                    "chatUrl"
                )
        ) {
            fail(
                "SupportConfig must not contain the removed external chatUrl setting."
            );
        } else {
            pass(
                "SupportConfig contains no legacy external chatUrl setting."
            );
        }

        if (
            config
                ?.button &&
            Object.prototype
                .hasOwnProperty
                .call(
                    config.button,
                    "openInNewTab"
                )
        ) {
            fail(
                "SupportConfig.button must not contain the removed Live Chat openInNewTab setting."
            );
        } else {
            pass(
                "SupportConfig contains no obsolete Live Chat new-tab configuration."
            );
        }

        if (
            !String(
                config
                    ?.button
                    ?.label ||
                ""
            ).trim()
        ) {
            fail(
                "SupportConfig.button.label must contain a production Live Chat button label."
            );
        } else {
            pass(
                "SupportConfig contains a Live Chat button label."
            );
        }
    }

    const requiredModuleTokens = [
        TAWK_PROPERTY_ID,
        TAWK_WIDGET_ID,
        TAWK_HOST,
        "showWidget",
        "hideWidget",
        "maximize",
        "Tawk_API",
        "loadTawkWidget"
    ];

    const missingModuleTokens =
        requiredModuleTokens.filter(
            token =>
                !module.includes(
                    token
                )
        );

    if (
        missingModuleTokens.length
    ) {
        fail(
            `LiveChatModule is missing required tawk.to integration token(s):\n- ${missingModuleTokens.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "LiveChatModule contains the required tawk.to integration."
        );
    }

    const forbiddenModuleTokens = [
        "config?.chatUrl",
        "config.chatUrl",
        "resolvedURL.href",
        "window.location.assign(",
        'window.open('
    ];

    const foundForbiddenModuleTokens =
        forbiddenModuleTokens.filter(
            token =>
                module.includes(
                    token
                )
        );

    if (
        foundForbiddenModuleTokens.length
    ) {
        fail(
            `LiveChatModule still contains removed external-URL navigation logic:\n- ${foundForbiddenModuleTokens.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "LiveChatModule contains no legacy external-chat navigation logic."
        );
    }

    const forbiddenViewTokens = [
        "chatUrl",
        "data-chat-url",
        "openInNewTab",
        "data-open-new-tab"
    ];

    const foundForbiddenViewTokens =
        forbiddenViewTokens.filter(
            token =>
                view.includes(
                    token
                )
        );

    if (
        foundForbiddenViewTokens.length
    ) {
        fail(
            `LiveChatView still contains removed external-chat configuration token(s):\n- ${foundForbiddenViewTokens.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "LiveChatView contains no legacy chatUrl/new-tab dependency."
        );
    }

    if (
        !view.includes(
            'data-chat-provider="tawk"'
        ) ||
        !view.includes(
            'data-live-chat-provider="tawk"'
        )
    ) {
        fail(
            "LiveChatView must identify tawk as the current Live Chat provider."
        );
    } else {
        pass(
            "LiveChatView identifies tawk as the Live Chat provider."
        );
    }

    const disclosurePages = [
        "pages/about.html",
        "pages/privacy-policy.html",
        "pages/terms.html",
        "pages/contact.html"
    ];

    const missingDisclosure =
        disclosurePages.filter(
            file =>
                !read(
                    file
                )
                    .toLowerCase()
                    .includes(
                        "tawk.to"
                    )
        );

    if (
        missingDisclosure.length
    ) {
        fail(
            `Current tawk.to Live Chat disclosure missing from public page(s):\n- ${missingDisclosure.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Public About/Privacy/Terms/Contact pages disclose the tawk.to Live Chat provider."
        );
    }
}

/* =========================================================
   SHARE CONTRACT
========================================================= */

function validateShareContract() {
    const content =
        read(
            "js/core/share.js"
        );

    const executableContent =
        stripJavaScriptComments(
            content
        );

    if (
        !content.includes(
            CANONICAL_HOME
        )
    ) {
        fail(
            `js/core/share.js must use canonical URL ${CANONICAL_HOME}`
        );
    } else {
        pass(
            "Share module uses the canonical 11Play URL."
        );
    }

    /*
     * Validate executable JavaScript only.
     *
     * Historical notes/comments are allowed to mention
     * removed referral behaviour without causing a false
     * production failure.
     */

    if (
        /\?ref=|referralCode|referredByCode/i.test(
            executableContent
        )
    ) {
        fail(
            "Share module still contains executable legacy referral-link logic."
        );
    } else {
        pass(
            "Share module contains no executable referral-code tracking logic."
        );
    }

    if (
        !content.includes(
            "11play-500-bdt-offer"
        )
    ) {
        warn(
            "Share module does not contain an obvious 500 BDT Offer asset reference."
        );
    } else {
        pass(
            "Share module references the current 500 BDT Offer asset."
        );
    }
}

/* =========================================================
   ADMIN HTML CONTRACT
========================================================= */

function validateAdminHtmlContract() {
    const html =
        read(
            "admin/index.html"
        );

    const requiredScripts = [
        "./js/admin.api.js",
        "./js/admin.auth.js",
        "./js/admin.users.js",
        "./js/admin.app.js"
    ];

    const missing =
        requiredScripts.filter(
            script =>
                !html.includes(
                    script
                )
        );

    if (
        missing.length
    ) {
        fail(
            `admin/index.html is missing current Admin script(s):\n- ${missing.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Admin HTML loads API, Auth, Users and App modules."
        );
    }

    const forbiddenReferences = [
        "admin.referrals.js",
        "admin.withdrawals.js",
        "admin.transactions.js",
        'data-admin-route="referrals"',
        'data-admin-route="withdrawals"',
        'data-admin-route="transactions"',
        'data-admin-page="referrals"',
        'data-admin-page="withdrawals"',
        'data-admin-page="transactions"',
        "data-admin-user-wallet-form",
        "data-admin-referral-approve-form",
        "data-admin-withdrawal-approve-form"
    ];

    const found =
        forbiddenReferences.filter(
            token =>
                html.includes(
                    token
                )
        );

    if (
        found.length
    ) {
        fail(
            `admin/index.html still contains removed Admin feature reference(s):\n- ${found.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Admin HTML contains no Referral/Wallet/Withdrawal/Transaction feature UI."
        );
    }

    const requiredOfferSelectors = [
        "data-admin-summary-offers-paid",
        "data-admin-summary-offers-unpaid",
        "data-admin-user-detail-offer-status",
        "data-admin-user-detail-offer-paid-action"
    ];

    const missingOfferSelectors =
        requiredOfferSelectors.filter(
            token =>
                !html.includes(
                    token
                )
        );

    if (
        missingOfferSelectors.length
    ) {
        fail(
            `admin/index.html is missing Offer Paid UI selector(s):\n- ${missingOfferSelectors.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Admin HTML contains current Offer Paid controls."
        );
    }
}

/* =========================================================
   ADMIN JAVASCRIPT CONTRACT
========================================================= */

function validateAdminJavaScriptContract() {
    const api =
        read(
            "admin/js/admin.api.js"
        );

    const users =
        read(
            "admin/js/admin.users.js"
        );

    const app =
        read(
            "admin/js/admin.app.js"
        );

    const combined =
        `${api}\n${users}\n${app}`;

    const requiredTokens = [
        "getAdminDashboardSummary",
        "getAdminUsers",
        "getAdminUserDetails",
        "markOfferPaid"
    ];

    const missing =
        requiredTokens.filter(
            token =>
                !combined.includes(
                    token
                )
        );

    if (
        missing.length
    ) {
        fail(
            `Current Admin JavaScript operation(s) missing:\n- ${missing.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Admin JavaScript contains current Dashboard/User/Offer operations."
        );
    }

    const forbiddenTokens = [
        "approveReferral",
        "rejectReferral",
        "adjustAdminWallet",
        "adjustWallet(",
        "getPendingWithdrawals",
        "approveWithdrawal",
        "rejectWithdrawal",
        "getAdminTransactions",
        "getAdminAuditLogs"
    ];

    const foundForbidden =
        forbiddenTokens.filter(
            token =>
                combined.includes(
                    token
                )
        );

    if (
        foundForbidden.length
    ) {
        fail(
            `Admin JavaScript still contains removed operation(s):\n- ${foundForbidden.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Admin JavaScript contains no removed referral/wallet/withdrawal operations."
        );
    }
}

/* =========================================================
   PUBLIC HTML DISCOVERY
========================================================= */

function isTemplateOrPartial(file) {
    if (
        CONFIG
            .templateFiles
            .has(
                file
            )
    ) {
        return true;
    }

    return file.startsWith(
        "reviews/partials/"
    );
}

function publicHtmlFiles(
    allFiles
) {
    return allFiles.filter(
        file =>
            file.endsWith(
                ".html"
            ) &&
            !isTemplateOrPartial(
                file
            )
    );
}

function extractAttributeReferences(
    html
) {
    const references =
        [];

    const regex =
        /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

    let match;

    while (
        (
            match =
                regex.exec(
                    html
                )
        ) !==
        null
    ) {
        references.push(
            match[1] ??
            match[2] ??
            ""
        );
    }

    return references;
}

function validateLocalHtmlReferences(
    files
) {
    const failures =
        [];

    for (
        const file
        of files
    ) {
        const html =
            read(
                file
            );

        for (
            const reference
            of extractAttributeReferences(
                html
            )
        ) {
            const cleanReference =
                stripQueryAndHash(
                    reference
                );

            if (
                !cleanReference ||
                cleanReference.startsWith(
                    "#"
                ) ||
                isExternalReference(
                    cleanReference
                )
            ) {
                continue;
            }

            /*
             * Deferred APK is intentionally excluded.
             */

            if (
                cleanReference ===
                    "11play.apk" ||
                cleanReference.endsWith(
                    "/11play.apk"
                )
            ) {
                continue;
            }

            const resolution =
                resolveLocalReference(
                    file,
                    cleanReference
                );

            if (
                !resolution
            ) {
                continue;
            }

            if (
                resolution.invalidRootRelative
            ) {
                failures.push(
                    `${file}: root-relative path is unsafe for GitHub Project Pages: ${cleanReference}`
                );

                continue;
            }

            if (
                resolution.outsideRoot
            ) {
                failures.push(
                    `${file}: local reference escapes repository root: ${cleanReference}`
                );

                continue;
            }

            if (
                !localTargetExists(
                    resolution
                )
            ) {
                failures.push(
                    `${file}: missing local target: ${cleanReference}`
                );
            }
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Broken local HTML references found:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "All production HTML href/src local references resolve."
        );
    }
}

/* =========================================================
   JSON-LD / PLACEHOLDER VALIDATION
========================================================= */

function jsonLdBlocks(html) {
    const blocks =
        [];

    const regex =
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (
            match =
                regex.exec(
                    html
                )
        ) !==
        null
    ) {
        blocks.push(
            match[1].trim()
        );
    }

    return blocks;
}

function validateJsonLd(files) {
    const failures =
        [];

    let blockCount =
        0;

    for (
        const file
        of files
    ) {
        const blocks =
            jsonLdBlocks(
                read(
                    file
                )
            );

        blocks.forEach(
            (
                block,
                index
            ) => {
                blockCount +=
                    1;

                try {
                    JSON.parse(
                        block
                    );
                } catch (error) {
                    failures.push(
                        `${file} JSON-LD #${
                            index +
                            1
                        }: ${error.message}`
                    );
                }
            }
        );
    }

    if (
        failures.length
    ) {
        fail(
            `Invalid JSON-LD found:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            `JSON-LD validation passed (${blockCount} block${
                blockCount ===
                1
                    ? ""
                    : "s"
            }).`
        );
    }
}

function validateNoUnresolvedPlaceholders(
    files
) {
    const failures =
        [];

    const placeholderRegex =
        /\{\{[A-Z0-9_]+\}\}/g;

    for (
        const file
        of files
    ) {
        const matches =
            read(
                file
            ).match(
                placeholderRegex
            );

        if (
            matches?.length
        ) {
            failures.push(
                `${file}: ${[
                    ...new Set(
                        matches
                    )
                ].join(", ")}`
            );
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Unresolved build placeholders found in public HTML:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "No unresolved build placeholders exist in public HTML."
        );
    }
}

/* =========================================================
   CANONICAL URL VALIDATION
========================================================= */

function canonicalFromHtml(html) {
    const match =
        html.match(
            /<link\b[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i
        ) ||
        html.match(
            /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i
        );

    return String(
        match?.[1] ||
        ""
    ).trim();
}

function validateCanonicalUrls(files) {
    const failures =
        [];

    let canonicalCount =
        0;

    for (
        const file
        of files
    ) {
        const canonical =
            canonicalFromHtml(
                read(
                    file
                )
            );

        if (
            !canonical
        ) {
            continue;
        }

        canonicalCount +=
            1;

        if (
            !(
                canonical ===
                    CANONICAL_HOME ||
                canonical.startsWith(
                    `${BASE_URL}/`
                )
            )
        ) {
            failures.push(
                `${file}: ${canonical}`
            );
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Non-canonical-domain canonical URLs found:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            `Canonical URL domain validation passed (${canonicalCount} canonical links).`
        );
    }
}

/* =========================================================
   FORBIDDEN PRODUCTION TOKENS
========================================================= */

function validateForbiddenProductionTokens(
    allFiles
) {
    const textExtensions =
        new Set([
            ".html",
            ".js",
            ".json",
            ".xml",
            ".txt",
            ".css",
            ".md",
            ".yml",
            ".yaml"
        ]);

    const excluded =
        new Set([
            "scripts/validate-production.js",
            "README.md"
        ]);

    const forbidden = [
        "https://11web.github.io/11play/",
        "https://t.me/your_channel",
        "https://wa.me/8801XXXXXXXXX",
        "https://your-website.com/",
        "https://facebook.com/your-page",
        "https://youtube.com/@your-channel",
        "https://twitter.com/your-handle"
    ];

    const failures =
        [];

    for (
        const file
        of allFiles
    ) {
        if (
            excluded.has(
                file
            ) ||
            isTemplateOrPartial(
                file
            )
        ) {
            continue;
        }

        if (
            !textExtensions.has(
                path
                    .extname(
                        file
                    )
                    .toLowerCase()
            )
        ) {
            continue;
        }

        const content =
            read(
                file
            );

        for (
            const token
            of forbidden
        ) {
            if (
                content.includes(
                    token
                )
            ) {
                failures.push(
                    `${file}: ${token}`
                );
            }
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Forbidden placeholder/legacy production URLs found:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "No forbidden placeholder or legacy production URLs were found."
        );
    }
}

/* =========================================================
   REVIEW OUTPUT VALIDATION
========================================================= */

function reviewSiteFiles(
    allFiles
) {
    return allFiles.filter(
        file =>
            /^reviews\/sites\/[^/]+\/index\.html$/
                .test(
                    file
                )
    );
}

function metaContent(
    html,
    name,
    attribute = "name"
) {
    const escaped =
        String(
            name
        ).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

    const first =
        new RegExp(
            `<meta\\b[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
            "i"
        );

    const second =
        new RegExp(
            `<meta\\b[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`,
            "i"
        );

    const match =
        html.match(
            first
        ) ||
        html.match(
            second
        );

    return String(
        match?.[1] ||
        ""
    ).trim();
}

function validateReviewOutputs(
    allFiles
) {
    const reviews =
        reviewSiteFiles(
            allFiles
        );

    const failures =
        [];

    if (
        !reviews.length
    ) {
        fail(
            "No generated review site pages were found."
        );

        return;
    }

    for (
        const file
        of reviews
    ) {
        const html =
            read(
                file
            );

        const status =
            metaContent(
                html,
                "review-status"
            ).toLowerCase();

        const image =
            metaContent(
                html,
                "review-image"
            );

        const slug =
            metaContent(
                html,
                "review-slug"
            );

        if (
            status !==
            "published"
        ) {
            failures.push(
                `${file}: review-status must be published.`
            );
        }

        if (
            !slug
        ) {
            failures.push(
                `${file}: review-slug missing.`
            );
        }

        if (
            !image
        ) {
            failures.push(
                `${file}: review-image missing.`
            );
        } else if (
            !isExternalReference(
                image
            ) &&
            !image.startsWith(
                "data:"
            )
        ) {
            const resolution =
                resolveLocalReference(
                    file,
                    image
                );

            if (
                !resolution ||
                !localTargetExists(
                    resolution
                )
            ) {
                failures.push(
                    `${file}: review-image target missing: ${image}`
                );
            } else if (
                fs
                    .statSync(
                        resolution.resolved
                    )
                    .size <=
                0
            ) {
                failures.push(
                    `${file}: review-image is empty: ${image}`
                );
            }
        }
    }

    if (
        failures.length
    ) {
        fail(
            `Generated review validation failed:\n- ${failures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            `Generated review validation passed (${reviews.length} published review pages).`
        );
    }
}

/* =========================================================
   SITEMAP VALIDATION
========================================================= */

function decodeXml(value) {
    return String(
        value ||
        ""
    )
        .replace(
            /&amp;/g,
            "&"
        )
        .replace(
            /&lt;/g,
            "<"
        )
        .replace(
            /&gt;/g,
            ">"
        )
        .replace(
            /&quot;/g,
            '"'
        )
        .replace(
            /&apos;/g,
            "'"
        );
}

function sitemapEntries(xml) {
    const entries =
        [];

    const blocks =
        String(
            xml ||
            ""
        ).match(
            /<url>[\s\S]*?<\/url>/gi
        ) ||
        [];

    for (
        const block
        of blocks
    ) {
        const loc =
            decodeXml(
                block.match(
                    /<loc>\s*([\s\S]*?)\s*<\/loc>/i
                )?.[1] ||
                ""
            ).trim();

        const lastmod =
            (
                block.match(
                    /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i
                )?.[1] ||
                ""
            ).trim();

        if (
            loc
        ) {
            entries.push({
                loc,
                lastmod
            });
        }
    }

    return entries;
}

function collectDateModifiedFromJsonLd(
    html
) {
    const dates =
        [];

    for (
        const block
        of jsonLdBlocks(
            html
        )
    ) {
        try {
            const value =
                JSON.parse(
                    block
                );

            const queue = [
                value
            ];

            while (
                queue.length
            ) {
                const current =
                    queue.shift();

                if (
                    Array.isArray(
                        current
                    )
                ) {
                    queue.push(
                        ...current
                    );

                    continue;
                }

                if (
                    !current ||
                    typeof current !==
                        "object"
                ) {
                    continue;
                }

                if (
                    /^\d{4}-\d{2}-\d{2}$/
                        .test(
                            String(
                                current
                                    .dateModified ||
                                ""
                            )
                        )
                ) {
                    dates.push(
                        String(
                            current
                                .dateModified
                        )
                    );
                }

                for (
                    const nested
                    of Object.values(
                        current
                    )
                ) {
                    if (
                        nested &&
                        typeof nested ===
                            "object"
                    ) {
                        queue.push(
                            nested
                        );
                    }
                }
            }
        } catch {
            /*
             * JSON-LD parse errors are handled separately.
             */
        }
    }

    return dates
        .sort()
        .reverse();
}

function validateSitemap(files) {
    const xml =
        read(
            "sitemap.xml"
        );

    if (
        !/<urlset\b/i.test(
            xml
        ) ||
        /<sitemapindex\b/i.test(
            xml
        )
    ) {
        fail(
            "sitemap.xml must be a urlset sitemap."
        );

        return;
    }

    const entries =
        sitemapEntries(
            xml
        );

    const byLoc =
        new Map();

    const duplicates =
        [];

    for (
        const entry
        of entries
    ) {
        const key =
            entry.loc.replace(
                /\/+$/,
                ""
            );

        if (
            byLoc.has(
                key
            )
        ) {
            duplicates.push(
                entry.loc
            );
        } else {
            byLoc.set(
                key,
                entry
            );
        }
    }

    if (
        duplicates.length
    ) {
        fail(
            `Duplicate sitemap URLs found:\n- ${duplicates.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            `Sitemap contains ${entries.length} unique URL entries.`
        );
    }

    const requiredUrls =
        new Set([
            CANONICAL_HOME,
            `${BASE_URL}/reviews/`,
            `${BASE_URL}/pages/about.html`,
            `${BASE_URL}/pages/privacy-policy.html`,
            `${BASE_URL}/pages/terms.html`,
            `${BASE_URL}/pages/contact.html`
        ]);

    for (
        const file
        of reviewSiteFiles(
            files
        )
    ) {
        const canonical =
            canonicalFromHtml(
                read(
                    file
                )
            );

        if (
            canonical
        ) {
            requiredUrls.add(
                canonical
            );
        }
    }

    const missing =
        [
            ...requiredUrls
        ].filter(
            url => {
                const key =
                    url.replace(
                        /\/+$/,
                        ""
                    );

                return !byLoc.has(
                    key
                );
            }
        );

    if (
        missing.length
    ) {
        fail(
            `Required sitemap URLs missing:\n- ${missing.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Sitemap includes all required public and review URLs."
        );
    }

    const dateFailures =
        [];

    for (
        const file
        of files.filter(
            item =>
                item.endsWith(
                    ".html"
                )
        )
    ) {
        if (
            isTemplateOrPartial(
                file
            )
        ) {
            continue;
        }

        const html =
            read(
                file
            );

        const canonical =
            canonicalFromHtml(
                html
            );

        const latestModified =
            collectDateModifiedFromJsonLd(
                html
            )[0] ||
            "";

        if (
            !canonical ||
            !latestModified
        ) {
            continue;
        }

        const entry =
            byLoc.get(
                canonical.replace(
                    /\/+$/,
                    ""
                )
            );

        if (
            entry &&
            entry.lastmod &&
            entry.lastmod !==
                latestModified
        ) {
            dateFailures.push(
                `${canonical}: sitemap ${entry.lastmod}, page dateModified ${latestModified}`
            );
        }
    }

    if (
        dateFailures.length
    ) {
        fail(
            `Sitemap lastmod values are stale:\n- ${dateFailures.join(
                "\n- "
            )}`
        );
    } else {
        pass(
            "Sitemap lastmod values match available page dateModified metadata."
        );
    }
}

/* =========================================================
   MAIN
========================================================= */

function run() {
    info(
        "Production validation started."
    );

    info(
        "Current architecture: Firebase Spark + Google Profile + Admin Offer Paid + tawk.to Live Chat."
    );

    info(
        "Deferred 11play.apk is intentionally excluded from inspection."
    );

    /* -----------------------------------------------------
       FILE SYSTEM
    ----------------------------------------------------- */

    validateRequiredFiles();

    validateObsoleteFilesRemoved();

    /* -----------------------------------------------------
       JSON / FIREBASE
    ----------------------------------------------------- */

    validateJsonFiles();

    validateFirebaseConfigFiles();

    validateFirestoreRulesContract();

    /* -----------------------------------------------------
       WEB APP CONFIGURATION
    ----------------------------------------------------- */

    validateManifest();

    validateRobots();

    validateMenuConfig();

    validateRootHtmlContract();

    validateLiveChatContract();

    validateShareContract();

    /* -----------------------------------------------------
       ADMIN
    ----------------------------------------------------- */

    validateAdminHtmlContract();

    validateAdminJavaScriptContract();

    /* -----------------------------------------------------
       FULL PRODUCTION TREE
    ----------------------------------------------------- */

    const allFiles =
        walk();

    const htmlFiles =
        publicHtmlFiles(
            allFiles
        );

    validateLocalHtmlReferences(
        htmlFiles
    );

    validateJsonLd(
        htmlFiles
    );

    validateNoUnresolvedPlaceholders(
        htmlFiles
    );

    validateCanonicalUrls(
        htmlFiles
    );

    validateForbiddenProductionTokens(
        allFiles
    );

    /* -----------------------------------------------------
       REVIEWS / SITEMAP
    ----------------------------------------------------- */

    validateReviewOutputs(
        allFiles
    );

    validateSitemap(
        allFiles
    );

    /* -----------------------------------------------------
       SUMMARY
    ----------------------------------------------------- */

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "11PLAY PRODUCTION VALIDATION SUMMARY"
    );

    console.log(
        "========================================"
    );

    console.log(
        `Checks passed: ${checkCount}`
    );

    console.log(
        `Warnings: ${warningCount}`
    );

    console.log(
        `Errors: ${errorCount}`
    );

    console.log(
        "========================================"
    );

    if (
        errorCount >
        0
    ) {
        throw new Error(
            `Production validation failed with ${errorCount} error(s).`
        );
    }

    info(
        "Production validation passed."
    );
}

/* =========================================================
   EXECUTION
========================================================= */

try {
    run();
} catch (error) {
    console.error("");

    console.error(
        `[Production Validator Error] ${
            error instanceof
                Error
                ? error.message
                : String(
                    error
                )
        }`
    );

    process.exitCode =
        1;
}