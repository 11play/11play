"use strict";

/* =========================================================
   11PLAY — PROFILE / ACCOUNT ROUTER
   File: js/account/router.js

   Responsibilities:
   - Render canonical account pages
   - Initialize the corresponding account-page module
   - Destroy the previously active account-page module
   - Expose a bridge to Main Router for programmatic navigation
   - Track the current account page and root

   Canonical navigation flow:
   Router.navigate(page)
       → Router updates Topbar and Navbar
       → Router calls ProfileRouter.open(page, root)
       → ProfileRouter renders the account page

   Important:
   - Main Router owns navigation
   - ProfileRouter does not update Topbar or Navbar
   - ProfileRouter does not bind Account Services clicks
   - ProfileRouter does not listen for global navigation events
========================================================= */

const ProfileRouter = (() => {
    "use strict";

    /* =====================================================
       CANONICAL PAGE DEFINITIONS
    ===================================================== */

    const PAGE_DEFINITIONS =
        Object.freeze({
            profile: {
                page:
                    "profile",

                getView() {
                    return window.ProfileView;
                },

                getModule() {
                    return window.ProfileModule;
                }
            },

            offer: {
                page:
                    "offer",

                getView() {
                    return window.OfferView;
                },

                getModule() {
                    return window.OfferModule;
                }
            },

            "live-chat": {
                page:
                    "live-chat",

                getView() {
                    return window.LiveChatView;
                },

                getModule() {
                    return window.LiveChatModule;
                }
            }
        });

    const ACCOUNT_PAGES =
        Object.freeze(
            Object.keys(
                PAGE_DEFINITIONS
            )
        );

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        currentRoot:
            null,

        currentPage:
            "",

        currentModule:
            null,

        routeGeneration:
            0
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

    function isPromiseLike(value) {
        return Boolean(
            value &&
            typeof value.then ===
                "function"
        );
    }

    function getPageDefinition(page) {
        const normalizedPage =
            normalizePage(page);

        return (
            PAGE_DEFINITIONS[
                normalizedPage
            ] ||
            null
        );
    }

    function getCanonicalPage(page) {
        return (
            getPageDefinition(page)
                ?.page ||
            ""
        );
    }

    function canHandle(page) {
        return Boolean(
            getPageDefinition(page)
        );
    }

    /* =====================================================
       ROOT RESOLUTION
    ===================================================== */

    function resolveRoot(root) {
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
            return document.querySelector(
                root.trim()
            );
        }

        if (
            state.currentRoot instanceof
                HTMLElement &&
            state.currentRoot.isConnected
        ) {
            return state.currentRoot;
        }

        return (
            document.getElementById(
                "app-view"
            ) ||
            document.getElementById(
                "appContent"
            ) ||
            document.getElementById(
                "mainContent"
            ) ||
            document.getElementById(
                "app"
            ) ||
            null
        );
    }

    /* =====================================================
       ROUTE EVENTS
    ===================================================== */

    function dispatchRouteChanged(
        requestedPage,
        page,
        root
    ) {
        window.dispatchEvent(
            new CustomEvent(
                "profile:route-changed",
                {
                    detail: {
                        requestedPage,
                        page,
                        root
                    }
                }
            )
        );

        return true;
    }

    function dispatchRouteReady(
        requestedPage,
        page,
        root
    ) {
        window.dispatchEvent(
            new CustomEvent(
                "profile:route-ready",
                {
                    detail: {
                        requestedPage,
                        page,
                        root
                    }
                }
            )
        );

        return true;
    }

    function dispatchRouteError(
        requestedPage,
        page,
        error
    ) {
        window.dispatchEvent(
            new CustomEvent(
                "profile:route-error",
                {
                    detail: {
                        requestedPage,
                        page,

                        message:
                            String(
                                error?.message ||
                                error ||
                                "Account page initialization failed."
                            )
                    }
                }
            )
        );

        return true;
    }

    /* =====================================================
       MODULE CLEANUP
    ===================================================== */

    function safelyDestroyModule(
        module,
        page
    ) {
        if (
            !module ||
            typeof module.destroy !==
                "function"
        ) {
            return true;
        }

        try {
            const result =
                module.destroy();

            if (
                isPromiseLike(result)
            ) {
                result.catch(
                    (error) => {
                        console.warn(
                            `[ProfileRouter] Asynchronous cleanup failed for "${page}".`,
                            error
                        );
                    }
                );
            }

            return result !== false;
        } catch (error) {
            console.warn(
                `[ProfileRouter] Cleanup failed for "${page}".`,
                error
            );

            return false;
        }
    }

    function destroyCurrentModule() {
        const activeModule =
            state.currentModule;

        const activePage =
            state.currentPage;

        state.currentModule =
            null;

        return safelyDestroyModule(
            activeModule,
            activePage
        );
    }

    /* =====================================================
       ASYNCHRONOUS MODULE INITIALIZATION
    ===================================================== */

    function handleAsyncInitialization({
        initialization,
        module,
        generation,
        requestedPage,
        page,
        root
    }) {
        Promise.resolve(
            initialization
        )
            .then(
                (result) => {
                    if (
                        generation !==
                            state.routeGeneration ||
                        state.currentPage !==
                            page ||
                        state.currentModule !==
                            module
                    ) {
                        return;
                    }

                    if (result === false) {
                        const error =
                            new Error(
                                `Module initialization returned false for "${page}".`
                            );

                        console.error(
                            "[ProfileRouter]",
                            error
                        );

                        dispatchRouteError(
                            requestedPage,
                            page,
                            error
                        );

                        return;
                    }

                    dispatchRouteReady(
                        requestedPage,
                        page,
                        root
                    );
                }
            )
            .catch(
                (error) => {
                    if (
                        generation !==
                            state.routeGeneration ||
                        state.currentPage !==
                            page ||
                        state.currentModule !==
                            module
                    ) {
                        return;
                    }

                    console.error(
                        `[ProfileRouter] Asynchronous initialization failed for "${page}".`,
                        error
                    );

                    dispatchRouteError(
                        requestedPage,
                        page,
                        error
                    );
                }
            );
    }

    /* =====================================================
       PAGE RENDERING
    ===================================================== */

    function renderPage({
        root,
        requestedPage,
        definition
    }) {
        if (
            !(root instanceof
                HTMLElement) ||
            !definition
        ) {
            return false;
        }

        const page =
            definition.page;

        const view =
            typeof definition.getView ===
                "function"
                ? definition.getView()
                : null;

        const module =
            typeof definition.getModule ===
                "function"
                ? definition.getModule()
                : null;

        if (
            !view ||
            typeof view.render !==
                "function"
        ) {
            console.error(
                `[ProfileRouter] View is unavailable for "${page}".`
            );

            return false;
        }

        /*
         * Destroy the old account-page runtime before
         * replacing its DOM.
         */

        state.routeGeneration +=
            1;

        const generation =
            state.routeGeneration;

        destroyCurrentModule();

        state.currentPage =
            "";

        root.replaceChildren();

        let renderedPage =
            null;

        try {
            renderedPage =
                view.render(root);
        } catch (error) {
            console.error(
                `[ProfileRouter] Failed to render "${page}".`,
                error
            );

            dispatchRouteError(
                requestedPage,
                page,
                error
            );

            return false;
        }

        if (renderedPage === false) {
            console.error(
                `[ProfileRouter] View rendering returned false for "${page}".`
            );

            return false;
        }

        const moduleRoot =
            renderedPage instanceof
                HTMLElement
                ? renderedPage
                : root;

        state.currentRoot =
            root;

        state.currentPage =
            page;

        state.currentModule =
            module || null;

        /*
         * Dispatch after the page DOM exists.
         */

        dispatchRouteChanged(
            requestedPage,
            page,
            root
        );

        if (
            !module ||
            typeof module.init !==
                "function"
        ) {
            dispatchRouteReady(
                requestedPage,
                page,
                root
            );

            return true;
        }

        try {
            const initialization =
                module.init(
                    moduleRoot,
                    {
                        page,
                        requestedPage
                    }
                );

            if (
                initialization === false
            ) {
                console.error(
                    `[ProfileRouter] Module initialization returned false for "${page}".`
                );

                safelyDestroyModule(
                    module,
                    page
                );

                state.currentModule =
                    null;

                dispatchRouteError(
                    requestedPage,
                    page,
                    new Error(
                        "Account page initialization failed."
                    )
                );

                return false;
            }

            if (
                isPromiseLike(
                    initialization
                )
            ) {
                handleAsyncInitialization({
                    initialization,
                    module,
                    generation,
                    requestedPage,
                    page,
                    root
                });
            } else {
                dispatchRouteReady(
                    requestedPage,
                    page,
                    root
                );
            }

            return true;
        } catch (error) {
            console.error(
                `[ProfileRouter] Failed to initialize "${page}".`,
                error
            );

            safelyDestroyModule(
                module,
                page
            );

            state.currentModule =
                null;

            dispatchRouteError(
                requestedPage,
                page,
                error
            );

            return false;
        }
    }

    /* =====================================================
       OPEN ACCOUNT PAGE
    ===================================================== */

    function open(page, root) {
        const requestedPage =
            normalizePage(page);

        const definition =
            getPageDefinition(
                requestedPage
            );

        if (!definition) {
            console.error(
                `[ProfileRouter] Unknown account page: "${requestedPage}".`
            );

            return false;
        }

        const targetRoot =
            resolveRoot(root);

        if (
            !(targetRoot instanceof
                HTMLElement)
        ) {
            console.error(
                "[ProfileRouter] A valid account-page root was not found."
            );

            return false;
        }

        state.initialized =
            true;

        state.currentRoot =
            targetRoot;

        return renderPage({
            root:
                targetRoot,

            requestedPage,

            definition
        });
    }

    /* =====================================================
       MAIN ROUTER BRIDGE
    ===================================================== */

    function navigate(page) {
        const canonicalPage =
            getCanonicalPage(page);

        if (!canonicalPage) {
            console.error(
                `[ProfileRouter] Unknown account route: "${normalizePage(
                    page
                )}".`
            );

            return false;
        }

        if (
            !window.Router ||
            window.Router ===
                ProfileRouter ||
            typeof window.Router
                .navigate !==
                "function"
        ) {
            console.error(
                "[ProfileRouter] Main Router is unavailable."
            );

            return false;
        }

        /*
         * Main Router remains responsible for:
         * - Topbar update
         * - Navbar update
         * - Page transition
         * - Calling ProfileRouter.open()
         */

        return window.Router.navigate(
            canonicalPage
        );
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init(root) {
        const targetRoot =
            resolveRoot(root);

        if (
            !(targetRoot instanceof
                HTMLElement)
        ) {
            console.error(
                "[ProfileRouter] Account root was not found."
            );

            return false;
        }

        state.currentRoot =
            targetRoot;

        state.initialized =
            true;

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.routeGeneration +=
            1;

        destroyCurrentModule();

        state.initialized =
            false;

        state.currentRoot =
            null;

        state.currentPage =
            "";

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        open,
        navigate,
        destroy,

        canHandle,
        getCanonicalPage,

        getCurrentPage() {
            return state.currentPage;
        },

        getCurrentRoot() {
            return state.currentRoot;
        },

        getCurrentModule() {
            return state.currentModule;
        },

        isInitialized() {
            return state.initialized;
        },

        ACCOUNT_PAGES
    });
})();

/* =========================================================
   GLOBAL EXPORTS
========================================================= */

window.ProfileRouter =
    ProfileRouter;

/*
 * Compatibility alias.
 * Main Router must call ProfileRouter.open().
 */

window.AccountRouter =
    ProfileRouter;