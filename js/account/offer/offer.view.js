"use strict";

/* =========================================================
   11PLAY — OFFER VIEW
   File: js/account/offer/offer.view.js

   Responsibilities:
   - Render the file-controlled 11Play Offer page
   - Read Offer content from window.OfferData
   - Render offer title, image, description and rules
   - Render the important offer note
   - Provide stable controls for Register Now
   - Provide stable controls for Live Chat navigation
   - Provide stable selectors for OfferModule

   Important:
   - This file renders markup only
   - Offer content comes from js/config/offer.data.js
   - No Firebase read/write occurs here
   - No authentication logic occurs here
   - No referral/reward/wallet logic occurs here
   - Button actions are handled by OfferModule
========================================================= */

const OfferView = (() => {
    "use strict";

    /* =====================================================
       DEFAULT DATA
    ===================================================== */

    const DEFAULT_OFFER =
        Object.freeze({
            enabled:
                false,

            id:
                "11play-offer",

            title:
                "11Play Offer",

            description:
                "",

            image:
                "",

            imageAlt:
                "11Play Offer",

            rules:
                Object.freeze([]),

            note:
                "",

            button:
                Object.freeze({
                    label:
                        "Register Now",

                    url:
                        "",

                    openInNewTab:
                        true
                }),

            liveChat:
                Object.freeze({
                    label:
                        "Contact Live Chat",

                    page:
                        "live-chat"
                })
        });

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizeString(
        value,
        fallback = ""
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }

        const normalizedValue =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
        );
    }

    function normalizeBoolean(
        value,
        fallback = false
    ) {
        if (
            value === true
        ) {
            return true;
        }

        if (
            value === false
        ) {
            return false;
        }

        return fallback;
    }

    function isPlainObject(
        value
    ) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(
                value
            );

        return (
            prototype ===
                Object.prototype ||
            prototype ===
                null
        );
    }

    function escapeHTML(
        value
    ) {
        return normalizeString(
            value
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    function normalizeRules(
        value
    ) {
        if (
            !Array.isArray(value)
        ) {
            return [];
        }

        return value
            .map(
                rule =>
                    normalizeString(
                        rule
                    )
            )
            .filter(
                Boolean
            );
    }

    /* =====================================================
       OFFER DATA
    ===================================================== */

    function getOfferData() {
        const source =
            isPlainObject(
                window.OfferData
            )
                ? window.OfferData
                : {};

        const sourceButton =
            isPlainObject(
                source.button
            )
                ? source.button
                : {};

        const sourceLiveChat =
            isPlainObject(
                source.liveChat
            )
                ? source.liveChat
                : {};

        return {
            enabled:
                normalizeBoolean(
                    source.enabled,
                    DEFAULT_OFFER.enabled
                ),

            id:
                normalizeString(
                    source.id,
                    DEFAULT_OFFER.id
                ),

            title:
                normalizeString(
                    source.title,
                    DEFAULT_OFFER.title
                ),

            description:
                normalizeString(
                    source.description,
                    DEFAULT_OFFER.description
                ),

            image:
                normalizeString(
                    source.image,
                    DEFAULT_OFFER.image
                ),

            imageAlt:
                normalizeString(
                    source.imageAlt,
                    source.title ||
                    DEFAULT_OFFER.imageAlt
                ),

            rules:
                normalizeRules(
                    source.rules
                ),

            note:
                normalizeString(
                    source.note,
                    DEFAULT_OFFER.note
                ),

            button: {
                label:
                    normalizeString(
                        sourceButton.label,
                        DEFAULT_OFFER
                            .button
                            .label
                    ),

                url:
                    normalizeString(
                        sourceButton.url,
                        DEFAULT_OFFER
                            .button
                            .url
                    ),

                openInNewTab:
                    normalizeBoolean(
                        sourceButton
                            .openInNewTab,
                        DEFAULT_OFFER
                            .button
                            .openInNewTab
                    )
            },

            liveChat: {
                label:
                    normalizeString(
                        sourceLiveChat.label,
                        DEFAULT_OFFER
                            .liveChat
                            .label
                    ),

                page:
                    normalizeString(
                        sourceLiveChat.page,
                        DEFAULT_OFFER
                            .liveChat
                            .page
                    )
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            "-"
                        )
            }
        };
    }

    /* =====================================================
       OFFER IMAGE
    ===================================================== */

    function renderOfferImage(
        offer
    ) {
        if (
            !offer.image
        ) {
            return "";
        }

        return `
            <div
                class="offer-image-container"
                data-offer-image-container
            >
                <img
                    id="offerImage"
                    class="offer-image"
                    src="${escapeHTML(
                        offer.image
                    )}"
                    alt="${escapeHTML(
                        offer.imageAlt
                    )}"
                    loading="eager"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    data-offer-image
                >
            </div>
        `;
    }

    /* =====================================================
       OFFER DESCRIPTION
    ===================================================== */

    function renderDescription(
        offer
    ) {
        if (
            !offer.description
        ) {
            return "";
        }

        return `
            <p
                id="offerDescription"
                class="offer-description"
            >
                ${escapeHTML(
                    offer.description
                )}
            </p>
        `;
    }

    /* =====================================================
       OFFER RULES
    ===================================================== */

    function renderRules(
        offer
    ) {
        if (
            offer.rules.length ===
                0
        ) {
            return "";
        }

        const ruleItems =
            offer.rules
                .map(
                    (
                        rule,
                        index
                    ) => `
                        <li
                            class="offer-rule-item"
                            data-offer-rule
                            data-rule-index="${index}"
                        >
                            <span
                                class="offer-rule-number"
                                aria-hidden="true"
                            >
                                ${index + 1}
                            </span>

                            <span class="offer-rule-text">
                                ${escapeHTML(
                                    rule
                                )}
                            </span>
                        </li>
                    `
                )
                .join("");

        return `
            <section
                id="offerRulesSection"
                class="offer-rules-section"
                aria-labelledby="offerRulesTitle"
            >
                <h2
                    id="offerRulesTitle"
                    class="offer-section-title"
                >
                    Rules & How to Claim
                </h2>

                <ol
                    id="offerRulesList"
                    class="offer-rules-list"
                >
                    ${ruleItems}
                </ol>
            </section>
        `;
    }

    /* =====================================================
       OFFER NOTE
    ===================================================== */

    function renderNote(
        offer
    ) {
        if (
            !offer.note
        ) {
            return "";
        }

        return `
            <aside
                id="offerImportantNote"
                class="offer-important-note"
                aria-label="Important offer information"
            >
                <span
                    class="offer-important-note-icon"
                    aria-hidden="true"
                >
                    !
                </span>

                <div class="offer-important-note-content">
                    <strong>
                        Important
                    </strong>

                    <p>
                        ${escapeHTML(
                            offer.note
                        )}
                    </p>
                </div>
            </aside>
        `;
    }

    /* =====================================================
       OFFER ACTIONS
    ===================================================== */

    function renderActions(
        offer
    ) {
        const registerDisabled =
            !offer.enabled ||
            !offer.button.url;

        const liveChatDisabled =
            !offer.liveChat.page;

        return `
            <div
                id="offerActions"
                class="offer-actions"
            >
                <button
                    id="offerLiveChatButton"
                    class="offer-action-button offer-live-chat-button"
                    type="button"
                    data-offer-action="live-chat"
                    data-page="${escapeHTML(
                        offer.liveChat.page
                    )}"
                    ${liveChatDisabled
                        ? `disabled aria-disabled="true"`
                        : `aria-disabled="false"`}
                >
                    <span
                        class="offer-action-icon"
                        aria-hidden="true"
                    >
                        💬
                    </span>

                    <span>
                        ${escapeHTML(
                            offer.liveChat.label
                        )}
                    </span>
                </button>

                <button
                    id="offerRegisterButton"
                    class="offer-action-button offer-register-button"
                    type="button"
                    data-offer-action="register"
                    data-url="${escapeHTML(
                        offer.button.url
                    )}"
                    data-open-new-tab="${String(
                        offer.button
                            .openInNewTab
                    )}"
                    ${registerDisabled
                        ? `disabled aria-disabled="true"`
                        : `aria-disabled="false"`}
                >
                    <span>
                        ${escapeHTML(
                            offer.button.label
                        )}
                    </span>

                    <span
                        class="offer-action-arrow"
                        aria-hidden="true"
                    >
                        →
                    </span>
                </button>
            </div>
        `;
    }

    /* =====================================================
       UNAVAILABLE STATE
    ===================================================== */

    function renderUnavailableState() {
        return `
            <div
                id="offerUnavailableState"
                class="offer-unavailable-state"
                role="status"
            >
                <span
                    class="offer-unavailable-icon"
                    aria-hidden="true"
                >
                    🎁
                </span>

                <h2>
                    No Offer Available
                </h2>

                <p>
                    There is no active 11Play offer at the moment.
                    Please check again later.
                </p>
            </div>
        `;
    }

    /* =====================================================
       TEMPLATE
    ===================================================== */

    function getTemplate() {
        const offer =
            getOfferData();

        return `
            <main
                id="offerPage"
                class="offer-page"
                data-account-page="offer"
                data-offer-id="${escapeHTML(
                    offer.id
                )}"
                data-offer-enabled="${String(
                    offer.enabled
                )}"
                aria-labelledby="offerPageTitle"
            >
                <section
                    id="offerCard"
                    class="offer-card"
                    aria-labelledby="offerPageTitle"
                >
                    <header class="offer-header">
                        <div
                            class="offer-header-icon"
                            aria-hidden="true"
                        >
                            🎁
                        </div>

                        <div class="offer-header-content">
                            <span class="offer-eyebrow">
                                11Play Offer
                            </span>

                            <h1
                                id="offerPageTitle"
                                class="offer-title"
                            >
                                ${escapeHTML(
                                    offer.title
                                )}
                            </h1>

                            ${renderDescription(
                                offer
                            )}
                        </div>
                    </header>

                    ${
                        offer.enabled
                            ? `
                                ${renderOfferImage(
                                    offer
                                )}

                                ${renderRules(
                                    offer
                                )}

                                ${renderNote(
                                    offer
                                )}

                                ${renderActions(
                                    offer
                                )}
                            `
                            : renderUnavailableState()
                    }
                </section>

                <div
                    id="offerPageStatus"
                    class="offer-page-status"
                    role="status"
                    aria-live="polite"
                    hidden
                ></div>
            </main>
        `;
    }

    /* =====================================================
       ROOT RESOLUTION
    ===================================================== */

    function resolveRoot(
        root
    ) {
        if (
            root instanceof
                HTMLElement
        ) {
            return root;
        }

        if (
            typeof root ===
                "string" &&
            root.trim()
        ) {
            return document
                .querySelector(
                    root.trim()
                );
        }

        return null;
    }

    /* =====================================================
       RENDER
    ===================================================== */

    function render(
        root
    ) {
        const targetRoot =
            resolveRoot(
                root
            );

        if (
            !(
                targetRoot instanceof
                    HTMLElement
            )
        ) {
            console.error(
                "[OfferView] A valid root element is required."
            );

            return false;
        }

        targetRoot.innerHTML =
            getTemplate();

        return (
            targetRoot
                .querySelector(
                    "#offerPage"
                ) ||
            false
        );
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        getTemplate,
        render,
        getOfferData
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.OfferView =
    OfferView;