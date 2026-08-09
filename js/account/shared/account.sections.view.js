/* =========================================================
   11PLAY — SHARED ACCOUNT SECTIONS VIEW
   File: js/account/shared/account.sections.view.js

   Shared by:
   - Profile
   - Referral Statistics
   - Reward Center
   - Withdraw History
   - Referral Rules

   Contains:
   - Invite Friends
   - Live Reward Withdrawal
   - Account Services

   Referral display:
   - Guest users see the canonical 11Play main-site URL
   - Guest sharing has no referral owner or reward attribution
   - Verified Google users see their own unique referral link
   - The referral link may initially remain in loading state

   Important:
   - This file contains markup only
   - It does not copy referral links
   - It does not generate reward records
   - It does not start timers
   - It does not navigate directly
   - The Main Router remains responsible for navigation
========================================================= */

const AccountSectionsView = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const SUPPORTED_PAGES =
        Object.freeze([
            "profile",
            "referral-statistics",
            "reward-center",
            "withdraw-history",
            "referral-rules"
        ]);

    /*
     * Temporary compatibility aliases.
     * All rendered data-account-page values remain canonical.
     */

    const PAGE_ALIASES =
        Object.freeze({
            referral:
                "referral-statistics",

            reward:
                "reward-center",

            withdrawal:
                "withdraw-history",

            withdraw:
                "withdraw-history",

            rules:
                "referral-rules"
        });

    const CANONICAL_REFERRAL_BASE_URL =
        "https://11play.github.io/11play/";

    const REFERRAL_QUERY_PARAMETER =
        "ref";

    const REFERRAL_SOURCES =
        Object.freeze([
            "",
            "guest",
            "user"
        ]);

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

    function escapeHTML(value) {
        return normalizeString(value)
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
                "&#39;"
            );
    }

    function escapeAttribute(value) {
        return escapeHTML(value);
    }

    /* =====================================================
       PAGE NORMALIZATION
    ===================================================== */

    function normalizePage(page) {
        const normalizedPage =
            normalizeString(page)
                .toLowerCase()
                .replace(
                    /[\s_]+/g,
                    "-"
                );

        const canonicalPage =
            PAGE_ALIASES[
                normalizedPage
            ] ||
            normalizedPage;

        return SUPPORTED_PAGES.includes(
            canonicalPage
        )
            ? canonicalPage
            : "profile";
    }

    function isCurrentPage(
        currentPage,
        targetPage
    ) {
        return (
            normalizePage(
                currentPage
            ) ===
            normalizePage(
                targetPage
            )
        );
    }

    /* =====================================================
       REFERRAL NORMALIZATION
    ===================================================== */

    function normalizeReferralCode(value) {
        const referralCode =
            normalizeString(value)
                .toUpperCase()
                .replace(
                    /[^A-HJ-NP-Z2-9]/g,
                    ""
                );

        return /^[A-HJ-NP-Z2-9]{8}$/
            .test(
                referralCode
            )
                ? referralCode
                : "";
    }

    function normalizeReferralLink(value) {
        const referralLink =
            normalizeString(value);

        if (!referralLink) {
            return "";
        }

        try {
            const parsedURL =
                new URL(
                    referralLink,
                    CANONICAL_REFERRAL_BASE_URL
                );

            const canonicalURL =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            if (
                parsedURL.protocol !==
                    "https:" ||
                parsedURL.origin !==
                    canonicalURL.origin ||
                parsedURL.pathname !==
                    canonicalURL.pathname
            ) {
                return "";
            }

            const referralCode =
                normalizeReferralCode(
                    parsedURL.searchParams
                        .get(
                            REFERRAL_QUERY_PARAMETER
                        )
                );

            parsedURL.hash =
                "";

            parsedURL.search =
                "";

            if (referralCode) {
                parsedURL.searchParams
                    .set(
                        REFERRAL_QUERY_PARAMETER,
                        referralCode
                    );
            }

            return parsedURL.toString();
        } catch {
            return "";
        }
    }

    function normalizeReferralSource(value) {
        const source =
            normalizeString(value)
                .toLowerCase();

        return REFERRAL_SOURCES.includes(
            source
        )
            ? source
            : "";
    }

    function getReferralMessage(
        referralSource
    ) {
        switch (
            normalizeReferralSource(
                referralSource
            )
        ) {
            case "guest":
                return `
                    🎁 Share 11Play with your friends.
                    Sign in with Google to get your own
                    unique referral link and referral rewards.
                `;

            case "user":
                return `
                    🎁 Your unique referral link.
                    Share it and earn up to
                    <strong>1000 Cash Reward.</strong>
                `;

            default:
                return `
                    🎁 Your referral link is loading.
                    Please wait while the secure referral
                    information is prepared.
                `;
        }
    }

    function getReferralInputLabel(
        referralSource
    ) {
        const normalizedSource =
            normalizeReferralSource(
                referralSource
            );

        if (
            normalizedSource ===
                "guest"
        ) {
            return "11Play main site link";
        }

        if (
            normalizedSource ===
                "user"
        ) {
            return "Your referral link";
        }

        return "Referral link";
    }

    /* =====================================================
       ACCOUNT SERVICE BUTTON
    ===================================================== */

    function getButtonAttributes(
        currentPage,
        targetPage
    ) {
        if (
            !isCurrentPage(
                currentPage,
                targetPage
            )
        ) {
            return [
                'class="account-navigation-item"',
                'aria-disabled="false"'
            ].join(" ");
        }

        return [
            'class="account-navigation-item is-current"',
            'aria-current="page"',
            'aria-disabled="true"',
            "disabled"
        ].join(" ");
    }

    function createAccountServiceItem({
        id,
        page,
        icon,
        title,
        description,
        currentPage
    }) {
        const canonicalPage =
            normalizePage(page);

        const current =
            isCurrentPage(
                currentPage,
                canonicalPage
            );

        return `
            <button
                id="${escapeAttribute(id)}"
                ${getButtonAttributes(
                    currentPage,
                    canonicalPage
                )}
                type="button"
                data-account-page="${escapeAttribute(
                    canonicalPage
                )}"
            >
                <span
                    class="account-navigation-icon"
                    aria-hidden="true"
                >
                    ${escapeHTML(icon)}
                </span>

                <span class="account-navigation-content">
                    <strong>
                        ${escapeHTML(title)}
                    </strong>

                    <small>
                        ${escapeHTML(description)}
                    </small>
                </span>

                <span
                    class="account-navigation-arrow"
                    aria-hidden="true"
                >
                    ›
                </span>

                <span
                    class="account-navigation-state"
                    ${
                        current
                            ? 'aria-label="Current page"'
                            : 'aria-hidden="true"'
                    }
                >
                    ${
                        current
                            ? "Current"
                            : ""
                    }
                </span>
            </button>
        `;
    }

    /* =====================================================
       INVITE FRIENDS TEMPLATE
    ===================================================== */

    function getReferralTemplate(
        referralLink,
        referralSource = ""
    ) {
        const normalizedReferralSource =
            normalizeReferralSource(
                referralSource
            );

        let normalizedReferralLink =
            normalizeReferralLink(
                referralLink
            );

        if (
            normalizedReferralSource ===
                "guest"
        ) {
            normalizedReferralLink =
                CANONICAL_REFERRAL_BASE_URL;
        }

        const hasReferralLink =
            Boolean(
                normalizedReferralLink
            );

        const referralMessage =
            getReferralMessage(
                normalizedReferralSource
            );

        const referralInputLabel =
            getReferralInputLabel(
                normalizedReferralSource
            );

        return `
            <section
                id="profileReferralCard"
                class="profile-card profile-referral-card"
                aria-labelledby="profileReferralTitle"
                data-referral-link-ready="${
                    hasReferralLink
                        ? "true"
                        : "false"
                }"
                data-referral-source="${escapeAttribute(
                    normalizedReferralSource
                )}"
            >
                <h2
                    id="profileReferralTitle"
                    class="profile-card-title"
                >
                    বন্ধু আমন্ত্রণ :
                </h2>

                <p
                    id="profileReferralMessage"
                    class="profile-referral-message"
                >
                    ${referralMessage}
                </p>

                <div class="profile-referral-link-box">
                    <label
                        class="sr-only"
                        for="referralLink"
                    >
                        ${escapeHTML(
                            referralInputLabel
                        )}
                    </label>

                    <input
                        id="referralLink"
                        class="profile-referral-link-input"
                        type="text"
                        value="${escapeAttribute(
                            normalizedReferralLink
                        )}"
                        placeholder="Referral link is loading..."
                        readonly
                        spellcheck="false"
                        autocomplete="off"
                        aria-describedby="referralLinkStatus"
                        aria-label="${escapeAttribute(
                            referralInputLabel
                        )}"
                    >

                    <button
                        id="copyReferralBtn"
                        class="profile-referral-copy-button"
                        type="button"
                        aria-label="Copy referral link"
                        aria-disabled="${
                            hasReferralLink
                                ? "false"
                                : "true"
                        }"
                        ${
                            hasReferralLink
                                ? ""
                                : "disabled"
                        }
                    >
                        <span
                            class="profile-referral-copy-icon"
                            aria-hidden="true"
                        >
                            📋
                        </span>

                        <span>
                            Copy
                        </span>
                    </button>
                </div>

                <p
                    id="referralLinkStatus"
                    class="profile-referral-status"
                    role="status"
                    aria-live="polite"
                ></p>
            </section>
        `;
    }

    /* =====================================================
       LIVE REWARD TEMPLATE
    ===================================================== */

    function getLiveRewardTemplate() {
        return `
            <section
                id="liveRewardWithdrawalCard"
                class="profile-card live-reward-card"
                aria-labelledby="liveRewardTitle"
            >
                <div class="live-reward-heading">
                    <div>
                        <h2
                            id="liveRewardTitle"
                            class="profile-card-title"
                        >
                            Live Reward Withdrawal
                        </h2>

                        <p class="live-reward-description">
                            Recent reward withdrawals
                        </p>
                    </div>

                    <span class="live-reward-status">
                        <span
                            class="live-reward-status-dot"
                            aria-hidden="true"
                        ></span>

                        Live
                    </span>
                </div>

                <div
                    class="live-reward-column-heading"
                    aria-hidden="true"
                >
                    <span>
                        ACCOUNTS
                    </span>

                    <span>
                        Status
                    </span>

                    <span>
                        Reward
                    </span>
                </div>

                <div
                    id="liveRewardViewport"
                    class="live-reward-viewport"
                    tabindex="0"
                    aria-label="Recent reward withdrawals"
                >
                    <div
                        id="liveRewardList"
                        class="live-reward-list"
                        role="feed"
                        aria-live="off"
                        aria-busy="true"
                    >
                        <div class="live-reward-loading">
                            <span
                                class="profile-loading-spinner"
                                aria-hidden="true"
                            ></span>

                            <span>
                                Loading withdrawals...
                            </span>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    /* =====================================================
       ACCOUNT SERVICES TEMPLATE
    ===================================================== */

    function getAccountServicesTemplate(
        currentPage
    ) {
        return `
            <section
                id="accountServicesCard"
                class="profile-card account-services-card"
                aria-labelledby="accountServicesTitle"
            >
                <h2
                    id="accountServicesTitle"
                    class="account-services-title"
                >
                    Account Services
                </h2>

                <nav
                    class="account-navigation-grid"
                    aria-label="Account services"
                >
                    ${createAccountServiceItem({
                        id:
                            "referralStatisticsBtn",

                        page:
                            "referral-statistics",

                        icon:
                            "📊",

                        title:
                            "Referral Statistics",

                        description:
                            "View invitations and successful referrals",

                        currentPage
                    })}

                    ${createAccountServiceItem({
                        id:
                            "rewardCenterBtn",

                        page:
                            "reward-center",

                        icon:
                            "🎁",

                        title:
                            "Reward Center",

                        description:
                            "View balance and earned rewards",

                        currentPage
                    })}

                    ${createAccountServiceItem({
                        id:
                            "withdrawHistoryBtn",

                        page:
                            "withdraw-history",

                        icon:
                            "📜",

                        title:
                            "Withdraw History",

                        description:
                            "Check completed and pending requests",

                        currentPage
                    })}

                    ${createAccountServiceItem({
                        id:
                            "referralRulesBtn",

                        page:
                            "referral-rules",

                        icon:
                            "📖",

                        title:
                            "Referral Rules",

                        description:
                            "Read eligibility and reward conditions",

                        currentPage
                    })}
                </nav>
            </section>
        `;
    }

    /* =====================================================
       COMPLETE TEMPLATE
    ===================================================== */

    function getTemplate(options = {}) {
        const currentPage =
            normalizePage(
                options.currentPage
            );

        const referralSource =
            normalizeReferralSource(
                options.referralSource ||
                options.source
            );

        let referralLink =
            normalizeReferralLink(
                options.referralLink
            );

        if (
            referralSource ===
                "guest"
        ) {
            referralLink =
                CANONICAL_REFERRAL_BASE_URL;
        }

        return `
            <div
                id="accountSections"
                class="account-sections"
                data-current-account-page="${escapeAttribute(
                    currentPage
                )}"
                data-referral-source="${escapeAttribute(
                    referralSource
                )}"
            >
                ${getReferralTemplate(
                    referralLink,
                    referralSource
                )}

                ${getLiveRewardTemplate()}

                ${getAccountServicesTemplate(
                    currentPage
                )}
            </div>
        `;
    }

    /* =====================================================
       RENDER
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
            return document
                .querySelector(
                    root.trim()
                );
        }

        return null;
    }

    function render(
        root,
        options = {}
    ) {
        const targetRoot =
            resolveRoot(root);

        if (
            !(targetRoot instanceof
                HTMLElement)
        ) {
            console.error(
                "[AccountSectionsView] A valid root element is required."
            );

            return false;
        }

        targetRoot.innerHTML =
            getTemplate(options);

        return (
            targetRoot.querySelector(
                "#accountSections"
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

        normalizePage,
        normalizeReferralLink,
        normalizeReferralSource,

        getSupportedPages() {
            return [
                ...SUPPORTED_PAGES
            ];
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.AccountSectionsView =
    AccountSectionsView;