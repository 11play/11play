"use strict";

/* =========================================================
   11PLAY — BOTTOM NAVBAR
   File: js/layout/navbar.js

   Responsibilities:
   - Render the persistent Bottom Navbar
   - Forward Bottom Navbar clicks to Main Router
   - Synchronize active state with the current route
   - Support keyboard navigation
   - Prevent duplicate event listeners
   - Preserve the original Bottom Navbar design

   Navigation ownership:
   - Main Router owns page navigation
   - Navbar only requests navigation
   - Navbar does not render application pages
   - Navbar does not update Topbar
========================================================= */

const Navbar = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_PAGE = "home";

    const NAV_ITEMS = Object.freeze([
        {
            page: "home",
            icon: "🏠",
            label: "Home"
        },
        {
            page: "news",
            icon: "📰",
            label: "News"
        },
        {
            page: "favorites",
            icon: "❤️",
            label: "Favorites"
        }
    ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized: false,
        root: null,
        controller: null,
        currentPage: DEFAULT_PAGE
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizePage(page) {
        return (
            String(page || DEFAULT_PAGE)
                .normalize("NFKC")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-") ||
            DEFAULT_PAGE
        );
    }

    function resolveRoot() {
        return document.getElementById(
            "bottomNav"
        );
    }

    function getInitialPage() {
        if (
            window.Router &&
            typeof window.Router
                .getCurrentPage === "function"
        ) {
            const currentPage =
                normalizePage(
                    window.Router
                        .getCurrentPage()
                );

            if (currentPage) {
                return currentPage;
            }
        }

        return DEFAULT_PAGE;
    }

    /* =====================================================
       NAV ITEM CREATION
    ===================================================== */

    function createNavItem(item) {
        /*
         * The original Navbar CSS is designed for a neutral
         * block element. Native <button> styling caused the
         * white/grey square background on inactive items.
         */

        const navItem =
            document.createElement("div");

        navItem.className = "nav";

        navItem.dataset.page =
            item.page;

        navItem.dataset.navPage =
            item.page;

        navItem.setAttribute(
            "role",
            "button"
        );

        navItem.setAttribute(
            "aria-label",
            item.label
        );

        navItem.tabIndex = 0;

        const icon =
            document.createElement("span");

        icon.className = "nav-icon";

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        icon.textContent =
            item.icon;

        const accessibleLabel =
            document.createElement("span");

        accessibleLabel.className =
            "sr-only";

        accessibleLabel.textContent =
            item.label;

        navItem.append(
            icon,
            accessibleLabel
        );

        return navItem;
    }

    /* =====================================================
       RENDERING
    ===================================================== */

    function render(
        activePage = DEFAULT_PAGE
    ) {
        const root =
            resolveRoot();

        if (!root) {
            console.warn(
                "[Navbar] Element with ID 'bottomNav' was not found."
            );

            return false;
        }

        if (state.root !== root) {
            unbindEvents();
            state.root = root;
        }

        const fragment =
            document.createDocumentFragment();

        NAV_ITEMS.forEach((item) => {
            fragment.appendChild(
                createNavItem(item)
            );
        });

        state.root.replaceChildren(
            fragment
        );

        bindEvents();

        return update(activePage);
    }

    /* =====================================================
       ACTIVE STATE
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
                "[data-nav-page]"
            )
        ) {
            return render(page);
        }

        const normalizedPage =
            normalizePage(page);

        state.currentPage =
            normalizedPage;

        state.root
            .querySelectorAll(
                "[data-nav-page]"
            )
            .forEach((item) => {
                const itemPage =
                    normalizePage(
                        item.dataset.navPage
                    );

                const active =
                    itemPage ===
                    normalizedPage;

                item.classList.toggle(
                    "active",
                    active
                );

                if (active) {
                    item.setAttribute(
                        "aria-current",
                        "page"
                    );
                } else {
                    item.removeAttribute(
                        "aria-current"
                    );
                }
            });

        state.root.dataset.currentPage =
            normalizedPage;

        return true;
    }

    /* =====================================================
       NAVIGATION
    ===================================================== */

    function navigate(page) {
        const normalizedPage =
            normalizePage(page);

        if (
            !window.Router ||
            typeof window.Router
                .navigate !== "function"
        ) {
            console.error(
                "[Navbar] Main Router is unavailable."
            );

            return false;
        }

        return window.Router.navigate(
            normalizedPage
        );
    }

    function isDisabled(item) {
        return (
            item.getAttribute(
                "aria-disabled"
            ) === "true"
        );
    }

    function activateItem(item) {
        if (
            !item ||
            isDisabled(item)
        ) {
            return false;
        }

        const page =
            normalizePage(
                item.dataset.navPage
            );

        if (!page) {
            return false;
        }

        return navigate(page);
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

        const item =
            event.target.closest(
                "[data-nav-page]"
            );

        if (
            !item ||
            !state.root?.contains(item)
        ) {
            return;
        }

        event.preventDefault();

        activateItem(item);
    }

    function handleKeydown(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof Element)
        ) {
            return;
        }

        const currentItem =
            event.target.closest(
                "[data-nav-page]"
            );

        if (
            !currentItem ||
            !state.root?.contains(
                currentItem
            )
        ) {
            return;
        }

        /*
         * Activate the focused Navbar item.
         */

        if (
            event.key === "Enter" ||
            event.key === " "
        ) {
            event.preventDefault();

            activateItem(currentItem);

            return;
        }

        if (
            ![
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End"
            ].includes(event.key)
        ) {
            return;
        }

        const items =
            Array.from(
                state.root.querySelectorAll(
                    "[data-nav-page]"
                )
            );

        const currentIndex =
            items.indexOf(
                currentItem
            );

        if (
            currentIndex < 0 ||
            !items.length
        ) {
            return;
        }

        let nextIndex =
            currentIndex;

        switch (event.key) {
            case "ArrowLeft":
                nextIndex =
                    (
                        currentIndex -
                        1 +
                        items.length
                    ) %
                    items.length;
                break;

            case "ArrowRight":
                nextIndex =
                    (
                        currentIndex +
                        1
                    ) %
                    items.length;
                break;

            case "Home":
                nextIndex = 0;
                break;

            case "End":
                nextIndex =
                    items.length - 1;
                break;

            default:
                return;
        }

        event.preventDefault();

        items[nextIndex]?.focus();
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
            { signal }
        );

        state.root.addEventListener(
            "keydown",
            handleKeydown,
            { signal }
        );

        return true;
    }

    function unbindEvents() {
        state.controller?.abort();
        state.controller = null;

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
                "[Navbar] Element with ID 'bottomNav' was not found."
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

        state.root = root;

        const rendered =
            render(
                getInitialPage()
            );

        state.initialized =
            rendered !== false;

        return state.initialized;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        unbindEvents();

        state.initialized = false;
        state.root = null;
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
        },

        NAV_ITEMS
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Navbar = Navbar;