"use strict";

/* =========================================================
   11PLAY — ADMIN DASHBOARD APPLICATION CONTROLLER
   File: admin/js/admin.app.js

   Responsibilities:
   - Initialize AdminAPI and AdminAuth
   - Control signed-out, checking, denied and authorized screens
   - Allow only the sole verified Google Admin account
   - Manage Admin Dashboard routing
   - Load Dashboard summary data
   - Initialize and refresh AdminUsers
   - Refresh Dashboard after Offer Paid actions
   - Clear sensitive Admin state after logout/access denial

   Current Admin scope:
   - Dashboard
   - Users
   - Offer Paid status

   Sole Admin:
   casinobuzzbd@gmail.com

   Security:
   - Client checks control only the Admin interface
   - Firestore Security Rules remain the final authority
   - FunctionsClient owns shared Spark/direct-Firestore operations
   - No Super Admin
   - No custom claims
   - No Firestore role assignment
========================================================= */

(function initializeAdminApp(
    window,
    document
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const SOLE_ADMIN_EMAIL =
        "casinobuzzbd@gmail.com";

    const DEFAULT_ROUTE =
        "dashboard";

    const SUMMARY_DEDUPE_WINDOW_MS =
        750;

    const ROUTES =
        Object.freeze({
            DASHBOARD:
                "dashboard",

            USERS:
                "users"
        });

    const VALID_ROUTES =
        Object.freeze(
            Object.values(
                ROUTES
            )
        );

    const ROUTE_TITLES =
        Object.freeze({
            [ROUTES.DASHBOARD]:
                "Dashboard",

            [ROUTES.USERS]:
                "Users"
        });

    const ROUTE_MODULES =
        Object.freeze({
            [ROUTES.USERS]:
                "AdminUsers"
        });

    const EVENTS =
        Object.freeze({
            READY:
                "admin-app:ready",

            STATE_CHANGED:
                "admin-app:state-changed",

            ROUTE_CHANGED:
                "admin-app:route-changed",

            DASHBOARD_UPDATED:
                "admin-app:dashboard-updated",

            REFRESH_STARTED:
                "admin-app:refresh-started",

            REFRESH_COMPLETED:
                "admin-app:refresh-completed",

            ERROR:
                "admin-app:error"
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const initializedModules =
        new Set();

    const loadingTokens =
        new Set();

    const state = {
        initialized:
            false,

        ready:
            false,

        authorized:
            false,

        signedIn:
            false,

        loading:
            false,

        route:
            DEFAULT_ROUTE,

        admin:
            null,

        summary:
            null,

        lastUpdatedAt:
            null,

        error:
            null
    };

    const elements = {
        root:
            null,

        loadingScreen:
            null,

        authScreen:
            null,

        accessDeniedScreen:
            null,

        errorScreen:
            null,

        dashboardShell:
            null,

        pageTitle:
            null,

        errorMessage:
            null,

        adminName:
            [],

        adminEmail:
            [],

        adminPhoto:
            [],

        navigationItems:
            [],

        pages:
            [],

        refreshButtons:
            [],

        toast:
            null,

        toastMessage:
            null
    };

    let readyPromise =
        null;

    let authUnsubscribe =
        null;

    let controller =
        null;

    let routeSequence =
        0;

    let summaryRequestSequence =
        0;

    let authProcessSequence =
        0;

    let authProcessingPromise =
        Promise.resolve();

    let summaryRequestPromise =
        null;

    let reauthenticationPromise =
        null;

    let toastTimer =
        null;

    let lastSummaryLoadedAtMs =
        0;

    let lastAuthSignature =
        "";

    let lastAuthorizedUid =
        "";

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(
                value
            )
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

    function toSafeString(
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
            String(
                value
            )
                .normalize(
                    "NFKC"
                )
                .trim();

        return (
            normalizedValue ||
            fallback
        );
    }

    function normalizeEmail(
        value
    ) {
        return toSafeString(
            value
        )
            .toLowerCase();
    }

    function toSafeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(
                value
            );

        return Number.isFinite(
            number
        )
            ? number
            : fallback;
    }

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        const number =
            toSafeNumber(
                value,
                fallback
            );

        return Math.max(
            0,
            Math.floor(
                number
            )
        );
    }

    function cloneValue(
        value
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            typeof window
                .structuredClone ===
                "function"
        ) {
            try {
                return window
                    .structuredClone(
                        value
                    );
            } catch {
                /*
                 * JSON fallback below.
                 */
            }
        }

        try {
            return JSON.parse(
                JSON.stringify(
                    value
                )
            );
        } catch {
            return value;
        }
    }

    function normalizeError(
        error
    ) {
        const rawCode =
            toSafeString(
                error?.code
            );

        return Object.freeze({
            code:
                rawCode.includes("/")
                    ? rawCode
                        .split("/")
                        .pop()
                    : rawCode ||
                      "unknown",

            message:
                toSafeString(
                    error?.message
                ) ||
                "The Admin Dashboard operation failed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function formatNumber(
        value
    ) {
        return new Intl.NumberFormat(
            "en-BD"
        ).format(
            toNonNegativeInteger(
                value
            )
        );
    }

    function isElement(
        value
    ) {
        return (
            typeof Element !==
                "undefined" &&
            value instanceof
                Element
        );
    }

    function normalizePhotoURL(
        value
    ) {
        const photoURL =
            toSafeString(
                value
            );

        if (
            !photoURL
        ) {
            return "";
        }

        try {
            const resolvedURL =
                new URL(
                    photoURL,
                    window.location.href
                );

            return [
                "https:",
                "http:"
            ].includes(
                resolvedURL.protocol
            )
                ? resolvedURL.href
                : "";
        } catch {
            return "";
        }
    }

    /* =====================================================
       EVENT AND STATE MANAGEMENT
    ===================================================== */

    function dispatch(
        eventName,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail:
                        cloneValue(
                            detail
                        )
                }
            )
        );
    }

    function getState() {
        return cloneValue({
            initialized:
                state.initialized,

            ready:
                state.ready,

            authorized:
                state.authorized,

            signedIn:
                state.signedIn,

            loading:
                state.loading,

            route:
                state.route,

            admin:
                state.admin,

            summary:
                state.summary,

            lastUpdatedAt:
                state.lastUpdatedAt,

            error:
                state.error
        });
    }

    function notify(
        eventName =
            EVENTS.STATE_CHANGED
    ) {
        const snapshot =
            getState();

        listeners.forEach(
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[AdminApp] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatch(
            eventName,
            snapshot
        );

        if (
            eventName !==
                EVENTS.STATE_CHANGED
        ) {
            dispatch(
                EVENTS.STATE_CHANGED,
                snapshot
            );
        }
    }

    function clearError() {
        state.error =
            null;

        if (
            elements.errorMessage
        ) {
            elements.errorMessage
                .textContent =
                "";
        }
    }

    function setOperationalError(
        error
    ) {
        state.error =
            normalizeError(
                error
            );

        if (
            elements.errorMessage
        ) {
            elements.errorMessage
                .textContent =
                state.error.message;
        }

        showToast(
            state.error.message,
            {
                type:
                    "error",

                duration:
                    4500
            }
        );

        notify(
            EVENTS.ERROR
        );
    }

    function setFatalError(
        error
    ) {
        state.error =
            normalizeError(
                error
            );

        loadingTokens.clear();

        state.loading =
            false;

        if (
            elements.errorMessage
        ) {
            elements.errorMessage
                .textContent =
                state.error.message;
        }

        showOnlyScreen(
            "error"
        );

        notify(
            EVENTS.ERROR
        );
    }

    /* =====================================================
       DOM CACHE
    ===================================================== */

    function queryAll(
        selector
    ) {
        return Array.from(
            document.querySelectorAll(
                selector
            )
        );
    }

    function cacheElements() {
        elements.root =
            document.querySelector(
                "[data-admin-app]"
            ) ||
            document.body;

        elements.loadingScreen =
            document.querySelector(
                "[data-admin-loading-screen]"
            );

        elements.authScreen =
            document.querySelector(
                "[data-admin-auth-screen]"
            );

        elements.accessDeniedScreen =
            document.querySelector(
                "[data-admin-access-denied-screen]"
            );

        elements.errorScreen =
            document.querySelector(
                "[data-admin-error-screen]"
            );

        elements.dashboardShell =
            document.querySelector(
                "[data-admin-dashboard]"
            );

        elements.pageTitle =
            document.querySelector(
                "[data-admin-page-title]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-error-message]"
            );

        elements.adminName =
            queryAll(
                "[data-admin-name]"
            );

        elements.adminEmail =
            queryAll(
                "[data-admin-email]"
            );

        elements.adminPhoto =
            queryAll(
                "[data-admin-photo]"
            );

        elements.navigationItems =
            queryAll(
                "[data-admin-route]"
            );

        elements.pages =
            queryAll(
                "[data-admin-page]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-refresh]"
            );

        elements.toast =
            document.querySelector(
                "[data-admin-toast]"
            );

        elements.toastMessage =
            document.querySelector(
                "[data-admin-toast-message]"
            );
    }

    /* =====================================================
       ELEMENT VISIBILITY
    ===================================================== */

    function setVisible(
        element,
        visible
    ) {
        if (
            !element
        ) {
            return;
        }

        const shouldShow =
            visible ===
            true;

        element.hidden =
            !shouldShow;

        element.setAttribute(
            "aria-hidden",
            shouldShow
                ? "false"
                : "true"
        );

        element.classList.toggle(
            "is-hidden",
            !shouldShow
        );

        element.classList.toggle(
            "is-visible",
            shouldShow
        );
    }

    function showOnlyScreen(
        screenName
    ) {
        setVisible(
            elements.loadingScreen,
            screenName ===
                "loading"
        );

        setVisible(
            elements.authScreen,
            screenName ===
                "auth"
        );

        setVisible(
            elements.accessDeniedScreen,
            screenName ===
                "access-denied"
        );

        setVisible(
            elements.errorScreen,
            screenName ===
                "error"
        );

        setVisible(
            elements.dashboardShell,
            screenName ===
                "dashboard"
        );

        if (
            elements.root
        ) {
            elements.root.dataset
                .adminScreen =
                screenName;
        }
    }

    /* =====================================================
       LOADING MANAGEMENT
    ===================================================== */

    function syncLoadingState() {
        const loading =
            loadingTokens.size >
            0;

        const changed =
            state.loading !==
            loading;

        state.loading =
            loading;

        elements.refreshButtons
            .forEach(
                button => {
                    button.disabled =
                        loading;

                    button.setAttribute(
                        "aria-busy",
                        loading
                            ? "true"
                            : "false"
                    );
                }
            );

        if (
            elements.root
        ) {
            elements.root
                .classList
                .toggle(
                    "is-loading",
                    loading
                );

            elements.root
                .setAttribute(
                    "aria-busy",
                    loading
                        ? "true"
                        : "false"
                );
        }

        if (
            changed
        ) {
            notify();
        }
    }

    function beginLoading(
        label
    ) {
        const token =
            Symbol(
                toSafeString(
                    label,
                    "admin-loading"
                )
            );

        loadingTokens.add(
            token
        );

        syncLoadingState();

        return token;
    }

    function endLoading(
        token
    ) {
        if (
            token
        ) {
            loadingTokens.delete(
                token
            );
        }

        syncLoadingState();
    }

    function clearLoading() {
        loadingTokens.clear();

        syncLoadingState();
    }

    /* =====================================================
       TOAST
    ===================================================== */

    function clearToastTimer() {
        if (
            !toastTimer
        ) {
            return;
        }

        window.clearTimeout(
            toastTimer
        );

        toastTimer =
            null;
    }

    function hideToast() {
        clearToastTimer();

        if (
            !elements.toast
        ) {
            return;
        }

        elements.toast.hidden =
            true;

        elements.toast
            .classList
            .remove(
                "is-visible"
            );
    }

    function showToast(
        message,
        options = {}
    ) {
        const text =
            toSafeString(
                message
            );

        if (
            !text ||
            !elements.toast
        ) {
            return false;
        }

        const type =
            toSafeString(
                options.type,
                "success"
            );

        const duration =
            Math.max(
                1000,
                toSafeNumber(
                    options.duration,
                    3000
                )
            );

        clearToastTimer();

        if (
            elements.toastMessage
        ) {
            elements.toastMessage
                .textContent =
                text;
        } else {
            elements.toast
                .textContent =
                text;
        }

        elements.toast.dataset
            .toastType =
            type;

        elements.toast.hidden =
            false;

        window.requestAnimationFrame(
            () => {
                elements.toast
                    ?.classList
                    .add(
                        "is-visible"
                    );
            }
        );

        toastTimer =
            window.setTimeout(
                hideToast,
                duration
            );

        return true;
    }

    /* =====================================================
       ADMIN IDENTITY
    ===================================================== */

    function createAdminInitials(
        admin
    ) {
        const displayName =
            toSafeString(
                admin?.displayName
            );

        if (
            !displayName
        ) {
            return "A";
        }

        return displayName
            .split(/\s+/)
            .filter(Boolean)
            .slice(
                0,
                2
            )
            .map(
                part =>
                    part
                        .charAt(0)
                        .toUpperCase()
            )
            .join("");
    }

    function normalizeAdmin(
        admin
    ) {
        const source =
            isPlainObject(
                admin
            )
                ? admin
                : {};

        return Object.freeze({
            uid:
                toSafeString(
                    source.uid
                ),

            displayName:
                toSafeString(
                    source.displayName ||
                    source.name,
                    "Admin"
                ),

            email:
                normalizeEmail(
                    source.email
                ),

            photoURL:
                normalizePhotoURL(
                    source.photoURL ||
                    source.photo
                ),

            isAdmin:
                source.isAdmin ===
                    true,

            isSuperAdmin:
                false,

            role:
                "admin"
        });
    }

    function renderAdminIdentity(
        admin
    ) {
        const normalizedAdmin =
            normalizeAdmin(
                admin
            );

        elements.adminName
            .forEach(
                element => {
                    element.textContent =
                        normalizedAdmin
                            .displayName;
                }
            );

        elements.adminEmail
            .forEach(
                element => {
                    element.textContent =
                        normalizedAdmin
                            .email;
                }
            );

        elements.adminPhoto
            .forEach(
                element => {
                    if (
                        element.tagName ===
                            "IMG"
                    ) {
                        if (
                            normalizedAdmin
                                .photoURL
                        ) {
                            element.src =
                                normalizedAdmin
                                    .photoURL;

                            element.referrerPolicy =
                                "no-referrer";
                        } else {
                            element.removeAttribute(
                                "src"
                            );
                        }

                        element.alt =
                            normalizedAdmin
                                .displayName;

                        return;
                    }

                    element.textContent =
                        createAdminInitials(
                            normalizedAdmin
                        );
                }
            );
    }

    /* =====================================================
       DASHBOARD SUMMARY NORMALIZATION
    ===================================================== */

    function normalizeDashboardSummary(
        result
    ) {
        const source =
            isPlainObject(
                result?.summary
            )
                ? result.summary
                : isPlainObject(
                    result?.data?.summary
                )
                    ? result
                        .data
                        .summary
                    : isPlainObject(
                        result?.data
                    )
                        ? result.data
                        : isPlainObject(
                            result
                        )
                            ? result
                            : {};

        const users =
            isPlainObject(
                source.users
            )
                ? source.users
                : {};

        const offers =
            isPlainObject(
                source.offers
            )
                ? source.offers
                : isPlainObject(
                    source.offer
                )
                    ? source.offer
                    : {};

        const totalUsers =
            toNonNegativeInteger(
                users.total ??
                source.totalUsers
            );

        const paidOffers =
            Math.min(
                totalUsers ||
                    Number.MAX_SAFE_INTEGER,

                toNonNegativeInteger(
                    offers.paid ??
                    source.paidOffers ??
                    source.offerPaid
                )
            );

        const unpaidOffers =
            Math.max(
                0,

                toNonNegativeInteger(
                    offers.unpaid,
                    Math.max(
                        0,
                        totalUsers -
                        paidOffers
                    )
                )
            );

        return Object.freeze({
            users: {
                total:
                    totalUsers,

                active:
                    toNonNegativeInteger(
                        users.active ??
                        source.activeUsers
                    ),

                suspended:
                    toNonNegativeInteger(
                        users.suspended ??
                        source.suspendedUsers
                    ),

                blocked:
                    toNonNegativeInteger(
                        users.blocked ??
                        source.blockedUsers
                    )
            },

            offers: {
                paid:
                    paidOffers,

                unpaid:
                    unpaidOffers,

                total:
                    toNonNegativeInteger(
                        offers.total,
                        totalUsers
                    )
            }
        });
    }

    function readPath(
        source,
        path
    ) {
        const parts =
            toSafeString(
                path
            )
                .split(".")
                .filter(
                    Boolean
                );

        let value =
            source;

        for (
            const part of parts
        ) {
            if (
                value === null ||
                value === undefined ||
                typeof value !==
                    "object"
            ) {
                return undefined;
            }

            value =
                value[part];
        }

        return value;
    }

    function setSummaryElements(
        selector,
        value
    ) {
        const formattedValue =
            formatNumber(
                value
            );

        queryAll(
            selector
        ).forEach(
            element => {
                element.textContent =
                    formattedValue;
            }
        );
    }

    function renderSummary(
        summary
    ) {
        const source =
            normalizeDashboardSummary(
                summary
            );

        queryAll(
            "[data-admin-summary]"
        ).forEach(
            element => {
                const path =
                    toSafeString(
                        element.dataset
                            .adminSummary
                    );

                const value =
                    readPath(
                        source,
                        path
                    );

                element.textContent =
                    formatNumber(
                        value
                    );
            }
        );

        setSummaryElements(
            "[data-admin-summary-users-total]",
            source.users.total
        );

        setSummaryElements(
            "[data-admin-summary-users-active]",
            source.users.active
        );

        setSummaryElements(
            "[data-admin-summary-users-suspended]",
            source.users.suspended
        );

        setSummaryElements(
            "[data-admin-summary-users-blocked]",
            source.users.blocked
        );

        setSummaryElements(
            "[data-admin-summary-offers-paid]",
            source.offers.paid
        );

        setSummaryElements(
            "[data-admin-summary-offers-unpaid]",
            source.offers.unpaid
        );

        setSummaryElements(
            "[data-admin-summary-offers-total]",
            source.offers.total
        );
    }

    /* =====================================================
       ADMIN API / AUTH
    ===================================================== */

    function getAdminAPI() {
        const api =
            window.AdminAPI;

        if (
            !api
        ) {
            throw new Error(
                "AdminAPI is not available."
            );
        }

        return api;
    }

    function getAdminAuth() {
        const auth =
            window.AdminAuth;

        if (
            !auth
        ) {
            throw new Error(
                "AdminAuth is not available."
            );
        }

        return auth;
    }

    /* =====================================================
       DASHBOARD SUMMARY
    ===================================================== */

    async function refreshDashboardSummary(
        options = {}
    ) {
        const showLoading =
            options.showLoading ===
            true;

        const force =
            options.force ===
            true;

        if (
            !state.authorized
        ) {
            return null;
        }

        if (
            summaryRequestPromise
        ) {
            return summaryRequestPromise;
        }

        const now =
            Date.now();

        if (
            !force &&
            state.summary &&
            now -
                lastSummaryLoadedAtMs <
                SUMMARY_DEDUPE_WINDOW_MS
        ) {
            return cloneValue(
                state.summary
            );
        }

        const requestId =
            ++summaryRequestSequence;

        const loadingToken =
            showLoading
                ? beginLoading(
                    "dashboard-summary"
                )
                : null;

        clearError();

        dispatch(
            EVENTS.REFRESH_STARTED,
            {
                route:
                    ROUTES.DASHBOARD
            }
        );

        summaryRequestPromise =
            (async () => {
                try {
                    const result =
                        await getAdminAPI()
                            .getAdminDashboardSummary();

                    if (
                        requestId !==
                            summaryRequestSequence ||
                        !state.authorized
                    ) {
                        return null;
                    }

                    state.summary =
                        normalizeDashboardSummary(
                            result
                        );

                    state.lastUpdatedAt =
                        new Date()
                            .toISOString();

                    lastSummaryLoadedAtMs =
                        Date.now();

                    renderSummary(
                        state.summary
                    );

                    notify(
                        EVENTS.DASHBOARD_UPDATED
                    );

                    dispatch(
                        EVENTS.REFRESH_COMPLETED,
                        {
                            route:
                                ROUTES.DASHBOARD,

                            success:
                                true
                        }
                    );

                    return cloneValue(
                        state.summary
                    );
                } catch (error) {
                    if (
                        requestId ===
                            summaryRequestSequence
                    ) {
                        setOperationalError(
                            error
                        );
                    }

                    dispatch(
                        EVENTS.REFRESH_COMPLETED,
                        {
                            route:
                                ROUTES.DASHBOARD,

                            success:
                                false,

                            error:
                                normalizeError(
                                    error
                                )
                        }
                    );

                    throw error;
                } finally {
                    if (
                        requestId ===
                            summaryRequestSequence
                    ) {
                        summaryRequestPromise =
                            null;
                    }

                    endLoading(
                        loadingToken
                    );
                }
            })();

        return summaryRequestPromise;
    }

    /* =====================================================
       ROUTE MODULE MANAGEMENT
    ===================================================== */

    function getRouteModule(
        route
    ) {
        const moduleName =
            ROUTE_MODULES[
                route
            ];

        if (
            !moduleName
        ) {
            return null;
        }

        const routeModule =
            window[
                moduleName
            ];

        if (
            !routeModule
        ) {
            throw new Error(
                `${moduleName} is not available.`
            );
        }

        return routeModule;
    }

    async function initializeRouteModule(
        route
    ) {
        const routeModule =
            getRouteModule(
                route
            );

        if (
            !routeModule
        ) {
            return {
                routeModule:
                    null,

                initializedNow:
                    false
            };
        }

        if (
            initializedModules.has(
                route
            )
        ) {
            return {
                routeModule,

                initializedNow:
                    false
            };
        }

        if (
            typeof routeModule.init !==
                "function"
        ) {
            throw new Error(
                `The ${route} Admin module does not provide init().`
            );
        }

        await routeModule.init();

        initializedModules.add(
            route
        );

        return {
            routeModule,

            initializedNow:
                true
        };
    }

    async function refreshRouteModule(
        route,
        options = {}
    ) {
        const {
            routeModule,
            initializedNow
        } =
            await initializeRouteModule(
                route
            );

        if (
            !routeModule
        ) {
            return null;
        }

        if (
            initializedNow &&
            options.refreshAfterInit !==
                true
        ) {
            return typeof routeModule
                .getState ===
                "function"
                ? routeModule
                    .getState()
                : routeModule;
        }

        if (
            options.force ===
                false
        ) {
            return typeof routeModule
                .getState ===
                "function"
                ? routeModule
                    .getState()
                : routeModule;
        }

        if (
            typeof routeModule.refresh ===
                "function"
        ) {
            return routeModule
                .refresh();
        }

        if (
            typeof routeModule.load ===
                "function"
        ) {
            return routeModule
                .load();
        }

        return null;
    }

    function destroyRouteModules() {
        Object.entries(
            ROUTE_MODULES
        ).forEach(
            ([
                route,
                moduleName
            ]) => {
                const routeModule =
                    window[
                        moduleName
                    ];

                if (
                    routeModule &&
                    typeof routeModule
                        .destroy ===
                        "function"
                ) {
                    try {
                        routeModule
                            .destroy();
                    } catch (error) {
                        console.error(
                            `[AdminApp] Failed to destroy ${moduleName}.`,
                            error
                        );
                    }
                }

                initializedModules
                    .delete(
                        route
                    );
            }
        );
    }

    /* =====================================================
       ROUTING
    ===================================================== */

    function normalizeRoute(
        value
    ) {
        const route =
            toSafeString(
                value
            )
                .toLowerCase()
                .replace(
                    /^#/,
                    ""
                )
                .split("?")[0]
                .replace(
                    /[^a-z-]/g,
                    ""
                );

        return VALID_ROUTES
            .includes(
                route
            )
                ? route
                : DEFAULT_ROUTE;
    }

    function getRouteFromLocation() {
        return normalizeRoute(
            window.location.hash
        );
    }

    function updatePageTitle(
        route
    ) {
        const routeTitle =
            ROUTE_TITLES[
                route
            ] ||
            ROUTE_TITLES[
                DEFAULT_ROUTE
            ];

        if (
            elements.pageTitle
        ) {
            elements.pageTitle
                .textContent =
                routeTitle;
        }

        document.title =
            `${routeTitle} — 11Play Admin`;
    }

    function renderNavigation(
        route
    ) {
        elements.navigationItems
            .forEach(
                element => {
                    const itemRoute =
                        normalizeRoute(
                            element.dataset
                                .adminRoute
                        );

                    const active =
                        itemRoute ===
                        route;

                    element.classList
                        .toggle(
                            "is-active",
                            active
                        );

                    if (
                        active
                    ) {
                        element.setAttribute(
                            "aria-current",
                            "page"
                        );
                    } else {
                        element.removeAttribute(
                            "aria-current"
                        );
                    }
                }
            );
    }

    function renderPages(
        route
    ) {
        elements.pages
            .forEach(
                page => {
                    const pageRoute =
                        normalizeRoute(
                            page.dataset
                                .adminPage
                        );

                    const active =
                        pageRoute ===
                        route;

                    page.hidden =
                        !active;

                    page.classList
                        .toggle(
                            "is-active",
                            active
                        );

                    page.setAttribute(
                        "aria-hidden",
                        active
                            ? "false"
                            : "true"
                    );
                }
            );
    }

    async function activateRoute(
        route,
        options = {}
    ) {
        if (
            !state.authorized
        ) {
            return getState();
        }

        const currentRouteRequest =
            ++routeSequence;

        const normalizedRoute =
            normalizeRoute(
                route
            );

        state.route =
            normalizedRoute;

        updatePageTitle(
            normalizedRoute
        );

        renderNavigation(
            normalizedRoute
        );

        renderPages(
            normalizedRoute
        );

        notify(
            EVENTS.ROUTE_CHANGED
        );

        const loadingToken =
            beginLoading(
                `route-${normalizedRoute}`
            );

        try {
            if (
                normalizedRoute ===
                    ROUTES.DASHBOARD
            ) {
                await refreshDashboardSummary({
                    showLoading:
                        false,

                    force:
                        options.force ===
                        true
                });
            } else {
                await refreshRouteModule(
                    normalizedRoute,
                    {
                        force:
                            options.force !==
                            false,

                        refreshAfterInit:
                            options
                                .refreshAfterInit ===
                                true
                    }
                );
            }
        } catch (error) {
            if (
                currentRouteRequest ===
                    routeSequence
            ) {
                setOperationalError(
                    error
                );
            }

            console.error(
                `[AdminApp] Route "${normalizedRoute}" failed.`,
                error
            );
        } finally {
            endLoading(
                loadingToken
            );
        }

        return getState();
    }

    async function navigate(
        route,
        options = {}
    ) {
        const normalizedRoute =
            normalizeRoute(
                route
            );

        const expectedHash =
            `#${normalizedRoute}`;

        if (
            window.location.hash !==
                expectedHash
        ) {
            const method =
                options.replace ===
                    true
                    ? "replaceState"
                    : "pushState";

            window.history[
                method
            ](
                null,
                "",
                expectedHash
            );
        }

        return activateRoute(
            normalizedRoute,
            options
        );
    }

    /* =====================================================
       CURRENT ROUTE REFRESH
    ===================================================== */

    async function refreshCurrentRoute() {
        if (
            !state.authorized
        ) {
            return getState();
        }

        clearError();

        const loadingToken =
            beginLoading(
                "current-route-refresh"
            );

        try {
            if (
                state.route ===
                    ROUTES.DASHBOARD
            ) {
                await refreshDashboardSummary({
                    showLoading:
                        false,

                    force:
                        true
                });
            } else {
                await Promise.all([
                    refreshRouteModule(
                        state.route,
                        {
                            force:
                                true,

                            refreshAfterInit:
                                true
                        }
                    ),

                    refreshDashboardSummary({
                        showLoading:
                            false,

                        force:
                            true
                    })
                ]);
            }

            showToast(
                "Data refreshed successfully."
            );
        } catch (error) {
            setOperationalError(
                error
            );
        } finally {
            endLoading(
                loadingToken
            );
        }

        return getState();
    }

    /* =====================================================
       AUTH STATE
    ===================================================== */

    function createAuthSignature(
        authState
    ) {
        return [
            toSafeString(
                authState?.status
            ),

            toSafeString(
                authState
                    ?.firebaseUser
                    ?.uid
            ),

            toSafeString(
                authState
                    ?.admin
                    ?.uid
            ),

            authState?.authorized ===
                true
                ? "1"
                : "0",

            authState?.accessDenied ===
                true
                ? "1"
                : "0",

            toSafeString(
                authState
                    ?.error
                    ?.code
            )
        ].join("|");
    }

    async function handleAuthorized(
        authState
    ) {
        const admin =
            normalizeAdmin(
                authState?.admin
            );

        const validAdmin =
            admin.uid &&
            admin.email ===
                SOLE_ADMIN_EMAIL &&
            admin.isAdmin ===
                true &&
            admin.isSuperAdmin ===
                false;

        if (
            !validAdmin
        ) {
            handleAccessDenied();
            return;
        }

        const sameAuthorizedSession =
            state.authorized ===
                true &&
            lastAuthorizedUid ===
                admin.uid;

        state.signedIn =
            true;

        state.authorized =
            true;

        state.admin =
            cloneValue(
                admin
            );

        state.error =
            null;

        lastAuthorizedUid =
            admin.uid;

        renderAdminIdentity(
            admin
        );

        showOnlyScreen(
            "dashboard"
        );

        if (
            sameAuthorizedSession
        ) {
            notify();
            return;
        }

        const route =
            getRouteFromLocation();

        await navigate(
            route,
            {
                replace:
                    !window.location.hash,

                force:
                    true
            }
        );
    }

    function resetAuthorizedState() {
        summaryRequestSequence +=
            1;

        routeSequence +=
            1;

        summaryRequestPromise =
            null;

        lastSummaryLoadedAtMs =
            0;

        lastAuthorizedUid =
            "";

        state.authorized =
            false;

        state.admin =
            null;

        state.summary =
            null;

        state.lastUpdatedAt =
            null;

        clearLoading();

        destroyRouteModules();
    }

    function handleSignedOut() {
        resetAuthorizedState();

        state.signedIn =
            false;

        state.route =
            DEFAULT_ROUTE;

        clearError();

        showOnlyScreen(
            "auth"
        );

        notify();
    }

    function handleAccessDenied() {
        resetAuthorizedState();

        state.signedIn =
            true;

        clearError();

        showOnlyScreen(
            "access-denied"
        );

        notify();
    }

    function handleAuthChecking() {
        state.signedIn =
            false;

        state.authorized =
            false;

        state.loading =
            true;

        showOnlyScreen(
            "loading"
        );

        notify();
    }

    function handleAuthError(
        authState
    ) {
        resetAuthorizedState();

        state.signedIn =
            Boolean(
                authState
                    ?.firebaseUser
                    ?.uid
            );

        setFatalError(
            authState?.error ||
            new Error(
                "Admin authentication failed."
            )
        );
    }

    async function processAuthState(
        authState,
        currentProcess
    ) {
        if (
            currentProcess !==
                authProcessSequence
        ) {
            return getState();
        }

        const status =
            toSafeString(
                authState?.status
            );

        if (
            authState?.authorized ===
                true ||
            status ===
                "authorized"
        ) {
            await handleAuthorized(
                authState
            );

            return getState();
        }

        if (
            currentProcess !==
                authProcessSequence
        ) {
            return getState();
        }

        if (
            authState?.accessDenied ===
                true ||
            status ===
                "access_denied"
        ) {
            handleAccessDenied();

            return getState();
        }

        if (
            status ===
                "signed_out"
        ) {
            handleSignedOut();

            return getState();
        }

        if (
            status ===
                "error"
        ) {
            handleAuthError(
                authState
            );

            return getState();
        }

        handleAuthChecking();

        return getState();
    }

    function queueAuthState(
        authState
    ) {
        const signature =
            createAuthSignature(
                authState
            );

        if (
            signature &&
            signature ===
                lastAuthSignature
        ) {
            return authProcessingPromise;
        }

        lastAuthSignature =
            signature;

        const currentProcess =
            ++authProcessSequence;

        authProcessingPromise =
            processAuthState(
                authState,
                currentProcess
            );

        return authProcessingPromise;
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function handleDocumentClick(
        event
    ) {
        if (
            event.defaultPrevented ||
            !isElement(
                event.target
            )
        ) {
            return;
        }

        const routeElement =
            event.target.closest(
                "[data-admin-route]"
            );

        if (
            routeElement
        ) {
            event.preventDefault();

            void navigate(
                routeElement.dataset
                    .adminRoute
            );

            return;
        }

        const refreshElement =
            event.target.closest(
                "[data-admin-refresh]"
            );

        if (
            refreshElement
        ) {
            event.preventDefault();

            void refreshCurrentRoute();

            return;
        }

        const retryElement =
            event.target.closest(
                "[data-admin-retry]"
            );

        if (
            retryElement
        ) {
            event.preventDefault();

            clearError();

            void getAdminAuth()
                .verifyAdminSession(
                    null,
                    {
                        redirectOnDenied:
                            true
                    }
                )
                .catch(
                    error => {
                        setFatalError(
                            error
                        );
                    }
                );

            return;
        }

        const toastCloseElement =
            event.target.closest(
                "[data-admin-toast-close]"
            );

        if (
            toastCloseElement
        ) {
            event.preventDefault();

            hideToast();
        }
    }

    function handleHashChange() {
        if (
            !state.authorized
        ) {
            return;
        }

        void activateRoute(
            getRouteFromLocation(),
            {
                force:
                    true
            }
        );
    }

    function handleAdminDataChanged() {
        if (
            !state.authorized
        ) {
            return;
        }

        void refreshDashboardSummary({
            showLoading:
                false,

            force:
                false
        }).catch(
            error => {
                console.error(
                    "[AdminApp] Background summary refresh failed.",
                    error
                );
            }
        );
    }

    function reverifyAdminSession() {
        if (
            reauthenticationPromise
        ) {
            return reauthenticationPromise;
        }

        reauthenticationPromise =
            getAdminAuth()
                .verifyAdminSession(
                    null,
                    {
                        redirectOnDenied:
                            true
                    }
                )
                .catch(
                    error => {
                        handleAccessDenied();

                        throw error;
                    }
                )
                .finally(
                    () => {
                        reauthenticationPromise =
                            null;
                    }
                );

        return reauthenticationPromise;
    }

    function handleAdminAPIError(
        event
    ) {
        const error =
            event?.detail?.error;

        if (
            !error
        ) {
            return;
        }

        const code =
            toSafeString(
                error.code
            )
                .toLowerCase()
                .replace(
                    /_/g,
                    "-"
                );

        if (
            code !==
                "permission-denied" &&
            code !==
                "unauthenticated"
        ) {
            return;
        }

        void reverifyAdminSession()
            .catch(
                () => {
                    /*
                     * Access-denied state is handled above.
                     */
                }
            );
    }

    function bindBrowserEvents() {
        if (
            controller
        ) {
            return true;
        }

        controller =
            new AbortController();

        const signal =
            controller.signal;

        document.addEventListener(
            "click",
            handleDocumentClick,
            {
                signal
            }
        );

        window.addEventListener(
            "hashchange",
            handleHashChange,
            {
                signal
            }
        );

        /*
         * Current Admin mutation events.
         */

        [
            "admin:data-changed",
            "admin-users:offer-paid",
            "admin:offer-paid"
        ].forEach(
            eventName => {
                window.addEventListener(
                    eventName,
                    handleAdminDataChanged,
                    {
                        signal
                    }
                );
            }
        );

        window.addEventListener(
            "admin-api:request-failed",
            handleAdminAPIError,
            {
                signal
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            readyPromise
        ) {
            return readyPromise;
        }

        readyPromise =
            (async () => {
                state.initialized =
                    true;

                cacheElements();

                bindBrowserEvents();

                showOnlyScreen(
                    "loading"
                );

                try {
                    const api =
                        getAdminAPI();

                    const auth =
                        getAdminAuth();

                    if (
                        typeof api.init ===
                            "function"
                    ) {
                        api.init();
                    }

                    if (
                        typeof auth.subscribe ===
                            "function"
                    ) {
                        authUnsubscribe =
                            auth.subscribe(
                                authState => {
                                    void queueAuthState(
                                        authState
                                    );
                                }
                            );
                    }

                    const authState =
                        await auth.init();

                    await queueAuthState(
                        authState
                    );

                    state.ready =
                        true;

                    notify(
                        EVENTS.READY
                    );

                    return getState();
                } catch (error) {
                    state.ready =
                        true;

                    setFatalError(
                        error
                    );

                    throw error;
                }
            })();

        return readyPromise;
    }

    function whenReady() {
        return init();
    }

    /* =====================================================
       SUBSCRIPTION
    ===================================================== */

    function subscribe(
        listener
    ) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "AdminApp subscriber must be a function."
            );
        }

        listeners.add(
            listener
        );

        listener(
            getState()
        );

        return function unsubscribe() {
            listeners.delete(
                listener
            );
        };
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        routeSequence +=
            1;

        summaryRequestSequence +=
            1;

        authProcessSequence +=
            1;

        clearToastTimer();

        clearLoading();

        if (
            typeof authUnsubscribe ===
                "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        controller?.abort();

        controller =
            null;

        destroyRouteModules();

        listeners.clear();

        readyPromise =
            null;

        summaryRequestPromise =
            null;

        reauthenticationPromise =
            null;

        authProcessingPromise =
            Promise.resolve();

        lastAuthSignature =
            "";

        lastAuthorizedUid =
            "";

        lastSummaryLoadedAtMs =
            0;

        state.initialized =
            false;

        state.ready =
            false;

        state.authorized =
            false;

        state.signedIn =
            false;

        state.loading =
            false;

        state.route =
            DEFAULT_ROUTE;

        state.admin =
            null;

        state.summary =
            null;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.AdminApp =
        Object.freeze({
            init,
            whenReady,
            destroy,

            navigate,
            activateRoute,

            refresh:
                refreshCurrentRoute,

            refreshCurrentRoute,
            refreshDashboardSummary,

            getState,

            getRoute() {
                return state.route;
            },

            getAdmin() {
                return cloneValue(
                    state.admin
                );
            },

            getSummary() {
                return cloneValue(
                    state.summary
                );
            },

            isAuthorized() {
                return (
                    state.authorized ===
                    true
                );
            },

            normalizeDashboardSummary,

            showToast,
            hideToast,

            subscribe,

            SOLE_ADMIN_EMAIL,
            ROUTES,
            EVENTS
        });

    /* =====================================================
       AUTOMATIC BOOT
    ===================================================== */

    function boot() {
        void init()
            .catch(
                error => {
                    console.error(
                        "[AdminApp] Initialization failed.",
                        error
                    );
                }
            );
    }

    if (
        document.readyState ===
            "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            boot,
            {
                once:
                    true
            }
        );
    } else {
        boot();
    }
})(
    window,
    document
);