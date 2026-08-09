"use strict";

/* =========================================================
   11PLAY — CORE ROUTER
   File: js/core/router.js

   Responsibilities:
   - Own all application-level navigation
   - Normalize and validate page names
   - Update Topbar and Navbar before rendering a page
   - Forward canonical account pages to ProfileRouter
   - Render standard application views
   - Handle delegated internal navigation
   - Handle external and payment links
   - Manage page transitions and cleanup

   Canonical account routing flow:
   Router.navigate(page)
       → Topbar.update(page)
       → Navbar.update(page)
       → ProfileRouter.open(page, root)

   Important:
   - ProfileRouter renders account-page content only
   - ProfileRouter does not control Topbar or Navbar
   - Account Services must call this Router first
========================================================= */

const Router = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_PAGE =
        "home";

    const TRANSITION_EXIT_DURATION =
        120;

    const TRANSITION_ENTER_DURATION =
        250;

    const ACCOUNT_PAGES =
        Object.freeze([
            "profile",
            "referral-statistics",
            "reward-center",
            "withdraw-history",
            "referral-rules"
        ]);

    const ACCOUNT_PAGE_SET =
        new Set(
            ACCOUNT_PAGES
        );

    const VIEW_MAP =
        Object.freeze({
            home:
                "HomeView",

            search:
                "SearchView",

            favorites:
                "FavoritesView",

            news:
                "NewsView",

            history:
                "HistoryView"
        });

    const PAGE_TRIGGER_SELECTOR = [
        "a[data-page]",
        "button[data-page]",
        '[role="button"][data-page]',
        "[data-router-link][data-page]"
    ].join(",");

    /*
     * Only interactive Account Services elements are accepted.
     * Page containers such as:
     *
     * <main data-account-page="profile">
     *
     * are not treated as navigation triggers.
     */

    const ACCOUNT_PAGE_TRIGGER_SELECTOR = [
        "a[data-account-page]",
        "button[data-account-page]",
        '[role="button"][data-account-page]',
        "[data-router-link][data-account-page]"
    ].join(",");

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        currentPage:
            DEFAULT_PAGE,

        isTransitioning:
            false,

        linksBound:
            false,

        transitionGeneration:
            0,

        exitTimer:
            null,

        enterTimer:
            null
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizePage(page) {
        return String(page || "")
            .normalize("NFKC")
            .trim()
            .toLowerCase()
            .replace(
                /\s+/g,
                "-"
            );
    }

    function getRoot() {
        return document.getElementById(
            "app-view"
        );
    }

    function isAccountPage(page) {
        return ACCOUNT_PAGE_SET.has(
            normalizePage(page)
        );
    }

    function getCurrentPage() {
        return state.currentPage;
    }

    function isInitialized() {
        return state.initialized;
    }

    function isTransitioning() {
        return state.isTransitioning;
    }

    /* =====================================================
       TRANSITION CLEANUP
    ===================================================== */

    function clearTransitionTimers() {
        if (state.exitTimer) {
            window.clearTimeout(
                state.exitTimer
            );

            state.exitTimer =
                null;
        }

        if (state.enterTimer) {
            window.clearTimeout(
                state.enterTimer
            );

            state.enterTimer =
                null;
        }

        return true;
    }

    function resetTransitionClasses() {
        const root =
            getRoot();

        if (!root) {
            return false;
        }

        root.classList.remove(
            "page-exit",
            "page-enter",
            "page-enter-active"
        );

        return true;
    }

    function finishTransition(
        generation
    ) {
        if (
            generation !==
            state.transitionGeneration
        ) {
            return false;
        }

        clearTransitionTimers();
        resetTransitionClasses();

        state.isTransitioning =
            false;

        return true;
    }

    /* =====================================================
       GLOBAL UI SYNCHRONIZATION
    ===================================================== */

    function syncUI(page) {
        const normalizedPage =
            normalizePage(page);

        try {
            window.Topbar
                ?.update
                ?.(normalizedPage);
        } catch (error) {
            console.error(
                "[Router] Topbar synchronization failed.",
                error
            );
        }

        try {
            window.Navbar
                ?.update
                ?.(normalizedPage);
        } catch (error) {
            console.error(
                "[Router] Navbar synchronization failed.",
                error
            );
        }

        return true;
    }

    /* =====================================================
       ROUTE EVENT
    ===================================================== */

    function dispatchRouteEvent(
        page,
        rendered
    ) {
        window.dispatchEvent(
            new CustomEvent(
                "router:page-changed",
                {
                    detail: {
                        page,

                        rendered:
                            rendered === true,

                        accountPage:
                            isAccountPage(page)
                    }
                }
            )
        );

        return true;
    }

    /* =====================================================
       ACCOUNT PAGE RENDERING
    ===================================================== */

    function renderAccountPage(
        page,
        root
    ) {
        if (
            !window.ProfileRouter ||
            typeof window.ProfileRouter
                .open !==
                "function"
        ) {
            console.error(
                "[Router] ProfileRouter is unavailable."
            );

            return false;
        }

        try {
            const result =
                window.ProfileRouter
                    .open(
                        page,
                        root
                    );

            return result !== false;
        } catch (error) {
            console.error(
                `[Router] Unable to open account page "${page}".`,
                error
            );

            return false;
        }
    }

    /* =====================================================
       STANDARD VIEW RENDERING
    ===================================================== */

    function renderStandardView(
        page,
        root
    ) {
        const viewName =
            VIEW_MAP[page];

        if (!viewName) {
            return false;
        }

        const view =
            window[viewName];

        if (
            !view ||
            typeof view.render !==
                "function"
        ) {
            return false;
        }

        try {
            const result =
                view.render(root);

            if (result === false) {
                return false;
            }

            if (page === "home") {
                window.requestAnimationFrame(
                    () => {
                        window.Category
                            ?.reset
                            ?.();

                        window.Category
                            ?.init
                            ?.(
                                "category-root"
                            );
                    }
                );
            }

            return true;
        } catch (error) {
            console.error(
                `[Router] Unable to render view "${viewName}".`,
                error
            );

            return false;
        }
    }

    /* =====================================================
       NOT-FOUND VIEW
    ===================================================== */

    function renderNotFound(
        page,
        root
    ) {
        const wrapper =
            document.createElement(
                "section"
            );

        wrapper.className =
            "router-not-found";

        wrapper.setAttribute(
            "role",
            "status"
        );

        const title =
            document.createElement(
                "h1"
            );

        title.className =
            "router-not-found-title";

        title.textContent =
            "Page Not Found";

        const description =
            document.createElement(
                "p"
            );

        description.className =
            "router-not-found-description";

        description.textContent =
            page
                ? `The page "${page}" is unavailable.`
                : "The requested page is unavailable.";

        wrapper.append(
            title,
            description
        );

        root.replaceChildren(
            wrapper
        );

        return false;
    }

    /* =====================================================
       PAGE RENDERING
    ===================================================== */

    function render(page) {
        const normalizedPage =
            normalizePage(page);

        const root =
            getRoot();

        if (
            !root ||
            !normalizedPage
        ) {
            return false;
        }

        /*
         * Removing the old page triggers its page-removal
         * observer and allows the old module to clean up.
         */

        root.replaceChildren();

        let rendered =
            false;

        if (
            isAccountPage(
                normalizedPage
            )
        ) {
            rendered =
                renderAccountPage(
                    normalizedPage,
                    root
                );
        } else {
            rendered =
                renderStandardView(
                    normalizedPage,
                    root
                );
        }

        if (!rendered) {
            renderNotFound(
                normalizedPage,
                root
            );
        }

        dispatchRouteEvent(
            normalizedPage,
            rendered
        );

        return rendered;
    }

    /* =====================================================
       PAGE TRANSITION
    ===================================================== */

    function transition(page) {
        const root =
            getRoot();

        if (!root) {
            return false;
        }

        clearTransitionTimers();

        state.transitionGeneration +=
            1;

        const generation =
            state.transitionGeneration;

        state.isTransitioning =
            true;

        root.classList.remove(
            "page-enter",
            "page-enter-active"
        );

        root.classList.add(
            "page-exit"
        );

        state.exitTimer =
            window.setTimeout(
                () => {
                    if (
                        generation !==
                        state.transitionGeneration
                    ) {
                        return;
                    }

                    render(page);

                    root.classList.remove(
                        "page-exit"
                    );

                    root.classList.add(
                        "page-enter"
                    );

                    window.requestAnimationFrame(
                        () => {
                            if (
                                generation !==
                                state.transitionGeneration
                            ) {
                                return;
                            }

                            root.classList.add(
                                "page-enter-active"
                            );
                        }
                    );

                    state.enterTimer =
                        window.setTimeout(
                            () => {
                                finishTransition(
                                    generation
                                );
                            },
                            TRANSITION_ENTER_DURATION
                        );
                },
                TRANSITION_EXIT_DURATION
            );

        return true;
    }

    /* =====================================================
       NAVIGATION
    ===================================================== */

    function navigate(
        page,
        initial = false
    ) {
        const requestedPage =
            normalizePage(page);

        if (!requestedPage) {
            return false;
        }

        const initialNavigation =
            initial === true;

        if (
            state.isTransitioning &&
            !initialNavigation
        ) {
            return false;
        }

        if (
            !initialNavigation &&
            requestedPage ===
                state.currentPage
        ) {
            syncUI(
                requestedPage
            );

            return true;
        }

        state.currentPage =
            requestedPage;

        /*
         * Global navigation UI must be synchronized before
         * ProfileRouter or a standard view renders.
         */

        syncUI(
            requestedPage
        );

        if (initialNavigation) {
            return render(
                requestedPage
            );
        }

        return transition(
            requestedPage
        );
    }

    /* =====================================================
       EXTERNAL LINK CHECK
    ===================================================== */

    function isExternalLink(url) {
        const normalizedURL =
            String(url || "")
                .trim();

        if (!normalizedURL) {
            return false;
        }

        if (
            /^(mailto|tel|sms):/i.test(
                normalizedURL
            )
        ) {
            return true;
        }

        if (
            normalizedURL.startsWith(
                "#"
            )
        ) {
            return false;
        }

        try {
            const parsedURL =
                new URL(
                    normalizedURL,
                    window.location.href
                );

            return (
                parsedURL.origin !==
                window.location.origin
            );
        } catch {
            return false;
        }
    }

    /* =====================================================
       PAYMENT LINK CHECK
    ===================================================== */

    function isPaymentLink(url) {
        const normalizedURL =
            String(url || "")
                .trim()
                .toLowerCase();

        if (!normalizedURL) {
            return false;
        }

        const keywords = [
            "payment",
            "checkout",
            "stripe",
            "paypal",
            "payoneer",
            "bkash",
            "nagad"
        ];

        return keywords.some(
            (keyword) =>
                normalizedURL.includes(
                    keyword
                )
        );
    }

    /* =====================================================
       EXTERNAL LINK HANDLER
    ===================================================== */

    function handleExternalClick(
        event,
        href
    ) {
        const normalizedHref =
            String(href || "")
                .trim();

        if (!normalizedHref) {
            return false;
        }

        if (
            !isPaymentLink(
                normalizedHref
            ) &&
            !isExternalLink(
                normalizedHref
            )
        ) {
            return false;
        }

        event?.preventDefault?.();

        window.open(
            normalizedHref,
            "_blank",
            "noopener,noreferrer"
        );

        return true;
    }

    /* =====================================================
       NAVIGATION TRIGGER RESOLUTION
    ===================================================== */

    function isOwnedBySeparateNavigation(
        target
    ) {
        return Boolean(
            target.closest(
                "#sideMenu, #bottomNav"
            )
        );
    }

    function getAccountPageTrigger(
        target
    ) {
        if (
            !(target instanceof Element) ||
            isOwnedBySeparateNavigation(
                target
            )
        ) {
            return null;
        }

        return target.closest(
            ACCOUNT_PAGE_TRIGGER_SELECTOR
        );
    }

    function getPageTrigger(target) {
        if (
            !(target instanceof Element) ||
            isOwnedBySeparateNavigation(
                target
            )
        ) {
            return null;
        }

        return target.closest(
            PAGE_TRIGGER_SELECTOR
        );
    }

    /* =====================================================
       CLICK FILTER
    ===================================================== */

    function isModifiedClick(event) {
        return Boolean(
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        );
    }

    /* =====================================================
       DOCUMENT CLICK HANDLER
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            isModifiedClick(event) ||
            !(event.target instanceof Element)
        ) {
            return;
        }

        /*
         * Account Services navigation must enter Core Router
         * first. The page container itself is never matched,
         * because only interactive selectors are accepted.
         */

        const accountTrigger =
            getAccountPageTrigger(
                event.target
            );

        if (accountTrigger) {
            const accountPage =
                normalizePage(
                    accountTrigger
                        .dataset
                        .accountPage
                );

            if (
                !isAccountPage(
                    accountPage
                )
            ) {
                return;
            }

            event.preventDefault();

            navigate(
                accountPage
            );

            return;
        }

        /*
         * Standard internal page navigation.
         */

        const pageTrigger =
            getPageTrigger(
                event.target
            );

        if (pageTrigger) {
            const page =
                normalizePage(
                    pageTrigger
                        .dataset
                        .page
                );

            if (!page) {
                return;
            }

            event.preventDefault();

            navigate(page);

            return;
        }

        /*
         * Standard anchor behavior.
         */

        const link =
            event.target.closest(
                "a"
            );

        if (!link) {
            return;
        }

        if (
            link.hasAttribute(
                "download"
            ) ||
            normalizeString(
                link.target
            ).toLowerCase() ===
                "_blank"
        ) {
            return;
        }

        const href =
            link.getAttribute(
                "href"
            );

        if (
            !href ||
            href === "#" ||
            href.startsWith("#")
        ) {
            return;
        }

        handleExternalClick(
            event,
            href
        );
    }

    function normalizeString(value) {
        return String(value || "")
            .trim();
    }

    /* =====================================================
       LINK BINDING
    ===================================================== */

    function bindLinks() {
        if (state.linksBound) {
            return true;
        }

        document.addEventListener(
            "click",
            handleDocumentClick,
            true
        );

        state.linksBound =
            true;

        return true;
    }

    function unbindLinks() {
        if (!state.linksBound) {
            return true;
        }

        document.removeEventListener(
            "click",
            handleDocumentClick,
            true
        );

        state.linksBound =
            false;

        return true;
    }

    /* =====================================================
       APPLICATION HOOKS
    ===================================================== */

    function handleCategoryChange(tab) {
        window.dispatchEvent(
            new CustomEvent(
                "router:category-changed",
                {
                    detail: {
                        category:
                            normalizePage(tab)
                    }
                }
            )
        );

        return true;
    }

    function handleBannerClick(
        href,
        event
    ) {
        return handleExternalClick(
            event,
            href
        );
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init(options = {}) {
        if (state.initialized) {
            return true;
        }

        bindLinks();

        state.initialized =
            true;

        const initialPage =
            normalizePage(
                options?.initialPage ||
                DEFAULT_PAGE
            ) ||
            DEFAULT_PAGE;

        return navigate(
            initialPage,
            true
        );
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.transitionGeneration +=
            1;

        clearTransitionTimers();
        resetTransitionClasses();
        unbindLinks();

        state.initialized =
            false;

        state.isTransitioning =
            false;

        state.currentPage =
            DEFAULT_PAGE;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        navigate,
        render,

        getCurrentPage,
        isAccountPage,
        isInitialized,
        isTransitioning,

        handleExternalClick,
        handleCategoryChange,
        handleBannerClick,

        ACCOUNT_PAGES,
        VIEW_MAP
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Router =
    Router;