"use strict";

/* =========================================================
   11PLAY — APPLICATION SHELL
   File: js/layout/shell.js

   Responsibilities:
   - Prepare the persistent application layout
   - Initialize Topbar and Navbar
   - Open and close the Side Menu
   - Close the Side Menu from the overlay or Escape key
   - Forward Search-button navigation to Main Router
   - Prevent duplicate global event listeners

   Important:
   - Main Router owns page navigation
   - ProfileRouter owns account-page rendering only
   - Shell does not render account pages
   - Shell does not update Topbar or Navbar page state
========================================================= */

const Shell = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const ELEMENT_IDS =
        Object.freeze({
            sideMenu:
                "sideMenu",

            overlay:
                "overlay",

            menuButton:
                "menuBtn",

            searchButton:
                "searchBtn"
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        controller:
            null
    };

    /* =====================================================
       ELEMENT RESOLUTION
    ===================================================== */

    function getSideMenu() {
        return document.getElementById(
            ELEMENT_IDS.sideMenu
        );
    }

    function getOverlay() {
        return document.getElementById(
            ELEMENT_IDS.overlay
        );
    }

    function getMenuButton() {
        return document.getElementById(
            ELEMENT_IDS.menuButton
        );
    }

    /* =====================================================
       STATIC LAYOUT
    ===================================================== */

    function renderStaticLayout() {
        const sideMenu =
            getSideMenu();

        /*
         * Do not overwrite menu content when MenuModule
         * has already rendered it.
         */

        if (
            sideMenu &&
            !sideMenu.hasChildNodes()
        ) {
            sideMenu.innerHTML = `
                <div
                    class="side-menu-loading"
                    role="status"
                    aria-live="polite"
                >
                    <h2 class="side-menu-loading-title">
                        Loading Menu...
                    </h2>
                </div>
            `;
        }

        closeMenu();

        return true;
    }

    /* =====================================================
       MENU STATE
    ===================================================== */

    function isMenuOpen() {
        return Boolean(
            getSideMenu()
                ?.classList
                .contains("active")
        );
    }

    function openMenu() {
        const sideMenu =
            getSideMenu();

        const overlay =
            getOverlay();

        const menuButton =
            getMenuButton();

        if (!sideMenu) {
            return false;
        }

        sideMenu.classList.add(
            "active"
        );

        sideMenu.setAttribute(
            "aria-hidden",
            "false"
        );

        overlay?.classList.add(
            "active"
        );

        overlay?.setAttribute(
            "aria-hidden",
            "false"
        );

        menuButton?.setAttribute(
            "aria-expanded",
            "true"
        );

        return true;
    }

    function closeMenu() {
        const sideMenu =
            getSideMenu();

        const overlay =
            getOverlay();

        const menuButton =
            getMenuButton();

        sideMenu?.classList.remove(
            "active"
        );

        sideMenu?.setAttribute(
            "aria-hidden",
            "true"
        );

        overlay?.classList.remove(
            "active"
        );

        overlay?.setAttribute(
            "aria-hidden",
            "true"
        );

        menuButton?.setAttribute(
            "aria-expanded",
            "false"
        );

        return true;
    }

    function toggleMenu() {
        return isMenuOpen()
            ? closeMenu()
            : openMenu();
    }

    /* =====================================================
       CLICK HANDLING
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof Element)
        ) {
            return;
        }

        const menuButton =
            event.target.closest(
                `#${ELEMENT_IDS.menuButton}`
            );

        if (menuButton) {
            event.preventDefault();

            toggleMenu();

            return;
        }

        const overlay =
            event.target.closest(
                `#${ELEMENT_IDS.overlay}`
            );

        if (overlay) {
            event.preventDefault();

            closeMenu();

            return;
        }

        const searchButton =
            event.target.closest(
                `#${ELEMENT_IDS.searchButton}`
            );

        if (searchButton) {
            event.preventDefault();

            closeMenu();

            if (
                window.Router &&
                typeof window.Router.navigate ===
                    "function"
            ) {
                window.Router.navigate(
                    "search"
                );
            }
        }
    }

    /* =====================================================
       KEYBOARD HANDLING
    ===================================================== */

    function handleDocumentKeydown(event) {
        if (
            event.key !== "Escape" ||
            !isMenuOpen()
        ) {
            return;
        }

        closeMenu();

        getMenuButton()?.focus();
    }

    /* =====================================================
       GLOBAL EVENT BINDING
    ===================================================== */

    function bindGlobalEvents() {
        if (state.controller) {
            return true;
        }

        state.controller =
            new AbortController();

        const signal =
            state.controller.signal;

        document.addEventListener(
            "click",
            handleDocumentClick,
            {
                signal
            }
        );

        document.addEventListener(
            "keydown",
            handleDocumentKeydown,
            {
                signal
            }
        );

        return true;
    }

    function unbindGlobalEvents() {
        state.controller?.abort();

        state.controller =
            null;

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (state.initialized) {
            return true;
        }

        renderStaticLayout();
        bindGlobalEvents();

        /*
         * Persistent layout components are initialized here.
         * Their page-state updates remain owned by Main Router.
         */

        window.Topbar
            ?.init
            ?.();

        window.Navbar
            ?.init
            ?.();

        state.initialized =
            true;

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        unbindGlobalEvents();
        closeMenu();

        state.initialized =
            false;

        return true;
    }

    function isInitialized() {
        return state.initialized;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        openMenu,
        closeMenu,
        toggleMenu,
        isMenuOpen,
        isInitialized
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Shell =
    Shell;