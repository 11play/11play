"use strict";

/* =========================================================
   11PLAY — TOPBAR
   File: js/layout/topbar.js

   Responsibilities:
   - Render the persistent application Topbar
   - Display the current page title and subtitle
   - Forward Profile-button navigation to Main Router
   - Provide accessible Menu, Search and Profile controls
   - Prevent duplicate event listeners

   Navigation ownership:
   - Main Router owns page navigation
   - Shell owns Menu and Search button interactions
   - Topbar forwards only the Profile button to Main Router

   Important:
   - Topbar does not render account-page content
   - Topbar does not update Navbar
   - Topbar does not control the Side Menu directly
========================================================= */

const Topbar = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_PAGE =
        "home";

    const TITLE_MAP =
        Object.freeze({
            home:
                "11PLAY",

            news:
                "News",

            search:
                "Search",

            favorites:
                "Favorites",

            reviews:
                "Reviews",

            history:
                "History",

            profile:
                "Profile",

            offer:
                "Offer",

            "live-chat":
                "Live Chat",

            privacy:
                "Privacy Policy",

            terms:
                "Terms",

            contact:
                "Contact",

            about:
                "About"
        });

    const SUBTITLE_MAP =
        Object.freeze({
            home:
                "Smart Web Access",

            news:
                "Latest Updates",

            search:
                "Find Content",

            favorites:
                "Saved Items",

            reviews:
                "User Feedback",

            history:
                "Activity Log",

            profile:
                "Your Account",

            offer:
                "Special Offer",

            "live-chat":
                "Live Support",

            privacy:
                "Privacy and Security",

            terms:
                "Terms and Conditions",

            contact:
                "Get in Touch",

            about:
                "About 11PLAY"
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        root:
            null,

        controller:
            null,

        currentPage:
            DEFAULT_PAGE
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizePage(page) {
        return String(
            page ||
            DEFAULT_PAGE
        )
            .normalize("NFKC")
            .trim()
            .toLowerCase()
            .replace(
                /\s+/g,
                "-"
            ) ||
            DEFAULT_PAGE;
    }

    function resolveRoot() {
        return document.getElementById(
            "topbar"
        );
    }

    function getInitialPage() {
        if (
            window.Router &&
            typeof window.Router
                .getCurrentPage ===
                "function"
        ) {
            const routerPage =
                normalizePage(
                    window.Router
                        .getCurrentPage()
                );

            if (routerPage) {
                return routerPage;
            }
        }

        return DEFAULT_PAGE;
    }

    /* =====================================================
       MARKUP
    ===================================================== */

    function getTemplate() {
        return `
            <div>
                <div
                    id="menuBtn"
                    role="button"
                    tabindex="0"
                    aria-label="Open menu"
                    aria-controls="sideMenu"
                    aria-expanded="false"
                >
                    ☰
                </div>

                <div style="text-align:center;">
                    <div
                        id="topbarTitle"
                        class="topbar-title"
                    ></div>

                    <div
                        id="topbarSubtitle"
                        class="topbar-subtitle"
                    ></div>
                </div>

                <div class="topbar-actions">
                    <div
                        id="searchBtn"
                        role="button"
                        tabindex="0"
                        aria-label="Open search"
                    >
                        🔍
                    </div>

                    <div
                        id="profileBtn"
                        role="button"
                        tabindex="0"
                        aria-label="Open profile"
                    >
                        👤
                    </div>
                </div>
            </div>
        `;
    }

    /* =====================================================
       CONTENT SYNCHRONIZATION
    ===================================================== */

    function updateContent(page) {
        if (!state.root) {
            return false;
        }

        const normalizedPage =
            normalizePage(page);

        state.currentPage =
            normalizedPage;

        const titleElement =
            state.root.querySelector(
                "#topbarTitle"
            );

        const subtitleElement =
            state.root.querySelector(
                "#topbarSubtitle"
            );

        const searchButton =
            state.root.querySelector(
                "#searchBtn"
            );

        const profileButton =
            state.root.querySelector(
                "#profileBtn"
            );

        const title =
            TITLE_MAP[
                normalizedPage
            ] ||
            "11PLAY";

        const subtitle =
            SUBTITLE_MAP[
                normalizedPage
            ] ||
            "";

        if (titleElement) {
            titleElement.textContent =
                title;
        }

        if (subtitleElement) {
            subtitleElement.textContent =
                subtitle;

            subtitleElement.hidden =
                !subtitle;
        }

        if (searchButton) {
            if (
                normalizedPage ===
                "search"
            ) {
                searchButton.setAttribute(
                    "aria-current",
                    "page"
                );
            } else {
                searchButton.removeAttribute(
                    "aria-current"
                );
            }
        }

        if (profileButton) {
            if (
                normalizedPage ===
                "profile"
            ) {
                profileButton.setAttribute(
                    "aria-current",
                    "page"
                );
            } else {
                profileButton.removeAttribute(
                    "aria-current"
                );
            }
        }

        state.root.dataset
            .currentPage =
            normalizedPage;

        return true;
    }

    /* =====================================================
       RENDERING
    ===================================================== */

    function render(
        page = DEFAULT_PAGE
    ) {
        const root =
            resolveRoot();

        if (!root) {
            console.warn(
                "[Topbar] Element with ID 'topbar' was not found."
            );

            return false;
        }

        if (
            state.root !== root
        ) {
            unbindEvents();

            state.root =
                root;
        }

        state.root.innerHTML =
            getTemplate();

        bindEvents();

        return updateContent(
            page
        );
    }

    /* =====================================================
       PROFILE NAVIGATION
    ===================================================== */

    function navigateToProfile() {
        if (
            !window.Router ||
            typeof window.Router
                .navigate !==
                "function"
        ) {
            console.error(
                "[Topbar] Main Router is unavailable."
            );

            return false;
        }

        return window.Router.navigate(
            "profile"
        );
    }

    /* =====================================================
       EVENT HANDLING
    ===================================================== */

    function handleClick(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof Element)
        ) {
            return;
        }

        const profileButton =
            event.target.closest(
                "#profileBtn"
            );

        if (
            !profileButton ||
            !state.root?.contains(
                profileButton
            )
        ) {
            return;
        }

        event.preventDefault();

        navigateToProfile();
    }

    function handleKeydown(event) {
        if (
            ![
                "Enter",
                " "
            ].includes(
                event.key
            ) ||
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        const control =
            event.target.closest(
                "#menuBtn, #searchBtn, #profileBtn"
            );

        if (
            !control ||
            !state.root?.contains(
                control
            )
        ) {
            return;
        }

        event.preventDefault();

        /*
         * Menu and Search clicks are handled by Shell.
         * Profile clicks are handled by this module.
         */

        control.click();
    }

    /* =====================================================
       EVENT BINDING
    ===================================================== */

    function bindEvents() {
        if (
            state.controller ||
            !state.root
        ) {
            return Boolean(
                state.controller
            );
        }

        state.controller =
            new AbortController();

        const signal =
            state.controller.signal;

        state.root.addEventListener(
            "click",
            handleClick,
            {
                signal
            }
        );

        state.root.addEventListener(
            "keydown",
            handleKeydown,
            {
                signal
            }
        );

        return true;
    }

    function unbindEvents() {
        state.controller?.abort();

        state.controller =
            null;

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        const root =
            resolveRoot();

        if (!root) {
            console.warn(
                "[Topbar] Element with ID 'topbar' was not found."
            );

            return false;
        }

        if (
            state.initialized &&
            state.root === root
        ) {
            return update(
                getInitialPage()
            );
        }

        state.root =
            root;

        const rendered =
            render(
                getInitialPage()
            );

        state.initialized =
            rendered !== false;

        return state.initialized;
    }

    /* =====================================================
       UPDATE
    ===================================================== */

    function update(page) {
        if (
            !state.root ||
            !state.root.isConnected
        ) {
            state.root =
                resolveRoot();
        }

        if (!state.root) {
            return false;
        }

        if (
            !state.root.querySelector(
                "#topbarTitle"
            )
        ) {
            return render(page);
        }

        return updateContent(page);
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        unbindEvents();

        state.initialized =
            false;

        state.root =
            null;

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

        render,
        update,

        getCurrentPage() {
            return state.currentPage;
        },

        isInitialized() {
            return state.initialized;
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Topbar =
    Topbar;