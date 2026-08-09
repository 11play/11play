"use strict";

/* =========================================================
   11PLAY — REFERRAL CLIENT DATA MODULE
   File: js/account/firebase/referral.db.js

   Production contract:
   - Firebase Spark plan optimized
   - Guest users receive the canonical main-site URL only
   - Verified Google users receive their own unique referral URL
   - Referral qualification requires:
       1. Verified Google account
       2. Unique Bangladesh mobile number
       3. Unique Web Device binding
       4. 7 different Bangladesh calendar days
       5. Minimum 2 eligible active hours on EACH day
   - Activity Policy Version = 2
   - Required Daily Activity = 7200 seconds
   - Qualified referrals wait for Admin review
   - Admin approval credits exactly ৳1000 once
   - Admin rejection becomes the invalid/rejected state
   - Referral/reward data is never directly modified here
   - Cursor pagination, masking and stale-account protection are preserved

   Backend reads:
   - getMyReferralStats
   - getMyReferrals

   Compatibility API:
   - loadPublicAdminReferral()
     The old method name is preserved, but it now returns the Guest
     main-site URL. It no longer reads or exposes an Admin referral.

   Important:
   - APK installation is NOT a referral requirement
   - Direct website access and wrapper/APK access use the same rules
   - Device identity is a Web Device / browser-installation binding,
     not a physical hardware ID
========================================================= */

(function initializeReferralDB(window, document) {
    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT = 50;
    const MAXIMUM_LIMIT = 100;
    const REFRESH_COOLDOWN_MS = 10 * 1000;

    const REQUIRED_ACTIVE_DAYS = 7;
    const REQUIRED_DAILY_SECONDS = 2 * 60 * 60;
    const REQUIRED_ACTIVE_SECONDS =
        REQUIRED_ACTIVE_DAYS *
        REQUIRED_DAILY_SECONDS;

    const ACTIVITY_POLICY_VERSION = 2;

    /*
     * Compatibility aliases only.
     *
     * IMPORTANT:
     * One eligible day means TWO qualifying hours,
     * not 24 elapsed hours.
     */
    const COMPATIBILITY_SECONDS_PER_DAY =
        REQUIRED_DAILY_SECONDS;

    const COMPATIBILITY_REQUIRED_SECONDS =
        REQUIRED_ACTIVE_SECONDS;

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const CANONICAL_REFERRAL_BASE_URL =
        "https://11play.github.io/11play/";

    const REFERRAL_QUERY_PARAMETER =
        "ref";

    const PROFILE_IDENTITY_RETRY_DELAYS_MS =
        Object.freeze([
            0,
            150,
            350,
            700,
            1200
        ]);

    const EVENT_UPDATED =
        "referral:updated";

    const EVENT_LOADING =
        "referral:loading";

    const EVENT_ERROR =
        "referral:error";

    const EVENT_FILTER_CHANGED =
        "referral:filter-changed";

    const EVENT_LINK_COPIED =
        "referral:link-copied";

    const EVENT_ACCESS_BLOCKED =
        "referral:access-blocked";

    const EVENT_PUBLIC_LINK_UPDATED =
        "referral:public-link-updated";

    const REFERRAL_SOURCE_GUEST =
        "guest";

    const REFERRAL_SOURCE_USER =
        "user";

    const CANONICAL_STATUSES =
        Object.freeze([
            "",
            "pending",
            "qualified",
            "approved",
            "rejected",
            "rewarded"
        ]);

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

        loadingMore:
            false,

        currentUser:
            null,

        statusFilter:
            "",

        limit:
            DEFAULT_LIMIT,

        stats:
            createEmptyStats(),

        referrals:
            [],

        nextCursor:
            "",

        hasMore:
            false,

        referralCode:
            "",

        referralLink:
            CANONICAL_REFERRAL_BASE_URL,

        referralSource:
            REFERRAL_SOURCE_GUEST,

        publicReferralUpdatedAt:
            null,

        lastUpdatedAt:
            null,

        error:
            null
    };

    const guestReferralCache = {
        referralCode:
            "",

        referralLink:
            CANONICAL_REFERRAL_BASE_URL,

        updatedAt:
            null
    };

    let authUnsubscribe =
        null;

    let readyPromise =
        null;

    let boundEvents =
        false;

    let refreshRequestSequence =
        0;

    let statsRequestSequence =
        0;

    let referralsRequestSequence =
        0;

    let dataGeneration =
        0;

    let lastRefreshStartedAt =
        0;

    let ownIdentityUid =
        "";

    let ownIdentityPromise =
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

    function toSafeString(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .normalize("NFKC")
            .trim();
    }

    function toSafeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(value);

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
            Math.floor(
                toSafeNumber(
                    value,
                    fallback
                )
            );

        return Math.max(
            0,
            Number.isFinite(
                number
            )
                ? number
                : 0
        );
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

    function cloneValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
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

    function serializeTimestamp(
        value
    ) {
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
            isPlainObject(
                value
            ) &&
            typeof value.seconds ===
                "number"
        ) {
            try {
                return new Date(
                    value.seconds *
                    1000
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
            : parsedDate
                .toISOString();
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
                )
                    .replace(
                        /^functions\//,
                        ""
                    )
                    .replace(
                        /^firestore\//,
                        ""
                    ) ||
                "referral-error",

            message:
                toSafeString(
                    details?.message ||
                    error?.message
                ) ||
                "Referral information could not be loaded.",

            field:
                toSafeString(
                    details?.field
                ),

            reason:
                toSafeString(
                    details?.reason ||
                    details?.code
                ),

            details
        };
    }

    function unwrapCallableResult(
        response
    ) {
        if (
            response &&
            typeof response ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "data"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "stats"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "referrals"
                )
        ) {
            return response.data;
        }

        return response;
    }

    function createReferralError(
        code,
        message,
        details = null
    ) {
        const error =
            new Error(
                toSafeString(
                    message
                ) ||
                "Referral information could not be loaded."
            );

        error.code =
            toSafeString(
                code
            ) ||
            "referral-error";

        error.details =
            details;

        return error;
    }

    function wait(milliseconds) {
        const delay =
            Math.max(
                0,
                Number(
                    milliseconds
                ) ||
                0
            );

        return new Promise(
            resolve => {
                window.setTimeout(
                    resolve,
                    delay
                );
            }
        );
    }

    function normalizeReferralCode(
        value
    ) {
        return toSafeString(
            value
        )
            .toUpperCase();
    }

    function isValidReferralCode(
        value
    ) {
        return /^[A-HJ-NP-Z2-9]{8}$/
            .test(
                normalizeReferralCode(
                    value
                )
            );
    }

    function isValidBangladeshMobile(
        value
    ) {
        return /^\+8801[3-9]\d{8}$/
            .test(
                toSafeString(
                    value
                )
            );
    }

    function isValidDeviceId(
        value
    ) {
        return /^[a-f0-9]{64}$/
            .test(
                toSafeString(
                    value
                )
                    .toLowerCase()
            );
    }

    function getGuestReferralIdentity() {
        return {
            referralCode:
                "",

            referralLink:
                CANONICAL_REFERRAL_BASE_URL,

            source:
                REFERRAL_SOURCE_GUEST,

            referralSource:
                REFERRAL_SOURCE_GUEST,

            isGuestReferral:
                true,

            isPublicAdminReferral:
                false
        };
    }

    /* =====================================================
       REFERRAL LINK NORMALIZATION
    ===================================================== */

    function normalizeReferralLink(
        value
    ) {
        const referralLink =
            toSafeString(
                value
            );

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

            parsedURL.hash =
                "";

            const referralCode =
                normalizeReferralCode(
                    parsedURL.searchParams
                        .get(
                            REFERRAL_QUERY_PARAMETER
                        )
                );

            /*
             * Only ?ref=<code> is allowed.
             */

            parsedURL.search =
                "";

            if (
                isValidReferralCode(
                    referralCode
                )
            ) {
                parsedURL.searchParams
                    .set(
                        REFERRAL_QUERY_PARAMETER,
                        referralCode
                    );
            }

            return parsedURL
                .toString();
        } catch {
            return "";
        }
    }

    function buildReferralLinkFromCode(
        referralCode
    ) {
        const normalizedCode =
            normalizeReferralCode(
                referralCode
            );

        if (
            !isValidReferralCode(
                normalizedCode
            )
        ) {
            return "";
        }

        if (
            window.ReferralCapture &&
            typeof window.ReferralCapture
                .buildReferralLink ===
                "function"
        ) {
            try {
                const builtLink =
                    normalizeReferralLink(
                        window.ReferralCapture
                            .buildReferralLink(
                                normalizedCode
                            )
                    );

                if (builtLink) {
                    return builtLink;
                }
            } catch {
                /*
                 * Fall back to canonical construction.
                 */
            }
        }

        try {
            const referralURL =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            referralURL.searchParams
                .set(
                    REFERRAL_QUERY_PARAMETER,
                    normalizedCode
                );

            referralURL.hash =
                "";

            return referralURL
                .toString();
        } catch {
            return "";
        }
    }

    function normalizeReferralIdentity(
        value
    ) {
        const source =
            isPlainObject(
                value
            )
                ? value
                : {};

        const referralCode =
            normalizeReferralCode(
                source.referralCode ||
                source.code
            );

        const validCode =
            isValidReferralCode(
                referralCode
            )
                ? referralCode
                : "";

        let referralLink =
            normalizeReferralLink(
                source.referralLink ||
                source.link
            );

        if (
            referralLink &&
            validCode
        ) {
            try {
                const linkCode =
                    normalizeReferralCode(
                        new URL(
                            referralLink
                        )
                            .searchParams
                            .get(
                                REFERRAL_QUERY_PARAMETER
                            )
                    );

                if (
                    linkCode !==
                    validCode
                ) {
                    referralLink =
                        "";
                }
            } catch {
                referralLink =
                    "";
            }
        }

        if (
            !referralLink &&
            validCode
        ) {
            referralLink =
                buildReferralLinkFromCode(
                    validCode
                );
        }

        return {
            referralCode:
                validCode,

            referralLink:
                referralLink ||
                ""
        };
    }

    function setReferralIdentity(
        identity,
        source = ""
    ) {
        const normalizedSource =
            toSafeString(
                source
            )
                .toLowerCase();

        if (
            normalizedSource ===
            REFERRAL_SOURCE_GUEST
        ) {
            const guestIdentity =
                getGuestReferralIdentity();

            state.referralCode =
                "";

            state.referralLink =
                guestIdentity
                    .referralLink;

            state.referralSource =
                REFERRAL_SOURCE_GUEST;

            return guestIdentity;
        }

        const normalizedIdentity =
            normalizeReferralIdentity(
                identity
            );

        const usable =
            Boolean(
                normalizedIdentity
                    .referralCode &&
                normalizedIdentity
                    .referralLink
            );

        state.referralCode =
            usable
                ? normalizedIdentity
                    .referralCode
                : "";

        state.referralLink =
            usable
                ? normalizedIdentity
                    .referralLink
                : "";

        state.referralSource =
            usable
                ? REFERRAL_SOURCE_USER
                : "";

        return {
            referralCode:
                state.referralCode,

            referralLink:
                state.referralLink,

            source:
                state.referralSource,

            referralSource:
                state.referralSource,

            isGuestReferral:
                false,

            isPublicAdminReferral:
                false
        };
    }

    function clearActiveReferralIdentity() {
        state.referralCode =
            "";

        state.referralLink =
            "";

        state.referralSource =
            "";

        return {
            referralCode:
                "",

            referralLink:
                "",

            source:
                "",

            referralSource:
                "",

            isGuestReferral:
                false,

            isPublicAdminReferral:
                false
        };
    }

    /* =====================================================
       STATUS NORMALIZATION
    ===================================================== */

    function normalizeStatus(value) {
        const rawStatus =
            toSafeString(
                value
            )
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (rawStatus) {
            case "":
                return "";

            case "pending":
            case "captured":
            case "observing":
                return "pending";

            case "qualified":
            case "pending_review":
                return "qualified";

            case "approved":
                return "approved";

            case "rejected":
            case "invalid":
                return "rejected";

            case "rewarded":
            case "valid":
                return "rewarded";

            default:
                return "";
        }
    }

    function isSupportedStatus(value) {
        const rawStatus =
            toSafeString(
                value
            );

        return (
            !rawStatus ||
            Boolean(
                normalizeStatus(
                    rawStatus
                )
            )
        );
    }

    function getStatusLabel(status) {
        switch (
            normalizeStatus(
                status
            )
        ) {
            case "pending":
                return "Pending";

            case "qualified":
                return "Pending Review";

            case "approved":
                return "Approved";

            case "rejected":
                return "Invalid";

            case "rewarded":
                return "Rewarded";

            default:
                return "";
        }
    }

    function getLegacyStatus(status) {
        switch (
            normalizeStatus(
                status
            )
        ) {
            case "pending":
                return "observing";

            case "qualified":
                return "pending_review";

            case "approved":
                return "valid";

            case "rejected":
                return "invalid";

            case "rewarded":
                return "valid";

            default:
                return "";
        }
    }

    function getUserVisibleStatus(
        status
    ) {
        return normalizeStatus(
            status
        );
    }

    function getUserVisibleStatusLabel(
        status
    ) {
        return getStatusLabel(
            status
        );
    }

    /* =====================================================
       STATISTICS
    ===================================================== */

    function createEmptyStats(
        uid = ""
    ) {
        return {
            uid:
                toSafeString(
                    uid
                ),

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
                0,

            visiblePending:
                0,

            observing:
                0,

            pendingReview:
                0,

            valid:
                0,

            invalid:
                0,

            createdAt:
                null,

            updatedAt:
                null
        };
    }

    function normalizeStats(
        stats,
        uid = ""
    ) {
        const source =
            isPlainObject(
                stats
            )
                ? stats
                : {};

        const pending =
            toNonNegativeInteger(
                source.pending ??
                source.observing
            );

        const qualified =
            toNonNegativeInteger(
                source.qualified ??
                source.pendingReview
            );

        const approved =
            toNonNegativeInteger(
                source.approved
            );

        const rejected =
            toNonNegativeInteger(
                source.rejected ??
                source.invalid
            );

        const rewarded =
            toNonNegativeInteger(
                source.rewarded ??
                source.valid
            );

        const calculatedTotal =
            pending +
            qualified +
            approved +
            rejected +
            rewarded;

        const total =
            Math.max(
                toNonNegativeInteger(
                    source.total
                ),
                calculatedTotal
            );

        return {
            uid:
                toSafeString(
                    source.uid ||
                    uid
                ),

            total,
            pending,
            qualified,
            approved,
            rejected,
            rewarded,

            totalReward:
                toNonNegativeInteger(
                    source.totalReward
                ),

            visiblePending:
                pending +
                qualified,

            observing:
                pending,

            pendingReview:
                qualified,

            valid:
                rewarded,

            invalid:
                rejected,

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                )
        };
    }

    function synchronizeProfileServiceStats() {
        if (
            !window.ProfileService ||
            typeof window.ProfileService
                .setReferralStats !==
                "function"
        ) {
            return false;
        }

        try {
            window.ProfileService
                .setReferralStats(
                    state.stats
                );

            return true;
        } catch (error) {
            console.warn(
                "[ReferralDB] ProfileService referral synchronization failed.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       MASKED REFERRED USER INFORMATION
    ===================================================== */

    function maskText(value) {
        const text =
            toSafeString(
                value
            );

        if (!text) {
            return "";
        }

        if (
            text.includes("*")
        ) {
            return text;
        }

        if (
            text.length === 1
        ) {
            return `${text}***`;
        }

        return `${text.slice(
            0,
            2
        )}***`;
    }

    function maskEmail(value) {
        const email =
            toSafeString(
                value
            )
                .toLowerCase();

        if (!email) {
            return "";
        }

        if (
            email.includes("*")
        ) {
            return email;
        }

        const separatorIndex =
            email.indexOf("@");

        if (
            separatorIndex <= 0
        ) {
            return maskText(
                email
            );
        }

        const localPart =
            email.slice(
                0,
                separatorIndex
            );

        const domain =
            email.slice(
                separatorIndex + 1
            );

        const visibleLocal =
            localPart.length > 1
                ? localPart.slice(
                    0,
                    2
                )
                : localPart.slice(
                    0,
                    1
                );

        return `${visibleLocal}***@${domain}`;
    }

    function maskMobileNumber(value) {
        const mobile =
            toSafeString(
                value
            );

        if (!mobile) {
            return "";
        }

        if (
            mobile.includes("*")
        ) {
            return mobile;
        }

        const digits =
            mobile.replace(
                /\D/g,
                ""
            );

        return digits.length < 4
            ? "****"
            : `******${digits.slice(
                -4
            )}`;
    }

    function normalizeReferredProfile(
        profile,
        referredUid = ""
    ) {
        const source =
            isPlainObject(
                profile
            )
                ? profile
                : {};

        const displayName =
            toSafeString(
                source.maskedDisplayName ||
                source.maskedName ||
                source.displayName ||
                source.name ||
                source.username
            );

        return {
            uid:
                toSafeString(
                    source.uid ||
                    referredUid
                ),

            username:
                maskText(
                    source.maskedUsername ||
                    source.username
                ),

            name:
                maskText(
                    displayName
                ),

            displayName:
                maskText(
                    displayName
                ),

            email:
                toSafeString(
                    source.maskedEmail
                ) ||
                maskEmail(
                    source.email
                ),

            mobileNumber:
                toSafeString(
                    source.maskedMobileNumber ||
                    source.maskedMobile
                ) ||
                maskMobileNumber(
                    source.mobileNumber
                ),

            photoURL:
                toSafeString(
                    source.photoURL ||
                    source.photo
                ),

            registrationDate:
                serializeTimestamp(
                    source.registrationDate ||
                    source.createdAt
                )
        };
    }

    /* =====================================================
       REFERRAL RECORD NORMALIZATION

       Canonical eligibility:
       - verified Google
       - unique mobile
       - unique Web Device
       - Activity Policy v2
       - 7 Active Days
       - 7200 eligible seconds required per day

       This module only normalizes backend state.
       It never independently grants qualification.
    ===================================================== */

    function normalizeReferralRecord(
        referral,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(
                referral
            )
                ? referral
                : {};

        const requirements =
            isPlainObject(
                source.requirements
            )
                ? source.requirements
                : {};

        const eligibility =
            isPlainObject(
                source.eligibility
            )
                ? source.eligibility
                : {};

        let status =
            normalizeStatus(
                source.status
            ) ||
            "pending";

        const rewardGranted =
            Boolean(
                source.rewardGranted ===
                    true ||
                source.rewardCredited ===
                    true ||
                status ===
                    "rewarded"
            );

        if (
            rewardGranted &&
            (
                status ===
                    "approved" ||
                status ===
                    "qualified"
            )
        ) {
            status =
                "rewarded";
        }

        const requiredActiveDays =
            toNonNegativeInteger(
                source.requiredActiveDays ??
                requirements
                    .requiredActiveDays ??
                eligibility
                    .requiredActiveDays,
                REQUIRED_ACTIVE_DAYS
            ) ||
            REQUIRED_ACTIVE_DAYS;

        const requiredDailySeconds =
            toNonNegativeInteger(
                source.requiredDailySeconds ??
                requirements
                    .requiredDailySeconds ??
                eligibility
                    .requiredDailySeconds,
                REQUIRED_DAILY_SECONDS
            ) ||
            REQUIRED_DAILY_SECONDS;

        const activityPolicyVersion =
            toNonNegativeInteger(
                source.activityPolicyVersion ??
                requirements
                    .activityPolicyVersion ??
                eligibility
                    .activityPolicyVersion
            );

        const policyCurrent =
            requiredActiveDays ===
                REQUIRED_ACTIVE_DAYS &&
            requiredDailySeconds ===
                REQUIRED_DAILY_SECONDS &&
            activityPolicyVersion ===
                ACTIVITY_POLICY_VERSION;

        let activeDays =
            0;

        const explicitActiveDays =
            source.activeDays ??
            requirements.activeDays ??
            eligibility.activeDays;

        if (
            explicitActiveDays !==
                undefined &&
            explicitActiveDays !==
                null
        ) {
            activeDays =
                toNonNegativeInteger(
                    explicitActiveDays
                );
        } else if (
            policyCurrent
        ) {
            /*
             * Compatibility fallback for current-policy
             * responses only.
             *
             * Never interpret old 24-hour Schema-v2 seconds
             * as valid Policy-v2 progress.
             */

            const compatibilitySeconds =
                toNonNegativeInteger(
                    source.activeSeconds ??
                    source.totalActiveSeconds ??
                    requirements
                        .activeSeconds ??
                    eligibility
                        .activeSeconds
                );

            activeDays =
                Math.floor(
                    compatibilitySeconds /
                    REQUIRED_DAILY_SECONDS
                );
        } else if (
            rewardGranted ||
            status ===
                "rewarded"
        ) {
            /*
             * Historical rewarded records remain displayable.
             * This does not re-run or grant qualification.
             */

            activeDays =
                requiredActiveDays;
        }

        activeDays =
            clamp(
                activeDays,
                0,
                requiredActiveDays
            );

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays -
                    activeDays
            );

        const progressPercent =
            requiredActiveDays > 0
                ? clamp(
                    Number(
                        (
                            activeDays /
                            requiredActiveDays *
                            100
                        ).toFixed(
                            4
                        )
                    ),
                    0,
                    100
                )
                : 100;

        const referredUid =
            toSafeString(
                source.referredUid ||
                source.referredUserId ||
                source.id ||
                fallbackId
            );

        const googleConnected =
            Boolean(
                source.googleConnected ===
                    true ||
                source.isGoogleConnected ===
                    true ||
                requirements
                    .googleConnected ===
                    true ||
                eligibility
                    .googleConnected ===
                    true
            );

        const mobileAdded =
            Boolean(
                source.mobileAdded ===
                    true ||
                requirements
                    .mobileAdded ===
                    true ||
                eligibility
                    .mobileAdded ===
                    true
            );

        const deviceAdded =
            Boolean(
                source.deviceAdded ===
                    true ||
                requirements
                    .deviceAdded ===
                    true ||
                eligibility
                    .deviceAdded ===
                    true
            );

        const activityCompleted =
            Boolean(
                (
                    policyCurrent &&
                    (
                        source.activityCompleted ===
                            true ||
                        source.usingTimeCompleted ===
                            true ||
                        requirements
                            .activityCompleted ===
                            true ||
                        requirements
                            .usingTimeCompleted ===
                            true ||
                        eligibility
                            .activityCompleted ===
                            true ||
                        eligibility
                            .usingTimeCompleted ===
                            true ||
                        activeDays >=
                            requiredActiveDays
                    )
                ) ||
                rewardGranted
            );

        const requirementsCompleted =
            Boolean(
                googleConnected &&
                mobileAdded &&
                deviceAdded &&
                policyCurrent &&
                activityCompleted &&
                activeDays ===
                    REQUIRED_ACTIVE_DAYS
            );

        /*
         * Backend `eligible` remains authoritative.
         *
         * Do not infer new qualification merely because a
         * client-side status string says "qualified".
         *
         * Rewarded historical rows remain valid final records.
         */

        const backendEligible =
            Boolean(
                source.eligible ===
                    true ||
                source.isEligible ===
                    true ||
                eligibility.eligible ===
                    true
            );

        const eligible =
            rewardGranted ||
            (
                backendEligible &&
                requirementsCompleted
            );

        const totalActiveSeconds =
            activeDays *
            REQUIRED_DAILY_SECONDS;

        const requiredActiveSeconds =
            REQUIRED_ACTIVE_SECONDS;

        const remainingActiveSeconds =
            Math.max(
                0,
                requiredActiveSeconds -
                    totalActiveSeconds
            );

        const referredProfile =
            normalizeReferredProfile(
                source.referredProfile ||
                source.referredUser ||
                source.user,
                referredUid
            );

        const mobileNumber =
            toSafeString(
                source.mobileNumber ||
                source.referredProfile
                    ?.mobileNumber
            );

        const deviceId =
            toSafeString(
                source.deviceId ||
                source.referredProfile
                    ?.deviceId
            )
                .toLowerCase();

        return {
            id:
                toSafeString(
                    source.id ||
                    fallbackId ||
                    referredUid
                ),

            referralId:
                toSafeString(
                    source.referralId ||
                    source.id ||
                    fallbackId ||
                    referredUid
                ),

            referrerUid:
                toSafeString(
                    source.referrerUid
                ),

            referredUid,

            referralCode:
                isValidReferralCode(
                    source.referralCode ||
                    source.code
                )
                    ? normalizeReferralCode(
                        source.referralCode ||
                        source.code
                    )
                    : "",

            referredProfile,

            googleConnected,

            mobileAdded,

            /*
             * Device Anti-Abuse / Web Device binding.
             * This is not a claim of immutable hardware identity.
             */
            deviceAdded,

            mobileNumberValid:
                mobileNumber
                    ? isValidBangladeshMobile(
                        mobileNumber
                    )
                    : mobileAdded,

            deviceIdValid:
                deviceId
                    ? isValidDeviceId(
                        deviceId
                    )
                    : deviceAdded,

            activeDays,

            requiredActiveDays,

            remainingActiveDays,

            requiredDailySeconds,

            activityPolicyVersion,

            policyCurrent,

            progressPercent,

            activityCompleted,

            requirementsCompleted,

            eligible,

            status,

            canonicalStatus:
                status,

            statusLabel:
                getStatusLabel(
                    status
                ),

            userVisibleStatus:
                getUserVisibleStatus(
                    status
                ),

            userVisibleStatusLabel:
                getUserVisibleStatusLabel(
                    status
                ),

            legacyStatus:
                getLegacyStatus(
                    status
                ),

            rewardAmount:
                toNonNegativeInteger(
                    source.rewardAmount,
                    1000
                ) ||
                1000,

            rewardGranted,

            adminNote:
                toSafeString(
                    source.adminNote ||
                    source.reviewNote ||
                    source.rejectionReason
                ),

            rewardGrantedAt:
                serializeTimestamp(
                    source.rewardGrantedAt ||
                    source.rewardedAt
                ),

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            capturedAt:
                serializeTimestamp(
                    source.capturedAt ||
                    source.observedAt
                ),

            qualifiedAt:
                serializeTimestamp(
                    source.qualifiedAt ||
                    source.eligibleAt
                ),

            reviewedAt:
                serializeTimestamp(
                    source.reviewedAt
                ),

            approvedAt:
                serializeTimestamp(
                    source.approvedAt
                ),

            rejectedAt:
                serializeTimestamp(
                    source.rejectedAt
                ),

            rewardedAt:
                serializeTimestamp(
                    source.rewardedAt ||
                    source.rewardGrantedAt
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                ),

            /*
             * Compatibility aliases.
             *
             * One Active Day = 7200 eligible seconds.
             * These aliases are read-only and are never used
             * by this module to grant referral eligibility.
             */

            activeSeconds:
                totalActiveSeconds,

            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds,

            usingTimeCompleted:
                activityCompleted
        };
    }

    function normalizeReferralList(
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
                    normalizeReferralRecord(
                        referral,
                        referral?.id
                    )
            )
            .filter(
                referral =>
                    Boolean(
                        referral.id ||
                        referral.referredUid
                    )
            );
    }

    function mergeUniqueReferralRecords(
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
                        referral?.id ||
                        referral?.referredUid
                    );

                if (
                    referralId
                ) {
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

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return cloneValue({
            initialized:
                state.initialized,

            loading:
                state.loading,

            loadingMore:
                state.loadingMore,

            currentUser:
                state.currentUser
                    ? {
                        uid:
                            toSafeString(
                                state.currentUser
                                    .uid
                            ),

                        email:
                            toSafeString(
                                state.currentUser
                                    .email
                            )
                    }
                    : null,

            statusFilter:
                state.statusFilter,

            limit:
                state.limit,

            stats:
                state.stats,

            referrals:
                state.referrals,

            nextCursor:
                state.nextCursor,

            hasMore:
                state.hasMore,

            referralCode:
                state.referralCode,

            referralLink:
                state.referralLink,

            referralSource:
                state.referralSource,

            isGuestReferral:
                state.referralSource ===
                REFERRAL_SOURCE_GUEST,

            isPublicAdminReferral:
                false,

            publicReferralUpdatedAt:
                state
                    .publicReferralUpdatedAt,

            lastUpdatedAt:
                state.lastUpdatedAt,

            error:
                state.error
        });
    }

    function notify(
        eventName =
            EVENT_UPDATED
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
                        "[ReferralDB] Subscriber failed.",
                        error
                    );
                }
            }
        );

        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail:
                        snapshot
                }
            )
        );

        return snapshot;
    }

    function notifyPublicLinkUpdated() {
        const snapshot =
            notify();

        window.dispatchEvent(
            new CustomEvent(
                EVENT_PUBLIC_LINK_UPDATED,
                {
                    detail:
                        snapshot
                }
            )
        );

        return snapshot;
    }

    function setLoading(value) {
        const loading =
            value ===
            true;

        if (
            state.loading ===
            loading
        ) {
            return false;
        }

        state.loading =
            loading;

        notify(
            EVENT_LOADING
        );

        return true;
    }

    function setLoadingMore(value) {
        const loadingMore =
            value ===
            true;

        if (
            state.loadingMore ===
            loadingMore
        ) {
            return false;
        }

        state.loadingMore =
            loadingMore;

        notify(
            EVENT_LOADING
        );

        return true;
    }

    function resetReferralPagination(
        options = {}
    ) {
        if (
            options.clearReferrals ===
            true
        ) {
            state.referrals =
                [];
        }

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.loadingMore =
            false;

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    options,
                    "status"
                )
        ) {
            state.statusFilter =
                normalizeStatus(
                    options.status
                );
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    options,
                    "limit"
                )
        ) {
            state.limit =
                toSafeLimit(
                    options.limit
                );
        }

        return {
            nextCursor:
                state.nextCursor,

            hasMore:
                state.hasMore
        };
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

        notify(
            EVENT_ERROR
        );

        return state.error;
    }

    function reportAccessBlocked(
        reason
    ) {
        state.error = {
            code:
                "referral-access-blocked",

            message:
                "Verified Google sign-in is required.",

            field:
                "",

            reason:
                toSafeString(
                    reason
                ),

            details:
                null
        };

        notify(
            EVENT_ACCESS_BLOCKED
        );

        return getState();
    }

    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    function resolveAuth() {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (
            configuredAuth
        ) {
            return configuredAuth;
        }

        if (
            window.firebase &&
            typeof window.firebase.auth ===
                "function"
        ) {
            try {
                return window.firebase
                    .auth();
            } catch {
                return null;
            }
        }

        return null;
    }

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

                if (
                    user?.uid
                ) {
                    return user;
                }
            } catch {
                /*
                 * Continue.
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

                if (
                    user?.uid
                ) {
                    return user;
                }
            } catch {
                /*
                 * Continue.
                 */
            }
        }

        return (
            resolveAuth()
                ?.currentUser ||
            null
        );
    }

    async function waitForAuthReady() {
        const authGuard =
            window.AuthGuard ||
            null;

        if (
            authGuard &&
            typeof authGuard.whenReady ===
                "function"
        ) {
            try {
                await authGuard
                    .whenReady();
            } catch (error) {
                console.warn(
                    "[ReferralDB] AuthGuard initialization did not complete.",
                    error
                );
            }
        }

        if (
            window.AuthService &&
            typeof window.AuthService
                .whenReady ===
                "function"
        ) {
            try {
                await window.AuthService
                    .whenReady();
            } catch (error) {
                console.warn(
                    "[ReferralDB] AuthService initialization did not complete.",
                    error
                );
            }
        }

        return resolveCurrentUser();
    }

    function getProviderIds(user) {
        if (
            Array.isArray(
                user?.providerIds
            )
        ) {
            return Array.from(
                new Set(
                    user.providerIds
                        .map(
                            toSafeString
                        )
                        .filter(
                            Boolean
                        )
                )
            );
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            return Array.from(
                new Set(
                    user.providerData
                        .map(
                            provider =>
                                toSafeString(
                                    provider
                                        ?.providerId
                                )
                        )
                        .filter(
                            Boolean
                        )
                )
            );
        }

        return [];
    }

    function hasReferralAccess(user) {
        if (
            !user?.uid
        ) {
            return false;
        }

        const guardState =
            window.AuthGuard &&
            typeof window.AuthGuard
                .getState ===
                "function"
                ? window.AuthGuard
                    .getState()
                : null;

        if (
            guardState?.initialized ===
                true &&
            guardState.uid ===
                user.uid
        ) {
            return Boolean(
                guardState.authenticated &&
                guardState.googleConnected &&
                guardState.googleSignIn &&
                guardState.emailVerified
            );
        }

        const authServiceUser =
            window.AuthService &&
            typeof window.AuthService
                .getCurrentUser ===
                "function"
                ? window.AuthService
                    .getCurrentUser()
                : null;

        if (
            authServiceUser?.uid ===
                user.uid
        ) {
            return Boolean(
                authServiceUser
                    .emailVerified ===
                    true &&
                authServiceUser
                    .isGoogleConnected ===
                    true &&
                authServiceUser
                    .isGoogleSignIn ===
                    true
            );
        }

        const providerIds =
            getProviderIds(
                user
            );

        return Boolean(
            user.emailVerified ===
                true &&
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            ) &&
            user.isGoogleSignIn ===
                true
        );
    }

    async function verifyReferralAccess(
        user
    ) {
        if (
            !user?.uid
        ) {
            return false;
        }

        if (
            hasReferralAccess(
                user
            )
        ) {
            return true;
        }

        const providerIds =
            getProviderIds(
                user
            );

        if (
            user.emailVerified !==
                true ||
            !providerIds.includes(
                GOOGLE_PROVIDER_ID
            )
        ) {
            return false;
        }

        if (
            typeof user
                .getIdTokenResult !==
                "function"
        ) {
            return false;
        }

        try {
            const tokenResult =
                await user
                    .getIdTokenResult(
                        false
                    );

            const signInProvider =
                toSafeString(
                    tokenResult
                        ?.signInProvider ||
                    tokenResult
                        ?.claims
                        ?.firebase
                        ?.sign_in_provider
                );

            return (
                signInProvider ===
                GOOGLE_PROVIDER_ID
            );
        } catch (error) {
            console.warn(
                "[ReferralDB] Google session verification failed.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       SIGNED-IN USER REFERRAL IDENTITY
    ===================================================== */

    function readCurrentProfile() {
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

                if (
                    profile
                ) {
                    return profile;
                }
            } catch {
                /*
                 * Continue.
                 */
            }
        }

        if (
            window.ProfileService &&
            typeof window.ProfileService
                .getUser ===
                "function"
        ) {
            try {
                return (
                    window.ProfileService
                        .getUser() ||
                    null
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    function getMatchingCurrentProfile(
        uid
    ) {
        const profile =
            readCurrentProfile();

        if (
            !isPlainObject(
                profile
            )
        ) {
            return null;
        }

        const profileUid =
            toSafeString(
                profile.uid ||
                profile.userId
            );

        return (
            profileUid &&
            profileUid ===
                toSafeString(
                    uid
                )
        )
            ? profile
            : null;
    }

    function extractProfileFromResult(
        result
    ) {
        const source =
            unwrapCallableResult(
                result
            );

        if (
            isPlainObject(
                source?.profile
            )
        ) {
            return source.profile;
        }

        if (
            isPlainObject(
                source?.user
            ) &&
            source.user.uid
        ) {
            return source.user;
        }

        if (
            isPlainObject(
                source
            ) &&
            source.uid
        ) {
            return source;
        }

        return null;
    }

    function isCurrentIdentityOperation(
        uid,
        generation
    ) {
        return Boolean(
            uid &&
            generation ===
                dataGeneration &&
            resolveCurrentUser()
                ?.uid ===
                uid
        );
    }

    function synchronizeReferralIdentity() {
        const currentUser =
            resolveCurrentUser();

        /*
         * Guest:
         * canonical main-site URL.
         */

        if (
            !currentUser?.uid
        ) {
            return setReferralIdentity(
                getGuestReferralIdentity(),
                REFERRAL_SOURCE_GUEST
            );
        }

        /*
         * Signed-in but not verified:
         * do not fall back to a Guest referral link.
         */

        if (
            !hasReferralAccess(
                currentUser
            )
        ) {
            return clearActiveReferralIdentity();
        }

        const profileIdentity =
            normalizeReferralIdentity(
                getMatchingCurrentProfile(
                    currentUser.uid
                ) ||
                {}
            );

        return setReferralIdentity(
            profileIdentity,
            profileIdentity.referralLink
                ? REFERRAL_SOURCE_USER
                : ""
        );
    }

    async function ensureCurrentUserReferralIdentity(
        options = {}
    ) {
        const user =
            resolveCurrentUser();

        if (
            !user?.uid
        ) {
            return {
                success:
                    false,

                referralCode:
                    "",

                referralLink:
                    CANONICAL_REFERRAL_BASE_URL,

                source:
                    REFERRAL_SOURCE_GUEST,

                referralSource:
                    REFERRAL_SOURCE_GUEST,

                isGuestReferral:
                    true,

                isPublicAdminReferral:
                    false
            };
        }

        const uid =
            user.uid;

        if (
            ownIdentityPromise &&
            ownIdentityUid ===
                uid
        ) {
            return ownIdentityPromise;
        }

        const expectedGeneration =
            dataGeneration;

        const operationPromise =
            (async () => {
                const accessAllowed =
                    await verifyReferralAccess(
                        user
                    );

                if (
                    !accessAllowed
                ) {
                    throw createReferralError(
                        "verified-google-sign-in-required",
                        "Verified direct Google sign-in is required."
                    );
                }

                if (
                    !isCurrentIdentityOperation(
                        uid,
                        expectedGeneration
                    )
                ) {
                    return {
                        success:
                            false,

                        stale:
                            true,

                        referralCode:
                            "",

                        referralLink:
                            "",

                        source:
                            "",

                        referralSource:
                            "",

                        isGuestReferral:
                            false,

                        isPublicAdminReferral:
                            false
                    };
                }

                const profileDB =
                    window.ProfileDB ||
                    null;

                if (
                    !profileDB
                ) {
                    throw createReferralError(
                        "profile-db-not-loaded",
                        "ProfileDB is not loaded."
                    );
                }

                if (
                    typeof profileDB.init ===
                        "function"
                ) {
                    await profileDB.init();
                }

                if (
                    typeof profileDB.whenReady ===
                        "function"
                ) {
                    await profileDB
                        .whenReady();
                }

                if (
                    !isCurrentIdentityOperation(
                        uid,
                        expectedGeneration
                    )
                ) {
                    return {
                        success:
                            false,

                        stale:
                            true,

                        referralCode:
                            "",

                        referralLink:
                            "",

                        source:
                            "",

                        referralSource:
                            "",

                        isGuestReferral:
                            false,

                        isPublicAdminReferral:
                            false
                    };
                }

                let profile =
                    getMatchingCurrentProfile(
                        uid
                    );

                let identity =
                    normalizeReferralIdentity(
                        profile ||
                        {}
                    );

                if (
                    !identity.referralLink &&
                    typeof profileDB
                        .ensureProfile ===
                        "function"
                ) {
                    const ensureResult =
                        await profileDB
                            .ensureProfile();

                    profile =
                        extractProfileFromResult(
                            ensureResult
                        ) ||
                        getMatchingCurrentProfile(
                            uid
                        );

                    identity =
                        normalizeReferralIdentity(
                            profile ||
                            {}
                        );
                }

                if (
                    !identity.referralLink &&
                    typeof profileDB
                        .refresh ===
                        "function"
                ) {
                    const refreshResult =
                        await profileDB
                            .refresh();

                    profile =
                        extractProfileFromResult(
                            refreshResult
                        ) ||
                        getMatchingCurrentProfile(
                            uid
                        );

                    identity =
                        normalizeReferralIdentity(
                            profile ||
                            {}
                        );
                }

                for (
                    const delay of
                    PROFILE_IDENTITY_RETRY_DELAYS_MS
                ) {
                    if (
                        identity.referralCode &&
                        identity.referralLink
                    ) {
                        break;
                    }

                    if (
                        delay > 0
                    ) {
                        await wait(
                            delay
                        );
                    }

                    if (
                        !isCurrentIdentityOperation(
                            uid,
                            expectedGeneration
                        )
                    ) {
                        return {
                            success:
                                false,

                            stale:
                                true,

                            referralCode:
                                "",

                            referralLink:
                                "",

                            source:
                                "",

                            referralSource:
                                "",

                            isGuestReferral:
                                false,

                            isPublicAdminReferral:
                                false
                        };
                    }

                    identity =
                        normalizeReferralIdentity(
                            getMatchingCurrentProfile(
                                uid
                            ) ||
                            {}
                        );
                }

                if (
                    !identity.referralCode ||
                    !identity.referralLink
                ) {
                    throw createReferralError(
                        "user-referral-link-unavailable",
                        "The user referral link is not available."
                    );
                }

                if (
                    !isCurrentIdentityOperation(
                        uid,
                        expectedGeneration
                    )
                ) {
                    return {
                        success:
                            false,

                        stale:
                            true,

                        referralCode:
                            "",

                        referralLink:
                            "",

                        source:
                            "",

                        referralSource:
                            "",

                        isGuestReferral:
                            false,

                        isPublicAdminReferral:
                            false
                    };
                }

                const resolvedIdentity =
                    setReferralIdentity(
                        identity,
                        REFERRAL_SOURCE_USER
                    );

                clearError();

                if (
                    options.notifyChange !==
                        false
                ) {
                    notify();
                }

                return {
                    success:
                        true,

                    ...resolvedIdentity
                };
            })();

        ownIdentityUid =
            uid;

        ownIdentityPromise =
            operationPromise;

        try {
            return await operationPromise;
        } finally {
            if (
                ownIdentityPromise ===
                    operationPromise
            ) {
                ownIdentityUid =
                    "";

                ownIdentityPromise =
                    null;
            }
        }
    }

    function getReferralIdentity() {
        return {
            ...synchronizeReferralIdentity()
        };
    }

    /* =====================================================
       GUEST MAIN-SITE SHARE LINK

       Compatibility method name:
       loadPublicAdminReferral()

       No Admin referral is loaded.
       No Firestore read is performed.
    ===================================================== */

    async function loadPublicAdminReferral(
        options = {}
    ) {
        const updatedAt =
            guestReferralCache
                .updatedAt ||
            new Date()
                .toISOString();

        guestReferralCache
            .referralCode =
            "";

        guestReferralCache
            .referralLink =
            CANONICAL_REFERRAL_BASE_URL;

        guestReferralCache
            .updatedAt =
            updatedAt;

        const user =
            resolveCurrentUser();

        if (
            !user?.uid
        ) {
            setReferralIdentity(
                getGuestReferralIdentity(),
                REFERRAL_SOURCE_GUEST
            );

            state.publicReferralUpdatedAt =
                updatedAt;

            clearError();

            if (
                options.notifyChange !==
                    false
            ) {
                notifyPublicLinkUpdated();
            }
        }

        return {
            success:
                true,

            referralCode:
                "",

            referralLink:
                CANONICAL_REFERRAL_BASE_URL,

            source:
                REFERRAL_SOURCE_GUEST,

            referralSource:
                REFERRAL_SOURCE_GUEST,

            isGuestReferral:
                true,

            isPublicAdminReferral:
                false,

            cached:
                true
        };
    }

    /* =====================================================
       SPARK CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (
            !client
        ) {
            throw createReferralError(
                "functions-client-not-loaded",
                "Firebase Spark Client is not loaded."
            );
        }

        return client;
    }

    async function callBackend(
        methodName,
        functionName,
        payload = {}
    ) {
        const client =
            requireFunctionsClient();

        if (
            typeof client[
                methodName
            ] ===
                "function"
        ) {
            return unwrapCallableResult(
                await client[
                    methodName
                ](
                    payload
                )
            );
        }

        if (
            typeof client.call ===
                "function"
        ) {
            return unwrapCallableResult(
                await client.call(
                    functionName,
                    payload
                )
            );
        }

        throw createReferralError(
            "client-method-unavailable",
            `Client method is unavailable: ${functionName}`
        );
    }

    function extractStats(result) {
        if (
            isPlainObject(
                result?.stats
            )
        ) {
            return result.stats;
        }

        if (
            isPlainObject(
                result
            ) &&
            (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "total"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "pending"
                    )
            )
        ) {
            return result;
        }

        return {};
    }

    function extractReferrals(result) {
        if (
            Array.isArray(
                result?.referrals
            )
        ) {
            return result.referrals;
        }

        return Array.isArray(
            result
        )
            ? result
            : [];
    }

    function extractReferralPage(
        result,
        options = {}
    ) {
        const expectedStatus =
            normalizeStatus(
                options.status
            );

        const responseStatusValue =
            toSafeString(
                result?.status
            );

        const responseStatus =
            normalizeStatus(
                responseStatusValue
            );

        if (
            responseStatusValue &&
            responseStatus !==
                expectedStatus
        ) {
            throw createReferralError(
                "referral-page-status-mismatch",
                "Referral pagination response does not match the requested status."
            );
        }

        const referrals =
            normalizeReferralList(
                extractReferrals(
                    result
                )
            );

        const reportedHasMore =
            result?.hasMore ===
            true;

        const nextCursor =
            reportedHasMore
                ? toSafeString(
                    result?.nextCursor
                )
                : "";

        if (
            reportedHasMore &&
            !nextCursor
        ) {
            throw createReferralError(
                "invalid-referral-pagination-response",
                "Referral pagination response is missing its next cursor."
            );
        }

        const requestCursor =
            toSafeString(
                options.cursor
            );

        if (
            reportedHasMore &&
            requestCursor &&
            nextCursor ===
                requestCursor
        ) {
            throw createReferralError(
                "repeated-referral-pagination-cursor",
                "Referral pagination returned the same cursor twice."
            );
        }

        return {
            referrals,

            hasMore:
                reportedHasMore &&
                Boolean(
                    nextCursor
                ),

            nextCursor
        };
    }

    function applyReferralPage(
        result,
        options = {}
    ) {
        const page =
            extractReferralPage(
                result,
                options
            );

        state.referrals =
            options.append ===
                true
                ? mergeUniqueReferralRecords(
                    state.referrals,
                    page.referrals
                )
                : page.referrals;

        state.nextCursor =
            page.nextCursor;

        state.hasMore =
            page.hasMore;

        return page;
    }

    /* =====================================================
       DATA LOADING
    ===================================================== */

    async function refreshStats(
        options = {}
    ) {
        const user =
            resolveCurrentUser();

        const initialUid =
            toSafeString(
                user?.uid
            );

        const initialGeneration =
            dataGeneration;

        const accessAllowed =
            Boolean(
                initialUid &&
                await verifyReferralAccess(
                    user
                )
            );

        if (
            initialGeneration !==
                dataGeneration ||
            resolveCurrentUser()
                ?.uid !==
                (
                    initialUid ||
                    undefined
                )
        ) {
            return cloneValue(
                state.stats
            );
        }

        if (
            !accessAllowed
        ) {
            state.stats =
                createEmptyStats();

            synchronizeProfileServiceStats();

            if (
                options.notifyChange !==
                    false
            ) {
                notify();
            }

            return cloneValue(
                state.stats
            );
        }

        const expectedUid =
            initialUid;

        const expectedGeneration =
            initialGeneration;

        const requestId =
            ++statsRequestSequence;

        try {
            const result =
                await callBackend(
                    "getMyReferralStats",
                    "getMyReferralStats",
                    {}
                );

            if (
                requestId !==
                    statsRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.stats
                );
            }

            state.stats =
                normalizeStats(
                    extractStats(
                        result
                    ),
                    expectedUid
                );

            synchronizeProfileServiceStats();

            if (
                options.notifyChange !==
                    false
            ) {
                notify();
            }

            return cloneValue(
                state.stats
            );
        } catch (error) {
            if (
                requestId ===
                    statsRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        }
    }

    async function refreshReferrals(
        options = {}
    ) {
        const user =
            resolveCurrentUser();

        const append =
            options.append ===
            true;

        const initialUid =
            toSafeString(
                user?.uid
            );

        const initialGeneration =
            dataGeneration;

        let reservedRequestId =
            0;

        if (
            !append
        ) {
            refreshRequestSequence +=
                1;

            reservedRequestId =
                ++referralsRequestSequence;
        }

        const accessAllowed =
            Boolean(
                initialUid &&
                await verifyReferralAccess(
                    user
                )
            );

        if (
            initialGeneration !==
                dataGeneration ||
            resolveCurrentUser()
                ?.uid !==
                (
                    initialUid ||
                    undefined
                ) ||
            (
                !append &&
                reservedRequestId !==
                    referralsRequestSequence
            )
        ) {
            return cloneValue(
                state.referrals
            );
        }

        if (
            !accessAllowed
        ) {
            resetReferralPagination({
                clearReferrals:
                    true
            });

            if (
                options.notifyChange !==
                    false
            ) {
                notify();
            }

            return cloneValue(
                state.referrals
            );
        }

        const rawStatus =
            options.status ??
            state.statusFilter;

        if (
            !isSupportedStatus(
                rawStatus
            )
        ) {
            throw new TypeError(
                "Unsupported referral status."
            );
        }

        const normalizedStatus =
            normalizeStatus(
                rawStatus
            );

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        if (
            append &&
            normalizedStatus !==
                state.statusFilter
        ) {
            throw new TypeError(
                "Referral pagination status does not match the active filter."
            );
        }

        const cursor =
            append
                ? toSafeString(
                    options.cursor ??
                    state.nextCursor
                )
                : "";

        if (
            append &&
            (
                state.loading ||
                state.loadingMore ||
                !state.hasMore ||
                !cursor
            )
        ) {
            return cloneValue(
                state.referrals
            );
        }

        const statusChanged =
            normalizedStatus !==
            state.statusFilter;

        if (
            !append &&
            statusChanged
        ) {
            resetReferralPagination({
                clearReferrals:
                    true,

                status:
                    normalizedStatus,

                limit:
                    normalizedLimit
            });
        }

        const payload = {
            limit:
                normalizedLimit
        };

        if (
            normalizedStatus
        ) {
            payload.status =
                normalizedStatus;
        }

        if (
            cursor
        ) {
            payload.cursor =
                cursor;
        }

        const expectedUid =
            initialUid;

        const expectedGeneration =
            initialGeneration;

        const requestId =
            append
                ? ++referralsRequestSequence
                : reservedRequestId;

        lastRefreshStartedAt =
            Date.now();

        state.currentUser =
            user;

        state.statusFilter =
            normalizedStatus;

        state.limit =
            normalizedLimit;

        clearError();

        if (
            append
        ) {
            setLoadingMore(
                true
            );
        } else {
            state.loadingMore =
                false;

            setLoading(
                true
            );
        }

        try {
            const result =
                await callBackend(
                    "getMyReferrals",
                    "getMyReferrals",
                    payload
                );

            if (
                requestId !==
                    referralsRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.referrals
                );
            }

            applyReferralPage(
                result,
                {
                    append,
                    cursor,

                    status:
                        normalizedStatus
                }
            );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            if (
                options.notifyChange !==
                    false
            ) {
                notify();
            }

            return cloneValue(
                state.referrals
            );
        } catch (error) {
            if (
                requestId ===
                    referralsRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            if (
                requestId ===
                    referralsRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                if (
                    append
                ) {
                    setLoadingMore(
                        false
                    );
                } else {
                    setLoading(
                        false
                    );
                }

                if (
                    options.notifyChange !==
                        false
                ) {
                    notify();
                }
            }
        }
    }

    async function refresh(
        options = {}
    ) {
        const user =
            resolveCurrentUser();

        /* =================================================
           GUEST

           No Firebase read is required for the Guest link.
           Guest always receives the canonical main-site URL.
        ================================================= */

        if (
            !user?.uid
        ) {
            reset({
                preserveInitialization:
                    true,

                preserveGuestReferral:
                    true
            });

            await loadPublicAdminReferral({
                notifyChange:
                    false
            });

            notify();

            return getState();
        }

        /* =================================================
           SIGNED-IN USER
        ================================================= */

        const initialUid =
            user.uid;

        const initialGeneration =
            dataGeneration;

        const referralAccessAllowed =
            await verifyReferralAccess(
                user
            );

        if (
            initialGeneration !==
                dataGeneration ||
            resolveCurrentUser()
                ?.uid !==
                initialUid
        ) {
            return getState();
        }

        if (
            !referralAccessAllowed
        ) {
            reset({
                preserveInitialization:
                    true,

                preserveCurrentUser:
                    true,

                preserveGuestReferral:
                    true
            });

            state.currentUser =
                user;

            clearActiveReferralIdentity();

            return reportAccessBlocked(
                "verified_google_sign_in_required"
            );
        }

        const force =
            options.force ===
            true;

        const rawStatus =
            options.status ??
            state.statusFilter;

        if (
            !isSupportedStatus(
                rawStatus
            )
        ) {
            throw new TypeError(
                "Unsupported referral status."
            );
        }

        const normalizedStatus =
            normalizeStatus(
                rawStatus
            );

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        const statusChanged =
            normalizedStatus !==
            state.statusFilter;

        const limitChanged =
            normalizedLimit !==
            state.limit;

        const now =
            Date.now();

        if (
            !force &&
            (
                state.loading ||
                state.loadingMore
            )
        ) {
            return getState();
        }

        if (
            !force &&
            !statusChanged &&
            !limitChanged &&
            state.lastUpdatedAt &&
            state.referralLink &&
            now -
                lastRefreshStartedAt <
                REFRESH_COOLDOWN_MS
        ) {
            return getState();
        }

        const expectedUid =
            initialUid;

        const expectedGeneration =
            initialGeneration;

        const refreshRequestId =
            ++refreshRequestSequence;

        const statsRequestId =
            ++statsRequestSequence;

        const referralsRequestId =
            ++referralsRequestSequence;

        lastRefreshStartedAt =
            now;

        state.currentUser =
            user;

        if (
            statusChanged
        ) {
            resetReferralPagination({
                clearReferrals:
                    true,

                status:
                    normalizedStatus,

                limit:
                    normalizedLimit
            });
        } else {
            state.statusFilter =
                normalizedStatus;

            state.limit =
                normalizedLimit;

            state.loadingMore =
                false;
        }

        synchronizeReferralIdentity();

        clearError();

        setLoading(
            true
        );

        const referralPayload = {
            limit:
                normalizedLimit
        };

        if (
            normalizedStatus
        ) {
            referralPayload.status =
                normalizedStatus;
        }

        try {
            await ensureCurrentUserReferralIdentity({
                notifyChange:
                    true
            });

            if (
                refreshRequestId !==
                    refreshRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            const [
                statsResult,
                referralsResult
            ] =
                await Promise.all([
                    callBackend(
                        "getMyReferralStats",
                        "getMyReferralStats",
                        {}
                    ),

                    callBackend(
                        "getMyReferrals",
                        "getMyReferrals",
                        referralPayload
                    )
                ]);

            if (
                refreshRequestId !==
                    refreshRequestSequence ||
                statsRequestId !==
                    statsRequestSequence ||
                referralsRequestId !==
                    referralsRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            state.stats =
                normalizeStats(
                    extractStats(
                        statsResult
                    ),
                    expectedUid
                );

            applyReferralPage(
                referralsResult,
                {
                    append:
                        false,

                    cursor:
                        "",

                    status:
                        normalizedStatus
                }
            );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            synchronizeProfileServiceStats();

            return getState();
        } catch (error) {
            if (
                refreshRequestId ===
                    refreshRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            if (
                refreshRequestId ===
                    refreshRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setLoading(
                    false
                );

                notify();
            }
        }
    }

    /* =====================================================
       FILTERING / PAGINATION
    ===================================================== */

    async function setStatusFilter(
        status,
        options = {}
    ) {
        if (
            !isSupportedStatus(
                status
            )
        ) {
            throw new TypeError(
                "Unsupported referral status."
            );
        }

        const normalizedStatus =
            normalizeStatus(
                status
            );

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        refreshRequestSequence +=
            1;

        referralsRequestSequence +=
            1;

        resetReferralPagination({
            clearReferrals:
                true,

            status:
                normalizedStatus,

            limit:
                normalizedLimit
        });

        clearError();

        notify(
            EVENT_FILTER_CHANGED
        );

        await refreshReferrals({
            append:
                false,

            status:
                normalizedStatus,

            limit:
                normalizedLimit,

            notifyChange:
                true
        });

        return getState();
    }

    function clearStatusFilter(
        options = {}
    ) {
        return setStatusFilter(
            "",
            options
        );
    }

    async function loadMore(
        options = {}
    ) {
        if (
            state.loading ||
            state.loadingMore ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        const normalizedOptions =
            isPlainObject(
                options
            )
                ? options
                : {};

        await refreshReferrals({
            append:
                true,

            cursor:
                state.nextCursor,

            status:
                state.statusFilter,

            limit:
                normalizedOptions
                    .limit ??
                state.limit,

            notifyChange:
                normalizedOptions
                    .notifyChange !==
                false
        });

        return getState();
    }

    /* =====================================================
       COPY ACTIVE LINK
    ===================================================== */

    async function copyTextFallback(
        text
    ) {
        if (
            !document.body
        ) {
            return false;
        }

        const textArea =
            document.createElement(
                "textarea"
            );

        textArea.value =
            text;

        textArea.setAttribute(
            "readonly",
            ""
        );

        textArea.style.position =
            "fixed";

        textArea.style.left =
            "-9999px";

        textArea.style.opacity =
            "0";

        textArea.style.pointerEvents =
            "none";

        document.body.appendChild(
            textArea
        );

        textArea.select();

        let copied =
            false;

        try {
            copied =
                document.execCommand(
                    "copy"
                );
        } catch {
            copied =
                false;
        } finally {
            textArea.remove();
        }

        return copied;
    }

    async function copyReferralLink() {
        const user =
            resolveCurrentUser();

        let identity =
            getReferralIdentity();

        if (
            user?.uid &&
            !identity.referralLink
        ) {
            await ensureCurrentUserReferralIdentity({
                notifyChange:
                    true
            });

            identity =
                getReferralIdentity();
        }

        if (
            !user?.uid
        ) {
            identity =
                getGuestReferralIdentity();

            setReferralIdentity(
                identity,
                REFERRAL_SOURCE_GUEST
            );
        }

        if (
            !identity.referralLink
        ) {
            throw createReferralError(
                "referral-link-unavailable",
                "Referral link is not available."
            );
        }

        let copied =
            false;

        if (
            window.navigator
                ?.clipboard &&
            typeof window.navigator
                .clipboard
                .writeText ===
                "function"
        ) {
            try {
                await window.navigator
                    .clipboard
                    .writeText(
                        identity.referralLink
                    );

                copied =
                    true;
            } catch {
                copied =
                    false;
            }
        }

        if (
            !copied
        ) {
            copied =
                await copyTextFallback(
                    identity.referralLink
                );
        }

        if (
            !copied
        ) {
            throw createReferralError(
                "referral-link-copy-failed",
                "Referral link could not be copied."
            );
        }

        const isGuestReferral =
            !user?.uid;

        const result = {
            success:
                true,

            referralCode:
                isGuestReferral
                    ? ""
                    : identity
                        .referralCode,

            referralLink:
                identity.referralLink,

            referralSource:
                isGuestReferral
                    ? REFERRAL_SOURCE_GUEST
                    : REFERRAL_SOURCE_USER,

            isGuestReferral,

            isPublicAdminReferral:
                false
        };

        window.dispatchEvent(
            new CustomEvent(
                EVENT_LINK_COPIED,
                {
                    detail:
                        result
                }
            )
        );

        return result;
    }

    /* =====================================================
       RESET
    ===================================================== */

    function reset(
        options = {}
    ) {
        dataGeneration +=
            1;

        refreshRequestSequence +=
            1;

        statsRequestSequence +=
            1;

        referralsRequestSequence +=
            1;

        ownIdentityUid =
            "";

        ownIdentityPromise =
            null;

        state.initialized =
            options.preserveInitialization ===
                true
                ? state.initialized
                : false;

        state.loading =
            false;

        state.loadingMore =
            false;

        if (
            options.preserveCurrentUser !==
                true
        ) {
            state.currentUser =
                null;
        }

        state.statusFilter =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.stats =
            createEmptyStats(
                options.preserveCurrentUser ===
                    true
                    ? state.currentUser
                        ?.uid
                    : ""
            );

        state.referrals =
            [];

        state.nextCursor =
            "";

        state.hasMore =
            false;

        const preserveGuestReferral =
            options.preserveGuestReferral !==
            false;

        if (
            preserveGuestReferral &&
            !state.currentUser?.uid
        ) {
            const guestIdentity =
                getGuestReferralIdentity();

            state.referralCode =
                "";

            state.referralLink =
                guestIdentity
                    .referralLink;

            state.referralSource =
                REFERRAL_SOURCE_GUEST;

            state.publicReferralUpdatedAt =
                guestReferralCache
                    .updatedAt;
        } else {
            state.referralCode =
                "";

            state.referralLink =
                "";

            state.referralSource =
                "";

            state.publicReferralUpdatedAt =
                null;
        }

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        lastRefreshStartedAt =
            0;

        synchronizeProfileServiceStats();

        notify();

        return getState();
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function handleProfileUpdated() {
        const user =
            resolveCurrentUser();

        if (
            user?.uid
        ) {
            void ensureCurrentUserReferralIdentity({
                notifyChange:
                    true
            }).catch(
                error => {
                    setError(
                        error
                    );
                }
            );

            return;
        }

        setReferralIdentity(
            getGuestReferralIdentity(),
            REFERRAL_SOURCE_GUEST
        );

        notifyPublicLinkUpdated();
    }

    function handleReferralRefresh() {
        const user =
            resolveCurrentUser();

        if (
            user?.uid
        ) {
            void refresh({
                force:
                    true
            }).catch(
                () => {
                    /*
                     * Error already published.
                     */
                }
            );

            return;
        }

        void loadPublicAdminReferral({
            notifyChange:
                true
        });
    }

    function handleWindowFocus() {
        const user =
            resolveCurrentUser();

        if (
            state.loading ||
            state.loadingMore
        ) {
            return;
        }

        if (
            !user?.uid
        ) {
            if (
                state.referralSource !==
                    REFERRAL_SOURCE_GUEST ||
                state.referralLink !==
                    CANONICAL_REFERRAL_BASE_URL
            ) {
                void loadPublicAdminReferral({
                    notifyChange:
                        true
                });
            }

            return;
        }

        const lastUpdatedMilliseconds =
            state.lastUpdatedAt
                ? new Date(
                    state.lastUpdatedAt
                ).getTime()
                : 0;

        if (
            !state.referralLink ||
            !lastUpdatedMilliseconds ||
            Date.now() -
                lastUpdatedMilliseconds >=
                REFRESH_COOLDOWN_MS
        ) {
            void refresh({
                force:
                    !state.referralLink
            }).catch(
                () => {
                    /*
                     * Error already published.
                     */
                }
            );
        }
    }

    function handleVisibilityChange() {
        if (
            document.visibilityState ===
                "visible"
        ) {
            handleWindowFocus();
        }
    }

    function bindBrowserEvents() {
        if (
            boundEvents
        ) {
            return true;
        }

        boundEvents =
            true;

        window.addEventListener(
            "profile:data-changed",
            handleProfileUpdated
        );

        window.addEventListener(
            "profile:updated",
            handleProfileUpdated
        );

        window.addEventListener(
            "PROFILE_UPDATED",
            handleProfileUpdated
        );

        window.addEventListener(
            "profile:ensure-success",
            handleProfileUpdated
        );

        window.addEventListener(
            "auth:state-changed",
            handleProfileUpdated
        );

        window.addEventListener(
            "profile:auth-changed",
            handleProfileUpdated
        );

        window.addEventListener(
            "referral:refresh",
            handleReferralRefresh
        );

        window.addEventListener(
            "focus",
            handleWindowFocus
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        return true;
    }

    function unbindBrowserEvents() {
        if (
            !boundEvents
        ) {
            return true;
        }

        boundEvents =
            false;

        window.removeEventListener(
            "profile:data-changed",
            handleProfileUpdated
        );

        window.removeEventListener(
            "profile:updated",
            handleProfileUpdated
        );

        window.removeEventListener(
            "PROFILE_UPDATED",
            handleProfileUpdated
        );

        window.removeEventListener(
            "profile:ensure-success",
            handleProfileUpdated
        );

        window.removeEventListener(
            "auth:state-changed",
            handleProfileUpdated
        );

        window.removeEventListener(
            "profile:auth-changed",
            handleProfileUpdated
        );

        window.removeEventListener(
            "referral:refresh",
            handleReferralRefresh
        );

        window.removeEventListener(
            "focus",
            handleWindowFocus
        );

        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        return true;
    }

    /* =====================================================
       AUTH STATE LISTENER
    ===================================================== */

    function bindAuthState() {
        if (
            authUnsubscribe
        ) {
            return true;
        }

        const auth =
            resolveAuth();

        if (
            !auth ||
            typeof auth.onAuthStateChanged !==
                "function"
        ) {
            return false;
        }

        authUnsubscribe =
            auth.onAuthStateChanged(
                firebaseUser => {
                    if (
                        firebaseUser?.uid
                    ) {
                        const previousUid =
                            state.currentUser
                                ?.uid ||
                            "";

                        if (
                            previousUid !==
                                firebaseUser.uid
                        ) {
                            reset({
                                preserveInitialization:
                                    true,

                                preserveGuestReferral:
                                    true
                            });
                        }

                        state.currentUser =
                            firebaseUser;

                        clearActiveReferralIdentity();

                        notify();

                        void refresh({
                            force:
                                true
                        }).catch(
                            () => {
                                /*
                                 * Error already published.
                                 */
                            }
                        );

                        return;
                    }

                    reset({
                        preserveInitialization:
                            true,

                        preserveGuestReferral:
                            true
                    });

                    void loadPublicAdminReferral({
                        notifyChange:
                            true
                    });
                },

                error => {
                    setError(
                        error
                    );
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
                bindBrowserEvents();

                if (
                    !bindAuthState()
                ) {
                    throw createReferralError(
                        "auth-not-ready",
                        "Firebase Authentication is not available."
                    );
                }

                const user =
                    await waitForAuthReady();

                state.initialized =
                    true;

                if (
                    !user?.uid
                ) {
                    await loadPublicAdminReferral({
                        notifyChange:
                            false
                    });

                    notify();

                    return getState();
                }

                state.currentUser =
                    user;

                clearActiveReferralIdentity();

                try {
                    await refresh({
                        force:
                            true
                    });
                } catch {
                    /*
                     * Error already published.
                     */
                }

                return getState();
            })().catch(
                error => {
                    state.initialized =
                        false;

                    readyPromise =
                        null;

                    setError(
                        error
                    );

                    throw error;
                }
            );

        return readyPromise;
    }

    /* =====================================================
       SUBSCRIPTION / CLEANUP
    ===================================================== */

    function subscribe(
        listener,
        options = {}
    ) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "ReferralDB subscriber must be a function."
            );
        }

        listeners.add(
            listener
        );

        if (
            options.emitCurrent !==
                false
        ) {
            listener(
                getState()
            );
        }

        return function unsubscribe() {
            listeners.delete(
                listener
            );
        };
    }

    function destroy() {
        dataGeneration +=
            1;

        refreshRequestSequence +=
            1;

        statsRequestSequence +=
            1;

        referralsRequestSequence +=
            1;

        ownIdentityUid =
            "";

        ownIdentityPromise =
            null;

        if (
            typeof authUnsubscribe ===
                "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        unbindBrowserEvents();

        listeners.clear();

        readyPromise =
            null;

        state.initialized =
            false;

        state.loading =
            false;

        state.loadingMore =
            false;

        state.currentUser =
            null;

        state.statusFilter =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.stats =
            createEmptyStats();

        state.referrals =
            [];

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.referralCode =
            "";

        state.referralLink =
            CANONICAL_REFERRAL_BASE_URL;

        state.referralSource =
            REFERRAL_SOURCE_GUEST;

        state.publicReferralUpdatedAt =
            guestReferralCache
                .updatedAt;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        lastRefreshStartedAt =
            0;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.ReferralDB =
        Object.freeze({
            init,
            destroy,
            refresh,

            refreshStats,
            refreshReferrals,

            setStatusFilter,
            clearStatusFilter,
            loadMore,

            copyReferralLink,
            getReferralIdentity,

            /*
             * Compatibility name.
             * Returns Guest main-site URL, never Admin referral.
             */
            loadPublicAdminReferral,

            getState,

            getStats() {
                return cloneValue(
                    state.stats
                );
            },

            getReferrals() {
                return cloneValue(
                    state.referrals
                );
            },

            getHasMore() {
                return state.hasMore;
            },

            getNextCursor() {
                return state.nextCursor;
            },

            isLoadingMore() {
                return state.loadingMore;
            },

            getStatusFilter() {
                return state
                    .statusFilter;
            },

            getStatusLabel,
            getLegacyStatus,
            getUserVisibleStatus,
            getUserVisibleStatusLabel,

            normalizeStatus,
            normalizeStats,
            normalizeReferralRecord,

            subscribe,
            reset,

            CANONICAL_STATUSES,

            REQUIRED_ACTIVE_DAYS,
            REQUIRED_DAILY_SECONDS,
            ACTIVITY_POLICY_VERSION
        });
})(
    window,
    document
);