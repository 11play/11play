"use strict";

/* =========================================================
   11PLAY — LIVE CHAT VIEW
   File: js/account/live-chat/live-chat.view.js

   Responsibilities:
   - Render the 11Play Live Chat page
   - Read display/support configuration from window.SupportConfig
   - Render support title, description and topics
   - Render the important support note
   - Provide a stable Start Live Chat button
   - Provide stable selectors for LiveChatModule
   - Show an unavailable state only when Live Chat is disabled

   Current provider:
   - tawk.to

   Important:
   - This file renders markup only
   - tawk.to loading/opening is handled by:
     js/account/live-chat/live-chat.module.js
   - Support text/configuration comes from:
     js/config/support.config.js
   - No external chat URL is required here
   - No Firebase read/write occurs here
   - No authentication logic occurs here
   - No referral/reward/wallet logic occurs here
========================================================= */

const LiveChatView = (() => {
    "use strict";

    /* =====================================================
       DEFAULT CONFIGURATION
    ===================================================== */

    const DEFAULT_CONFIG =
        Object.freeze({
            enabled:
                false,

            title:
                "11Play Live Chat",

            subtitle:
                "Need help? Contact our support team.",

            description:
                "",

            button:
                Object.freeze({
                    label:
                        "Start Live Chat"
                }),

            availability:
                Object.freeze({
                    title:
                        "Support",

                    text:
                        "Contact Live Chat whenever you need assistance."
                }),

            topics:
                Object.freeze([]),

            note:
                ""
        });

    /* =====================================================
       HELPERS
    ===================================================== */

    function isPlainObject(value) {
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

        const normalized =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalized ||
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

    function escapeHTML(value) {
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

    function normalizeTopics(value) {
        if (
            !Array.isArray(
                value
            )
        ) {
            return [];
        }

        return value
            .map(
                topic =>
                    normalizeString(
                        topic
                    )
            )
            .filter(
                Boolean
            );
    }

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    function getSupportConfig() {
        const source =
            isPlainObject(
                window.SupportConfig
            )
                ? window.SupportConfig
                : {};

        const button =
            isPlainObject(
                source.button
            )
                ? source.button
                : {};

        const availability =
            isPlainObject(
                source.availability
            )
                ? source.availability
                : {};

        return {
            enabled:
                normalizeBoolean(
                    source.enabled,
                    DEFAULT_CONFIG.enabled
                ),

            title:
                normalizeString(
                    source.title,
                    DEFAULT_CONFIG.title
                ),

            subtitle:
                normalizeString(
                    source.subtitle,
                    DEFAULT_CONFIG.subtitle
                ),

            description:
                normalizeString(
                    source.description,
                    DEFAULT_CONFIG.description
                ),

            button: {
                label:
                    normalizeString(
                        button.label,
                        DEFAULT_CONFIG
                            .button
                            .label
                    )
            },

            availability: {
                title:
                    normalizeString(
                        availability.title,
                        DEFAULT_CONFIG
                            .availability
                            .title
                    ),

                text:
                    normalizeString(
                        availability.text,
                        DEFAULT_CONFIG
                            .availability
                            .text
                    )
            },

            topics:
                normalizeTopics(
                    source.topics
                ),

            note:
                normalizeString(
                    source.note,
                    DEFAULT_CONFIG.note
                )
        };
    }

    /* =====================================================
       SUPPORT TOPICS
    ===================================================== */

    function renderTopics(
        config
    ) {
        if (
            config.topics.length ===
                0
        ) {
            return "";
        }

        const items =
            config.topics
                .map(
                    (
                        topic,
                        index
                    ) => `
                        <li
                            class="live-chat-topic-item"
                            data-live-chat-topic
                            data-topic-index="${index}"
                        >
                            <span
                                class="live-chat-topic-icon"
                                aria-hidden="true"
                            >
                                ✓
                            </span>

                            <span class="live-chat-topic-text">
                                ${escapeHTML(
                                    topic
                                )}
                            </span>
                        </li>
                    `
                )
                .join("");

        return `
            <section
                id="liveChatTopicsSection"
                class="live-chat-topics-section"
                aria-labelledby="liveChatTopicsTitle"
            >
                <h2
                    id="liveChatTopicsTitle"
                    class="live-chat-section-title"
                >
                    How We Can Help
                </h2>

                <ul
                    id="liveChatTopicsList"
                    class="live-chat-topics-list"
                >
                    ${items}
                </ul>
            </section>
        `;
    }

    /* =====================================================
       AVAILABILITY
    ===================================================== */

    function renderAvailability(
        config
    ) {
        if (
            !config.availability.title &&
            !config.availability.text
        ) {
            return "";
        }

        return `
            <section
                id="liveChatAvailability"
                class="live-chat-availability"
                aria-labelledby="liveChatAvailabilityTitle"
            >
                <span
                    class="live-chat-availability-icon"
                    aria-hidden="true"
                >
                    💬
                </span>

                <div class="live-chat-availability-content">
                    <h2
                        id="liveChatAvailabilityTitle"
                    >
                        ${escapeHTML(
                            config.availability.title
                        )}
                    </h2>

                    <p>
                        ${escapeHTML(
                            config.availability.text
                        )}
                    </p>
                </div>
            </section>
        `;
    }

    /* =====================================================
       NOTE
    ===================================================== */

    function renderNote(
        config
    ) {
        if (
            !config.note
        ) {
            return "";
        }

        return `
            <aside
                id="liveChatImportantNote"
                class="live-chat-important-note"
                aria-label="Important support information"
            >
                <span
                    class="live-chat-important-note-icon"
                    aria-hidden="true"
                >
                    !
                </span>

                <div class="live-chat-important-note-content">
                    <strong>
                        Important
                    </strong>

                    <p>
                        ${escapeHTML(
                            config.note
                        )}
                    </p>
                </div>
            </aside>
        `;
    }

    /* =====================================================
       CHAT ACTION
    ===================================================== */

    function renderAction(
        config
    ) {
        const disabled =
            config.enabled !==
                true;

        return `
            <div
                id="liveChatActions"
                class="live-chat-actions"
            >
                <button
                    id="liveChatStartButton"
                    class="live-chat-start-button"
                    type="button"
                    data-live-chat-action="start"
                    data-chat-provider="tawk"
                    ${disabled
                        ? `disabled aria-disabled="true"`
                        : `aria-disabled="false"`}
                >
                    <span
                        class="live-chat-start-icon"
                        aria-hidden="true"
                    >
                        💬
                    </span>

                    <span>
                        ${escapeHTML(
                            config.button.label
                        )}
                    </span>

                    <span
                        class="live-chat-start-arrow"
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
                id="liveChatUnavailableState"
                class="live-chat-unavailable-state"
                role="status"
            >
                <span
                    class="live-chat-unavailable-icon"
                    aria-hidden="true"
                >
                    💬
                </span>

                <h2>
                    Live Chat Unavailable
                </h2>

                <p>
                    Live Chat is currently unavailable.
                    Please try again later.
                </p>
            </div>
        `;
    }

    /* =====================================================
       TEMPLATE
    ===================================================== */

    function getTemplate() {
        const config =
            getSupportConfig();

        const canOpenChat =
            config.enabled ===
                true;

        return `
            <main
                id="liveChatPage"
                class="live-chat-page"
                data-account-page="live-chat"
                data-live-chat-enabled="${String(
                    config.enabled
                )}"
                data-live-chat-provider="tawk"
                aria-labelledby="liveChatPageTitle"
            >
                <section
                    id="liveChatCard"
                    class="live-chat-card"
                    aria-labelledby="liveChatPageTitle"
                >
                    <header class="live-chat-header">
                        <div
                            class="live-chat-header-icon"
                            aria-hidden="true"
                        >
                            💬
                        </div>

                        <div class="live-chat-header-content">
                            <span class="live-chat-eyebrow">
                                11Play Support
                            </span>

                            <h1
                                id="liveChatPageTitle"
                                class="live-chat-title"
                            >
                                ${escapeHTML(
                                    config.title
                                )}
                            </h1>

                            <p class="live-chat-subtitle">
                                ${escapeHTML(
                                    config.subtitle
                                )}
                            </p>

                            ${
                                config.description
                                    ? `
                                        <p
                                            id="liveChatDescription"
                                            class="live-chat-description"
                                        >
                                            ${escapeHTML(
                                                config.description
                                            )}
                                        </p>
                                    `
                                    : ""
                            }
                        </div>
                    </header>

                    ${
                        canOpenChat
                            ? `
                                ${renderAvailability(
                                    config
                                )}

                                ${renderTopics(
                                    config
                                )}

                                ${renderNote(
                                    config
                                )}

                                ${renderAction(
                                    config
                                )}
                            `
                            : `
                                ${renderUnavailableState()}

                                ${renderTopics(
                                    config
                                )}

                                ${renderNote(
                                    config
                                )}
                            `
                    }
                </section>

                <div
                    id="liveChatPageStatus"
                    class="live-chat-page-status"
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
            try {
                return document
                    .querySelector(
                        root.trim()
                    );
            } catch {
                return null;
            }
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
                "[LiveChatView] A valid root element is required."
            );

            return false;
        }

        targetRoot.innerHTML =
            getTemplate();

        return (
            targetRoot
                .querySelector(
                    "#liveChatPage"
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
        getSupportConfig
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.LiveChatView =
    LiveChatView;