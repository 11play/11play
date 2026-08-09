"use strict";

/* =========================================================
   11PLAY — ADMIN USERS MODULE
   File: admin/js/admin.users.js

   Responsibilities:
   - Load Profile System users through AdminAPI
   - Search loaded users
   - Filter users by canonical profile status
   - Load all users through cursor-based pagination
   - Load complete user details
   - Change only the permitted profile status
   - Apply idempotent wallet adjustments
   - Display canonical referral statistics
   - Display server-authoritative Eligible Active Days
   - Never access Firestore directly

   Security:
   - Identity fields are read-only
   - Mobile number is never modified by Admin
   - Display name and Google identity are never modified
   - Profile status change requires an Admin note
   - Wallet adjustment requires an idempotency operationId
   - Backend remains the final authority
========================================================= */

(function initializeAdminUsers(
    window,
    document
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT =
        50;

    const MAX_LIMIT =
        100;

    const REQUIRED_ACTIVE_DAYS =
        7;

    const LEGACY_SECONDS_PER_DAY =
        24 * 60 * 60;

    const ALLOWED_STATUSES =
        Object.freeze([
            "",
            "active",
            "suspended",
            "blocked"
        ]);

    const WALLET_DIRECTIONS =
        Object.freeze([
            "credit",
            "debit"
        ]);

    const EVENTS =
        Object.freeze({
            UPDATED:
                "admin-users:updated",

            LOADING:
                "admin-users:loading",

            ERROR:
                "admin-users:error",

            USER_SELECTED:
                "admin-users:user-selected",

            USER_UPDATED:
                "admin:user-updated",

            WALLET_UPDATED:
                "admin:wallet-updated"
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const state = {
        initialized:
            false,

        loading:
            false,

        loadingDetails:
            false,

        savingProfile:
            false,

        adjustingWallet:
            false,

        users:
            [],

        visibleUsers:
            [],

        selectedUserId:
            "",

        selectedUser:
            null,

        statusFilter:
            "",

        searchQuery:
            "",

        limit:
            DEFAULT_LIMIT,

        total:
            0,

        nextCursor:
            "",

        hasMore:
            false,

        lastUpdatedAt:
            null,

        error:
            null
    };

    const elements = {
        root:
            null,

        tableBody:
            null,

        loadingState:
            null,

        emptyState:
            null,

        errorState:
            null,

        errorMessage:
            null,

        totals:
            [],

        searchInput:
            null,

        statusFilter:
            null,

        loadMoreButton:
            null,

        refreshButtons:
            [],

        detailsPanel:
            null,

        profileForm:
            null,

        walletForm:
            null
    };

    let requestSequence =
        0;

    let detailSequence =
        0;

    let controller =
        null;

    let pendingWalletOperation =
        null;

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(value)
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

    function toString(
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

    function toNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function toInteger(
        value,
        fallback = 0
    ) {
        const number =
            toNumber(
                value,
                fallback
            );

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.max(
            0,
            Math.floor(number)
        );
    }

    function toSignedInteger(
        value,
        fallback = 0
    ) {
        const number =
            toNumber(
                value,
                fallback
            );

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.trunc(number);
    }

    function toLimit(value) {
        return Math.min(
            MAX_LIMIT,

            Math.max(
                1,
                Math.floor(
                    toNumber(
                        value,
                        DEFAULT_LIMIT
                    )
                )
            )
        );
    }

    function clamp(
        value,
        minimum,
        maximum
    ) {
        return Math.min(
            maximum,
            Math.max(
                minimum,
                value
            )
        );
    }

    function clone(value) {
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
                // JSON fallback below.
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

    function normalizeEmail(value) {
        return toString(
            value
        ).toLowerCase();
    }

    function normalizeStatus(value) {
        const status =
            toString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        return ALLOWED_STATUSES
            .includes(status)
                ? status
                : "";
    }

    function requireProfileStatus(value) {
        const status =
            normalizeStatus(value);

        if (!status) {
            throw new TypeError(
                "A valid profile status is required."
            );
        }

        return status;
    }

    function requireAdminNote(value) {
        const note =
            toString(value);

        if (!note) {
            throw new TypeError(
                "Admin note is required."
            );
        }

        if (
            note.length >
            500
        ) {
            throw new TypeError(
                "Admin note must not exceed 500 characters."
            );
        }

        return note;
    }

    function requireUserId(value) {
        const userId =
            toString(value);

        if (!userId) {
            throw new TypeError(
                "userId is required."
            );
        }

        if (
            userId.length >
                128 ||
            !/^[A-Za-z0-9_-]+$/.test(
                userId
            )
        ) {
            throw new TypeError(
                "userId is invalid."
            );
        }

        return userId;
    }

    function normalizeWalletDirection(value) {
        const direction =
            toString(value)
                .toLowerCase();

        if (
            !WALLET_DIRECTIONS
                .includes(direction)
        ) {
            throw new TypeError(
                "Wallet direction must be credit or debit."
            );
        }

        return direction;
    }

    function normalizeWalletAmount(value) {
        const amount =
            toSignedInteger(value);

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount < 1
        ) {
            throw new TypeError(
                "A positive whole-number wallet amount is required."
            );
        }

        return amount;
    }

    function getStatusLabel(status) {
        switch (
            normalizeStatus(status)
        ) {
            case "suspended":
                return "Suspended";

            case "blocked":
                return "Blocked";

            case "active":
            default:
                return "Active";
        }
    }

    function serializeTimestamp(value) {
        if (!value) {
            return null;
        }

        try {
            if (
                typeof value.toDate ===
                "function"
            ) {
                return value
                    .toDate()
                    .toISOString();
            }

            if (
                typeof value.toMillis ===
                "function"
            ) {
                return new Date(
                    value.toMillis()
                ).toISOString();
            }

            if (
                typeof value ===
                    "object" &&
                typeof value.seconds ===
                    "number"
            ) {
                const nanoseconds =
                    typeof value.nanoseconds ===
                        "number"
                        ? value.nanoseconds
                        : 0;

                return new Date(
                    value.seconds *
                        1000 +
                    Math.floor(
                        nanoseconds /
                        1000000
                    )
                ).toISOString();
            }

            const parsedDate =
                new Date(value);

            return Number.isNaN(
                parsedDate.getTime()
            )
                ? null
                : parsedDate
                    .toISOString();
        } catch {
            return null;
        }
    }

    function formatDate(value) {
        const timestamp =
            serializeTimestamp(value);

        if (!timestamp) {
            return "—";
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day:
                    "2-digit",

                month:
                    "short",

                year:
                    "numeric",

                hour:
                    "2-digit",

                minute:
                    "2-digit",

                hour12:
                    true
            }
        ).format(
            new Date(timestamp)
        );
    }

    function formatMoney(value) {
        return `৳${new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(
            toInteger(value)
        )}`;
    }

    function formatActiveDays(
        activeDays,
        requiredActiveDays =
            REQUIRED_ACTIVE_DAYS
    ) {
        const requiredDays =
            Math.max(
                1,
                toInteger(
                    requiredActiveDays,
                    REQUIRED_ACTIVE_DAYS
                ) ||
                REQUIRED_ACTIVE_DAYS
            );

        const completedDays =
            Math.min(
                requiredDays,
                toInteger(activeDays)
            );

        return `${completedDays} / ${requiredDays}`;
    }

    /*
     * Compatibility helper retained for any older Admin UI
     * consumer. Current eligibility is not calculated from
     * elapsed seconds.
     */

    function formatDuration(seconds) {
        const totalSeconds =
            toInteger(seconds);

        const days =
            Math.floor(
                totalSeconds /
                86400
            );

        const hours =
            Math.floor(
                (
                    totalSeconds %
                    86400
                ) /
                3600
            );

        const minutes =
            Math.floor(
                (
                    totalSeconds %
                    3600
                ) /
                60
            );

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${minutes}m`;
    }

    function normalizeError(error) {
        const rawCode =
            toString(
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
                toString(
                    error?.message
                ) ||
                "User operation could not be completed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function escapeHTML(value) {
        return toString(value)
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
                "&#039;"
            );
    }

    function normalizePhotoURL(value) {
        const photoURL =
            toString(value);

        if (!photoURL) {
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

    function getAdminAPI() {
        if (!window.AdminAPI) {
            throw new Error(
                "AdminAPI is not available."
            );
        }

        return window.AdminAPI;
    }

    async function requireAdminAccess() {
        const adminAuth =
            window.AdminAuth;

        if (
            adminAuth &&
            typeof adminAuth
                .requireAdmin ===
                "function"
        ) {
            return adminAuth
                .requireAdmin();
        }

        return null;
    }

    function isSoleAdminUser(user) {
        const adminEmail =
            normalizeEmail(
                window.AdminAPI
                    ?.SOLE_ADMIN_EMAIL ||
                window.AdminAuth
                    ?.SOLE_ADMIN_EMAIL ||
                "casinobuzzbd@gmail.com"
            );

        return Boolean(
            user &&
            normalizeEmail(
                user.email
            ) ===
                adminEmail
        );
    }

    /* =====================================================
       ACTIVITY NORMALIZATION
    ===================================================== */

    function legacySecondsToActiveDays(
        activity
    ) {
        const totalActiveSeconds =
            toInteger(
                activity
                    ?.totalActiveSeconds ??
                activity
                    ?.activeSeconds
            );

        if (!totalActiveSeconds) {
            return 0;
        }

        return Math.min(
            REQUIRED_ACTIVE_DAYS,
            Math.floor(
                totalActiveSeconds /
                LEGACY_SECONDS_PER_DAY
            )
        );
    }

    function normalizeActivity(
        source,
        profile = {},
        rootSource = {}
    ) {
        const activity =
            isPlainObject(source)
                ? source
                : {};

        const requiredActiveDays =
            Math.max(
                1,
                toInteger(
                    activity.requiredActiveDays ??
                    profile.requiredActiveDays ??
                    rootSource.requiredActiveDays,
                    REQUIRED_ACTIVE_DAYS
                ) ||
                REQUIRED_ACTIVE_DAYS
            );

        const legacyActiveDays =
            legacySecondsToActiveDays({
                totalActiveSeconds:
                    activity.totalActiveSeconds ??
                    activity.activeSeconds ??
                    profile.totalActiveSeconds ??
                    rootSource.totalActiveSeconds
            });

        const activeDays =
            Math.min(
                requiredActiveDays,
                toInteger(
                    activity.eligibleActiveDays ??
                    activity.activeDays ??
                    activity.totalActiveDays ??
                    profile.eligibleActiveDays ??
                    profile.activeDays ??
                    rootSource.eligibleActiveDays ??
                    rootSource.activeDays,
                    legacyActiveDays
                )
            );

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays -
                activeDays
            );

        const completed =
            activity.completed ===
                true ||
            activity.activityCompleted ===
                true ||
            activity.requirementCompleted ===
                true ||
            profile.activityCompleted ===
                true ||
            rootSource.activityCompleted ===
                true ||
            activeDays >=
                requiredActiveDays;

        const progressPercent =
            completed
                ? 100
                : clamp(
                    (
                        activeDays /
                        requiredActiveDays
                    ) * 100,
                    0,
                    100
                );

        return {
            activeDays,

            eligibleActiveDays:
                activeDays,

            requiredActiveDays,

            remainingActiveDays,

            progressPercent,

            completed,

            completedAt:
                serializeTimestamp(
                    activity.completedAt ||
                    profile.activityCompletedAt ||
                    rootSource.activityCompletedAt
                ),

            lastActiveAt:
                serializeTimestamp(
                    activity.lastActiveAt ||
                    activity.lastEligibleAt ||
                    activity.lastActivityAt ||
                    profile.lastActiveAt ||
                    rootSource.lastActiveAt
                ),

            /*
             * Compatibility aliases only.
             */

            totalActiveSeconds:
                activeDays *
                LEGACY_SECONDS_PER_DAY,

            requiredActiveSeconds:
                requiredActiveDays *
                LEGACY_SECONDS_PER_DAY,

            remainingActiveSeconds:
                remainingActiveDays *
                LEGACY_SECONDS_PER_DAY
        };
    }

    /* =====================================================
       USER NORMALIZATION
    ===================================================== */

    function normalizeUser(
        user,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(user)
                ? user
                : {};

        const profile =
            isPlainObject(
                source.profile
            )
                ? source.profile
                : source;

        const wallet =
            isPlainObject(
                source.wallet
            )
                ? source.wallet
                : isPlainObject(
                    profile.wallet
                )
                    ? profile.wallet
                    : {};

        const activitySource =
            isPlainObject(
                source.activity
            )
                ? source.activity
                : isPlainObject(
                    source.usingTime
                )
                    ? source.usingTime
                    : isPlainObject(
                        profile.activity
                    )
                        ? profile.activity
                        : isPlainObject(
                            profile.usingTime
                        )
                            ? profile.usingTime
                            : {};

        const referralStats =
            isPlainObject(
                source.referralStats
            )
                ? source.referralStats
                : isPlainObject(
                    source.referrals
                )
                    ? source.referrals
                    : isPlainObject(
                        profile.referralStats
                    )
                        ? profile
                            .referralStats
                        : isPlainObject(
                            profile.referrals
                        )
                            ? profile.referrals
                            : {};

        const uid =
            toString(
                profile.uid ||
                profile.userId ||
                profile.id ||
                source.uid ||
                source.userId ||
                source.id ||
                fallbackId
            );

        const status =
            normalizeStatus(
                profile.status ||
                source.status
            ) ||
            "active";

        const displayName =
            toString(
                profile.displayName ||
                profile.name ||
                source.displayName ||
                source.name
            );

        const email =
            normalizeEmail(
                profile.email ||
                source.email
            );

        const availableBalance =
            toInteger(
                wallet.availableBalance ??
                wallet.available ??
                wallet.balance ??
                profile.availableBalance ??
                source.availableBalance
            );

        const heldBalance =
            toInteger(
                wallet.heldBalance ??
                wallet.held ??
                wallet.reservedBalance ??
                profile.heldBalance ??
                source.heldBalance
            );

        const referralPending =
            toInteger(
                referralStats.pending ??
                referralStats.observing ??
                source.pendingReferrals
            );

        const referralQualified =
            toInteger(
                referralStats.qualified ??
                referralStats.pendingReview ??
                source.qualifiedReferrals
            );

        const referralApproved =
            toInteger(
                referralStats.approved ??
                source.approvedReferrals
            );

        const referralRewarded =
            toInteger(
                referralStats.rewarded ??
                referralStats.valid ??
                source.rewardedReferrals ??
                source.validReferrals
            );

        const referralRejected =
            toInteger(
                referralStats.rejected ??
                referralStats.invalid ??
                source.rejectedReferrals ??
                source.invalidReferrals
            );

        const activity =
            normalizeActivity(
                activitySource,
                profile,
                source
            );

        return {
            id:
                uid,

            uid,

            displayName,

            name:
                displayName,

            email,

            photoURL:
                normalizePhotoURL(
                    profile.photoURL ||
                    profile.photo ||
                    source.photoURL ||
                    source.photo
                ),

            mobileNumber:
                toString(
                    profile.mobileNumber ||
                    profile.mobile ||
                    source.mobileNumber ||
                    source.mobile
                ),

            mobileLocked:
                profile.mobileLocked ===
                    true ||
                profile
                    .mobileNumberLocked ===
                    true ||
                source.mobileLocked ===
                    true,

            accountType:
                toString(
                    profile.accountType ||
                    source.accountType ||
                    "google"
                ).toLowerCase(),

            googleConnected:
                profile
                    .googleConnected ===
                    true ||
                profile
                    .isGoogleConnected ===
                    true ||
                source
                    .googleConnected ===
                    true ||
                source
                    .isGoogleConnected ===
                    true,

            emailVerified:
                profile
                    .emailVerified ===
                    true ||
                source
                    .emailVerified ===
                    true,

            status,

            statusLabel:
                getStatusLabel(
                    status
                ),

            isSoleAdmin:
                email ===
                normalizeEmail(
                    window.AdminAPI
                        ?.SOLE_ADMIN_EMAIL ||
                    "casinobuzzbd@gmail.com"
                ),

            referralCode:
                toString(
                    profile.referralCode ||
                    source.referralCode
                ).toUpperCase(),

            referralLink:
                toString(
                    profile.referralLink ||
                    source.referralLink
                ),

            registrationDate:
                serializeTimestamp(
                    profile.registrationDate ||
                    profile.createdAt ||
                    source.registrationDate ||
                    source.createdAt
                ),

            lastLoginAt:
                serializeTimestamp(
                    profile.lastLoginAt ||
                    profile.lastLogin ||
                    source.lastLoginAt ||
                    source.lastLogin
                ),

            createdAt:
                serializeTimestamp(
                    profile.createdAt ||
                    profile.registrationDate ||
                    source.createdAt
                ),

            updatedAt:
                serializeTimestamp(
                    profile.updatedAt ||
                    source.updatedAt
                ),

            wallet: {
                availableBalance,

                heldBalance,

                totalBalance:
                    availableBalance +
                    heldBalance,

                totalEarned:
                    toInteger(
                        wallet.totalEarned ??
                        profile.totalEarned ??
                        source.totalEarned
                    ),

                totalWithdrawn:
                    toInteger(
                        wallet.totalWithdrawn ??
                        profile.totalWithdrawn ??
                        source.totalWithdrawn
                    )
            },

            activity,

            referralStats: {
                total:
                    toInteger(
                        referralStats.total ??
                        profile.totalReferrals ??
                        source.totalReferrals
                    ),

                pending:
                    referralPending,

                qualified:
                    referralQualified,

                approved:
                    referralApproved,

                rewarded:
                    referralRewarded,

                rejected:
                    referralRejected,

                totalReward:
                    toInteger(
                        referralStats.totalReward ??
                        referralStats.rewardAmount ??
                        source.totalReferralReward
                    ),

                /*
                 * Temporary compatibility aliases.
                 */

                observing:
                    referralPending,

                pendingReview:
                    referralQualified,

                valid:
                    referralRewarded,

                invalid:
                    referralRejected
            },

            raw:
                clone(source)
        };
    }

    function normalizeUsers(users) {
        return Array.isArray(users)
            ? users.map(
                (user) =>
                    normalizeUser(
                        user,
                        user?.id
                    )
            )
            : [];
    }

    function mergeUniqueUsers(
        existingUsers,
        incomingUsers
    ) {
        const usersById =
            new Map();

        [
            ...(Array.isArray(
                existingUsers
            )
                ? existingUsers
                : []),

            ...(Array.isArray(
                incomingUsers
            )
                ? incomingUsers
                : [])
        ].forEach(
            (user) => {
                const userId =
                    toString(
                        user?.uid ||
                        user?.id
                    );

                if (userId) {
                    usersById.set(
                        userId,
                        user
                    );
                }
            }
        );

        return Array.from(
            usersById.values()
        );
    }

    function extractResultValue(
        result,
        key,
        fallback = null
    ) {
        if (
            result &&
            typeof result ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    result,
                    key
                )
        ) {
            return result[key];
        }

        if (
            result?.data &&
            typeof result.data ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    result.data,
                    key
                )
        ) {
            return result.data[key];
        }

        return fallback;
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return clone(state);
    }

    function dispatch(
        eventName,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail:
                        clone(detail)
                }
            )
        );
    }

    function notify(
        eventName =
            EVENTS.UPDATED
    ) {
        const snapshot =
            getState();

        listeners.forEach(
            (listener) => {
                try {
                    listener(snapshot);
                } catch (error) {
                    console.error(
                        "[AdminUsers] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatch(
            eventName,
            snapshot
        );
    }

    function clearError() {
        state.error =
            null;
    }

    function setError(error) {
        state.error =
            normalizeError(error);

        renderError();

        notify(
            EVENTS.ERROR
        );
    }

    /* =====================================================
       DOM CACHE
    ===================================================== */

    function queryAll(selector) {
        return Array.from(
            document
                .querySelectorAll(
                    selector
                )
        );
    }

    function cacheElements() {
        elements.root =
            document.querySelector(
                "[data-admin-users]"
            );

        elements.tableBody =
            document.querySelector(
                "[data-admin-users-body]"
            );

        elements.loadingState =
            document.querySelector(
                "[data-admin-users-loading]"
            );

        elements.emptyState =
            document.querySelector(
                "[data-admin-users-empty]"
            );

        elements.errorState =
            document.querySelector(
                "[data-admin-users-error]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-users-error-message]"
            );

        elements.totals =
            queryAll(
                "[data-admin-users-total]"
            );

        elements.searchInput =
            document.querySelector(
                "[data-admin-users-search]"
            );

        elements.statusFilter =
            document.querySelector(
                "[data-admin-users-status]"
            );

        elements.loadMoreButton =
            document.querySelector(
                "[data-admin-users-load-more]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-users-refresh]"
            );

        elements.detailsPanel =
            document.querySelector(
                "[data-admin-user-details]"
            );

        elements.profileForm =
            document.querySelector(
                "[data-admin-user-profile-form]"
            );

        elements.walletForm =
            document.querySelector(
                "[data-admin-user-wallet-form]"
            );
    }

    function setVisible(
        element,
        visible
    ) {
        if (!element) {
            return;
        }

        element.hidden =
            visible !== true;

        element.setAttribute(
            "aria-hidden",
            visible
                ? "false"
                : "true"
        );
    }

    function setDisabled(
        element,
        disabled
    ) {
        if (!element) {
            return;
        }

        element.disabled =
            disabled === true;

        element.setAttribute(
            "aria-busy",
            disabled
                ? "true"
                : "false"
        );
    }

    function setFormValue(
        form,
        name,
        value
    ) {
        const field =
            form?.elements
                ?.namedItem(name);

        if (!field) {
            return;
        }

        field.value =
            toString(value);
    }

    function setIdentityFieldReadOnly(
        form,
        name,
        value
    ) {
        const field =
            form?.elements
                ?.namedItem(name);

        if (!field) {
            return;
        }

        field.value =
            toString(value);

        if (
            "readOnly" in field
        ) {
            field.readOnly =
                true;
        }

        field.setAttribute(
            "aria-readonly",
            "true"
        );

        field.dataset
            .adminIdentityField =
            "true";
    }

    function showToast(
        message,
        type = "success"
    ) {
        if (
            typeof window.AdminApp
                ?.showToast ===
                "function"
        ) {
            window.AdminApp
                .showToast(
                    message,
                    {
                        type
                    }
                );
        }
    }

    /* =====================================================
       USERS TABLE
    ===================================================== */

    function createUserRow(user) {
        const safePhotoURL =
            normalizePhotoURL(
                user.photoURL
            );

        const avatar =
            safePhotoURL
                ? `
                    <img
                        src="${escapeHTML(
                            safePhotoURL
                        )}"
                        alt="${escapeHTML(
                            user.displayName ||
                            "User"
                        )}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                    >
                `
                : `
                    <span aria-hidden="true">
                        ${escapeHTML(
                            (
                                user.displayName ||
                                user.email ||
                                "U"
                            )
                                .charAt(0)
                                .toUpperCase()
                        )}
                    </span>
                `;

        return `
            <tr
                data-admin-user-row="${escapeHTML(
                    user.uid
                )}"
            >
                <td>
                    <button
                        type="button"
                        class="admin-user-identity"
                        data-admin-user-open="${escapeHTML(
                            user.uid
                        )}"
                    >
                        <span class="admin-user-avatar">
                            ${avatar}
                        </span>

                        <span class="admin-user-text">
                            <strong>
                                ${escapeHTML(
                                    user.displayName ||
                                    "Unnamed User"
                                )}
                            </strong>

                            <small>
                                ${escapeHTML(
                                    user.email ||
                                    "No email"
                                )}
                            </small>
                        </span>
                    </button>
                </td>

                <td>
                    ${escapeHTML(
                        user.mobileNumber ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        user.referralCode ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatMoney(
                            user.wallet
                                .availableBalance
                        )
                    )}
                </td>

                <td>
                    <span
                        class="admin-status-badge is-${escapeHTML(
                            user.status
                        )}"
                    >
                        ${escapeHTML(
                            user.statusLabel
                        )}
                    </span>
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            user.registrationDate
                        )
                    )}
                </td>

                <td>
                    <button
                        type="button"
                        data-admin-user-open="${escapeHTML(
                            user.uid
                        )}"
                    >
                        View
                    </button>
                </td>
            </tr>
        `;
    }

    function renderUsers() {
        if (elements.tableBody) {
            elements.tableBody
                .innerHTML =
                state.visibleUsers
                    .map(
                        createUserRow
                    )
                    .join("");
        }

        setVisible(
            elements.loadingState,
            state.loading
        );

        setVisible(
            elements.emptyState,
            !state.loading &&
            state.visibleUsers
                .length ===
                0
        );

        elements.totals.forEach(
            (element) => {
                element.textContent =
                    String(
                        state.total
                    );
            }
        );

        if (
            elements.loadMoreButton
        ) {
            setVisible(
                elements.loadMoreButton,
                state.hasMore
            );

            setDisabled(
                elements.loadMoreButton,
                state.loading
            );
        }

        elements.refreshButtons
            .forEach(
                (button) => {
                    setDisabled(
                        button,
                        state.loading
                    );
                }
            );

        elements.root?.setAttribute(
            "aria-busy",
            state.loading
                ? "true"
                : "false"
        );
    }

    function renderError() {
        setVisible(
            elements.errorState,
            Boolean(
                state.error
            )
        );

        if (
            elements.errorMessage
        ) {
            elements.errorMessage
                .textContent =
                state.error
                    ?.message ||
                "";
        }
    }

    /* =====================================================
       USER DETAILS
    ===================================================== */

    function setText(
        selector,
        value
    ) {
        queryAll(selector)
            .forEach(
                (element) => {
                    element.textContent =
                        toString(value) ||
                        "—";
                }
            );
    }

    function renderSelectedUser() {
        const user =
            state.selectedUser;

        setVisible(
            elements.detailsPanel,
            Boolean(user)
        );

        elements.detailsPanel
            ?.setAttribute(
                "aria-busy",
                state.loadingDetails
                    ? "true"
                    : "false"
            );

        if (!user) {
            return;
        }

        setText(
            "[data-admin-user-detail-name]",
            user.displayName ||
            "Unnamed User"
        );

        setText(
            "[data-admin-user-detail-email]",
            user.email
        );

        setText(
            "[data-admin-user-detail-uid]",
            user.uid
        );

        setText(
            "[data-admin-user-detail-mobile]",
            user.mobileNumber
        );

        setText(
            "[data-admin-user-detail-status]",
            user.statusLabel
        );

        setText(
            "[data-admin-user-detail-referral-code]",
            user.referralCode
        );

        setText(
            "[data-admin-user-detail-registration]",
            formatDate(
                user.registrationDate
            )
        );

        setText(
            "[data-admin-user-detail-last-login]",
            formatDate(
                user.lastLoginAt
            )
        );

        setText(
            "[data-admin-user-detail-wallet-available]",
            formatMoney(
                user.wallet
                    .availableBalance
            )
        );

        setText(
            "[data-admin-user-detail-wallet-held]",
            formatMoney(
                user.wallet
                    .heldBalance
            )
        );

        setText(
            "[data-admin-user-detail-wallet-earned]",
            formatMoney(
                user.wallet
                    .totalEarned
            )
        );

        setText(
            "[data-admin-user-detail-wallet-withdrawn]",
            formatMoney(
                user.wallet
                    .totalWithdrawn
            )
        );

        const activeDaysText =
            formatActiveDays(
                user.activity
                    .activeDays,
                user.activity
                    .requiredActiveDays
            );

        setText(
            "[data-admin-user-detail-active-days], [data-admin-user-detail-active-seconds]",
            activeDaysText
        );

        setText(
            "[data-admin-user-detail-active-time]",
            activeDaysText
        );

        setText(
            "[data-admin-user-detail-referrals-total]",
            user.referralStats
                .total
        );

        setText(
            "[data-admin-user-detail-referrals-pending]",
            user.referralStats
                .pending
        );

        setText(
            "[data-admin-user-detail-referrals-qualified]",
            user.referralStats
                .qualified
        );

        setText(
            "[data-admin-user-detail-referrals-approved]",
            user.referralStats
                .approved
        );

        setText(
            "[data-admin-user-detail-referrals-rewarded]",
            user.referralStats
                .rewarded
        );

        setText(
            "[data-admin-user-detail-referrals-rejected]",
            user.referralStats
                .rejected
        );

        setText(
            "[data-admin-user-detail-referrals-valid]",
            user.referralStats
                .rewarded
        );

        setText(
            "[data-admin-user-detail-referrals-total-reward]",
            formatMoney(
                user.referralStats
                    .totalReward
            )
        );

        queryAll(
            "[data-admin-user-detail-photo]"
        ).forEach(
            (element) => {
                if (
                    element.tagName !==
                    "IMG"
                ) {
                    return;
                }

                if (user.photoURL) {
                    element.src =
                        user.photoURL;

                    element.referrerPolicy =
                        "no-referrer";
                } else {
                    element.removeAttribute(
                        "src"
                    );
                }

                element.alt =
                    user.displayName ||
                    "User";
            }
        );

        setFormValue(
            elements.profileForm,
            "userId",
            user.uid
        );

        setIdentityFieldReadOnly(
            elements.profileForm,
            "displayName",
            user.displayName
        );

        setIdentityFieldReadOnly(
            elements.profileForm,
            "name",
            user.displayName
        );

        setIdentityFieldReadOnly(
            elements.profileForm,
            "email",
            user.email
        );

        setIdentityFieldReadOnly(
            elements.profileForm,
            "mobileNumber",
            user.mobileNumber
        );

        setIdentityFieldReadOnly(
            elements.profileForm,
            "mobile",
            user.mobileNumber
        );

        setFormValue(
            elements.profileForm,
            "status",
            user.status
        );

        setFormValue(
            elements.profileForm,
            "adminNote",
            ""
        );

        const statusField =
            elements.profileForm
                ?.elements
                ?.namedItem(
                    "status"
                );

        if (statusField) {
            statusField.disabled =
                isSoleAdminUser(user);

            statusField.setAttribute(
                "aria-disabled",
                statusField.disabled
                    ? "true"
                    : "false"
            );
        }

        const profileSubmitButton =
            elements.profileForm
                ?.querySelector(
                    "[type='submit']"
                );

        if (
            profileSubmitButton
        ) {
            profileSubmitButton.disabled =
                isSoleAdminUser(user);

            profileSubmitButton
                .setAttribute(
                    "aria-disabled",
                    profileSubmitButton
                        .disabled
                        ? "true"
                        : "false"
                );
        }

        setFormValue(
            elements.walletForm,
            "userId",
            user.uid
        );

        if (
            pendingWalletOperation
                ?.userId !==
            user.uid
        ) {
            pendingWalletOperation =
                null;

            setFormValue(
                elements.walletForm,
                "operationId",
                ""
            );
        }
    }

    /* =====================================================
       SEARCH AND FILTER
    ===================================================== */

    function applyFilters() {
        const query =
            state.searchQuery
                .toLowerCase();

        state.visibleUsers =
            state.users.filter(
                (user) => {
                    if (!query) {
                        return true;
                    }

                    return [
                        user.uid,
                        user.displayName,
                        user.email,
                        user.mobileNumber,
                        user.referralCode,
                        user.status
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query);
                }
            );

        renderUsers();

        return clone(
            state.visibleUsers
        );
    }

    function setSearchQuery(value) {
        state.searchQuery =
            toString(value);

        applyFilters();
        notify();

        return getState();
    }

    async function setStatusFilter(value) {
        state.statusFilter =
            normalizeStatus(value);

        return refresh({
            status:
                state.statusFilter,

            limit:
                state.limit
        });
    }

    /* =====================================================
       LOAD USERS
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        await requireAdminAccess();

        const append =
            options.append === true;

        if (
            append &&
            (
                state.loading ||
                !state.hasMore ||
                !state.nextCursor
            )
        ) {
            return getState();
        }

        const currentRequest =
            ++requestSequence;

        const requestedLimit =
            toLimit(
                options.limit ||
                state.limit
            );

        const requestedStatus =
            append
                ? state.statusFilter
                : normalizeStatus(
                    options.status !==
                        undefined
                        ? options.status
                        : state.statusFilter
                );

        const cursor =
            append
                ? state.nextCursor
                : "";

        state.loading =
            true;

        state.limit =
            requestedLimit;

        state.statusFilter =
            requestedStatus;

        if (!append) {
            state.nextCursor =
                "";

            state.hasMore =
                false;
        }

        clearError();
        renderUsers();
        renderError();

        notify(
            EVENTS.LOADING
        );

        try {
            const payload = {
                limit:
                    requestedLimit,

                status:
                    requestedStatus
            };

            if (cursor) {
                payload.cursor =
                    cursor;
            }

            const result =
                await getAdminAPI()
                    .getAdminUsers(
                        payload
                    );

            if (
                currentRequest !==
                requestSequence
            ) {
                return getState();
            }

            const resultUsers =
                extractResultValue(
                    result,
                    "users",
                    extractResultValue(
                        result,
                        "items",
                        Array.isArray(
                            result?.data
                        )
                            ? result.data
                            : []
                    )
                );

            const pageUsers =
                normalizeUsers(
                    resultUsers
                );

            state.users =
                append
                    ? mergeUniqueUsers(
                        state.users,
                        pageUsers
                    )
                    : pageUsers;

            state.total =
                toInteger(
                    extractResultValue(
                        result,
                        "total",
                        extractResultValue(
                            result,
                            "count",
                            state.users
                                .length
                        )
                    ),
                    state.users.length
                );

            const nextCursor =
                toString(
                    extractResultValue(
                        result,
                        "nextCursor",
                        ""
                    )
                );

            const hasMore =
                extractResultValue(
                    result,
                    "hasMore",
                    false
                ) === true;

            state.nextCursor =
                hasMore
                    ? nextCursor
                    : "";

            state.hasMore =
                hasMore &&
                Boolean(nextCursor);

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();
            applyFilters();
            renderError();

            return getState();
        } catch (error) {
            if (
                currentRequest ===
                requestSequence
            ) {
                setError(error);
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                requestSequence
            ) {
                state.loading =
                    false;

                renderUsers();
                notify();
            }
        }
    }

    async function loadMore() {
        if (
            state.loading ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        return refresh({
            append:
                true,

            limit:
                state.limit
        });
    }

    /* =====================================================
       USER DETAILS
    ===================================================== */

    async function openUserDetails(
        userId
    ) {
        await requireAdminAccess();

        const uid =
            requireUserId(userId);

        const currentRequest =
            ++detailSequence;

        state.selectedUserId =
            uid;

        state.loadingDetails =
            true;

        clearError();

        const cachedUser =
            state.users.find(
                (user) =>
                    user.uid ===
                    uid
            );

        if (cachedUser) {
            state.selectedUser =
                clone(cachedUser);

            renderSelectedUser();

            notify(
                EVENTS.USER_SELECTED
            );
        }

        try {
            const result =
                await getAdminAPI()
                    .getAdminUserDetails(
                        uid,
                        {
                            limit:
                                50
                        }
                    );

            if (
                currentRequest !==
                detailSequence
            ) {
                return null;
            }

            const profile =
                result?.user ||
                result?.profile ||
                result?.data?.profile ||
                result?.data ||
                {};

            const merged = {
                ...profile,

                profile,

                wallet:
                    result?.wallet ||
                    result?.data?.wallet ||
                    profile.wallet,

                activity:
                    result?.activity ||
                    result?.data?.activity ||
                    profile.activity ||
                    profile.usingTime,

                referralStats:
                    result
                        ?.referralStats ||
                    result
                        ?.data
                        ?.referralStats ||
                    profile.referralStats ||
                    (
                        isPlainObject(
                            profile.referrals
                        )
                            ? profile.referrals
                            : {}
                    ),

                referralRecords:
                    result?.referrals ||
                    result
                        ?.data
                        ?.referrals ||
                    [],

                withdrawals:
                    result
                        ?.withdrawals ||
                    result
                        ?.data
                        ?.withdrawals ||
                    profile.withdrawals,

                transactions:
                    result
                        ?.transactions ||
                    result
                        ?.data
                        ?.transactions ||
                    profile.transactions
            };

            state.selectedUser =
                normalizeUser(
                    merged,
                    uid
                );

            state.selectedUser
                .rawDetails =
                clone(result);

            renderSelectedUser();

            notify(
                EVENTS.USER_SELECTED
            );

            return clone(
                state.selectedUser
            );
        } catch (error) {
            if (
                currentRequest ===
                detailSequence
            ) {
                setError(error);
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                detailSequence
            ) {
                state.loadingDetails =
                    false;

                renderSelectedUser();
                notify();
            }
        }
    }

    function closeUserDetails() {
        detailSequence +=
            1;

        state.selectedUserId =
            "";

        state.selectedUser =
            null;

        state.loadingDetails =
            false;

        pendingWalletOperation =
            null;

        renderSelectedUser();
        notify();

        return getState();
    }

    /* =====================================================
       UPDATE PROFILE STATUS
    ===================================================== */

    async function updateUserProfile(
        userId,
        statusOrUpdates,
        adminNote = ""
    ) {
        if (
            state.savingProfile
        ) {
            throw new Error(
                "A profile update is already in progress."
            );
        }

        await requireAdminAccess();

        const uid =
            requireUserId(
                userId ||
                state.selectedUserId
            );

        const source =
            isPlainObject(
                statusOrUpdates
            )
                ? statusOrUpdates
                : {
                    status:
                        statusOrUpdates
                };

        const status =
            requireProfileStatus(
                source.status
            );

        const note =
            requireAdminNote(
                adminNote ||
                source.adminNote ||
                source.note
            );

        if (
            isSoleAdminUser(
                state.selectedUser
            )
        ) {
            throw new Error(
                "The sole Admin account status cannot be changed."
            );
        }

        state.savingProfile =
            true;

        clearError();
        notify();

        try {
            const result =
                await getAdminAPI()
                    .updateAdminUserProfile(
                        uid,
                        status,
                        note
                    );

            await refresh({
                limit:
                    state.limit,

                status:
                    state.statusFilter
            });

            await openUserDetails(
                uid
            );

            const detail = {
                userId:
                    uid,

                status,

                result,

                message:
                    "User status updated successfully."
            };

            dispatch(
                EVENTS.USER_UPDATED,
                detail
            );

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            setError(error);

            throw error;
        } finally {
            state.savingProfile =
                false;

            notify();
        }
    }

    /* =====================================================
       IDEMPOTENT WALLET ADJUSTMENT
    ===================================================== */

    function createWalletOperationKey({
        userId,
        amount,
        direction,
        adminNote
    }) {
        return [
            userId,
            direction,
            amount,
            adminNote
        ].join("|");
    }

    function resolveWalletOperationId(
        payload,
        requestedOperationId = ""
    ) {
        const explicitOperationId =
            toString(
                requestedOperationId
            );

        if (explicitOperationId) {
            pendingWalletOperation = {
                userId:
                    payload.userId,

                key:
                    createWalletOperationKey(
                        payload
                    ),

                operationId:
                    explicitOperationId
            };

            return explicitOperationId;
        }

        const operationKey =
            createWalletOperationKey(
                payload
            );

        if (
            pendingWalletOperation &&
            pendingWalletOperation
                .key ===
                operationKey
        ) {
            return pendingWalletOperation
                .operationId;
        }

        const operationId =
            getAdminAPI()
                .createOperationId(
                    "wallet"
                );

        pendingWalletOperation = {
            userId:
                payload.userId,

            key:
                operationKey,

            operationId
        };

        return operationId;
    }

    async function adjustWallet(
        options = {}
    ) {
        if (
            state.adjustingWallet
        ) {
            throw new Error(
                "A wallet adjustment is already in progress."
            );
        }

        await requireAdminAccess();

        const userId =
            requireUserId(
                options.userId ||
                state.selectedUserId
            );

        const amount =
            normalizeWalletAmount(
                options.amount
            );

        const direction =
            normalizeWalletDirection(
                options.direction
            );

        const adminNote =
            requireAdminNote(
                options.adminNote ||
                options.note
            );

        const payload = {
            userId,
            amount,
            direction,
            adminNote
        };

        const operationId =
            resolveWalletOperationId(
                payload,
                options.operationId
            );

        state.adjustingWallet =
            true;

        clearError();
        notify();

        try {
            const result =
                await getAdminAPI()
                    .adjustAdminWallet({
                        ...payload,
                        operationId
                    });

            pendingWalletOperation =
                null;

            await refresh({
                limit:
                    state.limit,

                status:
                    state.statusFilter
            });

            await openUserDetails(
                userId
            );

            const detail = {
                userId,
                operationId,
                result,

                message:
                    "Wallet adjustment completed successfully."
            };

            dispatch(
                EVENTS.WALLET_UPDATED,
                detail
            );

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            /*
             * The same operationId remains available for a
             * retry of the same payload.
             */

            setError(error);

            throw error;
        } finally {
            state.adjustingWallet =
                false;

            notify();
        }
    }

    /* =====================================================
       FORM HANDLERS
    ===================================================== */

    function formValue(
        formData,
        name
    ) {
        return toString(
            formData.get(name)
        );
    }

    async function handleProfileSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-user-profile-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(form);

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            await updateUserProfile(
                formValue(
                    formData,
                    "userId"
                ) ||
                state.selectedUserId,

                formValue(
                    formData,
                    "status"
                ),

                formValue(
                    formData,
                    "adminNote"
                )
            );
        } catch (error) {
            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    async function handleWalletSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-user-wallet-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(form);

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            const result =
                await adjustWallet({
                    userId:
                        formValue(
                            formData,
                            "userId"
                        ) ||
                        state
                            .selectedUserId,

                    amount:
                        formValue(
                            formData,
                            "amount"
                        ),

                    direction:
                        formValue(
                            formData,
                            "direction"
                        ),

                    operationId:
                        formValue(
                            formData,
                            "operationId"
                        ),

                    adminNote:
                        formValue(
                            formData,
                            "adminNote"
                        )
                });

            if (result) {
                form.reset();

                setFormValue(
                    form,
                    "userId",
                    state.selectedUserId
                );

                setFormValue(
                    form,
                    "operationId",
                    ""
                );
            }
        } catch (error) {
            if (
                pendingWalletOperation
                    ?.operationId
            ) {
                setFormValue(
                    form,
                    "operationId",
                    pendingWalletOperation
                        .operationId
                );
            }

            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        const openButton =
            event.target.closest(
                "[data-admin-user-open]"
            );

        if (openButton) {
            event.preventDefault();

            void openUserDetails(
                openButton.dataset
                    .adminUserOpen
            ).catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message,
                        "error"
                    );
                }
            );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-user-details-close]"
            )
        ) {
            event.preventDefault();

            closeUserDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-users-refresh]"
            )
        ) {
            event.preventDefault();

            void refresh().catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message,
                        "error"
                    );
                }
            );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-users-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMore().catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message,
                        "error"
                    );
                }
            );
        }
    }

    function handleDocumentInput(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-users-search]"
            )
        ) {
            setSearchQuery(
                event.target.value
            );
        }
    }

    function handleDocumentChange(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-users-status]"
            )
        ) {
            void setStatusFilter(
                event.target.value
            ).catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message,
                        "error"
                    );
                }
            );
        }
    }

    function handleDocumentSubmit(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-user-profile-form]"
            )
        ) {
            void handleProfileSubmit(
                event
            );

            return;
        }

        if (
            event.target.matches(
                "[data-admin-user-wallet-form]"
            )
        ) {
            void handleWalletSubmit(
                event
            );
        }
    }

    function bindEvents() {
        if (controller) {
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

        document.addEventListener(
            "input",
            handleDocumentInput,
            {
                signal
            }
        );

        document.addEventListener(
            "change",
            handleDocumentChange,
            {
                signal
            }
        );

        document.addEventListener(
            "submit",
            handleDocumentSubmit,
            {
                signal
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function init() {
        if (
            state.initialized
        ) {
            cacheElements();
            renderUsers();
            renderSelectedUser();

            return getState();
        }

        state.initialized =
            true;

        cacheElements();
        bindEvents();

        state.statusFilter =
            normalizeStatus(
                elements.statusFilter
                    ?.value
            );

        state.searchQuery =
            toString(
                elements.searchInput
                    ?.value
            );

        try {
            await requireAdminAccess();
            await refresh();
        } catch (error) {
            setError(error);
        }

        return getState();
    }

    /* =====================================================
       SUBSCRIPTION
    ===================================================== */

    function subscribe(listener) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "AdminUsers subscriber must be a function."
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
       DESTROY
    ===================================================== */

    function destroy() {
        requestSequence +=
            1;

        detailSequence +=
            1;

        controller?.abort();

        controller =
            null;

        pendingWalletOperation =
            null;

        listeners.clear();

        state.initialized =
            false;

        state.loading =
            false;

        state.loadingDetails =
            false;

        state.savingProfile =
            false;

        state.adjustingWallet =
            false;

        state.users =
            [];

        state.visibleUsers =
            [];

        state.selectedUserId =
            "";

        state.selectedUser =
            null;

        state.statusFilter =
            "";

        state.searchQuery =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.total =
            0;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        Object.keys(elements)
            .forEach(
                (key) => {
                    elements[key] =
                        Array.isArray(
                            elements[key]
                        )
                            ? []
                            : null;
                }
            );

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.AdminUsers =
        Object.freeze({
            init,
            destroy,

            refresh,
            loadMore,

            setSearchQuery,
            setStatusFilter,

            openUserDetails,
            closeUserDetails,

            updateUserProfile,
            adjustWallet,

            getState,

            getUsers() {
                return clone(
                    state.users
                );
            },

            getVisibleUsers() {
                return clone(
                    state.visibleUsers
                );
            },

            getSelectedUser() {
                return clone(
                    state.selectedUser
                );
            },

            normalizeUser,
            normalizeUsers,
            normalizeActivity,
            normalizeStatus,
            getStatusLabel,

            formatMoney,
            formatDate,
            formatActiveDays,

            /*
             * Legacy compatibility export.
             */
            formatDuration,

            subscribe,

            EVENTS,
            ALLOWED_STATUSES,
            WALLET_DIRECTIONS,
            REQUIRED_ACTIVE_DAYS
        });
})(
    window,
    document
);