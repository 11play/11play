"use strict";

/* =========================================================
   11PLAY PRODUCTION VALIDATOR
   File: scripts/validate-production.js

   Purpose:
   - Fail CI before deployment when production-critical files,
     URLs, assets, JSON/JSON-LD, sitemap entries or generated
     review files are inconsistent.
   - Validate only the web production surface.
   - Keep the deferred APK completely untouched and uninspected.

   Node.js 22+; no external npm package required.
========================================================= */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://11play.github.io/11play";
const CANONICAL_HOME = `${BASE_URL}/`;

const CONFIG = Object.freeze({
    telegram: "https://t.me/play11play",
    whatsapp: "https://wa.me/8801828282882",
    website: CANONICAL_HOME,
    facebook: "https://facebook.com/app11play",
    youtube: "https://youtube.com/@11play-app",
    twitter: "https://twitter.com/app11play",

    ignoredDirectories: new Set([
        ".git",
        ".firebase",
        "node_modules",
        "_site",
        "functions",
        "tests"
    ]),

    ignoredFiles: new Set([
        "11play.apk"
    ]),

    templateFiles: new Set([
        "reviews/index.template.html",
        "reviews/review-template.html"
    ]),

    requiredFiles: [
        "index.html",
        "manifest.json",
        "robots.txt",
        "sitemap.xml",
        "firebase.json",
        "firestore.rules",
        "firestore.indexes.json",
        ".firebaserc",
        "js/config/firebase.config.js",
        "js/config/menu.config.js",
        "js/account/firebase/functions.client.js",
        "pages/about.html",
        "pages/privacy-policy.html",
        "pages/terms.html",
        "pages/contact.html",
        "admin/index.html",
        "reviews/index.html",
        "reviews/index.template.html",
        "reviews/review.css",
        "reviews/review-search.js",
        "reviews/assets/megacricketworld.webp",
        "scripts/build-reviews.js",
        "scripts/validate-production.js",
        ".github/workflows/build-reviews.yml",
        "package.json"
    ],

    jsonFiles: [
        "manifest.json",
        "firebase.json",
        "firestore.indexes.json",
        ".firebaserc",
        "package.json"
    ]
});

let errorCount = 0;
let warningCount = 0;
let checkCount = 0;

/* =========================================================
   LOGGING
========================================================= */

function info(message) {
    console.log(
        `[Production Validator] ${message}`
    );
}

function pass(message) {
    checkCount += 1;

    console.log(
        `[PASS] ${message}`
    );
}

function warn(message) {
    warningCount += 1;

    console.warn(
        `[WARN] ${message}`
    );
}

function fail(message) {
    errorCount += 1;

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
        .split(path.sep)
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
        value || ""
    )
        .split(path.sep)
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
    const output = [];

    for (
        const entry
        of fs.readdirSync(
            directory,
            {
                withFileTypes: true
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
        } else if (
            entry.isFile()
        ) {
            output.push(
                relativePath
            );
        }
    }

    return output.sort();
}

function stripQueryAndHash(
    value
) {
    return String(
        value || ""
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

function isExternalReference(
    value
) {
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
        cleanReference === "."
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
                        "/11play/".length
                    )
                )
            );
    } else if (
        cleanReference === "/11play" ||
        cleanReference === "/11play/"
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
        resolved !== ROOT &&
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

/* =========================================================
   REQUIRED FILES
========================================================= */

function validateRequiredFiles() {
    const missing = [];
    const empty = [];

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
            fs
                .statSync(
                    absolute(
                        file
                    )
                )
                .size <= 0
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

/* =========================================================
   JSON VALIDATION
========================================================= */

function parseJsonFile(
    file
) {
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
    let valid = true;

    for (
        const file
        of CONFIG.jsonFiles
    ) {
        if (
            !exists(
                file
            )
        ) {
            valid = false;

            continue;
        }

        try {
            JSON.parse(
                read(
                    file
                )
            );
        } catch (error) {
            valid = false;

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
    } else {
        pass(
            `Firestore indexes JSON contains ${indexes.indexes.length} composite index definitions.`
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

    let iconError =
        false;

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
            iconError =
                true;

            fail(
                `Manifest icon is missing: ${
                    source ||
                    "(empty)"
                }`
            );
        }
    }

    if (
        !iconError &&
        icons.length
    ) {
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

function validateMenuConfig() {
    const menu =
        loadMenuConfig();

    if (
        !menu
    ) {
        return;
    }

    const expectations = {
        telegram:
            CONFIG.telegram,

        whatsapp:
            CONFIG.whatsapp,

        website:
            CONFIG.website,

        facebook:
            CONFIG.facebook,

        youtube:
            CONFIG.youtube,

        twitter:
            CONFIG.twitter
    };

    for (
        const [
            page,
            expectedUrl
        ]
        of Object.entries(
            expectations
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
        } else if (
            String(
                item.url ||
                ""
            ) !==
            expectedUrl
        ) {
            fail(
                `Menu ${page} URL must be: ${expectedUrl}`
            );
        } else {
            pass(
                `Menu ${page} URL is production-ready.`
            );
        }
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
}

/* =========================================================
   PUBLIC HTML DISCOVERY
========================================================= */

function isTemplateOrPartial(
    file
) {
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
    const references = [];

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
    const failures = [];

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
                resolution
                    .invalidRootRelative
            ) {
                failures.push(
                    `${file}: root-relative path is unsafe for GitHub Project Pages: ${cleanReference}`
                );

                continue;
            }

            if (
                resolution
                    .outsideRoot
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

function jsonLdBlocks(
    html
) {
    const blocks = [];

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

function validateJsonLd(
    files
) {
    const failures = [];

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
                            index + 1
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
                blockCount === 1
                    ? ""
                    : "s"
            }).`
        );
    }
}

function validateNoUnresolvedPlaceholders(
    files
) {
    const failures = [];

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
   URL / CANONICAL VALIDATION
========================================================= */

function canonicalFromHtml(
    html
) {
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

function validateCanonicalUrls(
    files
) {
    const failures = [];

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

    const failures = [];

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

    const failures = [];

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
                    .size <= 0
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

function decodeXml(
    value
) {
    return String(
        value || ""
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

function sitemapEntries(
    xml
) {
    const entries = [];

    const blocks =
        String(
            xml || ""
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
    const dates = [];

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
                                current.dateModified ||
                                ""
                            )
                        )
                ) {
                    dates.push(
                        String(
                            current.dateModified
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
             * JSON-LD parse failures are reported
             * by validateJsonLd().
             */
        }
    }

    return dates
        .sort()
        .reverse();
}

function validateSitemap(
    files
) {
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

    const duplicates = [];

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

    const dateFailures = [];

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
        "Deferred 11play.apk is intentionally excluded from inspection."
    );

    validateRequiredFiles();

    validateJsonFiles();

    validateFirebaseConfigFiles();

    validateManifest();

    validateRobots();

    validateMenuConfig();

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

    validateReviewOutputs(
        allFiles
    );

    validateSitemap(
        allFiles
    );

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
        errorCount > 0
    ) {
        throw new Error(
            `Production validation failed with ${errorCount} error(s).`
        );
    }

    info(
        "Production validation passed."
    );
}

try {
    run();
} catch (error) {
    console.error("");

    console.error(
        `[Production Validator Error] ${
            error instanceof Error
                ? error.message
                : String(error)
        }`
    );

    process.exitCode = 1;
}
