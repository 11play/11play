"use strict";

/* =========================================================
   11PLAY — REFERRAL STATISTICS MODULE
   File:
   js/account/referral/statistics/referral.statistics.module.js

   Responsibilities:
   - Initialize the Referral Statistics page
   - Read server-authoritative data from ReferralDB
   - Render canonical referral statistics
   - Render masked referral records
   - Display reward only after a referral is rewarded
   - Render guest, loading, empty and error states
   - Provide cursor-based Load More integration
   - Initialize Shared Account Sections
   - Prevent stale cross-account data
   - Clean up page-specific listeners and subscriptions

   Canonical referral statuses:
   - pending
   - qualified
   - approved
   - rejected
   - rewarded

   Important:
   - No referral is created or updated here
   - No reward is calculated or credited here
   - No direct Firestore access occurs here
   - Main Router remains responsible for navigation
========================================================= */

const ReferralStatisticsModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const PAGE_ID =
        "referralStatisticsPage";

    const CURRENT_PAGE =
        "referral-statistics";

    const DEFAULT_REWARD_AMOUNT =
        1000;

    const REFERRAL_STATUSES =
        Object.freeze({
            PENDING:
                "pending",

            QUALIFIED:
                "qualified",

            APPROVED:
                "approved",

            REJECTED:
                "rejected",

            REWARDED:
                "rewarded"
        });

    const STATUS_ORDER =
        Object.freeze([
            REFERRAL_STATUSES.PENDING,
            REFERRAL_STATUSES.QUALIFIED,
            REFERRAL_STATUSES.APPROVED,
            REFERRAL_STATUSES.REJECTED,
            REFERRAL_STATUSES.REWARDED
        ]);

    const AUTH_EVENTS =
        Object.freeze([
            "auth:state-changed",
            "profile:auth-changed",
            "auth:signed-in",
            "auth:signed-out",
            "profile:logout"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        elements:
            {},

        currentUid:
            "",

        referrals:
            [],

        stats:
            createEmptyStats(),

        loading:
            false,

        loadingMore:
            false,

        hasMore:
            false,

        nextCursor:
            "",

        error:
            null,

        lastUpdatedAt:
            null,

        referralUnsubscribe:
            null,

        listeners:
            [],

        pageObserver:
            null,

        sharedSectionsInitialized:
            false,

        refreshPromise:
            null,

        loadMorePromise:
            null,

        lifecycleGeneration:
            0
    };

    let refreshOperationSequence =
        0;

    let loadMoreOperationSequence =
        0;

    let refreshOperationUid =
        "";

    let loadMoreOperationUid =
        "";

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

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
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
        );
    }

    function toSafeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        const number =
            Math.floor(
                toSafeNumber(
                    value,
                    fallback
                )
            );

        if (
            !Number.isSafeInteger(number) ||
            number < 0
        ) {
            return Math.max(
                0,
                Math.floor(
                    toSafeNumber(
                        fallback,
                        0
                    )
                )
            );
        }

        return number;
    }

    function safeAdd(
        firstValue,
        secondValue
    ) {
        const result =
            toNonNegativeInteger(
                firstValue
            ) +
            toNonNegativeInteger(
                secondValue
            );

        return Number.isSafeInteger(result)
            ? result
            : Number.MAX_SAFE_INTEGER;
    }

    function cloneValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        try {
            return JSON.parse(
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    function serializeTimestamp(value) {
        if (!value) {
            return null;
        }

        if (
            typeof value.toDate ===
            "function"
        ) {
            try {
                return value
                    .toDate()
                    .toISOString();
            } catch {
                return null;
            }
        }

        if (
            typeof value.toMillis ===
            "function"
        ) {
            try {
                return new Date(
                    value.toMillis()
                ).toISOString();
            } catch {
                return null;
            }
        }

        if (
            isPlainObject(value) &&
            typeof value.seconds ===
                "number"
        ) {
            try {
                return new Date(
                    value.seconds * 1000
                ).toISOString();
            } catch {
                return null;
            }
        }

        const parsedDate =
            new Date(value);

        return Number.isNaN(
            parsedDate.getTime()
        )
            ? null
            : parsedDate.toISOString();
    }

    function normalizeError(error) {
        const details =
            isPlainObject(
                error?.details
            )
                ? error.details
                : null;

        return {
            code:
                toSafeString(
                    error?.code
                ).replace(
                    /^functions\//,
                    ""
                ) ||
                "referral-statistics-error",

            message:
                toSafeString(
                    error?.message ||
                    details?.message,
                    "Unable to load referral statistics."
                ),

            field:
                toSafeString(
                    details?.field
                ),

            details
        };
    }

    function formatNumber(value) {
        return new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(
            toNonNegativeInteger(value)
        );
    }

    function formatMoney(value) {
        return `৳${formatNumber(value)}`;
    }

    function formatDate(value) {
        const timestamp =
            serializeTimestamp(value);

        if (!timestamp) {
            return "";
        }

        try {
            return new Intl.DateTimeFormat(
                "en-BD",
                {
                    day:
                        "2-digit",

                    month:
                        "short",

                    year:
                        "numeric"
                }
            ).format(
                new Date(timestamp)
            );
        } catch {
            return "";
        }
    }

    /* =====================================================
       PAGE RESOLUTION
    ===================================================== */

    function resolvePage(target) {
        if (
            target instanceof HTMLElement &&
            target.id === PAGE_ID
        ) {
            return target;
        }

        if (
            target instanceof HTMLElement
        ) {
            return target.querySelector(
                `#${PAGE_ID}`
            );
        }

        if (
            typeof target === "string" &&
            target.trim()
        ) {
            const matchedElement =
                document.querySelector(
                    target.trim()
                );

            if (
                matchedElement?.id ===
                PAGE_ID
            ) {
                return matchedElement;
            }

            return matchedElement
                ?.querySelector(
                    `#${PAGE_ID}`
                ) ||
                null;
        }

        return document.getElementById(
            PAGE_ID
        );
    }

    function collectElements() {
        if (!state.page) {
            return false;
        }

        state.elements = {
            summaryGrid:
                state.page.querySelector(
                    "#referralSummaryGrid"
                ),

            totalCount:
                state.page.querySelector(
                    "#referralTotalCount"
                ),

            pendingCount:
                state.page.querySelector(
                    "#referralPendingCount"
                ),

            qualifiedCount:
                state.page.querySelector(
                    "#referralQualifiedCount"
                ),

            rewardedCount:
                state.page.querySelector(
                    "#referralRewardedCount"
                ),

            rejectedCount:
                state.page.querySelector(
                    "#referralRejectedCount"
                ),

            totalReward:
                state.page.querySelector(
                    "#referralTotalReward"
                ),

            listCount:
                state.page.querySelector(
                    "#referralListCount"
                ),

            refreshState:
                state.page.querySelector(
                    "#referralStatisticsRefreshState"
                ),

            loadingState:
                state.page.querySelector(
                    "#referralStatisticsLoadingState"
                ),

            tableRegion:
                state.page.querySelector(
                    "#referralStatisticsTableRegion"
                ),

            tableBody:
                state.page.querySelector(
                    "#referralStatisticsTableBody"
                ),

            pagination:
                state.page.querySelector(
                    "#referralStatisticsPagination"
                ),

            loadMoreButton:
                state.page.querySelector(
                    "#referralStatisticsLoadMoreButton"
                ),

            loadMoreState:
                state.page.querySelector(
                    "#referralStatisticsLoadMoreState"
                ),

            emptyState:
                state.page.querySelector(
                    "#referralStatisticsEmptyState"
                ),

            guestState:
                state.page.querySelector(
                    "#referralStatisticsGuestState"
                ),

            pageStatus:
                state.page.querySelector(
                    "#referralStatisticsPageStatus"
                ),

            accountSectionsMount:
                state.page.querySelector(
                    "#accountSectionsMount"
                )
        };

        return true;
    }

    /* =====================================================
       MANAGED LISTENERS
    ===================================================== */

    function addManagedListener(
        element,
        eventName,
        handler,
        options
    ) {
        if (
            !element ||
            typeof element
                .addEventListener !==
                "function"
        ) {
            return false;
        }

        element.addEventListener(
            eventName,
            handler,
            options
        );

        state.listeners.push({
            element,
            eventName,
            handler,
            options
        });

        return true;
    }

    function removeManagedListeners() {
        state.listeners.forEach(
            ({
                element,
                eventName,
                handler,
                options
            }) => {
                try {
                    element.removeEventListener(
                        eventName,
                        handler,
                        options
                    );
                } catch {
                    /*
                     * No further cleanup is required.
                     */
                }
            }
        );

        state.listeners =
            [];
    }

    /* =====================================================
       AUTH USER
    ===================================================== */

    function resolveCurrentUser() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService
                .getCurrentUser ===
                "function"
        ) {
            try {
                const user =
                    authService
                        .getCurrentUser();

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue to Firebase Auth.
                 */
            }
        }

        if (
            authService &&
            typeof authService
                .getFirebaseUser ===
                "function"
        ) {
            try {
                const user =
                    authService
                        .getFirebaseUser();

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue to configured Firebase Auth.
                 */
            }
        }

        return (
            window.FirebaseConfig
                ?.auth
                ?.currentUser ||
            window.firebaseAuth
                ?.currentUser ||
            null
        );
    }

    function extractEventUser(event) {
        if (
            event?.type ===
                "auth:signed-out" ||
            event?.type ===
                "profile:logout"
        ) {
            return null;
        }

        return (
            event?.detail?.user ||
            event?.detail?.profile ||
            (
                event?.detail?.uid
                    ? event.detail
                    : null
            ) ||
            resolveCurrentUser()
        );
    }

    /* =====================================================
       STATUS NORMALIZATION
    ===================================================== */

    function normalizeStatus(value) {
        const status =
            toSafeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "pending":
            case "observing":
            case "observation":
            case "processing":
                return REFERRAL_STATUSES
                    .PENDING;

            case "qualified":
            case "pending_review":
            case "pendingreview":
            case "review":
            case "reviewing":
                return REFERRAL_STATUSES
                    .QUALIFIED;

            case "approved":
                return REFERRAL_STATUSES
                    .APPROVED;

            case "rejected":
            case "invalid":
            case "failed":
                return REFERRAL_STATUSES
                    .REJECTED;

            case "rewarded":
            case "valid":
            case "completed":
            case "successful":
            case "success":
                return REFERRAL_STATUSES
                    .REWARDED;

            default:
                return REFERRAL_STATUSES
                    .PENDING;
        }
    }

    function getStatusConfiguration(
        status
    ) {
        const normalizedStatus =
            normalizeStatus(status);

        const configurations = {
            pending: {
                label:
                    "Pending",

                indicator:
                    "🟠",

                className:
                    "is-pending"
            },

            qualified: {
                label:
                    "Qualified",

                indicator:
                    "🔵",

                className:
                    "is-qualified"
            },

            approved: {
                label:
                    "Approved",

                indicator:
                    "🟣",

                className:
                    "is-approved"
            },

            rejected: {
                label:
                    "Rejected",

                indicator:
                    "🔴",

                className:
                    "is-rejected"
            },

            rewarded: {
                label:
                    "Rewarded",

                indicator:
                    "🟢",

                className:
                    "is-rewarded"
            }
        };

        return configurations[
            normalizedStatus
        ];
    }

    /* =====================================================
       USERNAME MASKING
    ===================================================== */

    function maskUsername(value) {
        const originalValue =
            toSafeString(value);

        if (!originalValue) {
            return "*****0000";
        }

        /*
         * Server-provided masked identities must remain masked
         * exactly as received. Re-masking them can expose or
         * distort the intended privacy-safe representation.
         */
        if (originalValue.includes("*")) {
            return originalValue;
        }

        const localPart =
            originalValue.includes("@")
                ? originalValue
                    .split("@")[0]
                : originalValue;

        const cleanedValue =
            localPart
                .replace(
                    /\s+/g,
                    ""
                )
                .replace(
                    /^@+/,
                    ""
                );

        const visiblePart =
            cleanedValue
                .slice(-4)
                .padStart(
                    4,
                    "0"
                );

        return `*****${visiblePart}`;
    }

    /* =====================================================
       REFERRAL NORMALIZATION
    ===================================================== */

    function resolveReferralIdentity(
        source,
        index
    ) {
        const referredProfile =
            isPlainObject(
                source.referredProfile
            )
                ? source.referredProfile
                : isPlainObject(
                    source.referredUser
                )
                    ? source.referredUser
                    : isPlainObject(
                        source.user
                    )
                        ? source.user
                        : {};

        return (
            source.maskedUsername ||
            source.referredUsername ||
            source.username ||
            source.userName ||
            referredProfile.maskedUsername ||
            referredProfile.username ||
            source.referredDisplayName ||
            source.displayName ||
            referredProfile.maskedDisplayName ||
            referredProfile.maskedName ||
            referredProfile.displayName ||
            referredProfile.name ||
            source.referredEmail ||
            source.email ||
            referredProfile.maskedEmail ||
            referredProfile.email ||
            source.referredUid ||
            source.userId ||
            source.uid ||
            `referral-${index + 1}`
        );
    }

    function normalizeReferral(
        referral,
        index = 0
    ) {
        const source =
            isPlainObject(referral)
                ? referral
                : {};

        let status =
            normalizeStatus(
                source.canonicalStatus ||
                source.userVisibleStatus ||
                source.status ||
                source.referralStatus ||
                source.state
            );

        const rewardGranted =
            source.rewardGranted ===
                true ||
            source.rewardCredited ===
                true;

        if (
            rewardGranted &&
            status !==
                REFERRAL_STATUSES.REJECTED
        ) {
            status =
                REFERRAL_STATUSES.REWARDED;
        }

        const rewarded =
            status ===
            REFERRAL_STATUSES.REWARDED;

        const rewardAmount =
            rewarded
                ? toNonNegativeInteger(
                    source.rewardAmount ??
                    source.reward ??
                    source.amount,
                    DEFAULT_REWARD_AMOUNT
                ) ||
                  DEFAULT_REWARD_AMOUNT
                : 0;

        const createdAt =
            serializeTimestamp(
                source.createdAt
            );

        const referredUid =
            toSafeString(
                source.referredUid ||
                source.userId ||
                source.uid
            );

        return {
            id:
                toSafeString(
                    source.id ||
                    source.referralId ||
                    source.referenceId ||
                    referredUid ||
                    `${createdAt || "referral"}-${index}`
                ),

            referredUid,

            username:
                maskUsername(
                    resolveReferralIdentity(
                        source,
                        index
                    )
                ),

            status,

            rewardAmount,

            rewardText:
                formatMoney(
                    rewardAmount
                ),

            createdAt,

            createdAtText:
                formatDate(
                    createdAt
                ),

            qualifiedAt:
                serializeTimestamp(
                    source.qualifiedAt
                ),

            rewardedAt:
                serializeTimestamp(
                    source.rewardedAt ||
                    source.rewardGrantedAt ||
                    source.approvedAt
                )
        };
    }

    function extractReferralCollection(
        payload
    ) {
        if (Array.isArray(payload)) {
            return payload;
        }

        if (!isPlainObject(payload)) {
            return [];
        }

        const candidates = [
            payload.referrals,
            payload.items,
            payload.list,
            payload.data?.referrals,
            payload.data?.items
        ];

        for (
            const candidate of
            candidates
        ) {
            if (Array.isArray(candidate)) {
                return candidate;
            }
        }

        return [];
    }

    function normalizeReferralCollection(
        payload
    ) {
        return extractReferralCollection(
            payload
        )
            .map(
                (referral, index) =>
                    normalizeReferral(
                        referral,
                        index
                    )
            )
            .sort(
                (
                    firstReferral,
                    secondReferral
                ) => {
                    const firstTime =
                        firstReferral.createdAt
                            ? new Date(
                                firstReferral
                                    .createdAt
                            ).getTime()
                            : 0;

                    const secondTime =
                        secondReferral.createdAt
                            ? new Date(
                                secondReferral
                                    .createdAt
                            ).getTime()
                            : 0;

                    return (
                        secondTime -
                        firstTime
                    );
                }
            );
    }

    /* =====================================================
       STATISTICS NORMALIZATION
    ===================================================== */

    function createEmptyStats(
        uid = ""
    ) {
        return {
            uid:
                toSafeString(uid),

            total:
                0,

            pending:
                0,

            qualified:
                0,

            approved:
                0,

            rejected:
                0,

            rewarded:
                0,

            totalReward:
                0
        };
    }

    function calculateStatsFromReferrals(
        referrals,
        uid = ""
    ) {
        const stats =
            createEmptyStats(uid);

        referrals.forEach(
            (referral) => {
                stats.total +=
                    1;

                if (
                    STATUS_ORDER.includes(
                        referral.status
                    )
                ) {
                    stats[
                        referral.status
                    ] += 1;
                }

                if (
                    referral.status ===
                    REFERRAL_STATUSES.REWARDED
                ) {
                    stats.totalReward =
                        safeAdd(
                            stats.totalReward,
                            referral.rewardAmount
                        );
                }
            }
        );

        return stats;
    }

    function extractStats(payload) {
        if (!isPlainObject(payload)) {
            return null;
        }

        if (
            isPlainObject(
                payload.stats
            )
        ) {
            return payload.stats;
        }

        if (
            isPlainObject(
                payload.data?.stats
            )
        ) {
            return payload.data.stats;
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    payload,
                    "total"
                ) &&
            (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        payload,
                        "pending"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        payload,
                        "observing"
                    )
            )
        ) {
            return payload;
        }

        return null;
    }

    function normalizeStats(
        stats,
        referrals = [],
        uid = ""
    ) {
        const calculatedStats =
            calculateStatsFromReferrals(
                referrals,
                uid
            );

        const source =
            isPlainObject(stats)
                ? stats
                : {};

        const pending =
            toNonNegativeInteger(
                source.pending ??
                source.observing,
                calculatedStats.pending
            );

        const qualified =
            toNonNegativeInteger(
                source.qualified ??
                source.pendingReview,
                calculatedStats.qualified
            );

        const approved =
            toNonNegativeInteger(
                source.approved,
                calculatedStats.approved
            );

        const rejected =
            toNonNegativeInteger(
                source.rejected ??
                source.invalid,
                calculatedStats.rejected
            );

        const rewarded =
            toNonNegativeInteger(
                source.rewarded ??
                source.valid,
                calculatedStats.rewarded
            );

        const reconstructedTotal =
            pending +
            qualified +
            approved +
            rejected +
            rewarded;

        return {
            uid:
                toSafeString(
                    source.uid ||
                    uid
                ),

            total:
                toNonNegativeInteger(
                    source.total,
                    reconstructedTotal ||
                    calculatedStats.total
                ),

            pending,
            qualified,
            approved,
            rejected,
            rewarded,

            totalReward:
                toNonNegativeInteger(
                    source.totalReward,
                    calculatedStats
                        .totalReward
                )
        };
    }

    /* =====================================================
       REFERRALDB STATE
    ===================================================== */

    function readReferralDBState() {
        if (
            !window.ReferralDB ||
            typeof window.ReferralDB
                .getState !==
                "function"
        ) {
            return null;
        }

        try {
            const referralState =
                window.ReferralDB
                    .getState();

            return isPlainObject(
                referralState
            )
                ? referralState
                : null;
        } catch {
            return null;
        }
    }

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
                return {};
            }
        }

        return {};
    }

    /* =====================================================
       SUMMARY RENDERING
    ===================================================== */

    function setElementText(
        element,
        value
    ) {
        if (!element) {
            return false;
        }

        element.textContent =
            String(value);

        return true;
    }

    function renderSummary(stats) {
        setElementText(
            state.elements.totalCount,
            formatNumber(stats.total)
        );

        setElementText(
            state.elements.pendingCount,
            formatNumber(stats.pending)
        );

        setElementText(
            state.elements.qualifiedCount,
            formatNumber(
                stats.qualified
            )
        );

        setElementText(
            state.elements.rewardedCount,
            formatNumber(
                stats.rewarded
            )
        );

        setElementText(
            state.elements.rejectedCount,
            formatNumber(
                stats.rejected
            )
        );

        setElementText(
            state.elements.totalReward,
            formatMoney(
                stats.totalReward
            )
        );

        setElementText(
            state.elements.listCount,
            formatNumber(stats.total)
        );

        state.elements.listCount
            ?.setAttribute(
                "aria-label",
                `${stats.total} referrals`
            );

        if (
            state.elements.summaryGrid
        ) {
            state.elements.summaryGrid
                .setAttribute(
                    "aria-busy",
                    "false"
                );

            state.elements.summaryGrid
                .dataset
                .approvedCount =
                String(
                    stats.approved
                );
        }

        return true;
    }

    /* =====================================================
       STATUS BADGE
    ===================================================== */

    function createStatusBadge(status) {
        const configuration =
            getStatusConfiguration(
                status
            );

        const badge =
            document.createElement(
                "span"
            );

        badge.className =
            `referral-status-badge ${configuration.className}`;

        badge.dataset.status =
            normalizeStatus(status);

        const indicator =
            document.createElement(
                "span"
            );

        indicator.className =
            "referral-status-indicator";

        indicator.setAttribute(
            "aria-hidden",
            "true"
        );

        indicator.textContent =
            configuration.indicator;

        const label =
            document.createElement(
                "span"
            );

        label.className =
            "referral-status-label";

        label.textContent =
            configuration.label;

        badge.append(
            indicator,
            label
        );

        badge.setAttribute(
            "aria-label",
            `Status: ${configuration.label}`
        );

        return badge;
    }

    /* =====================================================
       REFERRAL ROW
    ===================================================== */

    function createReferralRow(
        referral
    ) {
        const row =
            document.createElement(
                "tr"
            );

        row.className =
            `referral-statistics-row referral-row-${referral.status}`;

        if (referral.id) {
            row.dataset.referralId =
                referral.id;
        }

        const usernameCell =
            document.createElement(
                "td"
            );

        const username =
            document.createElement(
                "span"
            );

        username.className =
            "referral-username";

        username.textContent =
            referral.username;

        usernameCell.appendChild(
            username
        );

        const statusCell =
            document.createElement(
                "td"
            );

        statusCell.appendChild(
            createStatusBadge(
                referral.status
            )
        );

        const rewardCell =
            document.createElement(
                "td"
            );

        const reward =
            document.createElement(
                "span"
            );

        reward.className =
            "referral-reward-value";

        reward.classList.toggle(
            "is-credited",
            referral.status ===
                REFERRAL_STATUSES.REWARDED
        );

        reward.textContent =
            referral.rewardText;

        rewardCell.appendChild(
            reward
        );

        row.append(
            usernameCell,
            statusCell,
            rewardCell
        );

        return row;
    }

    /* =====================================================
       CONTENT STATES
    ===================================================== */

    function hideContentStates() {
        if (
            state.elements.loadingState
        ) {
            state.elements.loadingState
                .hidden =
                true;
        }

        if (
            state.elements.tableRegion
        ) {
            state.elements.tableRegion
                .hidden =
                true;
        }

        if (
            state.elements.emptyState
        ) {
            state.elements.emptyState
                .hidden =
                true;
        }

        if (
            state.elements.guestState
        ) {
            state.elements.guestState
                .hidden =
                true;
        }
    }

    function showLoadingState() {
        hideContentStates();

        if (
            state.elements.loadingState
        ) {
            state.elements.loadingState
                .hidden =
                false;
        }
    }

    function showGuestState() {
        hideContentStates();

        if (
            state.elements.guestState
        ) {
            state.elements.guestState
                .hidden =
                false;
        }
    }

    function showEmptyState() {
        hideContentStates();

        if (
            state.elements.emptyState
        ) {
            state.elements.emptyState
                .hidden =
                false;
        }
    }

    function showTableState() {
        hideContentStates();

        if (
            state.elements.tableRegion
        ) {
            state.elements.tableRegion
                .hidden =
                false;
        }
    }

    function renderPagination() {
        const signedIn =
            Boolean(
                resolveCurrentUser()
                    ?.uid
            );

        const visible =
            Boolean(
                signedIn &&
                !state.loading &&
                state.referrals.length >
                    0 &&
                state.hasMore &&
                state.nextCursor
            );

        if (state.elements.pagination) {
            state.elements.pagination.hidden =
                !visible;

            state.elements.pagination
                .setAttribute(
                    "aria-hidden",
                    visible
                        ? "false"
                        : "true"
                );
        }

        if (state.elements.loadMoreButton) {
            state.elements.loadMoreButton.hidden =
                !visible;

            state.elements.loadMoreButton.disabled =
                !visible ||
                state.loadingMore;

            state.elements.loadMoreButton
                .setAttribute(
                    "aria-busy",
                    state.loadingMore
                        ? "true"
                        : "false"
                );

            state.elements.loadMoreButton.textContent =
                state.loadingMore
                    ? "Loading More Referrals..."
                    : "Load More Referrals";
        }

        if (state.elements.loadMoreState) {
            state.elements.loadMoreState.textContent =
                state.loadingMore
                    ? "Loading more referral records..."
                    : visible
                        ? `${state.referrals.length} referral records loaded.`
                        : "";
        }

        if (state.page) {
            state.page.dataset.hasMoreReferrals =
                state.hasMore
                    ? "true"
                    : "false";

            state.page.dataset.loadedReferralCount =
                String(
                    state.referrals.length
                );
        }

        return visible;
    }

    function renderReferralRows(
        referrals
    ) {
        const tableBody =
            state.elements.tableBody;

        if (!tableBody) {
            renderPagination();
            return false;
        }

        tableBody.replaceChildren();

        if (!referrals.length) {
            showEmptyState();
            renderPagination();

            return true;
        }

        const fragment =
            document.createDocumentFragment();

        referrals.forEach(
            (referral) => {
                fragment.appendChild(
                    createReferralRow(
                        referral
                    )
                );
            }
        );

        tableBody.appendChild(
            fragment
        );

        showTableState();
        renderPagination();

        return true;
    }

    /* =====================================================
       LOADING AND PAGE STATUS
    ===================================================== */

    function setLoading(value) {
        const loading =
            value === true;

        state.loading =
            loading;

        if (state.page) {
            state.page.classList.toggle(
                "is-loading",
                loading
            );

            state.page.setAttribute(
                "aria-busy",
                String(loading)
            );
        }

        if (
            state.elements.summaryGrid
        ) {
            state.elements.summaryGrid
                .setAttribute(
                    "aria-busy",
                    String(loading)
                );
        }

        if (
            state.elements.refreshState
        ) {
            state.elements.refreshState
                .textContent =
                loading
                    ? "Refreshing..."
                    : "";
        }

        if (loading) {
            showLoadingState();
        }

        renderPagination();

        return true;
    }

    function setLoadingMore(value) {
        const loadingMore =
            value === true;

        state.loadingMore =
            loadingMore;

        if (state.page) {
            state.page.classList.toggle(
                "is-loading-more",
                loadingMore
            );
        }

        renderPagination();

        return true;
    }

    function clearPageStatus() {
        const status =
            state.elements.pageStatus;

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
        type = "info"
    ) {
        const status =
            state.elements.pageStatus;

        if (!status) {
            return false;
        }

        const normalizedMessage =
            toSafeString(message);

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

        return true;
    }

    /* =====================================================
       DATA APPLICATION
    ===================================================== */

    function setData(payload) {
        if (
            !state.initialized ||
            !state.page
        ) {
            return false;
        }

        const currentUser =
            resolveCurrentUser();

        if (!currentUser?.uid) {
            state.currentUid =
                "";

            state.referrals =
                [];

            state.stats =
                createEmptyStats();

            state.loadingMore =
                false;

            state.hasMore =
                false;

            state.nextCursor =
                "";

            state.error =
                null;

            state.lastUpdatedAt =
                null;

            renderSummary(
                state.stats
            );

            setLoading(false);
            clearPageStatus();
            showGuestState();
            renderPagination();

            state.page.dataset
                .accountState =
                "guest";

            return true;
        }

        const payloadUid =
            toSafeString(
                payload?.currentUser
                    ?.uid ||
                payload?.stats
                    ?.uid ||
                payload?.uid
            );

        if (
            payloadUid &&
            payloadUid !==
                currentUser.uid
        ) {
            return false;
        }

        const referrals =
            normalizeReferralCollection(
                payload
            );

        const stats =
            normalizeStats(
                extractStats(payload),
                referrals,
                currentUser.uid
            );

        const nextCursor =
            toSafeString(
                payload?.nextCursor
            );

        const hasMore =
            payload?.hasMore ===
                true &&
            Boolean(nextCursor);

        state.currentUid =
            currentUser.uid;

        state.referrals =
            referrals;

        state.stats =
            stats;

        state.loadingMore =
            payload?.loadingMore ===
                true;

        state.hasMore =
            hasMore;

        state.nextCursor =
            hasMore
                ? nextCursor
                : "";

        state.error =
            null;

        state.lastUpdatedAt =
            serializeTimestamp(
                payload?.lastUpdatedAt
            ) ||
            new Date()
                .toISOString();

        renderSummary(stats);
        renderReferralRows(referrals);

        setLoading(false);
        clearPageStatus();
        renderPagination();

        state.page.dataset
            .accountState =
            "google";

        if (
            window.AccountSectionsModule &&
            typeof window
                .AccountSectionsModule
                .synchronizeReferralLink ===
                "function"
        ) {
            window.AccountSectionsModule
                .synchronizeReferralLink();
        }

        return true;
    }

    function handleDataError(error) {
        state.error =
            normalizeError(error);

        setLoading(false);
        setLoadingMore(false);

        showPageStatus(
            state.error.message,
            "error"
        );

        if (
            state.referrals.length
        ) {
            renderReferralRows(
                state.referrals
            );
        } else if (
            resolveCurrentUser()?.uid
        ) {
            showEmptyState();
            renderPagination();
        } else {
            showGuestState();
            renderPagination();
        }

        return state.error;
    }

    /* =====================================================
       REFERRALDB SUBSCRIPTION
    ===================================================== */

    function subscribeToReferralDB() {
        if (
            state.referralUnsubscribe ||
            !window.ReferralDB ||
            typeof window.ReferralDB
                .subscribe !==
                "function"
        ) {
            return false;
        }

        state.referralUnsubscribe =
            window.ReferralDB
                .subscribe(
                    (referralState) => {
                        if (!state.initialized) {
                            return;
                        }

                        if (
                            referralState?.loading ===
                            true
                        ) {
                            setLoading(true);

                            return;
                        }

                        setData(
                            referralState ||
                            {}
                        );

                        if (
                            referralState?.error
                        ) {
                            handleDataError(
                                referralState.error
                            );
                        }
                    }
                );

        return true;
    }

    function unsubscribeFromReferralDB() {
        if (
            typeof state
                .referralUnsubscribe ===
                "function"
        ) {
            try {
                state.referralUnsubscribe();
            } catch {
                /*
                 * No further cleanup is required.
                 */
            }
        }

        state.referralUnsubscribe =
            null;

        return true;
    }

    /* =====================================================
       SHARED ACCOUNT SECTIONS
    ===================================================== */

    function initializeSharedSections() {
        const mount =
            state.elements
                .accountSectionsMount;

        if (!mount) {
            return false;
        }

        if (
            !window.AccountSectionsView ||
            typeof window
                .AccountSectionsView
                .render !==
                "function"
        ) {
            return false;
        }

        const identity =
            getReferralIdentity();

        const rendered =
            window.AccountSectionsView
                .render(
                    mount,
                    {
                        currentPage:
                            CURRENT_PAGE,

                        referralLink:
                            toSafeString(
                                identity
                                    .referralLink
                            )
                    }
                );

        if (rendered === false) {
            return false;
        }

        if (
            !window.AccountSectionsModule ||
            typeof window
                .AccountSectionsModule
                .init !==
                "function"
        ) {
            return false;
        }

        const initialized =
            window.AccountSectionsModule
                .init({
                    root:
                        mount,

                    currentPage:
                        CURRENT_PAGE,

                    referralLink:
                        toSafeString(
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
                .destroy ===
                "function"
        ) {
            const currentPage =
                typeof sharedModule
                    .getCurrentPage ===
                    "function"
                    ? sharedModule
                        .getCurrentPage()
                    : CURRENT_PAGE;

            if (
                currentPage ===
                CURRENT_PAGE
            ) {
                sharedModule.destroy();
            }
        }

        state.sharedSectionsInitialized =
            false;

        return true;
    }

    /* =====================================================
       AUTH EVENTS
    ===================================================== */

    function handleAuthEvent(event) {
        if (!state.initialized) {
            return;
        }

        const user =
            extractEventUser(event);

        if (!user?.uid) {
            setData({
                referrals:
                    [],

                stats:
                    createEmptyStats()
            });

            if (
                window.AccountSectionsModule &&
                typeof window
                    .AccountSectionsModule
                    .clearReferralLink ===
                    "function"
            ) {
                window.AccountSectionsModule
                    .clearReferralLink();
            }

            return;
        }

        void refresh({
            force:
                true
        });
    }

    function handleLoadMoreClick(event) {
        event?.preventDefault();

        void loadMore();
    }

    function handleReferralUpdated() {
        if (!state.initialized) {
            return;
        }

        const referralState =
            readReferralDBState();

        if (referralState) {
            setData(
                referralState
            );
        }
    }

    function bindBrowserEvents() {
        AUTH_EVENTS.forEach(
            (eventName) => {
                addManagedListener(
                    window,
                    eventName,
                    handleAuthEvent
                );
            }
        );

        addManagedListener(
            window,
            "referral:updated",
            handleReferralUpdated
        );

        addManagedListener(
            state.elements
                .loadMoreButton,
            "click",
            handleLoadMoreClick
        );

        return true;
    }

    /* =====================================================
       REFRESH
    ===================================================== */

    async function initializeReferralDB() {
        const referralDB =
            window.ReferralDB;

        if (!referralDB) {
            throw new Error(
                "ReferralDB is unavailable."
            );
        }

        if (
            typeof referralDB.init ===
                "function"
        ) {
            await referralDB.init();
        }

        return referralDB;
    }

    function refresh(options = {}) {
        const currentUser =
            resolveCurrentUser();

        if (!currentUser?.uid) {
            setData({
                referrals:
                    [],

                stats:
                    createEmptyStats()
            });

            return Promise.resolve(
                getState()
            );
        }

        if (
            state.refreshPromise &&
            refreshOperationUid ===
                currentUser.uid
        ) {
            return state.refreshPromise;
        }

        const expectedUid =
            currentUser.uid;

        const expectedGeneration =
            state.lifecycleGeneration;

        const operationId =
            ++refreshOperationSequence;

        const operationPromise =
            (async () => {
                setLoading(true);
                clearPageStatus();

                try {
                    const referralDB =
                        await initializeReferralDB();

                    if (
                        !state.initialized ||
                        operationId !==
                            refreshOperationSequence ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getState();
                    }

                    let result =
                        null;

                    if (
                        typeof referralDB
                            .refresh ===
                            "function"
                    ) {
                        result =
                            await referralDB
                                .refresh({
                                    force:
                                        options.force ===
                                        true
                                });
                    }

                    if (
                        !state.initialized ||
                        operationId !==
                            refreshOperationSequence ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getState();
                    }

                    const referralState =
                        isPlainObject(result)
                            ? result
                            : readReferralDBState();

                    setData(
                        referralState || {
                            referrals:
                                [],

                            stats:
                                createEmptyStats(
                                    expectedUid
                                )
                        }
                    );

                    return getState();
                } catch (error) {
                    if (
                        state.initialized &&
                        operationId ===
                            refreshOperationSequence &&
                        expectedGeneration ===
                            state.lifecycleGeneration &&
                        resolveCurrentUser()
                            ?.uid ===
                            expectedUid
                    ) {
                        handleDataError(
                            error
                        );
                    }

                    return getState();
                } finally {
                    if (
                        operationId ===
                            refreshOperationSequence
                    ) {
                        state.refreshPromise =
                            null;

                        refreshOperationUid =
                            "";
                    }
                }
            })();

        refreshOperationUid =
            expectedUid;

        state.refreshPromise =
            operationPromise;

        return operationPromise;
    }

    function loadMore() {
        const currentUser =
            resolveCurrentUser();

        if (
            !currentUser?.uid ||
            state.loading ||
            state.loadingMore ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return Promise.resolve(
                getState()
            );
        }

        if (
            state.loadMorePromise &&
            loadMoreOperationUid ===
                currentUser.uid
        ) {
            return state.loadMorePromise;
        }

        const expectedUid =
            currentUser.uid;

        const expectedGeneration =
            state.lifecycleGeneration;

        const expectedCursor =
            state.nextCursor;

        const operationId =
            ++loadMoreOperationSequence;

        const operationPromise =
            (async () => {
                setLoadingMore(true);
                clearPageStatus();

                try {
                    const referralDB =
                        await initializeReferralDB();

                    if (
                        !state.initialized ||
                        operationId !==
                            loadMoreOperationSequence ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid ||
                        state.nextCursor !==
                            expectedCursor
                    ) {
                        return getState();
                    }

                    if (
                        typeof referralDB
                            .loadMore !==
                            "function"
                    ) {
                        throw new Error(
                            "Referral pagination is unavailable."
                        );
                    }

                    const result =
                        await referralDB
                            .loadMore();

                    if (
                        !state.initialized ||
                        operationId !==
                            loadMoreOperationSequence ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getState();
                    }

                    const referralState =
                        isPlainObject(result)
                            ? result
                            : readReferralDBState();

                    if (referralState) {
                        setData(
                            referralState
                        );
                    }

                    return getState();
                } catch (error) {
                    if (
                        state.initialized &&
                        operationId ===
                            loadMoreOperationSequence &&
                        expectedGeneration ===
                            state.lifecycleGeneration &&
                        resolveCurrentUser()
                            ?.uid ===
                            expectedUid
                    ) {
                        handleDataError(
                            error
                        );
                    }

                    return getState();
                } finally {
                    if (
                        operationId ===
                            loadMoreOperationSequence
                    ) {
                        setLoadingMore(false);

                        state.loadMorePromise =
                            null;

                        loadMoreOperationUid =
                            "";
                    }
                }
            })();

        loadMoreOperationUid =
            expectedUid;

        state.loadMorePromise =
            operationPromise;

        return operationPromise;
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

    async function init(
        target,
        options = {}
    ) {
        destroy();

        let page =
            resolvePage(target);

        if (
            !page &&
            window.ReferralStatisticsView &&
            typeof window
                .ReferralStatisticsView
                .render ===
                "function"
        ) {
            const renderedPage =
                window.ReferralStatisticsView
                    .render(target);

            page =
                renderedPage instanceof
                    HTMLElement
                    ? renderedPage
                    : resolvePage(target);
        }

        if (!page) {
            console.error(
                "[ReferralStatisticsModule] Referral Statistics page was not found."
            );

            return false;
        }

        state.lifecycleGeneration +=
            1;

        const currentGeneration =
            state.lifecycleGeneration;

        state.page =
            page;

        state.initialized =
            true;

        collectElements();
        bindBrowserEvents();
        observePageRemoval();

        initializeSharedSections();

        const currentUser =
            resolveCurrentUser();

        if (!currentUser?.uid) {
            setData({
                referrals:
                    [],

                stats:
                    createEmptyStats()
            });

            return true;
        }

        state.currentUid =
            currentUser.uid;

        setLoading(true);

        try {
            const referralDB =
                await initializeReferralDB();

            if (
                !state.initialized ||
                currentGeneration !==
                    state.lifecycleGeneration
            ) {
                return false;
            }

            subscribeToReferralDB();

            const currentReferralState =
                readReferralDBState();

            if (currentReferralState) {
                setData(
                    currentReferralState
                );
            }

            await refresh({
                force:
                    options.force ===
                    true
            });
        } catch (error) {
            if (
                state.initialized &&
                currentGeneration ===
                    state.lifecycleGeneration
            ) {
                handleDataError(
                    error
                );
            }
        }

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        refreshOperationSequence +=
            1;

        loadMoreOperationSequence +=
            1;

        refreshOperationUid =
            "";

        loadMoreOperationUid =
            "";

        state.refreshPromise =
            null;

        state.loadMorePromise =
            null;

        unsubscribeFromReferralDB();
        removeManagedListeners();

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

        state.elements =
            {};

        state.currentUid =
            "";

        state.referrals =
            [];

        state.stats =
            createEmptyStats();

        state.loading =
            false;

        state.loadingMore =
            false;

        state.hasMore =
            false;

        state.nextCursor =
            "";

        state.error =
            null;

        state.lastUpdatedAt =
            null;

        return true;
    }

    /* =====================================================
       STATE
    ===================================================== */

    function getState() {
        return cloneValue({
            initialized:
                state.initialized,

            loading:
                state.loading,

            loadingMore:
                state.loadingMore,

            currentUid:
                state.currentUid,

            referrals:
                state.referrals,

            stats:
                state.stats,

            hasMore:
                state.hasMore,

            nextCursor:
                state.nextCursor,

            error:
                state.error,

            lastUpdatedAt:
                state.lastUpdatedAt
        });
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,
        refresh,
        loadMore,
        setData,
        getState,

        maskUsername,
        normalizeStatus,
        normalizeReferral,
        normalizeReferralCollection,
        normalizeStats,

        formatNumber,
        formatMoney,

        isInitialized() {
            return state.initialized;
        },

        REFERRAL_STATUSES
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ReferralStatisticsModule =
    ReferralStatisticsModule;
