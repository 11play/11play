"use strict";

/* =========================================================
   11PLAY STATIC REVIEW BUILDER
   File: scripts/build-reviews.js

   কাজ:
   - reviews/sites/[slug]/index.html স্ক্যান করা
   - published review metadata পড়া ও যাচাই করা
   - published review local image কঠোরভাবে যাচাই করা
   - common header/features/footer আপডেট করা
   - reviews/index.html স্বয়ংক্রিয়ভাবে তৈরি করা
   - ItemList schema এবং root sitemap.xml আপডেট করা

   Production rules:
   - Published local review image অবশ্যই থাকতে হবে
   - Missing/empty local review image হলে build FAIL করবে
   - GitHub Project Pages-এর জন্য root-relative local image
     path অনুমোদিত নয়
   - Broken review asset নিয়ে production deploy হবে না

   Node.js 20+; external npm package প্রয়োজন নেই।
========================================================= */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REVIEWS = path.join(ROOT, "reviews");

const CONFIG = Object.freeze({
    baseUrl: "https://11play.github.io/11play",
    root: ROOT,
    reviews: REVIEWS,
    sites: path.join(REVIEWS, "sites"),

    indexTemplate: path.join(
        REVIEWS,
        "index.template.html"
    ),

    indexOutput: path.join(
        REVIEWS,
        "index.html"
    ),

    reviewCss: path.join(
        REVIEWS,
        "review.css"
    ),

    reviewSearch: path.join(
        REVIEWS,
        "review-search.js"
    ),

    header: path.join(
        REVIEWS,
        "partials",
        "header.html"
    ),

    features: path.join(
        REVIEWS,
        "partials",
        "common-features.html"
    ),

    footer: path.join(
        REVIEWS,
        "partials",
        "footer.html"
    ),

    sitemap: path.join(
        ROOT,
        "sitemap.xml"
    )
});

const MARKERS = Object.freeze({
    header: [
        "<!-- BUILD:HEADER_START -->",
        "<!-- BUILD:HEADER_END -->"
    ],

    footer: [
        "<!-- BUILD:FOOTER_START -->",
        "<!-- BUILD:FOOTER_END -->"
    ],

    features: [
        "<!-- BUILD:COMMON_FEATURES_START -->",
        "<!-- BUILD:COMMON_FEATURES_END -->"
    ],

    results: [
        "<!-- BUILD:REVIEW_RESULTS_START -->",
        "<!-- BUILD:REVIEW_RESULTS_END -->"
    ],

    count: [
        "<!-- BUILD:REVIEW_COUNT_START -->",
        "<!-- BUILD:REVIEW_COUNT_END -->"
    ],

    updated: [
        "<!-- BUILD:LAST_UPDATED_START -->",
        "<!-- BUILD:LAST_UPDATED_END -->"
    ],

    schema: [
        "<!-- BUILD:REVIEW_SCHEMA_START -->",
        "<!-- BUILD:REVIEW_SCHEMA_END -->"
    ]
});

/* =========================================================
   LOGGING
========================================================= */

function info(message) {
    console.log(
        `[Review Builder] ${message}`
    );
}

function warn(message) {
    console.warn(
        `[Review Builder Warning] ${message}`
    );
}

function fail(message) {
    console.error(
        `[Review Builder Error] ${message}`
    );
}

/* =========================================================
   FILE HELPERS
========================================================= */

function exists(filePath) {
    return fs.existsSync(filePath);
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

function read(filePath) {
    if (!exists(filePath)) {
        throw new Error(
            `প্রয়োজনীয় ফাইল পাওয়া যায়নি: ${relative(
                filePath
            )}`
        );
    }

    return fs.readFileSync(
        filePath,
        "utf8"
    );
}

function writeIfChanged(
    filePath,
    content
) {
    const next =
        `${String(content || "").trimEnd()}\n`;

    const previous = exists(filePath)
        ? fs.readFileSync(
              filePath,
              "utf8"
          )
        : null;

    if (previous === next) {
        return false;
    }

    fs.mkdirSync(
        path.dirname(filePath),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        filePath,
        next,
        "utf8"
    );

    return true;
}

/* =========================================================
   STRING HELPERS
========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function escapeRegExp(value) {
    return String(value).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}

function clean(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function slugify(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(
            /[^a-z0-9_-]+/g,
            "-"
        )
        .replace(
            /-+/g,
            "-"
        )
        .replace(
            /^[-_]+|[-_]+$/g,
            ""
        );
}

function trimSlash(value) {
    return String(value || "").replace(
        /\/+$/,
        ""
    );
}

function webUrl(...segments) {
    return segments
        .map(
            (
                segment,
                index
            ) => {
                const value =
                    String(
                        segment || ""
                    );

                return index === 0
                    ? trimSlash(value)
                    : value.replace(
                          /^\/+|\/+$/g,
                          ""
                      );
            }
        )
        .filter(Boolean)
        .join("/");
}

/* =========================================================
   BUILD MARKER HELPERS
========================================================= */

function replaceSection(
    html,
    marker,
    replacement
) {
    const [
        start,
        end
    ] = marker;

    const startIndex =
        html.indexOf(start);

    const endIndex =
        html.indexOf(end);

    if (
        startIndex === -1 ||
        endIndex === -1 ||
        endIndex < startIndex
    ) {
        throw new Error(
            `Build marker পাওয়া যায়নি: ${start}`
        );
    }

    return [
        html.slice(
            0,
            startIndex +
                start.length
        ),
        "",
        String(
            replacement || ""
        ).trim(),
        "",
        html.slice(endIndex)
    ].join("\n");
}

function replaceTokens(
    html,
    values
) {
    let output = html;

    for (
        const [
            name,
            value
        ] of Object.entries(values)
    ) {
        output = output.replace(
            new RegExp(
                escapeRegExp(
                    `{{${name}}}`
                ),
                "g"
            ),
            String(value ?? "")
        );
    }

    return output;
}

/* =========================================================
   HTML PARSING
========================================================= */

function parseAttributes(tag) {
    const attributes = {};

    const pattern =
        /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

    let match;

    while (
        (
            match =
                pattern.exec(tag)
        ) !== null
    ) {
        const name =
            String(
                match[1] || ""
            ).toLowerCase();

        if (
            !name ||
            name.startsWith("<")
        ) {
            continue;
        }

        attributes[name] =
            match[2] ??
            match[3] ??
            match[4] ??
            "";
    }

    return attributes;
}

function metaTags(html) {
    return (
        String(html || "").match(
            /<meta\b[^>]*>/gi
        ) || []
    ).map(
        (tag) => ({
            tag,
            attributes:
                parseAttributes(tag)
        })
    );
}

function meta(
    html,
    key,
    attribute = "name"
) {
    const expected =
        String(key).toLowerCase();

    const found =
        metaTags(html).find(
            ({ attributes }) =>
                String(
                    attributes[
                        attribute
                    ] || ""
                ).toLowerCase() ===
                expected
        );

    return clean(
        found?.attributes
            ?.content || ""
    );
}

function documentTitle(html) {
    const match =
        String(html || "").match(
            /<title\b[^>]*>([\s\S]*?)<\/title>/i
        );

    return clean(
        match?.[1] || ""
    );
}

/* =========================================================
   HTML UPDATE HELPERS
========================================================= */

function setMeta(
    html,
    attribute,
    key,
    value
) {
    const found =
        metaTags(html).find(
            ({ attributes }) =>
                String(
                    attributes[
                        attribute
                    ] || ""
                ).toLowerCase() ===
                String(
                    key
                ).toLowerCase()
        );

    const next =
        `<meta ${attribute}="${escapeHtml(
            key
        )}" content="${escapeHtml(
            value
        )}">`;

    return found
        ? html.replace(
              found.tag,
              next
          )
        : html.replace(
              /<\/head>/i,
              `    ${next}\n</head>`
          );
}

function setTitle(
    html,
    title
) {
    const next =
        `<title>${escapeHtml(
            title
        )}</title>`;

    const pattern =
        /<title\b[^>]*>[\s\S]*?<\/title>/i;

    return pattern.test(html)
        ? html.replace(
              pattern,
              next
          )
        : html.replace(
              /<\/head>/i,
              `    ${next}\n</head>`
          );
}

function setCanonical(
    html,
    url
) {
    const links =
        String(html || "").match(
            /<link\b[^>]*>/gi
        ) || [];

    const found =
        links.find(
            (tag) =>
                String(
                    parseAttributes(
                        tag
                    ).rel || ""
                )
                    .toLowerCase()
                    .split(/\s+/)
                    .includes(
                        "canonical"
                    )
        );

    const next =
        `<link rel="canonical" href="${escapeHtml(
            url
        )}">`;

    return found
        ? html.replace(
              found,
              next
          )
        : html.replace(
              /<\/head>/i,
              `    ${next}\n</head>`
          );
}

function setSchema(
    html,
    schemaType,
    schema
) {
    const pattern =
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;
    let found = null;

    while (
        (
            match =
                pattern.exec(html)
        ) !== null
    ) {
        const typePattern =
            new RegExp(
                `"@type"\\s*:\\s*"${escapeRegExp(
                    schemaType
                )}"`,
                "i"
            );

        if (
            typePattern.test(
                match[1] || ""
            )
        ) {
            found = match[0];
            break;
        }
    }

    const next = [
        '<script type="application/ld+json">',
        JSON.stringify(
            schema,
            null,
            4
        ),
        "</script>"
    ].join("\n");

    return found
        ? html.replace(
              found,
              next
          )
        : html.replace(
              /<\/head>/i,
              `    ${next}\n</head>`
          );
}

/* =========================================================
   DATE AND RATING HELPERS
========================================================= */

function validDate(value) {
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            String(value || "")
        )
    ) {
        return false;
    }

    const date =
        new Date(
            `${value}T00:00:00Z`
        );

    return (
        !Number.isNaN(
            date.getTime()
        ) &&
        date
            .toISOString()
            .slice(0, 10) ===
            value
    );
}

function today() {
    return new Date()
        .toISOString()
        .slice(0, 10);
}

function displayDate(value) {
    if (!validDate(value)) {
        return value;
    }

    try {
        return new Intl
            .DateTimeFormat(
                "bn-BD",
                {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC"
                }
            )
            .format(
                new Date(
                    `${value}T00:00:00Z`
                )
            );
    } catch {
        return value;
    }
}

function bnNumber(value) {
    try {
        return new Intl
            .NumberFormat(
                "bn-BD"
            )
            .format(value);
    } catch {
        return String(value);
    }
}

function latestDate(reviews) {
    return (
        reviews
            .map(
                (review) =>
                    review.modifiedDate ||
                    review.publishedDate
            )
            .filter(validDate)
            .sort()
            .reverse()[0] ||
        today()
    );
}

function ratingValue(value) {
    const rating =
        Number.parseFloat(value);

    if (
        !Number.isFinite(rating) ||
        rating < 1 ||
        rating > 5
    ) {
        return null;
    }

    return (
        Math.round(
            rating * 10
        ) / 10
    );
}

function ratingText(value) {
    return Number.isInteger(
        value
    )
        ? String(value)
        : value.toFixed(1);
}

function stars(value) {
    const rounded =
        Math.max(
            0,
            Math.min(
                5,
                Math.round(value)
            )
        );

    return (
        "★".repeat(rounded) +
        "☆".repeat(
            5 - rounded
        )
    );
}

/* =========================================================
   IMAGE HELPERS
========================================================= */

function externalUrl(value) {
    return /^(?:https?:)?\/\//i.test(
        String(value || "")
    );
}

function indexImage(
    imageSource,
    pagePath
) {
    const value =
        clean(imageSource);

    if (!value) {
        return "";
    }

    if (
        externalUrl(value) ||
        value.startsWith(
            "data:"
        ) ||
        value.startsWith("/")
    ) {
        return value;
    }

    const absolute =
        path.resolve(
            path.dirname(
                pagePath
            ),
            value
        );

    return `./${path
        .relative(
            REVIEWS,
            absolute
        )
        .split(path.sep)
        .join("/")}`;
}

function absoluteImage(
    indexImageUrl
) {
    if (!indexImageUrl) {
        return "";
    }

    if (
        externalUrl(
            indexImageUrl
        )
    ) {
        return indexImageUrl;
    }

    return webUrl(
        CONFIG.baseUrl,
        "reviews",
        indexImageUrl
            .replace(
                /^\.\//,
                ""
            )
            .replace(
                /^\/+/,
                ""
            )
    );
}

function favicon(siteName) {
    const value =
        clean(siteName);

    if (/^\d/.test(value)) {
        return value
            .slice(0, 2)
            .toUpperCase();
    }

    return (
        Array.from(value)[0]
            ?.toUpperCase() ||
        "R"
    );
}

/* =========================================================
   REVIEW DATA READER
========================================================= */

function readReview(
    pagePath,
    folderName
) {
    const html =
        read(pagePath);

    const status = (
        meta(
            html,
            "review-status"
        ) || "draft"
    ).toLowerCase();

    if (
        status !==
        "published"
    ) {
        info(
            `Draft/Unpublished বাদ: ${relative(
                pagePath
            )}`
        );

        return null;
    }

    const declaredSlug =
        meta(
            html,
            "review-slug"
        );

    const slug =
        slugify(
            declaredSlug ||
                folderName
        );

    const folderSlug =
        slugify(
            folderName
        );

    const siteName =
        meta(
            html,
            "review-site-name"
        );

    const title =
        meta(
            html,
            "review-title"
        ) ||
        documentTitle(html)
            .replace(
                /\s*\|\s*11Play\s*$/i,
                ""
            )
            .trim();

    const shortDescription =
        meta(
            html,
            "review-description"
        );

    const seoDescription =
        meta(
            html,
            "description"
        ) ||
        shortDescription;

    const rating =
        ratingValue(
            meta(
                html,
                "review-rating"
            )
        );

    const imageSource =
        meta(
            html,
            "review-image"
        ) ||
        meta(
            html,
            "og:image",
            "property"
        );

    const publishedDate =
        meta(
            html,
            "review-published"
        );

    const modifiedDate =
        meta(
            html,
            "review-modified"
        ) ||
        publishedDate;

    const authorName =
        meta(
            html,
            "author"
        ) ||
        "11Play";

    const relationship = (
        meta(
            html,
            "review-relationship"
        ) || ""
    ).toLowerCase();

    const errors = [];

    if (!slug) {
        errors.push(
            "review-slug/ফোল্ডারের নাম"
        );
    }

    if (!siteName) {
        errors.push(
            "review-site-name"
        );
    }

    if (!title) {
        errors.push(
            "review-title"
        );
    }

    if (!shortDescription) {
        errors.push(
            "review-description"
        );
    }

    if (!seoDescription) {
        errors.push(
            "description"
        );
    }

    if (rating === null) {
        errors.push(
            "review-rating (১ থেকে ৫)"
        );
    }

    if (!imageSource) {
        errors.push(
            "review-image"
        );
    }

    if (
        !validDate(
            publishedDate
        )
    ) {
        errors.push(
            "review-published (YYYY-MM-DD)"
        );
    }

    if (
        !validDate(
            modifiedDate
        )
    ) {
        errors.push(
            "review-modified (YYYY-MM-DD)"
        );
    }

    if (
        declaredSlug &&
        slug !== folderSlug
    ) {
        errors.push(
            `review-slug "${declaredSlug}" ফোল্ডার "${folderName}"-এর সঙ্গে মিলছে না`
        );
    }

    if (errors.length) {
        throw new Error(
            [
                `Metadata অসম্পূর্ণ: ${relative(
                    pagePath
                )}`,
                ...errors.map(
                    (error) =>
                        `- ${error}`
                )
            ].join("\n")
        );
    }

    const relativeUrl =
        `./sites/${encodeURIComponent(
            slug
        )}/`;

    const canonicalUrl =
        `${webUrl(
            CONFIG.baseUrl,
            "reviews",
            "sites",
            encodeURIComponent(
                slug
            )
        )}/`;

    const imageUrl =
        indexImage(
            imageSource,
            pagePath
        );

    /*
     * Production asset validation.
     *
     * External/data images are not local build artifacts.
     * Every published local image must resolve inside reviews/
     * and must exist as a non-empty regular file.
     */
    if (
        imageUrl &&
        !externalUrl(imageUrl) &&
        !imageUrl.startsWith(
            "data:"
        )
    ) {
        if (
            imageUrl.startsWith(
                "/"
            )
        ) {
            throw new Error(
                [
                    `Root-relative review image path অনুমোদিত নয়: ${relative(
                        pagePath
                    )}`,
                    `- ${imageUrl}`,
                    "GitHub Project Pages-এর জন্য repository-relative image path ব্যবহার করুন।"
                ].join("\n")
            );
        }

        const imagePath =
            path.resolve(
                REVIEWS,
                imageUrl.replace(
                    /^\.\//,
                    ""
                )
            );

        const reviewsRoot =
            `${path.resolve(REVIEWS)}${path.sep}`;

        const resolvedImagePath =
            path.resolve(
                imagePath
            );

        if (
            resolvedImagePath !==
                path.resolve(REVIEWS) &&
            !resolvedImagePath.startsWith(
                reviewsRoot
            )
        ) {
            throw new Error(
                [
                    `Review image reviews directory-এর বাইরে resolve করছে: ${relative(
                        pagePath
                    )}`,
                    `- ${imageUrl}`
                ].join("\n")
            );
        }

        if (!exists(resolvedImagePath)) {
            throw new Error(
                [
                    `Published review image পাওয়া যায়নি: ${relative(
                        pagePath
                    )}`,
                    `- Source: ${imageSource}`,
                    `- Expected: ${relative(
                        resolvedImagePath
                    )}`,
                    "Broken review image সহ production build অনুমোদিত নয়।"
                ].join("\n")
            );
        }

        const imageStats =
            fs.statSync(
                resolvedImagePath
            );

        if (
            !imageStats.isFile() ||
            imageStats.size <= 0
        ) {
            throw new Error(
                [
                    `Published review image invalid বা empty: ${relative(
                        pagePath
                    )}`,
                    `- ${relative(
                        resolvedImagePath
                    )}`
                ].join("\n")
            );
        }
    }

    return {
        slug,
        siteName,
        title,
        shortDescription,
        seoDescription,
        rating,
        ratingText:
            ratingText(rating),
        imageSource,
        indexImageUrl:
            imageUrl,
        absoluteImageUrl:
            absoluteImage(
                imageUrl
            ),
        publishedDate,
        modifiedDate,
        authorName,
        relationship,
        isSelfReview:
            relationship ===
                "self-review" ||
            slug === "11play",
        relativeUrl,
        canonicalUrl,
        pagePath,
        originalHtml: html
    };
}

function loadReviews() {
    if (!exists(CONFIG.sites)) {
        fs.mkdirSync(
            CONFIG.sites,
            {
                recursive: true
            }
        );

        warn(
            "reviews/sites ফোল্ডার তৈরি হয়েছে; কোনো review পাওয়া যায়নি।"
        );

        return [];
    }

    const reviews =
        fs.readdirSync(
            CONFIG.sites,
            {
                withFileTypes: true
            }
        )
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    !entry.name.startsWith(
                        "."
                    )
            )
            .map(
                (entry) => ({
                    folderName:
                        entry.name,

                    pagePath:
                        path.join(
                            CONFIG.sites,
                            entry.name,
                            "index.html"
                        )
                })
            )
            .filter(
                ({ pagePath }) => {
                    if (
                        exists(
                            pagePath
                        )
                    ) {
                        return true;
                    }

                    warn(
                        `index.html পাওয়া যায়নি: ${relative(
                            pagePath
                        )}`
                    );

                    return false;
                }
            )
            .map(
                ({
                    pagePath,
                    folderName
                }) =>
                    readReview(
                        pagePath,
                        folderName
                    )
            )
            .filter(Boolean);

    const slugs =
        new Set();

    const urls =
        new Set();

    for (
        const review
        of reviews
    ) {
        if (
            slugs.has(
                review.slug
            )
        ) {
            throw new Error(
                `Duplicate slug: ${review.slug}`
            );
        }

        if (
            urls.has(
                review.canonicalUrl
            )
        ) {
            throw new Error(
                `Duplicate canonical URL: ${review.canonicalUrl}`
            );
        }

        slugs.add(
            review.slug
        );

        urls.add(
            review.canonicalUrl
        );
    }

    reviews.sort(
        (
            first,
            second
        ) => {
            const firstDate =
                first.modifiedDate ||
                first.publishedDate;

            const secondDate =
                second.modifiedDate ||
                second.publishedDate;

            const dateOrder =
                secondDate.localeCompare(
                    firstDate
                );

            if (dateOrder) {
                return dateOrder;
            }

            if (
                first.isSelfReview !==
                second.isSelfReview
            ) {
                return first.isSelfReview
                    ? -1
                    : 1;
            }

            return first.title.localeCompare(
                second.title,
                "bn-BD"
            );
        }
    );

    return reviews;
}

/* =========================================================
   PARTIAL RENDERING
========================================================= */

function renderHeader(
    homeUrl,
    reviewsUrl,
    active = ""
) {
    let html =
        replaceTokens(
            read(
                CONFIG.header
            ),
            {
                HOME_URL:
                    homeUrl,

                REVIEWS_URL:
                    reviewsUrl
            }
        );

    if (
        active ===
        "reviews"
    ) {
        html = html.replace(
            'data-navigation-link="reviews"',
            'data-navigation-link="reviews" aria-current="page"'
        );
    }

    return html.trim();
}

function renderFeatures(
    review
) {
    return replaceTokens(
        read(
            CONFIG.features
        ),
        {
            SITE_NAME:
                escapeHtml(
                    review.siteName
                ),

            HOME_URL:
                "../../../index.html",

            REVIEWS_URL:
                "../../index.html"
        }
    ).trim();
}

function renderFooter(
    homeUrl,
    reviewsUrl
) {
    return replaceTokens(
        read(
            CONFIG.footer
        ),
        {
            HOME_URL:
                homeUrl,

            REVIEWS_URL:
                reviewsUrl,

            CURRENT_YEAR:
                String(
                    new Date()
                        .getFullYear()
                )
        }
    ).trim();
}

/* =========================================================
   REVIEW PAGE SCHEMA
========================================================= */

function reviewSchema(
    review
) {
    const schema = {
        "@context":
            "https://schema.org",

        "@type":
            "Review",

        name:
            review.title,

        headline:
            review.title,

        description:
            review.seoDescription,

        datePublished:
            review.publishedDate,

        dateModified:
            review.modifiedDate,

        inLanguage:
            "bn-BD",

        url:
            review.canonicalUrl,

        author: {
            "@type":
                "Organization",

            name:
                review.authorName,

            url:
                `${CONFIG.baseUrl}/`
        },

        publisher: {
            "@type":
                "Organization",

            name:
                "11Play",

            url:
                `${CONFIG.baseUrl}/`
        },

        itemReviewed: {
            "@type":
                "WebSite",

            name:
                review.siteName
        },

        reviewRating: {
            "@type":
                "Rating",

            ratingValue:
                review.rating,

            bestRating:
                5,

            worstRating:
                1
        }
    };

    if (
        review.absoluteImageUrl
    ) {
        schema.image = {
            "@type":
                "ImageObject",

            url:
                review.absoluteImageUrl,

            width:
                1200,

            height:
                630
        };
    }

    if (
        review.isSelfReview
    ) {
        schema.reviewBody =
            "এটি 11Play-এর নিজস্ব সম্পাদকীয় স্ব-মূল্যায়ন; স্বাধীন তৃতীয়-পক্ষের রিভিউ নয়।";

        schema.itemReviewed.url =
            `${CONFIG.baseUrl}/`;
    }

    return schema;
}

function breadcrumbSchema(
    review
) {
    return {
        "@context":
            "https://schema.org",

        "@type":
            "BreadcrumbList",

        itemListElement: [
            {
                "@type":
                    "ListItem",

                position:
                    1,

                name:
                    "11Play",

                item:
                    `${CONFIG.baseUrl}/`
            },

            {
                "@type":
                    "ListItem",

                position:
                    2,

                name:
                    "সকল রিভিউ",

                item:
                    `${CONFIG.baseUrl}/reviews/`
            },

            {
                "@type":
                    "ListItem",

                position:
                    3,

                name:
                    review.title,

                item:
                    review.canonicalUrl
            }
        ]
    };
}

/* =========================================================
   REVIEW PAGE BUILD
========================================================= */

function buildReviewPage(
    review
) {
    let html =
        replaceTokens(
            review.originalHtml,
            {
                SLUG:
                    review.slug,

                SITE_NAME:
                    review.siteName,

                REVIEW_TITLE:
                    review.title,

                SEO_DESCRIPTION:
                    review.seoDescription,

                SHORT_DESCRIPTION:
                    review.shortDescription,

                RATING:
                    review.ratingText,

                PUBLISHED_DATE:
                    review.publishedDate,

                MODIFIED_DATE:
                    review.modifiedDate,

                AUTHOR_NAME:
                    review.authorName,

                IMAGE_FILE:
                    path.basename(
                        review.imageSource
                    )
            }
        );

    html =
        replaceSection(
            html,
            MARKERS.header,
            renderHeader(
                "../../../index.html",
                "../../index.html"
            )
        );

    html =
        replaceSection(
            html,
            MARKERS.features,
            renderFeatures(
                review
            )
        );

    html =
        replaceSection(
            html,
            MARKERS.footer,
            renderFooter(
                "../../../index.html",
                "../../index.html"
            )
        );

    html =
        setTitle(
            html,
            `${review.title} | 11Play`
        );

    html =
        setMeta(
            html,
            "name",
            "description",
            review.seoDescription
        );

    html =
        setMeta(
            html,
            "name",
            "author",
            review.authorName
        );

    html =
        setMeta(
            html,
            "name",
            "robots",
            "index, follow, max-image-preview:large"
        );

    html =
        setMeta(
            html,
            "name",
            "review-slug",
            review.slug
        );

    html =
        setMeta(
            html,
            "name",
            "review-site-name",
            review.siteName
        );

    html =
        setMeta(
            html,
            "name",
            "review-title",
            review.title
        );

    html =
        setMeta(
            html,
            "name",
            "review-description",
            review.shortDescription
        );

    html =
        setMeta(
            html,
            "name",
            "review-rating",
            review.ratingText
        );

    html =
        setMeta(
            html,
            "name",
            "review-image",
            review.imageSource
        );

    html =
        setMeta(
            html,
            "name",
            "review-published",
            review.publishedDate
        );

    html =
        setMeta(
            html,
            "name",
            "review-modified",
            review.modifiedDate
        );

    html =
        setMeta(
            html,
            "name",
            "review-status",
            "published"
        );

    if (
        review.relationship
    ) {
        html =
            setMeta(
                html,
                "name",
                "review-relationship",
                review.relationship
            );
    }

    html =
        setCanonical(
            html,
            review.canonicalUrl
        );

    html =
        setMeta(
            html,
            "property",
            "og:type",
            "article"
        );

    html =
        setMeta(
            html,
            "property",
            "og:title",
            review.title
        );

    html =
        setMeta(
            html,
            "property",
            "og:description",
            review.seoDescription
        );

    html =
        setMeta(
            html,
            "property",
            "og:url",
            review.canonicalUrl
        );

    html =
        setMeta(
            html,
            "property",
            "og:image:alt",
            `${review.siteName} রিভিউ ব্যানার`
        );

    html =
        setMeta(
            html,
            "property",
            "article:published_time",
            review.publishedDate
        );

    html =
        setMeta(
            html,
            "property",
            "article:modified_time",
            review.modifiedDate
        );

    html =
        setMeta(
            html,
            "name",
            "twitter:card",
            "summary_large_image"
        );

    html =
        setMeta(
            html,
            "name",
            "twitter:title",
            review.title
        );

    html =
        setMeta(
            html,
            "name",
            "twitter:description",
            review.seoDescription
        );

    if (
        review.absoluteImageUrl
    ) {
        html =
            setMeta(
                html,
                "property",
                "og:image",
                review.absoluteImageUrl
            );

        html =
            setMeta(
                html,
                "name",
                "twitter:image",
                review.absoluteImageUrl
            );
    }

    html =
        setSchema(
            html,
            "Review",
            reviewSchema(
                review
            )
        );

    html =
        setSchema(
            html,
            "BreadcrumbList",
            breadcrumbSchema(
                review
            )
        );

    const leftovers =
        html.match(
            /\{\{[A-Z0-9_]+\}\}/g
        );

    if (
        leftovers?.length
    ) {
        throw new Error(
            [
                `অসম্পূর্ণ placeholder: ${relative(
                    review.pagePath
                )}`,

                ...[
                    ...new Set(
                        leftovers
                    )
                ].map(
                    (item) =>
                        `- ${item}`
                )
            ].join("\n")
        );
    }

    return writeIfChanged(
        review.pagePath,
        html
    );
}

/* =========================================================
   REVIEW INDEX RESULT
========================================================= */

function searchText(
    review
) {
    return clean(
        [
            review.siteName,
            review.title,
            review.shortDescription,
            review.seoDescription,
            review.slug,
            review.ratingText,

            review.isSelfReview
                ? "self review স্ব-মূল্যায়ন"
                : "website review"
        ].join(" ")
    );
}

function renderResult(
    review
) {
    const typeLabel =
        review.isSelfReview
            ? "স্ব-মূল্যায়ন"
            : "Website Review";

    const ratingLabel =
        review.isSelfReview
            ? "অভ্যন্তরীণ স্ব-মূল্যায়ন"
            : "সম্পাদকীয় রেটিং";

    const icon =
        favicon(
            review.siteName
        );

    const media =
        review.indexImageUrl
            ? `<img
                src="${escapeHtml(
                    review.indexImageUrl
                )}"
                alt="${escapeHtml(
                    review.siteName
                )} রিভিউ ব্যানার"
                width="1200"
                height="630"
                loading="lazy"
                decoding="async"
            >`
            : `<div class="review-result__image-fallback" aria-hidden="true">${escapeHtml(
                  icon
              )}</div>`;

    return `<article
    class="review-result"
    data-review-result
    data-review-slug="${escapeHtml(
        review.slug
    )}"
    data-review-rating="${escapeHtml(
        review.ratingText
    )}"
    data-review-date="${escapeHtml(
        review.modifiedDate
    )}"
    data-search-text="${escapeHtml(
        searchText(review)
    )}"
>
    <a
        class="review-result__link"
        href="${escapeHtml(
            review.relativeUrl
        )}"
        aria-label="${escapeHtml(
            `${review.siteName}-এর পূর্ণাঙ্গ রিভিউ পড়ুন`
        )}"
    >
        <div class="review-result__media">
            ${media}
        </div>

        <div class="review-result__content">

            <div class="review-result__url">

                <span
                    class="review-result__favicon"
                    aria-hidden="true"
                >
                    ${escapeHtml(
                        icon
                    )}
                </span>

                <span>
                    ${escapeHtml(
                        review.canonicalUrl
                    )}
                </span>

            </div>

            <h3 class="review-result__title">
                ${escapeHtml(
                    review.title
                )}
            </h3>

            <div
                class="review-result__rating"
                aria-label="${escapeHtml(
                    `${review.ratingText} আউট অফ ৫`
                )}"
            >

                <span
                    class="review-result__stars"
                    aria-hidden="true"
                >
                    ${stars(
                        review.rating
                    )}
                </span>

                <strong>
                    ${escapeHtml(
                        review.ratingText
                    )}/5
                </strong>

                <span>
                    ${escapeHtml(
                        ratingLabel
                    )}
                </span>

            </div>

            <p class="review-result__description">
                ${escapeHtml(
                    review.shortDescription
                )}
            </p>

            <div class="review-result__meta">

                <span>
                    ${escapeHtml(
                        typeLabel
                    )}
                </span>

                <time
                    datetime="${escapeHtml(
                        review.modifiedDate
                    )}"
                >
                    ${escapeHtml(
                        displayDate(
                            review.modifiedDate
                        )
                    )}
                </time>

            </div>

        </div>

    </a>

</article>`;
}

/* =========================================================
   REVIEW INDEX SCHEMA
========================================================= */

function indexSchema(
    reviews
) {
    return {
        "@context":
            "https://schema.org",

        "@type":
            "ItemList",

        name:
            "11Play Website Reviews",

        description:
            "বাংলা ভাষায় বিস্তারিত ওয়েবসাইট রিভিউ।",

        url:
            `${CONFIG.baseUrl}/reviews/`,

        numberOfItems:
            reviews.length,

        itemListOrder:
            "https://schema.org/ItemListOrderDescending",

        itemListElement:
            reviews.map(
                (
                    review,
                    index
                ) => ({
                    "@type":
                        "ListItem",

                    position:
                        index + 1,

                    name:
                        review.title,

                    url:
                        review.canonicalUrl
                })
            )
    };
}

/* =========================================================
   REVIEW INDEX BUILD
========================================================= */

function buildIndex(
    reviews
) {
    let html =
        read(
            CONFIG.indexTemplate
        );

    const newest =
        latestDate(reviews);

    const results =
        reviews.length
            ? reviews
                  .map(
                      renderResult
                  )
                  .join(
                      "\n\n"
                  )
            : `<div class="reviews-empty-state" data-build-placeholder>
    <h3>
        এখনো কোনো রিভিউ প্রকাশিত হয়নি
    </h3>

    <p>
        নতুন published review যোগ হলে এটি এখানে দেখা যাবে।
    </p>
</div>`;

    const schema = [
        '<script type="application/ld+json">',
        JSON.stringify(
            indexSchema(
                reviews
            ),
            null,
            4
        ),
        "</script>"
    ].join("\n");

    html =
        replaceSection(
            html,
            MARKERS.header,
            renderHeader(
                "../index.html",
                "./index.html",
                "reviews"
            )
        );

    html =
        replaceSection(
            html,
            MARKERS.results,
            results
        );

    html =
        replaceSection(
            html,
            MARKERS.count,
            `${bnNumber(
                reviews.length
            )}টি রিভিউ`
        );

    html =
        replaceSection(
            html,
            MARKERS.updated,
            displayDate(
                newest
            )
        );

    html =
        html.replace(
            /(<time\b[^>]*id=["']reviews-last-updated["'][^>]*\bdatetime=["'])[^"']*(["'][^>]*>)/i,
            `$1${newest}$2`
        );

    html =
        replaceSection(
            html,
            MARKERS.schema,
            schema
        );

    html =
        replaceSection(
            html,
            MARKERS.footer,
            renderFooter(
                "../index.html",
                "./index.html"
            )
        );

    return writeIfChanged(
        CONFIG.indexOutput,
        html
    );
}

/* =========================================================
   SITEMAP
========================================================= */

function parseSitemap(xml) {
    return (
        String(xml || "").match(
            /<url>[\s\S]*?<\/url>/gi
        ) || []
    )
        .map(
            (block) => ({
                block,

                loc:
                    clean(
                        block.match(
                            /<loc>\s*([\s\S]*?)\s*<\/loc>/i
                        )?.[1] ||
                            ""
                    )
            })
        )
        .filter(
            ({ loc }) =>
                loc
        );
}

function sitemapBlock(
    entry
) {
    return `  <url>
    <loc>${escapeXml(
        entry.loc
    )}</loc>
    <lastmod>${escapeXml(
        entry.lastmod
    )}</lastmod>
    <changefreq>${escapeXml(
        entry.changefreq
    )}</changefreq>
    <priority>${escapeXml(
        entry.priority
    )}</priority>
  </url>`;
}

function isReviewUrl(url) {
    const normalized =
        trimSlash(url);

    const root =
        `${trimSlash(
            CONFIG.baseUrl
        )}/reviews`;

    return (
        normalized === root ||
        normalized.startsWith(
            `${root}/`
        )
    );
}

function buildSitemap(
    reviews
) {
    const current =
        exists(
            CONFIG.sitemap
        )
            ? read(
                  CONFIG.sitemap
              )
            : "";

    if (
        /<sitemapindex\b/i.test(
            current
        )
    ) {
        throw new Error(
            "sitemap.xml একটি sitemap index; urlset sitemap প্রয়োজন।"
        );
    }

    const blocks = [];
    const seen =
        new Set();

    const preserved =
        parseSitemap(
            current
        ).filter(
            ({ loc }) =>
                !isReviewUrl(
                    loc
                )
        );

    for (
        const entry
        of preserved
    ) {
        const key =
            trimSlash(
                entry.loc
            );

        if (
            seen.has(key)
        ) {
            continue;
        }

        seen.add(key);

        blocks.push(
            entry.block.trim()
        );
    }

    const newest =
        latestDate(
            reviews
        );

    const generated = [
        {
            loc:
                `${CONFIG.baseUrl}/reviews/`,

            lastmod:
                newest,

            changefreq:
                "daily",

            priority:
                "0.9"
        },

        ...reviews.map(
            (review) => ({
                loc:
                    review.canonicalUrl,

                lastmod:
                    review.modifiedDate ||
                    review.publishedDate,

                changefreq:
                    "weekly",

                priority:
                    "0.8"
            })
        )
    ];

    for (
        const entry
        of generated
    ) {
        const key =
            trimSlash(
                entry.loc
            );

        if (
            seen.has(key)
        ) {
            continue;
        }

        seen.add(key);

        blocks.push(
            sitemapBlock(
                entry
            )
        );
    }

    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${blocks.join("\n\n")}

</urlset>`;

    return writeIfChanged(
        CONFIG.sitemap,
        xml
    );
}

/* =========================================================
   VALIDATION
========================================================= */

function validate() {
    const required = [
        CONFIG.indexTemplate,
        CONFIG.reviewCss,
        CONFIG.reviewSearch,
        CONFIG.header,
        CONFIG.features,
        CONFIG.footer
    ];

    const missing =
        required.filter(
            (filePath) =>
                !exists(
                    filePath
                )
        );

    if (
        missing.length
    ) {
        throw new Error(
            [
                "Review build-এর প্রয়োজনীয় ফাইল পাওয়া যায়নি:",

                ...missing.map(
                    (filePath) =>
                        `- ${relative(
                            filePath
                        )}`
                )
            ].join("\n")
        );
    }
}

/* =========================================================
   MAIN BUILD
========================================================= */

function run() {
    info(
        "Review build শুরু হয়েছে।"
    );

    validate();

    const reviews =
        loadReviews();

    let updatedPages =
        0;

    for (
        const review
        of reviews
    ) {
        if (
            buildReviewPage(
                review
            )
        ) {
            updatedPages += 1;

            info(
                `Review page আপডেট: ${relative(
                    review.pagePath
                )}`
            );
        }
    }

    const indexUpdated =
        buildIndex(
            reviews
        );

    const sitemapUpdated =
        buildSitemap(
            reviews
        );

    if (
        indexUpdated
    ) {
        info(
            "reviews/index.html আপডেট হয়েছে।"
        );
    }

    if (
        sitemapUpdated
    ) {
        info(
            "sitemap.xml আপডেট হয়েছে।"
        );
    }

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "11PLAY REVIEW BUILD COMPLETE"
    );

    console.log(
        "========================================"
    );

    console.log(
        `Published reviews: ${reviews.length}`
    );

    console.log(
        `Updated review pages: ${updatedPages}`
    );

    console.log(
        `Review index updated: ${
            indexUpdated
                ? "Yes"
                : "No"
        }`
    );

    console.log(
        `Sitemap updated: ${
            sitemapUpdated
                ? "Yes"
                : "No"
        }`
    );

    console.log(
        "========================================"
    );
}

/* =========================================================
   ERROR HANDLING
========================================================= */

try {
    run();
} catch (error) {
    fail(
        error instanceof Error
            ? error.message
            : String(error)
    );

    process.exitCode = 1;
}