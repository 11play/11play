"use strict";

/* =========================================================
   11PLAY — OFFER MODULE
   File: js/account/offer/offer.module.js

   Responsibilities:
   - Initialize the Offer page runtime
   - Handle Register Now navigation safely
   - Handle Live Chat internal navigation
   - Handle missing or failed Offer images gracefully
   - Show Offer-page status messages when necessary
   - Clean up only Offer-page listeners
   - Destroy itself when the rendered Offer page is removed

   Important:
   - Offer content comes from js/config/offer.data.js
   - Offer markup comes from offer.view.js
   - No Firebase read/write occurs here
   - No authentication is required to view the Offer
   - No referral/reward/wallet logic exists here
   - Main Router remains responsible for SPA navigation
========================================================= */

const OfferModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const OFFER_PAGE_NAME =
        "offer";

    const DEFAULT_LIVE_CHAT_PAGE =
        "live-chat";

    const STATUS_DURATION_MS =
        5000;

    const ALLOWED_PROTOCOLS =
        new Set([
            "http:",
            "https:"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        controller:
            null,

        pageObserver:
            null,

        statusTimer:
            null,

        lifecycleGeneration:
            0
    };

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

    function normalizePage(
        value,
        fallback = ""
    ) {
        return normalizeString(
            value,
            fallback
        )
            .toLowerCase()
            .replace(
                /\s+/g,
                "-"
            );
    }

    function resolveURL(
        value
    ) {
        const url =
            normalizeString(
                value
            );

        if (!url) {
            return null;
        }

        try {
            const resolvedURL =
                new URL(
                    url,
                    window.location.href
                );

            if (
                !ALLOWED_PROTOCOLS.has(
                    resolvedURL.protocol
                )
            ) {
                return null;
            }

            return resolvedURL;
        } catch {
            return null;
        }
    }

    function isSameOriginURL(
        url
    ) {
        return Boolean(
            url instanceof URL &&
            url.origin ===
                window.location.origin
        );
    }

    function getElement(
        selector
    ) {
        if (
            !state.page ||
            !selector
        ) {
            return null;
        }

        try {
            return state.page
                .querySelector(
                    selector
                );
        } catch {
            return null;
        }
    }

    /* =====================================================
       OFFER DATA
    ===================================================== */

    function getOfferData() {
        if (
            window.OfferView &&
            typeof window.OfferView
                .getOfferData ===
                "function"
        ) {
            try {
                return window.OfferView
                    .getOfferData();
            } catch (error) {
                console.warn(
                    "[OfferModule] Offer data could not be read from OfferView.",
                    error
                );
            }
        }

        return (
            window.OfferData ||
            null
        );
    }

    function isOfferEnabled() {
        const offer =
            getOfferData();

        return offer?.enabled ===
            true;
    }

    /* =====================================================
       STATUS
    ===================================================== */

    function clearStatusTimer() {
        if (
            state.statusTimer
        ) {
            window.clearTimeout(
                state.statusTimer
            );

            state.statusTimer =
                null;
        }
    }

    function getStatusElement() {
        return getElement(
            "#offerPageStatus"
        );
    }

    function hideStatus() {
        clearStatusTimer();

        const status =
            getStatusElement();

        if (!status) {
            return false;
        }

        status.hidden =
            true;

        status.textContent =
            "";

        delete status.dataset
            .statusType;

        status.classList.remove(
            "is-success",
            "is-error",
            "is-info"
        );

        return true;
    }

    function showStatus(
        message,
        type = "info",
        duration =
            STATUS_DURATION_MS
    ) {
        const status =
            getStatusElement();

        if (!status) {
            return false;
        }

        clearStatusTimer();

        const normalizedMessage =
            normalizeString(
                message
            );

        if (!normalizedMessage) {
            return hideStatus();
        }

        const normalizedType =
            [
                "success",
                "error",
                "info"
            ].includes(type)
                ? type
                : "info";

        status.textContent =
            normalizedMessage;

        status.hidden =
            false;

        status.dataset.statusType =
            normalizedType;

        status.classList.toggle(
            "is-success",
            normalizedType ===
                "success"
        );

        status.classList.toggle(
            "is-error",
            normalizedType ===
                "error"
        );

        status.classList.toggle(
            "is-info",
            normalizedType ===
                "info"
        );

        if (
            duration >
                0
        ) {
            state.statusTimer =
                window.setTimeout(
                    () => {
                        hideStatus();
                    },
                    duration
                );
        }

        return true;
    }

    /* =====================================================
       BUTTON STATE
    ===================================================== */

    function setButtonLoading(
        button,
        loading
    ) {
        if (
            !(
                button instanceof
                    HTMLButtonElement
            )
        ) {
            return false;
        }

        const isLoading =
            Boolean(
                loading
            );

        button.classList.toggle(
            "is-loading",
            isLoading
        );

        button.setAttribute(
            "aria-busy",
            String(
                isLoading
            )
        );

        if (
            isLoading
        ) {
            button.dataset
                .previousDisabled =
                String(
                    button.disabled
                );

            button.disabled =
                true;
        } else {
            const wasDisabled =
                button.dataset
                    .previousDisabled ===
                "true";

            button.disabled =
                wasDisabled;

            delete button.dataset
                .previousDisabled;
        }

        return true;
    }

    /* =====================================================
       LIVE CHAT NAVIGATION
    ===================================================== */

    function openLiveChat(
        button = null
    ) {
        const page =
            normalizePage(
                button?.dataset?.page,
                DEFAULT_LIVE_CHAT_PAGE
            );

        if (!page) {
            showStatus(
                "Live Chat is currently unavailable.",
                "error"
            );

            return false;
        }

        if (
            !window.Router ||
            typeof window.Router
                .navigate !==
                "function"
        ) {
            console.error(
                "[OfferModule] Main Router is unavailable."
            );

            showStatus(
                "Live Chat could not be opened.",
                "error"
            );

            return false;
        }

        try {
            window.Router
                .navigate(
                    page
                );

            return true;
        } catch (error) {
            console.error(
                "[OfferModule] Live Chat navigation failed.",
                error
            );

            showStatus(
                "Live Chat could not be opened.",
                "error"
            );

            return false;
        }
    }

    /* =====================================================
       REGISTER NOW
    ===================================================== */

    function openRegisterURL(
        button
    ) {
        if (
            !(
                button instanceof
                    HTMLElement
            )
        ) {
            return false;
        }

        if (
            button.getAttribute(
                "aria-disabled"
            ) ===
                "true" ||
            button.disabled ===
                true
        ) {
            return false;
        }

        if (
            !isOfferEnabled()
        ) {
            showStatus(
                "This offer is not currently available.",
                "info"
            );

            return false;
        }

        const resolvedURL =
            resolveURL(
                button.dataset.url
            );

        if (!resolvedURL) {
            console.error(
                "[OfferModule] Register URL is missing or invalid."
            );

            showStatus(
                "Registration link is currently unavailable.",
                "error"
            );

            return false;
        }

        const openInNewTab =
            button.dataset
                .openNewTab !==
            "false";

        try {
            setButtonLoading(
                button,
                true
            );

            /*
             * Same-origin links may use normal browser
             * navigation. External offer links are isolated
             * with noopener/noreferrer.
             */

            if (
                !openInNewTab &&
                isSameOriginURL(
                    resolvedURL
                )
            ) {
                window.location.assign(
                    resolvedURL.href
                );

                return true;
            }

            if (
                !openInNewTab
            ) {
                window.location.assign(
                    resolvedURL.href
                );

                return true;
            }

            const openedWindow =
                window.open(
                    resolvedURL.href,
                    "_blank",
                    "noopener,noreferrer"
                );

            if (openedWindow) {
                openedWindow.opener =
                    null;

                setButtonLoading(
                    button,
                    false
                );

                return true;
            }

            /*
             * Popup blockers can reject window.open().
             * Fall back to current-tab navigation so the CTA
             * remains functional.
             */

            setButtonLoading(
                button,
                false
            );

            window.location.assign(
                resolvedURL.href
            );

            return true;
        } catch (error) {
            setButtonLoading(
                button,
                false
            );

            console.error(
                "[OfferModule] Registration navigation failed.",
                error
            );

            showStatus(
                "Registration link could not be opened.",
                "error"
            );

            return false;
        }
    }

    /* =====================================================
       OFFER IMAGE
    ===================================================== */

    function handleImageLoad(
        event
    ) {
        const image =
            event.currentTarget;

        if (
            !(
                image instanceof
                    HTMLImageElement
            )
        ) {
            return;
        }

        image.classList.add(
            "is-loaded"
        );

        image.classList.remove(
            "is-error"
        );

        const container =
            image.closest(
                "[data-offer-image-container]"
            );

        container?.classList
            .add(
                "has-image"
            );

        container?.classList
            .remove(
                "has-image-error"
            );
    }

    function handleImageError(
        event
    ) {
        const image =
            event.currentTarget;

        if (
            !(
                image instanceof
                    HTMLImageElement
            )
        ) {
            return;
        }

        image.classList.remove(
            "is-loaded"
        );

        image.classList.add(
            "is-error"
        );

        image.hidden =
            true;

        const container =
            image.closest(
                "[data-offer-image-container]"
            );

        if (container) {
            container.classList
                .remove(
                    "has-image"
                );

            container.classList
                .add(
                    "has-image-error"
                );

            container.setAttribute(
                "aria-hidden",
                "true"
            );

            container.hidden =
                true;
        }

        console.warn(
            "[OfferModule] Offer image could not be loaded."
        );
    }

    /* =====================================================
       CLICK HANDLING
    ===================================================== */

    function handleClick(
        event
    ) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                    Element
            )
        ) {
            return;
        }

        const actionElement =
            event.target.closest(
                "[data-offer-action]"
            );

        if (
            !actionElement ||
            !state.page
                ?.contains(
                    actionElement
                )
        ) {
            return;
        }

        if (
            actionElement
                .getAttribute(
                    "aria-disabled"
                ) ===
                "true" ||
            actionElement.disabled ===
                true
        ) {
            event.preventDefault();

            return;
        }

        const action =
            normalizeString(
                actionElement
                    .dataset
                    .offerAction
            )
                .toLowerCase();

        if (
            action ===
                "live-chat"
        ) {
            event.preventDefault();

            openLiveChat(
                actionElement
            );

            return;
        }

        if (
            action ===
                "register"
        ) {
            event.preventDefault();

            openRegisterURL(
                actionElement
            );
        }
    }

    /* =====================================================
       KEYBOARD HANDLING
    ===================================================== */

    function handleKeydown(
        event
    ) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                    Element
            )
        ) {
            return;
        }

        if (
            event.key !==
                "Enter" &&
            event.key !==
                " "
        ) {
            return;
        }

        const actionElement =
            event.target.closest(
                "[data-offer-action]"
            );

        if (
            !actionElement ||
            !state.page
                ?.contains(
                    actionElement
                )
        ) {
            return;
        }

        /*
         * Native buttons already handle Enter/Space.
         * This fallback supports future non-button controls
         * without double-triggering current buttons.
         */

        if (
            actionElement instanceof
                HTMLButtonElement
        ) {
            return;
        }

        event.preventDefault();

        actionElement.click();
    }

    /* =====================================================
       EVENT BINDING
    ===================================================== */

    function bindEvents() {
        if (
            state.controller ||
            !state.page
        ) {
            return Boolean(
                state.controller
            );
        }

        state.controller =
            new AbortController();

        const signal =
            state.controller
                .signal;

        state.page
            .addEventListener(
                "click",
                handleClick,
                {
                    signal
                }
            );

        state.page
            .addEventListener(
                "keydown",
                handleKeydown,
                {
                    signal
                }
            );

        const image =
            getElement(
                "#offerImage"
            );

        if (image) {
            image.addEventListener(
                "load",
                handleImageLoad,
                {
                    signal
                }
            );

            image.addEventListener(
                "error",
                handleImageError,
                {
                    signal
                }
            );

            /*
             * Cached images may already be complete before
             * event listeners are attached.
             */

            if (
                image.complete
            ) {
                if (
                    image.naturalWidth >
                        0
                ) {
                    handleImageLoad({
                        currentTarget:
                            image
                    });
                } else if (
                    image.getAttribute(
                        "src"
                    )
                ) {
                    handleImageError({
                        currentTarget:
                            image
                    });
                }
            }
        }

        return true;
    }

    function unbindEvents() {
        state.controller
            ?.abort();

        state.controller =
            null;

        return true;
    }

    /* =====================================================
       PAGE REMOVAL OBSERVER
    ===================================================== */

    function observePageRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined" ||
            !state.page
        ) {
            return false;
        }

        const observedPage =
            state.page;

        const observedGeneration =
            state.lifecycleGeneration;

        state.pageObserver =
            new MutationObserver(
                () => {
                    if (
                        observedGeneration !==
                            state.lifecycleGeneration ||
                        !observedPage ||
                        observedPage.isConnected
                    ) {
                        return;
                    }

                    destroy();
                }
            );

        state.pageObserver
            .observe(
                document.body,
                {
                    childList:
                        true,

                    subtree:
                        true
                }
            );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        destroy();

        const page =
            document.getElementById(
                "offerPage"
            );

        if (!page) {
            console.error(
                "[OfferModule] OfferView must be rendered before OfferModule.init()."
            );

            return false;
        }

        state.lifecycleGeneration +=
            1;

        state.page =
            page;

        state.initialized =
            true;

        bindEvents();
        observePageRemoval();

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        clearStatusTimer();

        unbindEvents();

        if (
            state.pageObserver
        ) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        state.page =
            null;

        state.initialized =
            false;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        openLiveChat,
        openRegisterURL,

        showStatus,
        hideStatus,

        isInitialized() {
            return state.initialized;
        },

        getCurrentPage() {
            return state.initialized
                ? OFFER_PAGE_NAME
                : "";
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.OfferModule =
    OfferModule;