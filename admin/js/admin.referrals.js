"use strict";

/* =========================================================
   11PLAY — ADMIN REFERRALS MODULE
   File: admin/js/admin.referrals.js

   Responsibilities:
   - Load referrals qualified for Admin review
   - Search loaded referral records
   - Load qualified referrals through cursor-based pagination
   - Display referrer and referred-user information
   - Display Verified Google, unique-mobile, Unique Web Device
     and Eligible Active Days status
   - Display the 7 days × 2 eligible hours/day activity policy
   - Approve or reject a qualified referral
   - Keep Admin notes optional for referral decisions
   - Refresh referral queue after each decision
   - Notify Admin Dashboard after a decision
   - Never access Firestore directly

   Final qualification model:
   - Verified unique Google-connected account
   - Globally unique Bangladesh mobile number
   - Unique Web Device binding / Device Anti-Abuse Layer
   - 7 different eligible Bangladesh calendar dates
   - Minimum 2 eligible hours (7200 accepted seconds) per date

   Important:
   - Qualified means Pending Admin review
   - Qualified does not automatically credit the wallet
   - FunctionsClient + Firestore Rules revalidate eligibility
   - Reward credit remains atomic and idempotent
   - Partial activity never counts as a partial Active Day
   - Browser time is never eligibility authority here
   - Device ID is a browser-installation binding, not a physical
     hardware identifier
   - Legacy seconds are compatibility-only
========================================================= */

(function initializeAdminReferrals(window, document) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT = 50;
    const MAXIMUM_LIMIT = 100;

    const DEFAULT_REQUIRED_ACTIVE_DAYS = 7;

    const DEFAULT_REQUIRED_DAILY_SECONDS =
        2 * 60 * 60;

    const DEFAULT_REQUIRED_DAILY_MINUTES =
        DEFAULT_REQUIRED_DAILY_SECONDS / 60;

    const DEFAULT_REQUIRED_ACTIVE_SECONDS =
        DEFAULT_REQUIRED_ACTIVE_DAYS *
        DEFAULT_REQUIRED_DAILY_SECONDS;

    const ACTIVITY_POLICY_VERSION = 2;

    /*
     * Legacy Schema-v2 compatibility only.
     * These values must never drive current qualification.
     */

    const LEGACY_SECONDS_PER_DAY =
        24 * 60 * 60;

    const LEGACY_REQUIRED_ACTIVE_SECONDS =
        DEFAULT_REQUIRED_ACTIVE_DAYS *
        LEGACY_SECONDS_PER_DAY;

    const DEFAULT_REWARD_AMOUNT = 1000;

    const REVIEWABLE_STATUS =
        "qualified";

    const CANONICAL_STATUSES =
        Object.freeze([
            "pending",
            "qualified",

            /*
             * Historical compatibility only.
             */
            "approved",

            "rewarded",
            "rejected"
        ]);

    const EVENTS =
        Object.freeze({
            UPDATED:
                "admin-referrals:updated",

            LOADING:
                "admin-referrals:loading",

            ERROR:
                "admin-referrals:error",

            SELECTED:
                "admin-referrals:selected",

            ACTION_STARTED:
                "admin-referrals:action-started",

            ACTION_COMPLETED:
                "admin-referrals:action-completed",

            REFERRAL_UPDATED:
                "admin:referral-updated"
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

        actionInProgress:
            false,

        actionReferralId:
            "",

        actionType:
            "",

        referrals:
            [],

        visibleReferrals:
            [],

        selectedReferralId:
            "",

        selectedReferral:
            null,

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

        pendingRewardAmount:
            0,

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

        searchInput:
            null,

        totalElements:
            [],

        pendingRewardElements:
            [],

        refreshButtons:
            [],

        loadMoreButton:
            null,

        detailsPanel:
            null,

        approveForm:
            null,

        rejectForm:
            null
    };

    let requestSequence =
        0;

    let selectionSequence =
        0;

    let controller =
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
            !Number.isSafeInteger(
                number
            ) ||
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

    function toSafeLimit(value) {
        return Math.min(
            MAXIMUM_LIMIT,
            Math.max(
                1,
                Math.floor(
                    toSafeNumber(
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

    function safeAdd(
        firstValue,
        secondValue
    ) {
        const total =
            toNonNegativeInteger(
                firstValue
            ) +
            toNonNegativeInteger(
                secondValue
            );

        return Number.isSafeInteger(
            total
        )
            ? total
            : Number.MAX_SAFE_INTEGER;
    }

    function cloneValue(value) {
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

    function normalizeError(error) {
        const rawCode =
            toSafeString(
                error?.code
            );

        const detailsMessage =
            toSafeString(
                error?.details?.message ||
                error?.data?.message
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
                detailsMessage ||
                toSafeString(
                    error?.message
                ) ||
                "Referral operation could not be completed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function escapeHTML(value) {
        return toSafeString(value)
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
            toSafeString(value);

        if (!photoURL) {
            return "";
        }

        try {
            const resolvedURL =
                new URL(
                    photoURL,
                    window.location.href
                );

            return resolvedURL.protocol ===
                "https:"
                ? resolvedURL.href
                : "";
        } catch {
            return "";
        }
    }

    function requireReferralId(value) {
        const referralId =
            toSafeString(value);

        if (!referralId) {
            throw new TypeError(
                "referralId is required."
            );
        }

        if (
            referralId.length >
                128 ||
            !/^[A-Za-z0-9_-]+$/.test(
                referralId
            )
        ) {
            throw new TypeError(
                "referralId is invalid."
            );
        }

        return referralId;
    }

    function normalizeOptionalAdminNote(
        value
    ) {
        const note =
            toSafeString(value);

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

    function formatMoney(value) {
        const amount =
            toNonNegativeInteger(
                value
            );

        return `৳${new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(amount)}`;
    }

    function formatDate(value) {
        const timestamp =
            serializeTimestamp(
                value
            );

        if (!timestamp) {
            return "—";
        }

        try {
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
                        true,

                    timeZone:
                        "Asia/Dhaka"
                }
            ).format(
                new Date(timestamp)
            );
        } catch {
            return "—";
        }
    }

    function formatActiveDays(
        activeDays,
        requiredActiveDays =
            DEFAULT_REQUIRED_ACTIVE_DAYS
    ) {
        const requiredDays =
            Math.max(
                1,
                toNonNegativeInteger(
                    requiredActiveDays,
                    DEFAULT_REQUIRED_ACTIVE_DAYS
                ) ||
                DEFAULT_REQUIRED_ACTIVE_DAYS
            );

        const completedDays =
            Math.min(
                requiredDays,
                toNonNegativeInteger(
                    activeDays
                )
            );

        return `${completedDays} / ${requiredDays}`;
    }

    function formatEligibleMinutes(
        seconds,
        requiredDailySeconds =
            DEFAULT_REQUIRED_DAILY_SECONDS
    ) {
        const dailySeconds =
            Math.max(
                1,
                toNonNegativeInteger(
                    requiredDailySeconds,
                    DEFAULT_REQUIRED_DAILY_SECONDS
                ) ||
                DEFAULT_REQUIRED_DAILY_SECONDS
            );

        const acceptedSeconds =
            Math.min(
                dailySeconds,
                toNonNegativeInteger(
                    seconds
                )
            );

        const minutes =
            Math.floor(
                acceptedSeconds /
                60
            );

        const requiredMinutes =
            Math.floor(
                dailySeconds /
                60
            );

        return `${minutes} / ${requiredMinutes} min`;
    }

    function formatDeviceId(value) {
        const deviceId =
            toSafeString(value)
                .toLowerCase();

        if (!deviceId) {
            return "—";
        }

        if (
            deviceId.length <=
            20
        ) {
            return deviceId;
        }

        return `${deviceId.slice(
            0,
            8
        )}…${deviceId.slice(-8)}`;
    }

    /*
     * Legacy compatibility helper only.
     *
     * This does not participate in current referral
     * eligibility.
     */

    function formatDuration(
        totalSeconds
    ) {
        const seconds =
            toNonNegativeInteger(
                totalSeconds
            );

        const days =
            Math.floor(
                seconds /
                86400
            );

        const hours =
            Math.floor(
                (
                    seconds %
                    86400
                ) /
                3600
            );

        const minutes =
            Math.floor(
                (
                    seconds %
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

    async function refreshDashboardSummary() {
        const adminApp =
            window.AdminApp;

        const refreshMethod =
            adminApp
                ?.refreshDashboardSummary ||
            adminApp
                ?.refreshSummary ||
            adminApp
                ?.refreshDashboard;

        if (
            typeof refreshMethod !==
            "function"
        ) {
            return null;
        }

        try {
            return await refreshMethod
                .call(adminApp);
        } catch (error) {
            console.warn(
                "[AdminReferrals] Dashboard summary refresh failed.",
                error
            );

            return null;
        }
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function normalizeProfile(
        profile,
        fallbackUid = ""
    ) {
        const source =
            isPlainObject(profile)
                ? profile
                : {};

        const providerIds =
            Array.isArray(
                source.providerIds
            )
                ? source.providerIds
                    .map(
                        toSafeString
                    )
                    .filter(
                        Boolean
                    )
                : [];

        const googleConnected =
            source.googleConnected ===
                true ||
            source.isGoogleConnected ===
                true ||
            source.isGoogleSignIn ===
                true ||
            providerIds.includes(
                "google.com"
            ) ||
            toSafeString(
                source.signInProvider
            ).toLowerCase() ===
                "google.com" ||
            toSafeString(
                source.accountType
            ).toLowerCase() ===
                "google";

        const deviceId =
            toSafeString(
                source.deviceId ||
                source.webDeviceId
            ).toLowerCase();

        const deviceBound =
            source.deviceBound ===
                true ||
            source.deviceAdded ===
                true ||
            source.deviceLocked ===
                true ||
            source.uniqueDeviceBound ===
                true ||
            Boolean(deviceId);

        return Object.freeze({
            uid:
                toSafeString(
                    source.uid ||
                    source.userId ||
                    source.id ||
                    fallbackUid
                ),

            displayName:
                toSafeString(
                    source.displayName ||
                    source.name
                ),

            name:
                toSafeString(
                    source.name ||
                    source.displayName
                ),

            email:
                toSafeString(
                    source.email
                ).toLowerCase(),

            photoURL:
                normalizePhotoURL(
                    source.photoURL ||
                    source.photo
                ),

            mobileNumber:
                toSafeString(
                    source.mobileNumber ||
                    source.mobile
                ),

            mobileLocked:
                source.mobileLocked ===
                    true ||
                source.isMobileLocked ===
                    true ||
                source.mobileNumberLocked ===
                    true ||
                Boolean(
                    toSafeString(
                        source.mobileNumber ||
                        source.mobile
                    )
                ),

            googleConnected,

            emailVerified:
                source.emailVerified ===
                    true ||
                source.isEmailVerified ===
                    true,

            accountType:
                toSafeString(
                    source.accountType ||
                    (
                        googleConnected
                            ? "google"
                            : ""
                    )
                ).toLowerCase(),

            referralCode:
                toSafeString(
                    source.referralCode
                ).toUpperCase(),

            deviceId,
            deviceBound,

            registrationDate:
                serializeTimestamp(
                    source.registrationDate ||
                    source.createdAt
                )
        });
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

        const aliases = {
            observing:
                "pending",

            pending_review:
                "qualified",

            pending_admin:
                "qualified",

            pending_admin_review:
                "qualified",

            eligible:
                "qualified",

            valid:
                "rewarded",

            success:
                "rewarded",

            completed:
                "rewarded",

            invalid:
                "rejected"
        };

        const canonicalStatus =
            aliases[status] ||
            status;

        return CANONICAL_STATUSES
            .includes(
                canonicalStatus
            )
                ? canonicalStatus
                : "";
    }

    function getStatusLabel(value) {
        switch (
            normalizeStatus(value)
        ) {
            case "pending":
                return "Pending";

            case "qualified":
                return "Pending Admin";

            case "approved":
                return "Legacy Approved";

            case "rewarded":
                return "Rewarded";

            case "rejected":
                return "Rejected";

            default:
                return "Pending";
        }
    }

    /* =====================================================
       ACTIVITY NORMALIZATION
    ===================================================== */

    function hasExplicitActiveDayValue(
        activity,
        eligibility
    ) {
        const candidates = [
            activity
                ?.eligibleActiveDays,

            activity
                ?.activeDays,

            activity
                ?.totalActiveDays,

            activity
                ?.completedActiveDays,

            eligibility
                ?.eligibleActiveDays,

            eligibility
                ?.activeDays,

            eligibility
                ?.completedActiveDays
        ];

        return candidates.some(
            value =>
                value !== null &&
                value !== undefined &&
                value !== ""
        );
    }

    function legacyActivityToActiveDays(
        source,
        requiredActiveDays =
            DEFAULT_REQUIRED_ACTIVE_DAYS
    ) {
        const activity =
            isPlainObject(source)
                ? source
                : {};

        const policyVersion =
            toNonNegativeInteger(
                activity
                    .activityPolicyVersion ||
                activity
                    .policyVersion
            );

        /*
         * Current policy must never derive eligible
         * days from accumulated seconds.
         */

        if (
            policyVersion >=
            ACTIVITY_POLICY_VERSION
        ) {
            return 0;
        }

        const legacyCompleted =
            activity.completed ===
                true ||
            activity.activityCompleted ===
                true ||
            activity.usingTimeCompleted ===
                true ||
            activity.requirementCompleted ===
                true;

        const legacySeconds =
            toNonNegativeInteger(
                activity
                    .legacyTotalActiveSeconds ??
                activity
                    .totalActiveSeconds ??
                activity
                    .activeSeconds
            );

        const legacyRequiredSeconds =
            toNonNegativeInteger(
                activity
                    .legacyRequiredActiveSeconds ??
                activity
                    .requiredActiveSeconds,
                LEGACY_REQUIRED_ACTIVE_SECONDS
            ) ||
            LEGACY_REQUIRED_ACTIVE_SECONDS;

        /*
         * Legacy partial seconds never create partial
         * Eligible Active Day credit.
         */

        if (
            legacyCompleted ||
            legacySeconds >=
                legacyRequiredSeconds
        ) {
            return Math.max(
                1,
                toNonNegativeInteger(
                    requiredActiveDays,
                    DEFAULT_REQUIRED_ACTIVE_DAYS
                ) ||
                DEFAULT_REQUIRED_ACTIVE_DAYS
            );
        }

        return 0;
    }

    function normalizeActivity(
        source,
        eligibility = {}
    ) {
        const activity =
            isPlainObject(source)
                ? source
                : {};

        const eligibilitySource =
            isPlainObject(eligibility)
                ? eligibility
                : {};

        const requiredActiveDays =
            Math.max(
                1,
                toNonNegativeInteger(
                    activity
                        .requiredActiveDays ??
                    eligibilitySource
                        .requiredActiveDays,
                    DEFAULT_REQUIRED_ACTIVE_DAYS
                ) ||
                DEFAULT_REQUIRED_ACTIVE_DAYS
            );

        const requiredDailySeconds =
            Math.max(
                1,
                toNonNegativeInteger(
                    activity
                        .requiredDailySeconds ??
                    eligibilitySource
                        .requiredDailySeconds,
                    DEFAULT_REQUIRED_DAILY_SECONDS
                ) ||
                DEFAULT_REQUIRED_DAILY_SECONDS
            );

        const activityPolicyVersion =
            toNonNegativeInteger(
                activity
                    .activityPolicyVersion ??
                eligibilitySource
                    .activityPolicyVersion ??
                activity
                    .policyVersion ??
                eligibilitySource
                    .policyVersion
            );

        const explicitActiveDays =
            hasExplicitActiveDayValue(
                activity,
                eligibilitySource
            );

        const legacyActiveDays =
            explicitActiveDays
                ? 0
                : legacyActivityToActiveDays(
                    {
                        ...eligibilitySource,
                        ...activity
                    },
                    requiredActiveDays
                );

        const activeDays =
            Math.min(
                requiredActiveDays,
                toNonNegativeInteger(
                    activity
                        .eligibleActiveDays ??
                    activity
                        .activeDays ??
                    activity
                        .totalActiveDays ??
                    activity
                        .completedActiveDays ??
                    eligibilitySource
                        .eligibleActiveDays ??
                    eligibilitySource
                        .activeDays ??
                    eligibilitySource
                        .completedActiveDays,
                    legacyActiveDays
                )
            );

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays -
                activeDays
            );

        const currentDaySeconds =
            Math.min(
                requiredDailySeconds,
                toNonNegativeInteger(
                    activity
                        .currentDaySeconds ??
                    activity
                        .todayActiveSeconds ??
                    eligibilitySource
                        .currentDaySeconds ??
                    eligibilitySource
                        .todayActiveSeconds
                )
            );

        const currentDayCompleted =
            activity.currentDayCompleted ===
                true ||
            eligibilitySource
                .currentDayCompleted ===
                true ||
            currentDaySeconds >=
                requiredDailySeconds;

        const completed =
            activity.completed ===
                true ||
            activity.activityCompleted ===
                true ||
            activity.requirementCompleted ===
                true ||
            eligibilitySource
                .activityCompleted ===
                true ||
            eligibilitySource
                .usingTimeCompleted ===
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
                    ) *
                    100,
                    0,
                    100
                );

        const dailyProgressPercent =
            currentDayCompleted
                ? 100
                : clamp(
                    (
                        currentDaySeconds /
                        requiredDailySeconds
                    ) *
                    100,
                    0,
                    100
                );

        /*
         * currentDaySeconds is partial accepted activity.
         * A completed current day is already included in
         * activeDays, so it must not be double-counted.
         */

        const compatibilityPartialSeconds =
            currentDayCompleted
                ? 0
                : currentDaySeconds;

        const totalActiveSeconds =
            safeAdd(
                activeDays *
                    requiredDailySeconds,
                compatibilityPartialSeconds
            );

        const requiredActiveSeconds =
            requiredActiveDays *
            requiredDailySeconds;

        return Object.freeze({
            activeDays,

            eligibleActiveDays:
                activeDays,

            requiredActiveDays,

            remainingActiveDays,

            currentDayKey:
                toSafeString(
                    activity
                        .currentDayKey ||
                    eligibilitySource
                        .currentDayKey
                ),

            currentDaySeconds,

            currentDayMinutes:
                Math.floor(
                    currentDaySeconds /
                    60
                ),

            currentDayCompleted,

            requiredDailySeconds,

            requiredDailyMinutes:
                Math.floor(
                    requiredDailySeconds /
                    60
                ),

            remainingTodaySeconds:
                Math.max(
                    0,
                    requiredDailySeconds -
                    currentDaySeconds
                ),

            dailyProgressPercent,
            progressPercent,
            completed,

            completedAt:
                serializeTimestamp(
                    activity
                        .completedAt ||
                    eligibilitySource
                        .completedAt
                ),

            lastCheckpointAt:
                serializeTimestamp(
                    activity
                        .lastCheckpointAt ||
                    eligibilitySource
                        .lastCheckpointAt
                ),

            lastActiveAt:
                serializeTimestamp(
                    activity
                        .lastActiveAt ||
                    activity
                        .lastEligibleAt ||
                    activity
                        .lastActivityAt ||
                    eligibilitySource
                        .lastActiveAt
                ),

            activityPolicyVersion:
                activityPolicyVersion ||
                (
                    explicitActiveDays
                        ? ACTIVITY_POLICY_VERSION
                        : 0
                ),

            /*
             * Compatibility aliases under the CURRENT
             * 2-hours-per-day model.
             */

            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds:
                Math.max(
                    0,
                    requiredActiveSeconds -
                    totalActiveSeconds
                )
        });
    }

    /* =====================================================
       GOOGLE ELIGIBILITY
    ===================================================== */

    function normalizeGoogleEligibility(
        source,
        eligibility,
        referredProfile,
        status
    ) {
        const googleConnected =
            source.googleConnected ===
                true ||
            source.isGoogleConnected ===
                true ||
            eligibility.googleConnected ===
                true ||
            eligibility.isGoogleConnected ===
                true ||
            referredProfile
                .googleConnected ===
                true;

        const explicitVerifiedGoogle =
            source.googleVerified ===
                true ||
            source.verifiedGoogle ===
                true ||
            source.verifiedGoogleAccount ===
                true ||
            eligibility.googleVerified ===
                true ||
            eligibility.verifiedGoogle ===
                true ||
            eligibility
                .verifiedGoogleAccount ===
                true;

        const profileVerifiedGoogle =
            googleConnected &&
            referredProfile
                .emailVerified ===
                true;

        /*
         * Compatibility fallback for already-qualified
         * backend records that predate explicit
         * googleVerified projection.
         */

        const backendQualifiedGoogle =
            googleConnected &&
            (
                status ===
                    "qualified" ||
                status ===
                    "rewarded"
            );

        return Object.freeze({
            googleConnected,

            googleVerified:
                explicitVerifiedGoogle ||
                profileVerifiedGoogle ||
                backendQualifiedGoogle
        });
    }

    /* =====================================================
       MOBILE ELIGIBILITY
    ===================================================== */

    function normalizeMobileEligibility(
        source,
        eligibility,
        referredProfile,
        status
    ) {
        const mobileAdded =
            source.mobileAdded ===
                true ||
            source.mobileLocked ===
                true ||
            source.mobileNumberLocked ===
                true ||
            eligibility.mobileAdded ===
                true ||
            eligibility.mobileLocked ===
                true ||
            referredProfile
                .mobileLocked ===
                true ||
            Boolean(
                referredProfile
                    .mobileNumber
            );

        const explicitUniqueMobile =
            source.mobileUnique ===
                true ||
            source.uniqueMobile ===
                true ||
            source.mobileReserved ===
                true ||
            source.mobileReservationValid ===
                true ||
            source.mobileVerifiedUnique ===
                true ||
            eligibility.mobileUnique ===
                true ||
            eligibility.uniqueMobile ===
                true ||
            eligibility.mobileReserved ===
                true ||
            eligibility
                .mobileReservationValid ===
                true ||
            eligibility
                .mobileVerifiedUnique ===
                true;

        /*
         * Qualified/rewarded records passed the backend
         * uniqueness check. This fallback is display-only.
         */

        const backendQualifiedMobile =
            mobileAdded &&
            (
                status ===
                    "qualified" ||
                status ===
                    "rewarded"
            );

        return Object.freeze({
            mobileAdded,

            mobileUnique:
                explicitUniqueMobile ||
                backendQualifiedMobile
        });
    }

    /* =====================================================
       UNIQUE WEB DEVICE ELIGIBILITY
    ===================================================== */

    function normalizeDeviceEligibility(
        source,
        eligibility,
        referredProfile,
        status
    ) {
        const deviceId =
            toSafeString(
                source.deviceId ||
                source.webDeviceId ||
                eligibility.deviceId ||
                eligibility.webDeviceId ||
                referredProfile.deviceId
            ).toLowerCase();

        const deviceAdded =
            source.deviceAdded ===
                true ||
            source.deviceBound ===
                true ||
            source.deviceLocked ===
                true ||
            eligibility.deviceAdded ===
                true ||
            eligibility.deviceBound ===
                true ||
            eligibility.deviceLocked ===
                true ||
            referredProfile.deviceBound ===
                true ||
            Boolean(deviceId);

        const explicitUniqueDevice =
            source.deviceUnique ===
                true ||
            source.uniqueDevice ===
                true ||
            source.deviceReserved ===
                true ||
            source.deviceReservationValid ===
                true ||
            source.deviceBindingValid ===
                true ||
            source.uniqueDeviceBound ===
                true ||
            eligibility.deviceUnique ===
                true ||
            eligibility.uniqueDevice ===
                true ||
            eligibility.deviceReserved ===
                true ||
            eligibility
                .deviceReservationValid ===
                true ||
            eligibility
                .deviceBindingValid ===
                true ||
            eligibility
                .uniqueDeviceBound ===
                true;

        /*
         * This represents the browser-installation reservation
         * used by the Device Anti-Abuse Layer. It is not a
         * physical hardware ID.
         */

        const backendQualifiedDevice =
            deviceAdded &&
            (
                status ===
                    "qualified" ||
                status ===
                    "rewarded"
            );

        return Object.freeze({
            deviceId,
            deviceAdded,

            deviceBound:
                deviceAdded,

            deviceUnique:
                explicitUniqueDevice ||
                backendQualifiedDevice
        });
    }

    /* =====================================================
       REFERRAL NORMALIZATION
    ===================================================== */

    function normalizeReferral(
        referral,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(referral)
                ? referral
                : {};

        const eligibility =
            isPlainObject(
                source.eligibility
            )
                ? source.eligibility
                : {};

        const requirements =
            isPlainObject(
                source.requirements
            )
                ? source.requirements
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
                    : {};

        const referrerSource =
            source.referrerProfile ||
            source.referrerUser ||
            source.referrer ||
            {};

        const referredSource =
            source.referredProfile ||
            source.referredUser ||
            source.referred ||
            {};

        const referralId =
            toSafeString(
                source.referralId ||
                source.id ||
                fallbackId
            );

        const referrerUid =
            toSafeString(
                source.referrerUid ||
                source.referrerId ||
                referrerSource.uid ||
                referrerSource.userId
            );

        const referredUid =
            toSafeString(
                source.referredUid ||
                source.referredId ||
                referredSource.uid ||
                referredSource.userId
            );

        const referrerProfile =
            normalizeProfile(
                referrerSource,
                referrerUid
            );

        const referredProfile =
            normalizeProfile(
                referredSource,
                referredUid
            );

        let status =
            normalizeStatus(
                source.status
            );

        if (!status) {
            const looksQualified =
                source.qualified ===
                    true ||
                source.pendingReview ===
                    true ||
                Boolean(
                    source.qualifiedAt ||
                    source.eligibleAt
                );

            status =
                looksQualified
                    ? "qualified"
                    : "pending";
        }

        const mergedEligibility = {
            ...requirements,
            ...eligibility
        };

        const activity =
            normalizeActivity(
                {
                    ...activitySource,

                    activeDays:
                        activitySource
                            .activeDays ??
                        source.activeDays ??
                        source
                            .eligibleActiveDays ??
                        requirements
                            .activeDays,

                    eligibleActiveDays:
                        activitySource
                            .eligibleActiveDays ??
                        source
                            .eligibleActiveDays ??
                        requirements
                            .eligibleActiveDays,

                    requiredActiveDays:
                        activitySource
                            .requiredActiveDays ??
                        source
                            .requiredActiveDays ??
                        requirements
                            .requiredActiveDays,

                    requiredDailySeconds:
                        activitySource
                            .requiredDailySeconds ??
                        source
                            .requiredDailySeconds ??
                        requirements
                            .requiredDailySeconds,

                    currentDaySeconds:
                        activitySource
                            .currentDaySeconds ??
                        source
                            .currentDaySeconds,

                    currentDayCompleted:
                        activitySource
                            .currentDayCompleted ??
                        source
                            .currentDayCompleted,

                    activityPolicyVersion:
                        activitySource
                            .activityPolicyVersion ??
                        source
                            .activityPolicyVersion ??
                        requirements
                            .activityPolicyVersion,

                    activityCompleted:
                        activitySource
                            .activityCompleted ??
                        source
                            .activityCompleted,

                    completed:
                        activitySource
                            .completed ??
                        source
                            .usingTimeCompleted,

                    totalActiveSeconds:
                        activitySource
                            .totalActiveSeconds ??
                        source
                            .totalActiveSeconds ??
                        source
                            .activeSeconds,

                    requiredActiveSeconds:
                        activitySource
                            .requiredActiveSeconds ??
                        source
                            .requiredActiveSeconds
                },
                mergedEligibility
            );

        const googleEligibility =
            normalizeGoogleEligibility(
                source,
                mergedEligibility,
                referredProfile,
                status
            );

        const mobileEligibility =
            normalizeMobileEligibility(
                source,
                mergedEligibility,
                referredProfile,
                status
            );

        const deviceEligibility =
            normalizeDeviceEligibility(
                source,
                mergedEligibility,
                referredProfile,
                status
            );

        const policyMatches =
            activity.requiredActiveDays ===
                DEFAULT_REQUIRED_ACTIVE_DAYS &&
            activity.requiredDailySeconds ===
                DEFAULT_REQUIRED_DAILY_SECONDS &&
            activity.activityPolicyVersion >=
                ACTIVITY_POLICY_VERSION;

        const requirementEligible =
            googleEligibility
                .googleVerified &&
            mobileEligibility
                .mobileUnique &&
            deviceEligibility
                .deviceUnique &&
            activity.completed &&
            policyMatches;

        const backendEligible =
            source.eligible ===
                true ||
            source.isEligible ===
                true ||
            eligibility.eligible ===
                true ||
            status ===
                "qualified" ||
            status ===
                "rewarded";

        const rewardAmount =
            toNonNegativeInteger(
                source.rewardAmount ??
                source.reward ??
                source.amount,
                DEFAULT_REWARD_AMOUNT
            ) ||
            DEFAULT_REWARD_AMOUNT;

        return Object.freeze({
            id:
                referralId,

            referralId,
            referrerUid,
            referredUid,

            referralCode:
                toSafeString(
                    source.referralCode ||
                    source.code
                ).toUpperCase(),

            status,

            statusLabel:
                getStatusLabel(
                    status
                ),

            reviewable:
                status ===
                REVIEWABLE_STATUS,

            googleConnected:
                googleEligibility
                    .googleConnected,

            googleVerified:
                googleEligibility
                    .googleVerified,

            mobileAdded:
                mobileEligibility
                    .mobileAdded,

            mobileUnique:
                mobileEligibility
                    .mobileUnique,

            deviceId:
                deviceEligibility
                    .deviceId,

            deviceAdded:
                deviceEligibility
                    .deviceAdded,

            deviceBound:
                deviceEligibility
                    .deviceBound,

            deviceUnique:
                deviceEligibility
                    .deviceUnique,

            activity,

            activeDays:
                activity.activeDays,

            eligibleActiveDays:
                activity
                    .eligibleActiveDays,

            requiredActiveDays:
                activity
                    .requiredActiveDays,

            remainingActiveDays:
                activity
                    .remainingActiveDays,

            requiredDailySeconds:
                activity
                    .requiredDailySeconds,

            requiredDailyMinutes:
                activity
                    .requiredDailyMinutes,

            currentDaySeconds:
                activity
                    .currentDaySeconds,

            currentDayMinutes:
                activity
                    .currentDayMinutes,

            currentDayCompleted:
                activity
                    .currentDayCompleted,

            activityPolicyVersion:
                activity
                    .activityPolicyVersion,

            activityCompleted:
                activity.completed,

            /*
             * Historical alias.
             */
            usingTimeCompleted:
                activity.completed,

            policyMatches,

            requirementEligible,

            eligible:
                backendEligible ||
                requirementEligible,

            rewardAmount,

            rewardGranted:
                source.rewardGranted ===
                    true ||
                source.rewardCredited ===
                    true ||
                status ===
                    "rewarded",

            referrerProfile,
            referredProfile,

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            observedAt:
                serializeTimestamp(
                    source.observedAt ||
                    source.capturedAt
                ),

            qualifiedAt:
                serializeTimestamp(
                    source.qualifiedAt ||
                    source.eligibleAt
                ),

            approvedAt:
                serializeTimestamp(
                    source.approvedAt
                ),

            rewardedAt:
                serializeTimestamp(
                    source.rewardedAt ||
                    source.rewardGrantedAt
                ),

            rejectedAt:
                serializeTimestamp(
                    source.rejectedAt
                ),

            reviewedAt:
                serializeTimestamp(
                    source.reviewedAt
                ),

            adminNote:
                toSafeString(
                    source.adminNote ||
                    source.reason
                ),

            /*
             * Compatibility aliases under the current
             * 7 × 2-hour model.
             */

            activeSeconds:
                activity
                    .totalActiveSeconds,

            totalActiveSeconds:
                activity
                    .totalActiveSeconds,

            requiredActiveSeconds:
                activity
                    .requiredActiveSeconds,

            remainingActiveSeconds:
                activity
                    .remainingActiveSeconds,

            raw:
                cloneValue(source)
        });
    }

    function normalizeReferrals(
        referrals
    ) {
        if (
            !Array.isArray(
                referrals
            )
        ) {
            return [];
        }

        return referrals
            .map(
                referral =>
                    normalizeReferral(
                        referral,
                        referral?.id
                    )
            )
            .filter(
                referral =>
                    Boolean(
                        referral
                            .referralId
                    )
            );
    }

    function mergeUniqueReferrals(
        existingReferrals,
        incomingReferrals
    ) {
        const referralsById =
            new Map();

        [
            ...(
                Array.isArray(
                    existingReferrals
                )
                    ? existingReferrals
                    : []
            ),

            ...(
                Array.isArray(
                    incomingReferrals
                )
                    ? incomingReferrals
                    : []
            )
        ].forEach(
            referral => {
                const referralId =
                    toSafeString(
                        referral
                            ?.referralId ||
                        referral
                            ?.id
                    );

                if (referralId) {
                    referralsById.set(
                        referralId,
                        referral
                    );
                }
            }
        );

        return Array.from(
            referralsById.values()
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

    function extractReferralArray(result) {
        if (
            Array.isArray(result)
        ) {
            return result;
        }

        if (
            Array.isArray(
                result?.referrals
            )
        ) {
            return result.referrals;
        }

        if (
            Array.isArray(
                result?.items
            )
        ) {
            return result.items;
        }

        if (
            Array.isArray(
                result?.data
            )
        ) {
            return result.data;
        }

        if (
            Array.isArray(
                result
                    ?.data
                    ?.referrals
            )
        ) {
            return result
                .data
                .referrals;
        }

        if (
            Array.isArray(
                result
                    ?.data
                    ?.items
            )
        ) {
            return result
                .data
                .items;
        }

        return [];
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return cloneValue(
            state
        );
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
                        cloneValue(
                            detail
                        )
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
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[AdminReferrals] Subscriber failed.",
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
            normalizeError(
                error
            );

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
            document.querySelectorAll(
                selector
            )
        );
    }

    function cacheElements() {
        elements.root =
            document.querySelector(
                "[data-admin-referrals]"
            );

        elements.tableBody =
            document.querySelector(
                "[data-admin-referrals-body]"
            );

        elements.loadingState =
            document.querySelector(
                "[data-admin-referrals-loading]"
            );

        elements.emptyState =
            document.querySelector(
                "[data-admin-referrals-empty]"
            );

        elements.errorState =
            document.querySelector(
                "[data-admin-referrals-error]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-referrals-error-message]"
            );

        elements.searchInput =
            document.querySelector(
                "[data-admin-referrals-search]"
            );

        elements.totalElements =
            queryAll(
                "[data-admin-referrals-total]"
            );

        elements.pendingRewardElements =
            queryAll(
                "[data-admin-referrals-pending-reward]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-referrals-refresh]"
            );

        elements.loadMoreButton =
            document.querySelector(
                "[data-admin-referrals-load-more]"
            );

        elements.detailsPanel =
            document.querySelector(
                "[data-admin-referral-details]"
            );

        elements.approveForm =
            document.querySelector(
                "[data-admin-referral-approve-form]"
            );

        elements.rejectForm =
            document.querySelector(
                "[data-admin-referral-reject-form]"
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

    function setText(
        selector,
        value
    ) {
        queryAll(selector)
            .forEach(
                element => {
                    element.textContent =
                        toSafeString(
                            value
                        ) ||
                        "—";
                }
            );
    }

    function setFormValue(
        form,
        fieldName,
        value
    ) {
        const field =
            form
                ?.elements
                ?.namedItem(
                    fieldName
                );

        if (field) {
            field.value =
                toSafeString(
                    value
                );
        }
    }

    /* =====================================================
       TABLE RENDERING
    ===================================================== */

    function createEligibilityBadge(
        completed,
        trueLabel,
        falseLabel
    ) {
        return `
            <span
                class="admin-status-badge ${
                    completed
                        ? "is-success"
                        : "is-warning"
                }"
            >
                ${escapeHTML(
                    completed
                        ? trueLabel
                        : falseLabel
                )}
            </span>
        `;
    }

    function createProfileIdentity(
        profile,
        fallbackText
    ) {
        const displayName =
            profile.displayName ||
            profile.email ||
            fallbackText;

        const safePhotoURL =
            normalizePhotoURL(
                profile.photoURL
            );

        const avatar =
            safePhotoURL
                ? `
                    <img
                        src="${escapeHTML(
                            safePhotoURL
                        )}"
                        alt="${escapeHTML(
                            displayName
                        )}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                    >
                `
                : `
                    <span aria-hidden="true">
                        ${escapeHTML(
                            displayName
                                .charAt(0)
                                .toUpperCase() ||
                            "U"
                        )}
                    </span>
                `;

        return `
            <span class="admin-user-identity">
                <span class="admin-user-avatar">
                    ${avatar}
                </span>

                <span class="admin-user-text">
                    <strong>
                        ${escapeHTML(
                            displayName
                        )}
                    </strong>

                    <small>
                        ${escapeHTML(
                            profile.email ||
                            profile.uid ||
                            "—"
                        )}
                    </small>
                </span>
            </span>
        `;
    }

    function createReferralRow(
        referral
    ) {
        const actionRunning =
            state.actionInProgress &&
            state.actionReferralId ===
                referral.referralId;

        const approveLabel =
            actionRunning &&
            state.actionType ===
                "approve"
                ? "Approving..."
                : "Approve";

        const activeDaysText =
            formatActiveDays(
                referral.activeDays,
                referral
                    .requiredActiveDays
            );

        const activitySubtext =
            referral.activityCompleted
                ? "Complete · 2h/day"
                : `${referral.remainingActiveDays} day${
                    referral
                        .remainingActiveDays ===
                    1
                        ? ""
                        : "s"
                } remaining · 2h/day`;

        return `
            <tr
                data-admin-referral-row="${escapeHTML(
                    referral.referralId
                )}"
            >
                <td>
                    ${createProfileIdentity(
                        referral.referrerProfile,
                        "Referrer"
                    )}
                </td>

                <td>
                    ${createProfileIdentity(
                        referral.referredProfile,
                        "Referred User"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        referral.referralCode ||
                        "—"
                    )}
                </td>

                <td>
                    ${createEligibilityBadge(
                        referral.googleVerified,
                        "Verified Google",
                        "Google Incomplete"
                    )}
                </td>

                <td>
                    ${createEligibilityBadge(
                        referral.mobileUnique,
                        "Unique Mobile",
                        "Mobile Incomplete"
                    )}
                </td>

                <td>
                    ${createEligibilityBadge(
                        referral.deviceUnique,
                        "Web Device Bound",
                        "Device Incomplete"
                    )}
                </td>

                <td>
                    <strong>
                        ${escapeHTML(
                            activeDaysText
                        )}
                    </strong>

                    <small>
                        ${escapeHTML(
                            activitySubtext
                        )}
                    </small>
                </td>

                <td>
                    ${escapeHTML(
                        formatMoney(
                            referral.rewardAmount
                        )
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            referral.qualifiedAt ||
                            referral.createdAt
                        )
                    )}
                </td>

                <td>
                    <div class="admin-table-actions">
                        <button
                            type="button"
                            data-admin-referral-open="${escapeHTML(
                                referral.referralId
                            )}"
                            ${
                                actionRunning
                                    ? "disabled"
                                    : ""
                            }
                        >
                            View
                        </button>

                        <button
                            type="button"
                            data-admin-referral-approve="${escapeHTML(
                                referral.referralId
                            )}"
                            ${
                                (
                                    actionRunning ||
                                    !referral.reviewable
                                )
                                    ? "disabled"
                                    : ""
                            }
                        >
                            ${approveLabel}
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function renderReferrals() {
        if (
            elements.tableBody
        ) {
            elements.tableBody
                .innerHTML =
                state.visibleReferrals
                    .map(
                        createReferralRow
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
            state.visibleReferrals
                .length ===
                0
        );

        elements.totalElements
            .forEach(
                element => {
                    element.textContent =
                        String(
                            state.total
                        );
                }
            );

        elements.pendingRewardElements
            .forEach(
                element => {
                    element.textContent =
                        formatMoney(
                            state
                                .pendingRewardAmount
                        );
                }
            );

        elements.refreshButtons
            .forEach(
                button => {
                    setDisabled(
                        button,
                        state.loading ||
                        state
                            .actionInProgress
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
                state.loading ||
                state
                    .actionInProgress
            );
        }

        elements.root
            ?.setAttribute(
                "aria-busy",
                (
                    state.loading ||
                    state.actionInProgress
                )
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
       SELECTED REFERRAL DETAILS
    ===================================================== */

    function updateDetailPhoto(
        selector,
        profile,
        fallbackAlt
    ) {
        queryAll(selector)
            .forEach(
                element => {
                    if (
                        element.tagName !==
                        "IMG"
                    ) {
                        return;
                    }

                    if (
                        profile.photoURL
                    ) {
                        element.src =
                            profile.photoURL;

                        element.referrerPolicy =
                            "no-referrer";
                    } else {
                        element.removeAttribute(
                            "src"
                        );
                    }

                    element.alt =
                        profile.displayName ||
                        fallbackAlt;
                }
            );
    }

    function renderSelectedReferral() {
        const referral =
            state.selectedReferral;

        setVisible(
            elements.detailsPanel,
            Boolean(
                referral
            )
        );

        if (!referral) {
            return;
        }

        setText(
            "[data-admin-referral-detail-id]",
            referral.referralId
        );

        setText(
            "[data-admin-referral-detail-code]",
            referral.referralCode
        );

        setText(
            "[data-admin-referral-detail-status]",
            referral.statusLabel
        );

        setText(
            "[data-admin-referral-detail-reward]",
            formatMoney(
                referral.rewardAmount
            )
        );

        setText(
            "[data-admin-referral-detail-created]",
            formatDate(
                referral.createdAt
            )
        );

        setText(
            "[data-admin-referral-detail-qualified-at], [data-admin-referral-detail-eligible-at]",
            formatDate(
                referral.qualifiedAt
            )
        );

        setText(
            "[data-admin-referral-detail-active-days], [data-admin-referral-detail-active-time]",
            formatActiveDays(
                referral.activeDays,
                referral
                    .requiredActiveDays
            )
        );

        setText(
            "[data-admin-referral-detail-required-days], [data-admin-referral-detail-required-time]",
            `${referral.requiredActiveDays} days`
        );

        setText(
            "[data-admin-referral-detail-required-daily-time]",
            referral.requiredDailyMinutes ===
                DEFAULT_REQUIRED_DAILY_MINUTES
                ? `${referral.requiredDailyMinutes} minutes (2 hours)`
                : `${referral.requiredDailyMinutes} minutes`
        );

        setText(
            "[data-admin-referral-detail-activity-policy]",
            referral.activityPolicyVersion
                ? `v${referral.activityPolicyVersion}`
                : "Legacy compatibility"
        );

        setText(
            "[data-admin-referral-detail-referrer-name]",
            referral.referrerProfile
                .displayName
        );

        setText(
            "[data-admin-referral-detail-referrer-email]",
            referral.referrerProfile
                .email
        );

        setText(
            "[data-admin-referral-detail-referrer-uid]",
            referral.referrerUid
        );

        setText(
            "[data-admin-referral-detail-referred-name]",
            referral.referredProfile
                .displayName
        );

        setText(
            "[data-admin-referral-detail-referred-email]",
            referral.referredProfile
                .email
        );

        setText(
            "[data-admin-referral-detail-referred-mobile]",
            referral.referredProfile
                .mobileNumber
        );

        setText(
            "[data-admin-referral-detail-referred-uid]",
            referral.referredUid
        );

        setText(
            "[data-admin-referral-detail-google]",
            referral.googleVerified
                ? "Verified Google account"
                : "Verified Google requirement incomplete"
        );

        setText(
            "[data-admin-referral-detail-mobile]",
            referral.mobileUnique
                ? "Unique Bangladesh mobile reserved"
                : (
                    referral.mobileAdded
                        ? "Mobile uniqueness not verified"
                        : "Mobile requirement incomplete"
                )
        );

        setText(
            "[data-admin-referral-detail-device]",
            referral.deviceUnique
                ? "Unique Web Device binding valid"
                : (
                    referral.deviceAdded
                        ? "Web Device binding not verified"
                        : "Web Device requirement incomplete"
                )
        );

        setText(
            "[data-admin-referral-detail-device-id]",
            formatDeviceId(
                referral.deviceId
            )
        );

        setText(
            "[data-admin-referral-detail-activity-completed], [data-admin-referral-detail-using-time]",
            referral.activityCompleted
                ? `${referral.requiredActiveDays} eligible days × ${referral.requiredDailyMinutes} min/day completed`
                : `Eligible Active Days incomplete · Today ${formatEligibleMinutes(
                    referral.currentDaySeconds,
                    referral.requiredDailySeconds
                )}`
        );

        const qualificationSummary =
            [
                referral.googleVerified
                    ? "Google ✓"
                    : "Google ✕",

                referral.mobileUnique
                    ? "Mobile ✓"
                    : "Mobile ✕",

                referral.deviceUnique
                    ? "Web Device ✓"
                    : "Web Device ✕",

                referral.activityCompleted
                    ? "Activity ✓"
                    : "Activity ✕"
            ].join(
                " · "
            );

        setText(
            "[data-admin-referral-detail-eligibility]",
            referral.status ===
                "qualified"
                ? `Qualified — Pending Admin review · ${qualificationSummary}`
                : (
                    referral.eligible
                        ? `Backend eligibility recorded · ${qualificationSummary}`
                        : `Backend validation required · ${qualificationSummary}`
                )
        );

        updateDetailPhoto(
            "[data-admin-referral-detail-referrer-photo]",
            referral.referrerProfile,
            "Referrer"
        );

        updateDetailPhoto(
            "[data-admin-referral-detail-referred-photo]",
            referral.referredProfile,
            "Referred User"
        );

        setFormValue(
            elements.approveForm,
            "referralId",
            referral.referralId
        );

        setFormValue(
            elements.rejectForm,
            "referralId",
            referral.referralId
        );

        setDisabled(
            elements.approveForm
                ?.querySelector(
                    "[type='submit']"
                ),
            state.actionInProgress ||
            !referral.reviewable
        );

        setDisabled(
            elements.rejectForm
                ?.querySelector(
                    "[type='submit']"
                ),
            state.actionInProgress ||
            !referral.reviewable
        );
    }

    /* =====================================================
       SEARCH
    ===================================================== */

    function applySearch() {
        const query =
            state.searchQuery
                .toLowerCase();

        state.visibleReferrals =
            state.referrals.filter(
                referral => {
                    if (!query) {
                        return true;
                    }

                    return [
                        referral.referralId,
                        referral.referralCode,
                        referral.status,
                        referral.referrerUid,
                        referral.referredUid,

                        referral.referrerProfile
                            .displayName,

                        referral.referrerProfile
                            .email,

                        referral.referrerProfile
                            .mobileNumber,

                        referral.referredProfile
                            .displayName,

                        referral.referredProfile
                            .email,

                        referral.referredProfile
                            .mobileNumber,

                        referral.deviceId,

                        referral.deviceUnique
                            ? "unique web device"
                            : "device incomplete",

                        referral.activeDays,
                        referral.requiredActiveDays,
                        referral.requiredDailyMinutes,
                        referral.activityPolicyVersion
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query);
                }
            );

        renderReferrals();

        return cloneValue(
            state.visibleReferrals
        );
    }

    function setSearchQuery(value) {
        state.searchQuery =
            toSafeString(value);

        applySearch();
        notify();

        return getState();
    }

    /* =====================================================
       LOAD QUALIFIED REFERRALS
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        await requireAdminAccess();

        const append =
            options.append ===
            true;

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
            toSafeLimit(
                options.limit ||
                state.limit
            );

        const cursor =
            append
                ? state.nextCursor
                : "";

        state.loading =
            true;

        state.limit =
            requestedLimit;

        if (!append) {
            state.nextCursor =
                "";

            state.hasMore =
                false;
        }

        clearError();

        renderReferrals();
        renderError();

        notify(
            EVENTS.LOADING
        );

        try {
            const payload = {
                limit:
                    requestedLimit
            };

            if (cursor) {
                payload.cursor =
                    cursor;
            }

            const result =
                await getAdminAPI()
                    .getPendingReferrals(
                        payload
                    );

            if (
                currentRequest !==
                requestSequence
            ) {
                return getState();
            }

            /*
             * Admin review queue is qualified-only.
             * Server-side validation remains authoritative.
             */

            const pageReferrals =
                normalizeReferrals(
                    extractReferralArray(
                        result
                    )
                ).filter(
                    referral =>
                        referral.status ===
                        REVIEWABLE_STATUS
                );

            state.referrals =
                append
                    ? mergeUniqueReferrals(
                        state.referrals,
                        pageReferrals
                    )
                    : pageReferrals;

            const reportedTotal =
                extractResultValue(
                    result,
                    "total",
                    null
                );

            state.total =
                reportedTotal ===
                    null ||
                reportedTotal ===
                    undefined
                    ? state.referrals
                        .length
                    : toNonNegativeInteger(
                        reportedTotal,
                        state.referrals
                            .length
                    );

            const nextCursor =
                toSafeString(
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
                Boolean(
                    nextCursor
                );

            const loadedPendingRewardAmount =
                state.referrals
                    .reduce(
                        (
                            total,
                            referral
                        ) => {
                            if (
                                !referral
                                    .reviewable
                            ) {
                                return total;
                            }

                            return safeAdd(
                                total,
                                referral
                                    .rewardAmount
                            );
                        },
                        0
                    );

            const reportedPendingRewardAmount =
                extractResultValue(
                    result,
                    "pendingRewardAmount",
                    null
                );

            state.pendingRewardAmount =
                reportedPendingRewardAmount ===
                    null ||
                reportedPendingRewardAmount ===
                    undefined
                    ? loadedPendingRewardAmount
                    : toNonNegativeInteger(
                        reportedPendingRewardAmount,
                        loadedPendingRewardAmount
                    );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            applySearch();
            renderError();

            if (
                state.selectedReferralId
            ) {
                const refreshedSelected =
                    state.referrals.find(
                        referral =>
                            referral.referralId ===
                            state.selectedReferralId
                    );

                if (
                    refreshedSelected
                ) {
                    state.selectedReferral =
                        cloneValue(
                            refreshedSelected
                        );

                    renderSelectedReferral();
                } else if (!append) {
                    closeReferralDetails();
                }
            }

            return getState();
        } catch (error) {
            if (
                currentRequest ===
                requestSequence
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                requestSequence
            ) {
                state.loading =
                    false;

                renderReferrals();
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
       REFERRAL DETAILS
    ===================================================== */

    function openReferralDetails(
        referralId
    ) {
        const id =
            requireReferralId(
                referralId
            );

        selectionSequence +=
            1;

        const referral =
            state.referrals.find(
                item =>
                    item.referralId ===
                    id
            );

        if (!referral) {
            throw new Error(
                "Referral record was not found."
            );
        }

        state.selectedReferralId =
            id;

        state.selectedReferral =
            cloneValue(
                referral
            );

        renderSelectedReferral();

        notify(
            EVENTS.SELECTED
        );

        return cloneValue(
            state.selectedReferral
        );
    }

    function closeReferralDetails() {
        selectionSequence +=
            1;

        state.selectedReferralId =
            "";

        state.selectedReferral =
            null;

        renderSelectedReferral();
        notify();

        return getState();
    }

    /* =====================================================
       ACTION STATE
    ===================================================== */

    function startAction(
        referralId,
        actionType
    ) {
        if (
            state.actionInProgress
        ) {
            throw new Error(
                "Another referral review is already in progress."
            );
        }

        state.actionInProgress =
            true;

        state.actionReferralId =
            referralId;

        state.actionType =
            actionType;

        clearError();

        renderReferrals();
        renderSelectedReferral();

        notify(
            EVENTS.ACTION_STARTED
        );
    }

    function finishAction() {
        state.actionInProgress =
            false;

        state.actionReferralId =
            "";

        state.actionType =
            "";

        renderReferrals();
        renderSelectedReferral();

        notify(
            EVENTS.ACTION_COMPLETED
        );
    }

    function getLoadedReferral(
        referralId
    ) {
        return (
            state.referrals.find(
                item =>
                    item.referralId ===
                    referralId
            ) ||
            null
        );
    }

    function ensureReviewableReferral(
        referralId
    ) {
        const referral =
            getLoadedReferral(
                referralId
            );

        if (!referral) {
            throw new Error(
                "Qualified referral record was not found in the current Admin queue."
            );
        }

        if (!referral.reviewable) {
            throw new Error(
                "Only qualified referrals can be reviewed."
            );
        }

        return referral;
    }

    /* =====================================================
       APPROVE REFERRAL
    ===================================================== */

    async function approveReferral(
        referralId,
        adminNote = ""
    ) {
        await requireAdminAccess();

        const id =
            requireReferralId(
                referralId ||
                state.selectedReferralId
            );

        const referral =
            ensureReviewableReferral(
                id
            );

        const note =
            normalizeOptionalAdminNote(
                adminNote
            );

        startAction(
            id,
            "approve"
        );

        try {
            /*
             * AdminAPI → FunctionsClient revalidates:
             *
             * - referral is still qualified
             * - verified Google account
             * - unique Bangladesh mobile reservation
             * - Unique Web Device reservation/binding
             * - activityPolicyVersion >= 2
             * - 7 different eligible Bangladesh dates
             * - 7200 accepted seconds per eligible date
             * - reward has not already been granted
             * - reward/wallet/ledger/stats/audit remain atomic
             */

            const result =
                await getAdminAPI()
                    .approveReferral(
                        id,
                        note
                    );

            const creditedAmount =
                toNonNegativeInteger(
                    result
                        ?.rewardAmount ??
                    result
                        ?.amount ??
                    result
                        ?.reward
                        ?.amount ??
                    result
                        ?.data
                        ?.rewardAmount ??
                    result
                        ?.data
                        ?.amount ??
                    result
                        ?.data
                        ?.reward
                        ?.amount ??
                    referral
                        .rewardAmount,
                    DEFAULT_REWARD_AMOUNT
                ) ||
                DEFAULT_REWARD_AMOUNT;

            closeReferralDetails();

            await refresh({
                limit:
                    state.limit
            });

            const detail = {
                referralId:
                    id,

                status:
                    "rewarded",

                rewardAmount:
                    creditedAmount,

                result,

                message:
                    `Referral approved and rewarded successfully. ${formatMoney(
                        creditedAmount
                    )} was credited to the referrer wallet.`
            };

            dispatch(
                EVENTS.REFERRAL_UPDATED,
                detail
            );

            await refreshDashboardSummary();

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            setError(
                error
            );

            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );

            throw error;
        } finally {
            finishAction();
        }
    }

    /* =====================================================
       REJECT REFERRAL
    ===================================================== */

    async function rejectReferral(
        referralId,
        adminNote = ""
    ) {
        await requireAdminAccess();

        const id =
            requireReferralId(
                referralId ||
                state.selectedReferralId
            );

        ensureReviewableReferral(
            id
        );

        /*
         * Final policy:
         * Referral rejection note is optional.
         */

        const note =
            normalizeOptionalAdminNote(
                adminNote
            );

        startAction(
            id,
            "reject"
        );

        try {
            const result =
                await getAdminAPI()
                    .rejectReferral(
                        id,
                        note
                    );

            closeReferralDetails();

            await refresh({
                limit:
                    state.limit
            });

            const detail = {
                referralId:
                    id,

                status:
                    "rejected",

                result,

                message:
                    "Referral rejected successfully. No reward was credited."
            };

            dispatch(
                EVENTS.REFERRAL_UPDATED,
                detail
            );

            await refreshDashboardSummary();

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            setError(
                error
            );

            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );

            throw error;
        } finally {
            finishAction();
        }
    }

    /* =====================================================
       FORM HELPERS
    ===================================================== */

    function getFormValue(
        formData,
        fieldName
    ) {
        return toSafeString(
            formData.get(
                fieldName
            )
        );
    }

    async function handleApproveSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-referral-approve-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(
                form
            );

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            await approveReferral(
                getFormValue(
                    formData,
                    "referralId"
                ) ||
                state.selectedReferralId,

                getFormValue(
                    formData,
                    "adminNote"
                )
            );

            form.reset();
        } catch {
            /*
             * Error already published/displayed.
             */
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    async function handleRejectSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-referral-reject-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(
                form
            );

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            await rejectReferral(
                getFormValue(
                    formData,
                    "referralId"
                ) ||
                state.selectedReferralId,

                getFormValue(
                    formData,
                    "adminNote"
                )
            );

            form.reset();
        } catch {
            /*
             * Error already published/displayed.
             */
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    /* =====================================================
       INLINE NOTE COMPATIBILITY
    ===================================================== */

    function escapeSelectorValue(value) {
        if (
            window.CSS &&
            typeof window.CSS
                .escape ===
                "function"
        ) {
            return window.CSS
                .escape(
                    value
                );
        }

        return value.replace(
            /["\\]/g,
            "\\$&"
        );
    }

    function readInlineAdminNote(
        referralId
    ) {
        const escapedId =
            escapeSelectorValue(
                referralId
            );

        const field =
            document.querySelector(
                `[data-admin-referral-note="${escapedId}"]`
            );

        return toSafeString(
            field?.value
        );
    }

    /* =====================================================
       DOCUMENT EVENTS
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        const openButton =
            event.target.closest(
                "[data-admin-referral-open]"
            );

        if (openButton) {
            event.preventDefault();

            try {
                openReferralDetails(
                    openButton
                        .dataset
                        .adminReferralOpen
                );
            } catch (error) {
                setError(
                    error
                );

                showToast(
                    normalizeError(
                        error
                    ).message,
                    "error"
                );
            }

            return;
        }

        const approveButton =
            event.target.closest(
                "[data-admin-referral-approve]"
            );

        if (approveButton) {
            event.preventDefault();

            const referralId =
                approveButton
                    .dataset
                    .adminReferralApprove;

            const note =
                readInlineAdminNote(
                    referralId
                );

            void approveReferral(
                referralId,
                note
            ).catch(
                () => {
                    /*
                     * Error already displayed.
                     */
                }
            );

            return;
        }

        const rejectButton =
            event.target.closest(
                "[data-admin-referral-reject]"
            );

        if (rejectButton) {
            event.preventDefault();

            const referralId =
                rejectButton
                    .dataset
                    .adminReferralReject;

            const note =
                readInlineAdminNote(
                    referralId
                );

            void rejectReferral(
                referralId,
                note
            ).catch(
                () => {
                    /*
                     * Error already displayed.
                     */
                }
            );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-referral-details-close]"
            )
        ) {
            event.preventDefault();

            closeReferralDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-referrals-refresh]"
            )
        ) {
            event.preventDefault();

            void refresh()
                .catch(
                    error => {
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
                "[data-admin-referrals-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMore()
                .catch(
                    error => {
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
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-referrals-search]"
            )
        ) {
            setSearchQuery(
                event.target.value
            );
        }
    }

    function handleDocumentSubmit(event) {
        if (
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-referral-approve-form]"
            )
        ) {
            void handleApproveSubmit(
                event
            );

            return;
        }

        if (
            event.target.matches(
                "[data-admin-referral-reject-form]"
            )
        ) {
            void handleRejectSubmit(
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

            renderReferrals();
            renderSelectedReferral();

            return getState();
        }

        state.initialized =
            true;

        cacheElements();
        bindEvents();

        state.searchQuery =
            toSafeString(
                elements.searchInput
                    ?.value
            );

        try {
            await requireAdminAccess();

            await refresh();
        } catch (error) {
            setError(
                error
            );
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
                "AdminReferrals subscriber must be a function."
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

        selectionSequence +=
            1;

        controller?.abort();

        controller =
            null;

        listeners.clear();

        state.initialized =
            false;

        state.loading =
            false;

        state.actionInProgress =
            false;

        state.actionReferralId =
            "";

        state.actionType =
            "";

        state.referrals =
            [];

        state.visibleReferrals =
            [];

        state.selectedReferralId =
            "";

        state.selectedReferral =
            null;

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

        state.pendingRewardAmount =
            0;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        Object.keys(
            elements
        ).forEach(
            key => {
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

    window.AdminReferrals =
        Object.freeze({
            init,
            destroy,

            refresh,
            loadMore,

            setSearchQuery,

            openReferralDetails,
            closeReferralDetails,

            approveReferral,
            rejectReferral,

            getState,

            getReferrals() {
                return cloneValue(
                    state.referrals
                );
            },

            getVisibleReferrals() {
                return cloneValue(
                    state.visibleReferrals
                );
            },

            getSelectedReferral() {
                return cloneValue(
                    state.selectedReferral
                );
            },

            normalizeReferral,
            normalizeReferrals,
            normalizeProfile,
            normalizeActivity,
            normalizeStatus,

            getStatusLabel,

            formatMoney,
            formatDate,
            formatActiveDays,
            formatEligibleMinutes,
            formatDeviceId,

            /*
             * Legacy compatibility export only.
             */
            formatDuration,

            subscribe,

            EVENTS,
            CANONICAL_STATUSES,
            REVIEWABLE_STATUS,

            DEFAULT_REQUIRED_ACTIVE_DAYS,
            DEFAULT_REQUIRED_DAILY_SECONDS,
            DEFAULT_REQUIRED_DAILY_MINUTES,
            DEFAULT_REQUIRED_ACTIVE_SECONDS,

            ACTIVITY_POLICY_VERSION,

            /*
             * Legacy compatibility constant only.
             */
            LEGACY_REQUIRED_ACTIVE_SECONDS,

            DEFAULT_REWARD_AMOUNT
        });
})(
    window,
    document
);