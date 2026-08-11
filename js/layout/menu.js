"use strict";

/* =========================================================
   11PLAY — SIDE MENU
   File: js/layout/menu.js

   Responsibilities:
   - Render MenuConfig safely
   - Forward internal page navigation to Main Router
   - Handle configured menu actions
   - Open configured HTML, external and download links
   - Synchronize active menu item with Main Router
   - Show the sole Admin Dashboard entry when authorized
   - Delegate menu visibility to Shell
   - Preserve the original side-menu design

   Supported action:
   - invite-share -> Share.shareInvite()
========================================================= */

const Menu = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_PAGE =
        "home";

    const ROUTE_CHANGED_EVENT =
        "router:page-changed";

    const SOLE_ADMIN_EMAIL =
        "casinobuzzbd@gmail.com";

    const ADMIN_DASHBOARD_URL =
        "https://11play.github.io/11play/admin/";

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const INVITE_SHARE_ACTION =
        "invite-share";

    const ADMIN_AUTH_EVENTS =
        Object.freeze([
            "auth:state-changed",
            "profile:auth-changed",
            "auth:signed-in",
            "auth:signed-out"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        menuElement:
            null,

        overlayElement:
            null,

        menuButton:
            null,

        controller:
            null,

        activePage:
            DEFAULT_PAGE
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

    function normalizePage(page) {
        return normalizeString(
            page
        )
            .toLowerCase()
            .replace(
                /\s+/g,
                "-"
            );
    }

    function normalizeAction(
        action
    ) {
        return normalizeString(
            action
        )
            .toLowerCase()
            .replace(
                /\s+/g,
                "-"
            );
    }

    function normalizeEmail(value) {
        return normalizeString(
            value
        )
            .toLowerCase();
    }

    function getData() {
        return Array.isArray(
            window.MenuConfig
        )
            ? window.MenuConfig
            : [];
    }

    /* =====================================================
       AUTHENTICATED USER
    ===================================================== */

    function getProviderIds(user) {
        const providerIds =
            [];

        if (
            Array.isArray(
                user?.providerIds
            )
        ) {
            providerIds.push(
                ...user.providerIds
            );
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            user.providerData
                .forEach(
                    provider => {
                        providerIds.push(
                            provider
                                ?.providerId
                        );
                    }
                );
        }

        return Array.from(
            new Set(
                providerIds
                    .map(
                        providerId =>
                            normalizeString(
                                providerId
                            )
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    function resolveAuthenticatedUser() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService
        ) {
            const methods =
                [
                    "getCurrentUser",
                    "getUser"
                ];

            for (
                const methodName of
                methods
            ) {
                if (
                    typeof authService[
                        methodName
                    ] !==
                        "function"
                ) {
                    continue;
                }

                try {
                    const user =
                        authService[
                            methodName
                        ]();

                    if (
                        user?.uid
                    ) {
                        return user;
                    }
                } catch {
                    /*
                     * Continue to the next
                     * authenticated-user source.
                     */
                }
            }
        }

        if (
            window.AuthGuard &&
            typeof window.AuthGuard
                .getState ===
                "function"
        ) {
            try {
                const guardState =
                    window.AuthGuard
                        .getState();

                if (
                    guardState
                        ?.user
                        ?.uid
                ) {
                    return guardState
                        .user;
                }
            } catch {
                /*
                 * No authenticated user
                 * can be confirmed.
                 */
            }
        }

        return null;
    }

    function isSoleAdminUser(user) {
        if (
            !user?.uid
        ) {
            return false;
        }

        const providerIds =
            getProviderIds(
                user
            );

        const signInProvider =
            normalizeString(
                user.signInProvider
            )
                .toLowerCase();

        const directGoogleSignIn =
            user.isGoogleSignIn ===
                true ||
            signInProvider ===
                GOOGLE_PROVIDER_ID;

        return Boolean(
            normalizeEmail(
                user.email
            ) ===
                SOLE_ADMIN_EMAIL &&
            user.emailVerified ===
                true &&
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            ) &&
            directGoogleSignIn
        );
    }

    /* =====================================================
       ELEMENT RESOLUTION
    ===================================================== */

    function resolveElements() {
        state.menuElement =
            document.getElementById(
                "sideMenu"
            );

        state.overlayElement =
            document.getElementById(
                "overlay"
            );

        state.menuButton =
            document.getElementById(
                "menuBtn"
            );

        return Boolean(
            state.menuElement
        );
    }

    /* =====================================================
       URL HANDLING
    ===================================================== */

    function resolveURL(value) {
        const url =
            normalizeString(
                value
            );

        if (
            !url
        ) {
            return null;
        }

        try {
            const resolvedURL =
                new URL(
                    url,
                    window.location.href
                );

            const allowedProtocols =
                new Set([
                    "http:",
                    "https:",
                    "mailto:",
                    "tel:",
                    "sms:"
                ]);

            return allowedProtocols
                .has(
                    resolvedURL.protocol
                )
                ? resolvedURL
                : null;
        } catch {
            return null;
        }
    }

    function isExternalURL(url) {
        if (
            !(
                url instanceof
                    URL
            )
        ) {
            return false;
        }

        if (
            [
                "mailto:",
                "tel:",
                "sms:"
            ].includes(
                url.protocol
            )
        ) {
            return true;
        }

        return (
            url.origin !==
            window.location.origin
        );
    }

    function isDownloadItem(
        item,
        url
    ) {
        if (
            item?.download ===
                true
        ) {
            return true;
        }

        const pathname =
            url instanceof URL
                ? url.pathname
                : normalizeString(
                    item?.url
                );

        return /\.apk$/i.test(
            pathname
        );
    }

    /* =====================================================
       MENU HEADER
    ===================================================== */

    function createMenuHeader() {
        const header =
            document.createElement(
                "div"
            );

        header.className =
            "menu-header";

        const icon =
            document.createElement(
                "div"
            );

        icon.className =
            "menu-icon";

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        icon.textContent =
            "☰";

        const content =
            document.createElement(
                "div"
            );

        const title =
            document.createElement(
                "div"
            );

        title.className =
            "menu-title";

        title.textContent =
            "11PLAY";

        const subtitle =
            document.createElement(
                "div"
            );

        subtitle.className =
            "menu-subtitle";

        subtitle.textContent =
            "Smart Web Access";

        content.append(
            title,
            subtitle
        );

        header.append(
            icon,
            content
        );

        return header;
    }

    /* =====================================================
       DIVIDER AND VERSION
    ===================================================== */

    function createDivider() {
        const divider =
            document.createElement(
                "div"
            );

        divider.className =
            "menu-divider";

        divider.setAttribute(
            "role",
            "separator"
        );

        return divider;
    }

    function createVersionItem(item) {
        const version =
            document.createElement(
                "div"
            );

        version.className =
            "menu-version";

        version.textContent =
            normalizeString(
                item?.label,
                "Version"
            );

        return version;
    }

    /* =====================================================
       ACTIVE STATE
    ===================================================== */

    function applyMenuItemState(
        element,
        page
    ) {
        const active =
            Boolean(
                page
            ) &&
            page ===
                state.activePage;

        element.classList.toggle(
            "active",
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

        return active;
    }

    /* =====================================================
       INTERNAL SPA MENU ITEM
    ===================================================== */

    function createInternalItem(item) {
        const page =
            normalizePage(
                item?.page
            );

        if (
            !page
        ) {
            return null;
        }

        /*
         * Original menu CSS was designed for block elements.
         * Using div prevents native button styles from
         * changing the existing menu design.
         */

        const element =
            document.createElement(
                "div"
            );

        element.className =
            "menu-item";

        element.dataset.page =
            page;

        element.dataset.menuRoute =
            page;

        element.setAttribute(
            "role",
            "button"
        );

        element.tabIndex =
            0;

        element.textContent =
            normalizeString(
                item?.label,
                page
            );

        applyMenuItemState(
            element,
            page
        );

        return element;
    }

    /* =====================================================
       ACTION MENU ITEM
    ===================================================== */

    function createActionItem(item) {
        const action =
            normalizeAction(
                item?.action
            );

        if (
            !action
        ) {
            return null;
        }

        /*
         * Action items intentionally use the same .menu-item
         * class so the existing menu design remains unchanged.
         */

        const element =
            document.createElement(
                "div"
            );

        element.className =
            "menu-item";

        element.dataset.menuAction =
            action;

        element.setAttribute(
            "role",
            "button"
        );

        element.setAttribute(
            "aria-label",
            normalizeString(
                item?.label,
                "Menu action"
            )
        );

        element.tabIndex =
            0;

        element.textContent =
            normalizeString(
                item?.label,
                "Action"
            );

        return element;
    }

    /* =====================================================
       HTML / EXTERNAL / DOWNLOAD MENU ITEM
    ===================================================== */

    function createURLItem(item) {
        const resolvedURL =
            resolveURL(
                item?.url
            );

        if (
            !resolvedURL
        ) {
            return null;
        }

        const page =
            normalizePage(
                item?.page
            );

        /*
         * URL entries also use div so native anchor styles
         * do not alter the existing menu design.
         */

        const element =
            document.createElement(
                "div"
            );

        element.className =
            "menu-item";

        element.dataset.menuUrl =
            "true";

        element.dataset.url =
            resolvedURL.href;

        element.setAttribute(
            "role",
            "link"
        );

        element.tabIndex =
            0;

        element.textContent =
            normalizeString(
                item?.label,
                page ||
                "Open"
            );

        if (
            page
        ) {
            element.dataset.page =
                page;
        }

        if (
            isDownloadItem(
                item,
                resolvedURL
            )
        ) {
            element.dataset.download =
                "true";
        } else if (
            isExternalURL(
                resolvedURL
            )
        ) {
            element.dataset.external =
                "true";
        }

        applyMenuItemState(
            element,
            page
        );

        return element;
    }

    /* =====================================================
       SOLE ADMIN DASHBOARD ITEM

       This controls menu visibility only.
       Firestore Rules remain the final data authority.
    ===================================================== */

    function createAdminDashboardItem() {
        const resolvedURL =
            resolveURL(
                ADMIN_DASHBOARD_URL
            );

        if (
            !resolvedURL
        ) {
            return null;
        }

        const element =
            document.createElement(
                "div"
            );

        element.className =
            "menu-item admin-dashboard-entry-link";

        element.dataset
            .mainAdminDashboardLink =
            "true";

        element.dataset.menuUrl =
            "true";

        element.dataset.url =
            resolvedURL.href;

        element.setAttribute(
            "role",
            "link"
        );

        element.setAttribute(
            "aria-label",
            "Open Admin Dashboard"
        );

        element.tabIndex =
            0;

        const icon =
            document.createElement(
                "span"
            );

        icon.className =
            "admin-dashboard-entry-link-icon";

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        icon.textContent =
            "⚙";

        const label =
            document.createElement(
                "span"
            );

        label.textContent =
            "Admin Dashboard";

        element.append(
            icon,
            label
        );

        return element;
    }

    function getMenuBody() {
        return (
            state.menuElement
                ?.querySelector(
                    ".menu-body"
                ) ||
            null
        );
    }

    function removeAdminDashboardItem() {
        state.menuElement
            ?.querySelectorAll(
                "[data-main-admin-dashboard-link]"
            )
            .forEach(
                element => {
                    element.remove();
                }
            );

        return true;
    }

    function syncAdminDashboardItem() {
        const menuBody =
            getMenuBody();

        if (
            !menuBody
        ) {
            return false;
        }

        const currentUser =
            resolveAuthenticatedUser();

        const existingItem =
            menuBody.querySelector(
                "[data-main-admin-dashboard-link]"
            );

        if (
            !isSoleAdminUser(
                currentUser
            )
        ) {
            removeAdminDashboardItem();

            return false;
        }

        if (
            existingItem
        ) {
            return true;
        }

        const adminItem =
            createAdminDashboardItem();

        if (
            !adminItem
        ) {
            return false;
        }

        menuBody.appendChild(
            adminItem
        );

        return true;
    }

    /* =====================================================
       CONFIGURED ITEM CREATION
    ===================================================== */

    function createConfiguredItem(item) {
        if (
            !item ||
            typeof item !==
                "object"
        ) {
            return null;
        }

        if (
            item.type ===
                "divider"
        ) {
            return createDivider();
        }

        if (
            item.type ===
                "version"
        ) {
            return createVersionItem(
                item
            );
        }

        if (
            item.type ===
                "action"
        ) {
            return createActionItem(
                item
            );
        }

        if (
            item.type !==
                "item"
        ) {
            return null;
        }

        return item.url
            ? createURLItem(
                item
            )
            : createInternalItem(
                item
            );
    }

    /* =====================================================
       RENDERING
    ===================================================== */

    function render() {
        if (
            !state.menuElement &&
            !resolveElements()
        ) {
            console.error(
                "[Menu] Side Menu element was not found."
            );

            return false;
        }

        const fragment =
            document
                .createDocumentFragment();

        fragment.appendChild(
            createMenuHeader()
        );

        const menuBody =
            document.createElement(
                "nav"
            );

        menuBody.className =
            "menu-body";

        menuBody.setAttribute(
            "aria-label",
            "Main menu"
        );

        getData()
            .forEach(
                item => {
                    const element =
                        createConfiguredItem(
                            item
                        );

                    if (
                        element
                    ) {
                        menuBody
                            .appendChild(
                                element
                            );
                    }
                }
            );

        if (
            isSoleAdminUser(
                resolveAuthenticatedUser()
            )
        ) {
            const adminItem =
                createAdminDashboardItem();

            if (
                adminItem
            ) {
                menuBody.appendChild(
                    adminItem
                );
            }
        }

        fragment.appendChild(
            menuBody
        );

        state.menuElement
            .replaceChildren(
                fragment
            );

        state.menuElement
            .setAttribute(
                "aria-hidden",
                String(
                    !isOpen()
                )
            );

        return true;
    }

    /* =====================================================
       ACTIVE MENU UPDATE
    ===================================================== */

    function updateActiveState() {
        if (
            !state.menuElement
        ) {
            return false;
        }

        state.menuElement
            .querySelectorAll(
                ".menu-item[data-page]"
            )
            .forEach(
                item => {
                    applyMenuItemState(
                        item,
                        normalizePage(
                            item.dataset
                                .page
                        )
                    );
                }
            );

        return true;
    }

    function setActive(page) {
        const normalizedPage =
            normalizePage(
                page
            );

        if (
            !normalizedPage
        ) {
            return false;
        }

        state.activePage =
            normalizedPage;

        updateActiveState();

        return true;
    }

    function resolveInitialPage() {
        if (
            window.Router &&
            typeof window.Router
                .getCurrentPage ===
                "function"
        ) {
            const currentPage =
                normalizePage(
                    window.Router
                        .getCurrentPage()
                );

            if (
                currentPage
            ) {
                return currentPage;
            }
        }

        return DEFAULT_PAGE;
    }

    /* =====================================================
       MENU VISIBILITY
    ===================================================== */

    function isOpen() {
        if (
            window.Shell &&
            typeof window.Shell
                .isMenuOpen ===
                "function"
        ) {
            return window.Shell
                .isMenuOpen();
        }

        return Boolean(
            state.menuElement
                ?.classList
                .contains(
                    "active"
                )
        );
    }

    function open() {
        if (
            window.Shell &&
            typeof window.Shell
                .openMenu ===
                "function"
        ) {
            return window.Shell
                .openMenu();
        }

        state.menuElement
            ?.classList
            .add(
                "active"
            );

        state.overlayElement
            ?.classList
            .add(
                "active"
            );

        state.menuElement
            ?.setAttribute(
                "aria-hidden",
                "false"
            );

        state.overlayElement
            ?.setAttribute(
                "aria-hidden",
                "false"
            );

        state.menuButton
            ?.setAttribute(
                "aria-expanded",
                "true"
            );

        return true;
    }

    function close() {
        if (
            window.Shell &&
            typeof window.Shell
                .closeMenu ===
                "function"
        ) {
            return window.Shell
                .closeMenu();
        }

        state.menuElement
            ?.classList
            .remove(
                "active"
            );

        state.overlayElement
            ?.classList
            .remove(
                "active"
            );

        state.menuElement
            ?.setAttribute(
                "aria-hidden",
                "true"
            );

        state.overlayElement
            ?.setAttribute(
                "aria-hidden",
                "true"
            );

        state.menuButton
            ?.setAttribute(
                "aria-expanded",
                "false"
            );

        return true;
    }

    /* =====================================================
       URL NAVIGATION
    ===================================================== */

    function openURLItem(item) {
        const resolvedURL =
            resolveURL(
                item.dataset.url
            );

        if (
            !resolvedURL
        ) {
            return false;
        }

        close();

        /*
         * Download item.
         */

        if (
            item.dataset.download ===
                "true"
        ) {
            const downloadLink =
                document.createElement(
                    "a"
                );

            downloadLink.href =
                resolvedURL.href;

            downloadLink.setAttribute(
                "download",
                ""
            );

            downloadLink.hidden =
                true;

            document.body
                .appendChild(
                    downloadLink
                );

            downloadLink.click();

            downloadLink.remove();

            return true;
        }

        /*
         * External URL, mail, phone or SMS.
         */

        if (
            item.dataset.external ===
                "true"
        ) {
            const openedWindow =
                window.open(
                    resolvedURL.href,
                    "_blank",
                    "noopener,noreferrer"
                );

            if (
                openedWindow
            ) {
                openedWindow.opener =
                    null;
            }

            return true;
        }

        /*
         * Same-origin HTML page.
         */

        window.location.assign(
            resolvedURL.href
        );

        return true;
    }

    /* =====================================================
       INTERNAL SPA NAVIGATION
    ===================================================== */

    function openInternalItem(item) {
        const page =
            normalizePage(
                item.dataset.page
            );

        if (
            !page
        ) {
            return false;
        }

        close();

        if (
            !window.Router ||
            typeof window.Router
                .navigate !==
                "function"
        ) {
            console.error(
                "[Menu] Main Router is unavailable."
            );

            return false;
        }

        window.Router.navigate(
            page
        );

        return true;
    }

    /* =====================================================
       MENU ACTIONS
    ===================================================== */

    async function handleInviteShare() {
        close();

        if (
            !window.Share ||
            typeof window.Share
                .shareInvite !==
                "function"
        ) {
            console.error(
                "[Menu] Share service is unavailable."
            );

            return false;
        }

        try {
            const result =
                await window.Share
                    .shareInvite();

            return Boolean(
                result?.success ||
                result?.cancelled
            );
        } catch (error) {
            console.error(
                "[Menu] Invite sharing failed.",
                error
            );

            return false;
        }
    }

    async function openActionItem(item) {
        const action =
            normalizeAction(
                item.dataset
                    .menuAction
            );

        if (
            !action
        ) {
            return false;
        }

        if (
            action ===
                INVITE_SHARE_ACTION
        ) {
            return handleInviteShare();
        }

        console.warn(
            `[Menu] Unsupported menu action: ${action}`
        );

        return false;
    }

    /* =====================================================
       MENU CLICK HANDLING
    ===================================================== */

    function handleMenuClick(event) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                    Element
            )
        ) {
            return;
        }

        const item =
            event.target.closest(
                ".menu-item"
            );

        if (
            !item ||
            !state.menuElement
                ?.contains(
                    item
                )
        ) {
            return;
        }

        event.preventDefault();

        if (
            item.getAttribute(
                "aria-disabled"
            ) ===
                "true"
        ) {
            return;
        }

        if (
            item.dataset.menuAction
        ) {
            void openActionItem(
                item
            );

            return;
        }

        if (
            item.dataset.menuUrl ===
                "true"
        ) {
            openURLItem(
                item
            );

            return;
        }

        openInternalItem(
            item
        );
    }

    /* =====================================================
       KEYBOARD ACCESS
    ===================================================== */

    function handleMenuKeydown(event) {
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

        const item =
            event.target.closest(
                ".menu-item"
            );

        if (
            !item ||
            !state.menuElement
                ?.contains(
                    item
                )
        ) {
            return;
        }

        event.preventDefault();

        item.click();
    }

    /* =====================================================
       ROUTER SYNCHRONIZATION
    ===================================================== */

    function handleRouteChanged(event) {
        const page =
            normalizePage(
                event
                    ?.detail
                    ?.page
            );

        if (
            !page
        ) {
            return;
        }

        setActive(
            page
        );
    }

    /* =====================================================
       AUTHENTICATION SYNCHRONIZATION
    ===================================================== */

    function handleAuthenticationChanged() {
        if (
            !state.initialized
        ) {
            return;
        }

        syncAdminDashboardItem();
    }

    /* =====================================================
       EVENT BINDING
    ===================================================== */

    function bind() {
        if (
            state.controller ||
            !state.menuElement
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

        state.menuElement
            .addEventListener(
                "click",
                handleMenuClick,
                {
                    signal
                }
            );

        state.menuElement
            .addEventListener(
                "keydown",
                handleMenuKeydown,
                {
                    signal
                }
            );

        window.addEventListener(
            ROUTE_CHANGED_EVENT,
            handleRouteChanged,
            {
                signal
            }
        );

        ADMIN_AUTH_EVENTS
            .forEach(
                eventName => {
                    window.addEventListener(
                        eventName,
                        handleAuthenticationChanged,
                        {
                            signal
                        }
                    );
                }
            );

        return true;
    }

    function unbind() {
        state.controller
            ?.abort();

        state.controller =
            null;

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            state.initialized
        ) {
            state.activePage =
                resolveInitialPage();

            render();

            updateActiveState();

            return true;
        }

        if (
            !resolveElements()
        ) {
            console.error(
                "[Menu] Unable to initialize because #sideMenu was not found."
            );

            return false;
        }

        state.activePage =
            resolveInitialPage();

        render();

        bind();

        state.initialized =
            true;

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        unbind();

        close();

        state.initialized =
            false;

        state.menuElement =
            null;

        state.overlayElement =
            null;

        state.menuButton =
            null;

        state.activePage =
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
        open,
        close,
        isOpen,
        setActive,

        getActivePage() {
            return state.activePage;
        },

        isInitialized() {
            return state.initialized;
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Menu =
    Menu;