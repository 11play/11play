"use strict";

/* =========================================================
   11PLAY — REFERRAL RULES MODULE
   File:
   js/account/referral/rules/referral.rules.module.js

   Responsibilities:
   - Initialize the Referral Rules page
   - Render and initialize Shared Account Sections
   - Synchronize the backend-issued referral link
   - Manage page loading and status messages
   - Clean up only this page's runtime

   Important:
   - Referral rules are display-only on this page
   - APK installation is not detected here
   - No Firebase write occurs here
   - No referral eligibility is calculated here
   - Main Router owns account-page navigation
========================================================= */

const ReferralRulesModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const PAGE_ID =
        "referralRulesPage";

    const CURRENT_PAGE =
        "referral-rules";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        sharedMount:
            null,

        sharedSectionsInitialized:
            false,

        pageObserver:
            null,

        pageStatusTimer:
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

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(value);

        return (
            prototype === Object.prototype ||
            prototype === null
        );
    }

    /* =====================================================
       PAGE RESOLUTION
    ===================================================== */

    function resolvePage(root) {
        if (
            root instanceof HTMLElement &&
            root.id === PAGE_ID
        ) {
            return root;
        }

        if (
            root instanceof HTMLElement
        ) {
            return (
                root.querySelector(
                    `#${PAGE_ID}`
                ) ||
                null
            );
        }

        if (
            typeof root === "string" &&
            root.trim()
        ) {
            const resolvedRoot =
                document.querySelector(
                    root.trim()
                );

            if (
                resolvedRoot?.id ===
                PAGE_ID
            ) {
                return resolvedRoot;
            }

            return (
                resolvedRoot
                    ?.querySelector(
                        `#${PAGE_ID}`
                    ) ||
                null
            );
        }

        return document.getElementById(
            PAGE_ID
        );
    }

    function getSharedMount() {
        return (
            state.page
                ?.querySelector(
                    "#accountSectionsMount"
                ) ||
            null
        );
    }

    function getPageStatusElement() {
        return (
            state.page
                ?.querySelector(
                    "#referralRulesPageStatus"
                ) ||
            null
        );
    }

    /* =====================================================
       PAGE STATUS
    ===================================================== */

    function clearPageStatusTimer() {
        if (!state.pageStatusTimer) {
            return false;
        }

        window.clearTimeout(
            state.pageStatusTimer
        );

        state.pageStatusTimer =
            null;

        return true;
    }

    function hidePageStatus() {
        clearPageStatusTimer();

        const status =
            getPageStatusElement();

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

    function showPageStatus(
        message,
        type = "info",
        duration = 0
    ) {
        const status =
            getPageStatusElement();

        if (!status) {
            return false;
        }

        clearPageStatusTimer();

        const normalizedMessage =
            normalizeString(message);

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
            !normalizedMessage;

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
            normalizedMessage &&
            Number(duration) > 0
        ) {
            state.pageStatusTimer =
                window.setTimeout(
                    hidePageStatus,
                    Number(duration)
                );
        }

        return true;
    }

    /* =====================================================
       PAGE LOADING
    ===================================================== */

    function setPageLoading(
        isLoading
    ) {
        if (!state.page) {
            return false;
        }

        const loading =
            Boolean(isLoading);

        state.page.classList.toggle(
            "is-loading",
            loading
        );

        state.page.setAttribute(
            "aria-busy",
            String(loading)
        );

        return true;
    }

    /* =====================================================
       REFERRAL IDENTITY
    ===================================================== */

    function getReferralIdentity() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .getReferralIdentity ===
                "function"
        ) {
            try {
                return (
                    window.ReferralDB
                        .getReferralIdentity() ||
                    {}
                );
            } catch {
                /*
                 * Continue to ProfileDB.
                 */
            }
        }

        if (
            window.ProfileDB &&
            typeof window.ProfileDB
                .getProfile ===
                "function"
        ) {
            try {
                const profile =
                    window.ProfileDB
                        .getProfile();

                return {
                    referralCode:
                        normalizeString(
                            profile
                                ?.referralCode
                        ),

                    referralLink:
                        normalizeString(
                            profile
                                ?.referralLink
                        )
                };
            } catch {
                return {};
            }
        }

        return {};
    }

    /* =====================================================
       SHARED ACCOUNT SECTIONS
    ===================================================== */

    function renderSharedSections() {
        if (
            !window.AccountSectionsView ||
            typeof window.AccountSectionsView
                .render !== "function"
        ) {
            console.error(
                "[ReferralRulesModule] AccountSectionsView is unavailable."
            );

            return false;
        }

        const mount =
            getSharedMount();

        if (!mount) {
            console.error(
                "[ReferralRulesModule] Account Sections mount was not found."
            );

            return false;
        }

        state.sharedMount =
            mount;

        const identity =
            getReferralIdentity();

        return (
            window.AccountSectionsView
                .render(
                    mount,
                    {
                        currentPage:
                            CURRENT_PAGE,

                        referralLink:
                            normalizeString(
                                identity
                                    .referralLink
                            )
                    }
                ) !== false
        );
    }

    function initializeSharedSections() {
        if (
            !window.AccountSectionsModule ||
            typeof window.AccountSectionsModule
                .init !== "function"
        ) {
            console.error(
                "[ReferralRulesModule] AccountSectionsModule is unavailable."
            );

            return false;
        }

        if (!renderSharedSections()) {
            return false;
        }

        const identity =
            getReferralIdentity();

        const initialized =
            window.AccountSectionsModule
                .init({
                    root:
                        state.sharedMount,

                    currentPage:
                        CURRENT_PAGE,

                    referralLink:
                        normalizeString(
                            identity
                                .referralLink
                        )
                });

        state.sharedSectionsInitialized =
            initialized !== false;

        return state
            .sharedSectionsInitialized;
    }

    function destroySharedSections() {
        if (
            !state.sharedSectionsInitialized
        ) {
            return true;
        }

        const sharedModule =
            window.AccountSectionsModule;

        if (
            sharedModule &&
            typeof sharedModule
                .destroy === "function"
        ) {
            const currentPage =
                typeof sharedModule
                    .getCurrentPage ===
                    "function"
                    ? sharedModule
                        .getCurrentPage()
                    : CURRENT_PAGE;

            /*
             * An old page instance must not destroy
             * shared sections initialized by another page.
             */

            if (
                currentPage ===
                CURRENT_PAGE
            ) {
                sharedModule.destroy();
            }
        }

        state.sharedSectionsInitialized =
            false;

        state.sharedMount =
            null;

        return true;
    }

    /* =====================================================
       SHARED REFERRAL-LINK API
    ===================================================== */

    function setReferralLink(link) {
        const normalizedLink =
            normalizeString(link);

        if (
            !normalizedLink ||
            !window.AccountSectionsModule ||
            typeof window.AccountSectionsModule
                .setReferralLink !==
                "function"
        ) {
            return false;
        }

        return window.AccountSectionsModule
            .setReferralLink(
                normalizedLink,
                {
                    resolveIdentity:
                        false
                }
            );
    }

    function getReferralLink() {
        if (
            !window.AccountSectionsModule ||
            typeof window.AccountSectionsModule
                .getReferralLink !==
                "function"
        ) {
            return "";
        }

        return normalizeString(
            window.AccountSectionsModule
                .getReferralLink()
        );
    }

    function refreshReferralLink() {
        if (
            !window.AccountSectionsModule
        ) {
            return false;
        }

        if (
            typeof window.AccountSectionsModule
                .synchronizeReferralLink ===
                "function"
        ) {
            return window.AccountSectionsModule
                .synchronizeReferralLink();
        }

        const identity =
            getReferralIdentity();

        return setReferralLink(
            identity.referralLink
        );
    }

    /* =====================================================
       SHARED LIVE REWARD API
    ===================================================== */

    function maskAccountNumber(
        accountNumber
    ) {
        if (
            window.AccountSectionsModule &&
            typeof window.AccountSectionsModule
                .maskAccountNumber ===
                "function"
        ) {
            return window.AccountSectionsModule
                .maskAccountNumber(
                    accountNumber
                );
        }

        const digits =
            normalizeString(
                accountNumber
            )
                .replace(
                    /\D/g,
                    ""
                )
                .slice(
                    0,
                    11
                );

        if (
            digits.length !==
            11
        ) {
            return "*******0000";
        }

        return (
            "*******" +
            digits.slice(-4)
        );
    }

    function refreshLiveRewards() {
        if (
            !window.AccountSectionsModule ||
            typeof window.AccountSectionsModule
                .refreshLiveRewards !==
                "function"
        ) {
            return false;
        }

        return window.AccountSectionsModule
            .refreshLiveRewards();
    }

    /* =====================================================
       PAGE REMOVAL OBSERVER
    ===================================================== */

    function observePageRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined"
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

        state.pageObserver.observe(
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

    function normalizeInitOptions(
        options
    ) {
        if (
            options instanceof HTMLElement ||
            typeof options === "string"
        ) {
            return {
                root:
                    options
            };
        }

        return isPlainObject(options)
            ? options
            : {};
    }

    function init(options = {}) {
        destroy();

        const normalizedOptions =
            normalizeInitOptions(
                options
            );

        const page =
            resolvePage(
                normalizedOptions.root
            );

        if (!page) {
            console.error(
                "[ReferralRulesModule] ReferralRulesView must be rendered before initialization."
            );

            return false;
        }

        state.lifecycleGeneration +=
            1;

        state.page =
            page;

        state.initialized =
            true;

        setPageLoading(true);
        hidePageStatus();

        try {
            if (
                !initializeSharedSections()
            ) {
                throw new Error(
                    "Shared Account Sections initialization failed."
                );
            }

            observePageRemoval();

            /*
             * Re-resolve the backend-issued referral link
             * after all shared modules are initialized.
             */

            refreshReferralLink();

            return true;
        } catch (error) {
            console.error(
                "[ReferralRulesModule] Initialization failed.",
                error
            );

            showPageStatus(
                "The Referral Rules page could not be loaded.",
                "error"
            );

            destroySharedSections();

            return false;
        } finally {
            setPageLoading(false);
        }
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        clearPageStatusTimer();

        if (state.pageObserver) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        destroySharedSections();

        state.initialized =
            false;

        state.page =
            null;

        state.sharedMount =
            null;

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
        initialize:
            init,

        destroy,
        isInitialized,

        setPageLoading,
        showPageStatus,
        hidePageStatus,

        setReferralLink,
        getReferralLink,
        refreshReferralLink,

        maskAccountNumber,
        refreshLiveRewards
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ReferralRulesModule =
    ReferralRulesModule;
