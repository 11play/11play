"use strict";

/* =========================================================
   11PLAY — PROFILE UI CONTROLLER
   File: js/account/profile/profile.ui.js

   Responsibilities:
   - Render Guest and verified Google-user states
   - Render profile information
   - Delegate avatar rendering to ProfileAvatar
   - Delegate username rendering to ProfileUsername
   - Delegate Eligible Active Days rendering to ProfileUsingTime
   - Manage one-time mobile-number UI
   - Handle Google sign-in and logout actions
   - Show loading, success and error states
   - Clean up Profile-specific event listeners

   Activity contract:
   - Referral eligibility uses Eligible Active Days
   - Required Active Days = 7
   - Minimum eligible activity per day = 2 hours
   - Today may contain partial 15-minute checkpoint progress
   - Browser elapsed seconds are never authoritative
   - Firestore/FunctionsClient remain authoritative
   - Legacy seconds fields are read-only migration aliases only

   Device contract:
   - Web Device identity is created/validated elsewhere
   - This file only propagates deviceId/deviceBound state
   - This file never decides device uniqueness

   Not handled here:
   - Referral-link rendering or copying
   - Live Reward Withdrawal
   - Account Services navigation
   - Client-side referral eligibility calculation
   - Direct Firebase writes
========================================================= */

const ProfileUI = (() => {
    "use strict";

    const REQUIRED_ACTIVE_DAYS =
        7;

    const REQUIRED_DAILY_SECONDS =
        2 * 60 * 60;

    const REQUIRED_DAILY_MINUTES =
        REQUIRED_DAILY_SECONDS / 60;

    const REQUIRED_TOTAL_SECONDS =
        REQUIRED_ACTIVE_DAYS *
        REQUIRED_DAILY_SECONDS;

    /*
     * Legacy compatibility only.
     *
     * Older 11Play activity versions represented one
     * credited Active Day as 24 hours.
     *
     * New production activity:
     * 1 Eligible Active Day = minimum 2 eligible hours.
     */
    const LEGACY_SECONDS_PER_DAY =
        24 * 60 * 60;

    const ACTIVITY_POLICY_VERSION =
        2;

    const DEFAULT_PROFILE = Object.freeze({
        isAuthenticated:
            false,

        authenticated:
            false,

        uid:
            "",

        photoURL:
            "",

        username:
            "guest",

        displayName:
            "Guest User",

        email:
            "",

        mobileNumber:
            "",

        mobileAdded:
            false,

        mobileLocked:
            false,

        isMobileLocked:
            false,

        /*
         * Device state is display/projection only here.
         */
        deviceId:
            "",

        deviceBound:
            false,

        registrationDate:
            null,

        accountType:
            "guest",

        isGoogleConnected:
            false,

        googleConnected:
            false,

        lastLogin:
            null,

        usingTime: Object.freeze({
            uid:
                "",

            userId:
                "",

            deviceId:
                "",

            deviceBound:
                false,

            eligibleActiveDays:
                0,

            totalActiveDays:
                0,

            activeDays:
                0,

            requiredActiveDays:
                REQUIRED_ACTIVE_DAYS,

            remainingActiveDays:
                REQUIRED_ACTIVE_DAYS,

            currentDayKey:
                "",

            currentDayStartedAt:
                null,

            currentDaySeconds:
                0,

            todayActiveSeconds:
                0,

            todayActiveMinutes:
                0,

            requiredDailySeconds:
                REQUIRED_DAILY_SECONDS,

            requiredDailyMinutes:
                REQUIRED_DAILY_MINUTES,

            remainingTodaySeconds:
                REQUIRED_DAILY_SECONDS,

            remainingTodayMinutes:
                REQUIRED_DAILY_MINUTES,

            currentDayCompleted:
                false,

            dailyProgressPercent:
                0,

            progressPercent:
                0,

            completed:
                false,

            completedAt:
                null,

            eligibleDayKeys:
                Object.freeze([]),

            lastEligibleDayKey:
                "",

            lastEligibleAt:
                null,

            lastCheckpointAt:
                null,

            lastActiveAt:
                null,

            lastActivityAt:
                null,

            activityPolicyVersion:
                ACTIVITY_POLICY_VERSION,

            /*
             * Compatibility totals.
             *
             * New contract:
             * 7 × 2 hours = 14 eligible hours total.
             */
            totalActiveSeconds:
                0,

            requiredActiveSeconds:
                REQUIRED_TOTAL_SECONDS,

            remainingActiveSeconds:
                REQUIRED_TOTAL_SECONDS,

            currentSessionId:
                "",

            currentSessionActive:
                false,

            currentSessionStartedAt:
                null,

            lastHeartbeatAt:
                null
        })
    });

    const state = {
        root:
            null,

        initialized:
            false,

        currentProfile: {
            ...DEFAULT_PROFILE
        },

        isSubmittingMobile:
            false,

        isAuthLoading:
            false,

        usingTimeInitialized:
            false,

        handlers: {
            signIn:
                null,

            logout:
                null,

            saveMobile:
                null
        },

        listeners:
            []
    };

    let statusTimer =
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
            Object.getPrototypeOf(value);

        return (
            prototype ===
                Object.prototype ||
            prototype ===
                null
        );
    }

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

    function normalizeBoolean(value) {
        return value === true;
    }

    function normalizeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return fallback;
        }

        return number;
    }

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        return Math.max(
            0,
            Math.floor(
                normalizeNumber(
                    value,
                    fallback
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

    function firstDefined(...values) {
        for (const value of values) {
            if (
                value !== undefined &&
                value !== null &&
                value !== ""
            ) {
                return value;
            }
        }

        return undefined;
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

    function normalizeActiveDayKeys(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        return Array.from(
            new Set(
                value
                    .map(
                        normalizeString
                    )
                    .filter(
                        dayKey =>
                            /^\d{4}-\d{2}-\d{2}$/
                                .test(
                                    dayKey
                                )
                    )
            )
        ).sort();
    }

    function timestampToMillis(value) {
        if (!value) {
            return 0;
        }

        if (
            typeof value.toMillis ===
                "function"
        ) {
            return value.toMillis();
        }

        if (
            typeof value.toDate ===
                "function"
        ) {
            try {
                return value
                    .toDate()
                    .getTime();
            } catch {
                return 0;
            }
        }

        if (
            value instanceof Date
        ) {
            return value.getTime();
        }

        if (
            typeof value ===
                "string"
        ) {
            const milliseconds =
                Date.parse(
                    value
                );

            return Number.isFinite(
                milliseconds
            )
                ? milliseconds
                : 0;
        }

        if (
            Number.isFinite(
                value?.seconds
            )
        ) {
            return (
                value.seconds *
                1000
            );
        }

        return 0;
    }

    function bangladeshDayKey(value) {
        const milliseconds =
            timestampToMillis(
                value
            );

        if (!milliseconds) {
            return "";
        }

        return new Date(
            milliseconds +
            6 * 60 * 60 * 1000
        )
            .toISOString()
            .slice(
                0,
                10
            );
    }

    function escapeSelector(value) {
        if (
            window.CSS &&
            typeof window.CSS.escape ===
                "function"
        ) {
            return window.CSS.escape(
                String(value)
            );
        }

        return String(value)
            .replace(
                /([^\w-])/g,
                "\\$1"
            );
    }

    function getReadableErrorMessage(
        error,
        fallback =
            "The operation could not be completed."
    ) {
        const detailsMessage =
            normalizeString(
                error?.details?.message ||
                error?.details
                    ?.error?.message ||
                ""
            );

        if (
            detailsMessage &&
            detailsMessage
                .toLowerCase() !==
                "internal"
        ) {
            return detailsMessage;
        }

        const errorMessage =
            normalizeString(
                error?.message ||
                ""
            );

        if (
            errorMessage &&
            errorMessage
                .toLowerCase() !==
                "internal"
        ) {
            return errorMessage;
        }

        const errorCode =
            normalizeString(
                error?.code ||
                ""
            )
                .replace(
                    /^functions\//,
                    ""
                )
                .replace(
                    /^firestore\//,
                    ""
                );

        if (
            errorCode ===
            "failed-precondition"
        ) {
            return "The requested profile update is not available yet.";
        }

        if (
            errorCode ===
            "permission-denied"
        ) {
            return "This profile cannot currently be updated.";
        }

        if (
            errorCode ===
            "unauthenticated"
        ) {
            return "Sign in with Google to continue.";
        }

        if (
            errorCode ===
            "invalid-argument"
        ) {
            return "The submitted information is not valid.";
        }

        if (
            errorCode ===
            "already-exists"
        ) {
            return "This information is already linked to another account.";
        }

        return fallback;
    }

    /* =====================================================
       DOM HELPERS
    ===================================================== */

    function getElement(id) {
        const scope =
            state.root ||
            document;

        if (
            scope === document
        ) {
            return document
                .getElementById(
                    id
                );
        }

        if (
            scope instanceof HTMLElement &&
            scope.id === id
        ) {
            return scope;
        }

        return scope.querySelector(
            `#${escapeSelector(id)}`
        );
    }

    function setText(
        id,
        value,
        fallback = "Not available"
    ) {
        const element =
            getElement(
                id
            );

        if (!element) {
            return false;
        }

        element.textContent =
            normalizeString(
                value,
                fallback
            );

        return true;
    }

    /* =====================================================
       PROFILE SECTION VISIBILITY AND ORDER
    ===================================================== */

    function syncProfileSections(profile) {
        const card =
            getElement(
                "profileInformationCard"
            );

        const usingTimeSection =
            getElement(
                "profileUsingTimeSection"
            );

        if (
            !(card instanceof HTMLElement)
        ) {
            return false;
        }

        const header =
            card.querySelector(
                ".profile-header"
            );

        const accountInformation =
            card.querySelector(
                ".profile-account-information"
            );

        const authSection =
            card.querySelector(
                ".profile-auth-section"
            );

        const authenticated =
            profile?.isAuthenticated ===
            true;

        if (
            accountInformation
        ) {
            accountInformation.hidden =
                !authenticated;

            accountInformation.setAttribute(
                "aria-hidden",
                String(
                    !authenticated
                )
            );
        }

        if (
            usingTimeSection
        ) {
            usingTimeSection.hidden =
                !authenticated;

            usingTimeSection.setAttribute(
                "aria-hidden",
                String(
                    !authenticated
                )
            );
        }

        card.classList.toggle(
            "is-guest-profile",
            !authenticated
        );

        card.classList.toggle(
            "is-authenticated-profile",
            authenticated
        );

        if (
            !authenticated &&
            header &&
            authSection
        ) {
            header.insertAdjacentElement(
                "afterend",
                authSection
            );

            return true;
        }

        if (
            authenticated &&
            usingTimeSection &&
            authSection
        ) {
            usingTimeSection
                .insertAdjacentElement(
                    "afterend",
                    authSection
                );
        }

        return true;
    }

    /* =====================================================
       MOBILE NUMBER NORMALIZATION
    ===================================================== */

    function sanitizeMobileDigits(value) {
        return normalizeString(
            value
        )
            .replace(
                /\D/g,
                ""
            )
            .slice(
                0,
                10
            );
    }

    function normalizeMobileForDisplay(
        value
    ) {
        const digits =
            normalizeString(
                value
            )
                .replace(
                    /\D/g,
                    ""
                );

        if (
            /^8801[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+${digits}`;
        }

        if (
            /^01[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+88${digits}`;
        }

        if (
            /^1[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+880${digits}`;
        }

        return "";
    }

    function validateMobileNumber(value) {
        const digits =
            sanitizeMobileDigits(
                value
            );

        if (!digits) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Mobile number is required."
            };
        }

        if (
            digits.length !==
            10
        ) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Enter exactly 10 digits after +880."
            };
        }

        if (
            !/^1[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Enter a valid Bangladesh mobile number."
            };
        }

        return {
            valid:
                true,

            digits,

            fullNumber:
                `+880${digits}`,

            message:
                ""
        };
    }

    /* =====================================================
       ACTIVITY NORMALIZATION — 7 DAYS × 2 HOURS
    ===================================================== */

    function deriveActiveDays(
        source,
        requiredActiveDays
    ) {
        const explicitDays =
            firstDefined(
                source.eligibleActiveDays,
                source.totalActiveDays,
                source.activeDays,
                source.creditedActiveDays,
                source.completedActiveDays
            );

        if (
            explicitDays !==
            undefined
        ) {
            return Math.min(
                requiredActiveDays,
                toNonNegativeInteger(
                    explicitDays
                )
            );
        }

        const eligibleDayKeys =
            normalizeActiveDayKeys(
                firstDefined(
                    source.eligibleDayKeys,
                    source.activeDayKeys,
                    source.creditedDayKeys
                )
            );

        if (
            eligibleDayKeys.length >
            0
        ) {
            return Math.min(
                requiredActiveDays,
                eligibleDayKeys.length
            );
        }

        const legacySeconds =
            toNonNegativeInteger(
                source.totalActiveSeconds
            );

        if (
            legacySeconds <= 0
        ) {
            return 0;
        }

        const policyVersion =
            toNonNegativeInteger(
                source.activityPolicyVersion
            );

        /*
         * Schema/activity policy distinction:
         *
         * New policy:
         * 7200 seconds = one completed Eligible Active Day.
         *
         * Legacy compatibility:
         * 86400 seconds = one old credited day.
         */
        const divisor =
            policyVersion >=
                ACTIVITY_POLICY_VERSION
                ? REQUIRED_DAILY_SECONDS
                : LEGACY_SECONDS_PER_DAY;

        return Math.min(
            requiredActiveDays,
            Math.floor(
                legacySeconds /
                divisor
            )
        );
    }

    function deriveCurrentDaySeconds(
        source
    ) {
        const explicitSeconds =
            firstDefined(
                source.currentDaySeconds,
                source.todayActiveSeconds,
                source.currentActiveSeconds
            );

        if (
            explicitSeconds !==
            undefined
        ) {
            return toNonNegativeInteger(
                explicitSeconds
            );
        }

        const explicitMinutes =
            firstDefined(
                source.currentDayMinutes,
                source.todayActiveMinutes,
                source.currentActiveMinutes
            );

        if (
            explicitMinutes !==
            undefined
        ) {
            return (
                toNonNegativeInteger(
                    explicitMinutes
                ) *
                60
            );
        }

        return 0;
    }

    function normalizeActivity(value) {
        const source =
            isPlainObject(
                value
            )
                ? value
                : {};

        const requiredActiveDays =
            Math.max(
                1,
                toNonNegativeInteger(
                    firstDefined(
                        source.requiredActiveDays,
                        REQUIRED_ACTIVE_DAYS
                    ),
                    REQUIRED_ACTIVE_DAYS
                ) ||
                REQUIRED_ACTIVE_DAYS
            );

        const requiredDailySeconds =
            Math.max(
                1,
                toNonNegativeInteger(
                    firstDefined(
                        source.requiredDailySeconds,
                        REQUIRED_DAILY_SECONDS
                    ),
                    REQUIRED_DAILY_SECONDS
                ) ||
                REQUIRED_DAILY_SECONDS
            );

        const requiredDailyMinutes =
            Math.ceil(
                requiredDailySeconds /
                60
            );

        const eligibleDayKeys =
            normalizeActiveDayKeys(
                firstDefined(
                    source.eligibleDayKeys,
                    source.activeDayKeys,
                    source.creditedDayKeys
                )
            );

        let eligibleActiveDays =
            deriveActiveDays(
                source,
                requiredActiveDays
            );

        eligibleActiveDays =
            Math.min(
                requiredActiveDays,
                Math.max(
                    eligibleActiveDays,
                    eligibleDayKeys.length
                )
            );

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays -
                eligibleActiveDays
            );

        const currentDaySeconds =
            Math.min(
                requiredDailySeconds,
                deriveCurrentDaySeconds(
                    source
                )
            );

        const todayActiveSeconds =
            currentDaySeconds;

        const todayActiveMinutes =
            Math.floor(
                todayActiveSeconds /
                60
            );

        const currentDayCompleted =
            source.currentDayCompleted ===
                true ||
            currentDaySeconds >=
                requiredDailySeconds;

        const remainingTodaySeconds =
            currentDayCompleted
                ? 0
                : Math.max(
                    0,
                    requiredDailySeconds -
                    currentDaySeconds
                );

        const remainingTodayMinutes =
            Math.ceil(
                remainingTodaySeconds /
                60
            );

        /*
         * Overall referral progress remains based on
         * completed Eligible Active Days only.
         *
         * A partial day does NOT become a partial Active Day.
         */
        const calculatedProgress =
            requiredActiveDays > 0
                ? (
                    eligibleActiveDays /
                    requiredActiveDays
                ) *
                    100
                : 100;

        const suppliedProgress =
            Number(
                source.progressPercent
            );

        const progressPercent =
            Number.isFinite(
                suppliedProgress
            )
                ? clamp(
                    suppliedProgress,
                    0,
                    100
                )
                : clamp(
                    calculatedProgress,
                    0,
                    100
                );

        const suppliedDailyProgress =
            Number(
                source.dailyProgressPercent
            );

        const calculatedDailyProgress =
            requiredDailySeconds > 0
                ? (
                    currentDaySeconds /
                    requiredDailySeconds
                ) *
                    100
                : 100;

        const dailyProgressPercent =
            Number.isFinite(
                suppliedDailyProgress
            )
                ? clamp(
                    suppliedDailyProgress,
                    0,
                    100
                )
                : clamp(
                    calculatedDailyProgress,
                    0,
                    100
                );

        const completed =
            source.completed ===
                true ||
            eligibleActiveDays >=
                requiredActiveDays;

        const currentDayStartedAt =
            firstDefined(
                source.currentDayStartedAt,
                source.activityDayAt,
                source.dayStartedAt
            ) ||
            null;

        const currentDayKey =
            normalizeString(
                firstDefined(
                    source.currentDayKey,
                    source.activityDayKey
                )
            ) ||
            bangladeshDayKey(
                currentDayStartedAt
            );

        const deviceId =
            normalizeString(
                firstDefined(
                    source.deviceId,
                    source.webDeviceId,
                    source.boundDeviceId
                )
            );

        const deviceBound =
            source.deviceBound ===
                true ||
            Boolean(
                deviceId
            );

        /*
         * If currentDayCompleted=true, FunctionsClient should
         * already have converted today's 2 hours into activeDays.
         *
         * Therefore currentDaySeconds must not be added again
         * to totalActiveSeconds.
         */
        const partialTodaySeconds =
            currentDayCompleted
                ? 0
                : currentDaySeconds;

        const requiredActiveSeconds =
            requiredActiveDays *
            requiredDailySeconds;

        const totalActiveSeconds =
            Math.min(
                requiredActiveSeconds,

                eligibleActiveDays *
                    requiredDailySeconds +
                partialTodaySeconds
            );

        const remainingActiveSeconds =
            Math.max(
                0,
                requiredActiveSeconds -
                totalActiveSeconds
            );

        return {
            uid:
                normalizeString(
                    source.uid ||
                    source.userId
                ),

            userId:
                normalizeString(
                    source.userId ||
                    source.uid
                ),

            deviceId,

            deviceBound,

            eligibleActiveDays,

            totalActiveDays:
                eligibleActiveDays,

            activeDays:
                eligibleActiveDays,

            requiredActiveDays,

            remainingActiveDays,

            currentDayKey,

            currentDayStartedAt,

            currentDaySeconds,

            todayActiveSeconds,

            todayActiveMinutes,

            requiredDailySeconds,

            requiredDailyMinutes,

            remainingTodaySeconds,

            remainingTodayMinutes,

            currentDayCompleted,

            dailyProgressPercent,

            progressPercent,

            completed,

            completedAt:
                completed
                    ? source.completedAt ||
                    null
                    : null,

            eligibleDayKeys,

            lastEligibleDayKey:
                normalizeString(
                    firstDefined(
                        source.lastEligibleDayKey,
                        source.lastActiveDayKey,
                        source.lastCreditedDayKey,
                        eligibleDayKeys[
                            eligibleDayKeys.length -
                            1
                        ]
                    )
                ),

            lastEligibleAt:
                firstDefined(
                    source.lastEligibleAt,
                    source.lastActiveDayAt,
                    source.lastCreditedAt
                ) ||
                null,

            lastCheckpointAt:
                source.lastCheckpointAt ||
                null,

            lastActiveAt:
                source.lastActiveAt ||
                null,

            lastActivityAt:
                firstDefined(
                    source.lastActivityAt,
                    source.lastActiveAt,
                    source.lastCheckpointAt,
                    source.updatedAt
                ) ||
                null,

            updatedAt:
                source.updatedAt ||
                null,

            activityPolicyVersion:
                toNonNegativeInteger(
                    source.activityPolicyVersion,
                    ACTIVITY_POLICY_VERSION
                ) ||
                ACTIVITY_POLICY_VERSION,

            /*
             * Compatibility aliases.
             *
             * New calculation:
             * completed days × 2 hours
             * + today's accepted partial checkpoints.
             */
            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds,

            currentSessionId:
                "",

            currentSessionActive:
                false,

            currentSessionStartedAt:
                null,

            lastHeartbeatAt:
                source.lastCheckpointAt ||
                source.lastActiveAt ||
                null
        };
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function getCurrentFirebaseUser(
        uid = ""
    ) {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        let firebaseUser =
            configuredAuth
                ?.currentUser ||
            null;

        if (
            !firebaseUser &&
            window.firebase
                ?.auth
        ) {
            try {
                firebaseUser =
                    window.firebase
                        .auth()
                        .currentUser ||
                    null;
            } catch {
                firebaseUser =
                    null;
            }
        }

        if (
            !firebaseUser?.uid
        ) {
            return null;
        }

        const normalizedUid =
            normalizeString(
                uid
            );

        if (
            normalizedUid &&
            firebaseUser.uid !==
                normalizedUid
        ) {
            return null;
        }

        return firebaseUser;
    }

    function deriveUsername(
        profile,
        email,
        authenticated
    ) {
        if (
            window.ProfileUsername &&
            typeof window
                .ProfileUsername
                .getUsername ===
                "function"
        ) {
            try {
                return window
                    .ProfileUsername
                    .getUsername(
                        {
                            ...profile,
                            email
                        },
                        {
                            allowGuest:
                                true
                        }
                    );
            } catch {
                /*
                 * Continue to local fallback.
                 */
            }
        }

        const emailUsername =
            email.includes("@")
                ? email.split("@")[0]
                : "";

        const username =
            normalizeString(
                emailUsername ||
                profile.username,
                authenticated
                    ? "user"
                    : "guest"
            )
                .replace(
                    /^@+/,
                    ""
                )
                .replace(
                    /\s+/g,
                    ""
                )
                .toLowerCase();

        return (
            username ||
            "guest"
        );
    }

    function isGoogleConnectedProfile(
        profile = {},
        uid = ""
    ) {
        const providerIds =
            Array.isArray(
                profile.providerIds
            )
                ? profile.providerIds
                    .map(
                        providerId =>
                            normalizeString(
                                providerId
                            )
                    )
                : [];

        const firebaseUser =
            getCurrentFirebaseUser(
                uid ||
                profile.uid
            );

        if (
            Array.isArray(
                firebaseUser
                    ?.providerData
            )
        ) {
            firebaseUser
                .providerData
                .forEach(
                    provider => {
                        const providerId =
                            normalizeString(
                                provider
                                    ?.providerId
                            );

                        if (
                            providerId &&
                            !providerIds
                                .includes(
                                    providerId
                                )
                        ) {
                            providerIds
                                .push(
                                    providerId
                                );
                        }
                    }
                );
        }

        return Boolean(
            profile.isGoogleConnected ===
                true ||
            profile.googleConnected ===
                true ||
            profile.isGoogleSignIn ===
                true ||
            providerIds.includes(
                "google.com"
            ) ||
            normalizeString(
                profile.accountType
            ).toLowerCase() ===
                "google"
        );
    }

    function normalizeAccountType(
        value,
        authenticated
    ) {
        if (!authenticated) {
            return "guest";
        }

        const accountType =
            normalizeString(
                value,
                "google"
            )
                .toLowerCase();

        return accountType ===
            "guest"
                ? "google"
                : accountType;
    }

    function normalizeUsingTimeSource(
        profile
    ) {
        const explicitUsingTime =
            profile.usingTime ||
            profile.activity ||
            profile.activitySummary;

        if (
            isPlainObject(
                explicitUsingTime
            )
        ) {
            return normalizeActivity(
                explicitUsingTime
            );
        }

        return normalizeActivity({
            uid:
                normalizeString(
                    profile.uid
                ),

            userId:
                normalizeString(
                    profile.uid
                ),

            deviceId:
                firstDefined(
                    profile.deviceId,
                    profile.webDeviceId,
                    profile.boundDeviceId
                ),

            deviceBound:
                profile.deviceBound ===
                true,

            eligibleActiveDays:
                firstDefined(
                    profile.eligibleActiveDays,
                    profile.totalActiveDays,
                    profile.activeDays
                ),

            requiredActiveDays:
                firstDefined(
                    profile.requiredActiveDays,
                    REQUIRED_ACTIVE_DAYS
                ),

            currentDaySeconds:
                firstDefined(
                    profile.currentDaySeconds,
                    profile.todayActiveSeconds
                ),

            todayActiveMinutes:
                profile.todayActiveMinutes,

            requiredDailySeconds:
                firstDefined(
                    profile.requiredDailySeconds,
                    REQUIRED_DAILY_SECONDS
                ),

            currentDayStartedAt:
                firstDefined(
                    profile.currentDayStartedAt,
                    profile.activityDayAt
                ),

            currentDayCompleted:
                profile.currentDayCompleted ===
                true,

            lastCheckpointAt:
                profile.lastCheckpointAt ||
                null,

            lastActiveAt:
                profile.lastActiveAt ||
                null,

            activityPolicyVersion:
                profile.activityPolicyVersion,

            eligibleDayKeys:
                firstDefined(
                    profile.eligibleDayKeys,
                    profile.activeDayKeys
                ),

            completed:
                profile.activityCompleted ===
                    true ||
                profile.usingTimeCompleted ===
                    true,

            completedAt:
                profile.completedAt ||
                profile.activityCompletedAt ||
                null,

            lastEligibleDayKey:
                profile.lastEligibleDayKey ||
                "",

            lastEligibleAt:
                profile.lastEligibleAt ||
                null,

            lastActivityAt:
                profile.lastActivityAt ||
                null,

            /*
             * Legacy migration input only.
             */
            totalActiveSeconds:
                profile.totalActiveSeconds ??
                profile.usingTimeSeconds
        });
    }

    function normalizeProfile(
        profile = {}
    ) {
        const source =
            isPlainObject(
                profile
            )
                ? profile
                : {};

        const uid =
            normalizeString(
                source.uid ||
                source.userId
            );

        const authenticated =
            normalizeBoolean(
                source.isAuthenticated
            ) ||
            normalizeBoolean(
                source.authenticated
            ) ||
            Boolean(
                uid
            );

        const firebaseUser =
            authenticated
                ? getCurrentFirebaseUser(
                    uid
                )
                : null;

        const email =
            normalizeString(
                source.email ||
                firebaseUser
                    ?.email
            )
                .toLowerCase();

        const username =
            deriveUsername(
                source,
                email,
                authenticated
            );

        const displayName =
            normalizeString(
                source.displayName ||
                source.name ||
                firebaseUser
                    ?.displayName,
                authenticated
                    ? username
                    : "Guest User"
            );

        const mobileNumber =
            normalizeMobileForDisplay(
                source.mobileNumber ||
                source.mobile
            );

        const googleConnected =
            authenticated &&
            isGoogleConnectedProfile(
                source,
                uid
            );

        const authMetadata =
            firebaseUser
                ?.metadata ||
            {};

        const registrationDate =
            source.registrationDate ||
            source.createdAt ||
            authMetadata.creationTime ||
            null;

        const lastLogin =
            source.lastLogin ||
            source.lastLoginAt ||
            authMetadata.lastSignInTime ||
            registrationDate ||
            null;

        const mobileLocked =
            normalizeBoolean(
                source.isMobileLocked
            ) ||
            normalizeBoolean(
                source.mobileLocked
            ) ||
            Boolean(
                mobileNumber
            );

        const usingTime =
            normalizeUsingTimeSource(
                source
            );

        const deviceId =
            normalizeString(
                firstDefined(
                    source.deviceId,
                    source.webDeviceId,
                    source.boundDeviceId,
                    usingTime.deviceId
                )
            );

        const deviceBound =
            source.deviceBound ===
                true ||
            usingTime.deviceBound ===
                true ||
            Boolean(
                deviceId
            );

        return {
            ...DEFAULT_PROFILE,
            ...source,

            isAuthenticated:
                authenticated,

            authenticated,

            uid,

            photoURL:
                normalizeString(
                    source.photoURL ||
                    source.photo ||
                    firebaseUser
                        ?.photoURL
                ),

            username,

            displayName,

            email,

            isGoogleConnected:
                googleConnected,

            googleConnected,

            mobileNumber,

            mobileAdded:
                source.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked,

            isMobileLocked:
                mobileLocked,

            deviceId,

            deviceBound,

            registrationDate,

            accountType:
                normalizeAccountType(
                    source.accountType,
                    authenticated
                ),

            lastLogin,

            usingTime: {
                ...usingTime,

                deviceId:
                    usingTime.deviceId ||
                    deviceId,

                deviceBound:
                    usingTime.deviceBound ===
                        true ||
                    deviceBound
            }
        };
    }

    /* =====================================================
       AVATAR
    ===================================================== */

    function getAvatarInitial(profile) {
        const source =
            normalizeString(
                profile.displayName ||
                profile.username ||
                profile.email,
                "G"
            );

        return source
            .charAt(0)
            .toUpperCase();
    }

    function showInitialFallback(
        image,
        fallback,
        avatar,
        profile
    ) {
        if (image) {
            image.hidden =
                true;

            image.onerror =
                null;

            image.removeAttribute(
                "src"
            );

            image.alt =
                "";
        }

        if (fallback) {
            fallback.hidden =
                false;

            fallback.textContent =
                getAvatarInitial(
                    profile
                );
        }

        if (avatar) {
            avatar.dataset
                .avatarState =
                "fallback";

            avatar.classList.add(
                "is-fallback"
            );

            avatar.classList.remove(
                "has-image"
            );
        }

        return true;
    }

    function renderAvatar(profile) {
        const image =
            getElement(
                "profileAvatarImage"
            );

        const fallback =
            getElement(
                "profileAvatarFallback"
            );

        const avatar =
            getElement(
                "profileAvatar"
            );

        if (
            !image ||
            !fallback ||
            !avatar
        ) {
            return false;
        }

        if (
            window.ProfileAvatar &&
            typeof window
                .ProfileAvatar
                .applyToImage ===
                "function"
        ) {
            try {
                window.ProfileAvatar
                    .applyToImage(
                        image,
                        profile
                    );

                image.hidden =
                    false;

                fallback.hidden =
                    true;

                avatar.dataset
                    .avatarState =
                    profile.photoURL
                        ? "google"
                        : "default";

                avatar.classList.add(
                    "has-image"
                );

                avatar.classList.remove(
                    "is-fallback"
                );

                avatar.setAttribute(
                    "aria-label",
                    profile.photoURL
                        ? "Google profile photo"
                        : "Default profile photo"
                );

                return true;
            } catch (error) {
                console.warn(
                    "[ProfileUI] ProfileAvatar could not render the image.",
                    error
                );
            }
        }

        const photoURL =
            normalizeString(
                profile.photoURL
            );

        if (
            !profile.isAuthenticated ||
            !photoURL
        ) {
            return showInitialFallback(
                image,
                fallback,
                avatar,
                profile
            );
        }

        image.onload =
            () => {
                image.hidden =
                    false;

                fallback.hidden =
                    true;

                avatar.dataset
                    .avatarState =
                    "google";

                avatar.classList.add(
                    "has-image"
                );

                avatar.classList.remove(
                    "is-fallback"
                );
            };

        image.onerror =
            () => {
                showInitialFallback(
                    image,
                    fallback,
                    avatar,
                    profile
                );
            };

        image.src =
            photoURL;

        image.alt =
            `${profile.displayName}'s profile photo`;

        image.referrerPolicy =
            "no-referrer";

        return true;
    }

    /* =====================================================
       USERNAME
    ===================================================== */

    function renderUsername(profile) {
        const element =
            getElement(
                "profileUsername"
            );

        if (!element) {
            return false;
        }

        if (
            window.ProfileUsername &&
            typeof window
                .ProfileUsername
                .applyToElement ===
                "function"
        ) {
            try {
                return window
                    .ProfileUsername
                    .applyToElement(
                        element,
                        profile,
                        {
                            allowGuest:
                                true
                        }
                    );
            } catch (error) {
                console.warn(
                    "[ProfileUI] ProfileUsername could not render the username.",
                    error
                );
            }
        }

        const username =
            normalizeString(
                profile.username,
                profile.isAuthenticated
                    ? "user"
                    : "guest"
            )
                .replace(
                    /^@+/,
                    ""
                );

        const displayUsername =
            `@${username}`;

        element.textContent =
            displayUsername;

        element.dataset.username =
            username;

        element.dataset.accountType =
            profile.isAuthenticated
                ? "google"
                : "guest";

        element.setAttribute(
            "aria-label",
            profile.isAuthenticated
                ? `Username ${displayUsername}`
                : "Guest username"
        );

        return displayUsername;
    }

    /* =====================================================
       DATE FORMATTING
    ===================================================== */

    function resolveDate(value) {
        if (!value) {
            return null;
        }

        if (
            typeof value ===
                "object" &&
            typeof value.toDate ===
                "function"
        ) {
            try {
                const firestoreDate =
                    value.toDate();

                return Number.isNaN(
                    firestoreDate
                        .getTime()
                )
                    ? null
                    : firestoreDate;
            } catch {
                return null;
            }
        }

        if (
            typeof value ===
                "object" &&
            typeof value.toMillis ===
                "function"
        ) {
            try {
                const firestoreDate =
                    new Date(
                        value.toMillis()
                    );

                return Number.isNaN(
                    firestoreDate
                        .getTime()
                )
                    ? null
                    : firestoreDate;
            } catch {
                return null;
            }
        }

        if (
            typeof value ===
                "object" &&
            typeof value.seconds ===
                "number"
        ) {
            const timestampDate =
                new Date(
                    value.seconds *
                    1000
                );

            return Number.isNaN(
                timestampDate
                    .getTime()
            )
                ? null
                : timestampDate;
        }

        const date =
            value instanceof Date
                ? value
                : new Date(
                    value
                );

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function formatDate(
        value,
        options = {}
    ) {
        const date =
            resolveDate(
                value
            );

        if (!date) {
            return "Not available";
        }

        try {
            return new Intl
                .DateTimeFormat(
                    "en-BD",
                    {
                        day:
                            "2-digit",

                        month:
                            "short",

                        year:
                            "numeric",

                        ...options
                    }
                )
                .format(
                    date
                );
        } catch {
            return "Not available";
        }
    }

    function formatDateTime(value) {
        return formatDate(
            value,
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit",

                hour12:
                    true
            }
        );
    }

    /* =====================================================
       MOBILE ERROR
    ===================================================== */

    function showMobileError(message) {
        const errorElement =
            getElement(
                "profileMobileError"
            );

        const input =
            getElement(
                "profileMobileInput"
            );

        const normalizedMessage =
            normalizeString(
                message
            );

        if (
            errorElement
        ) {
            errorElement.textContent =
                normalizedMessage;

            errorElement.hidden =
                !normalizedMessage;
        }

        if (input) {
            input.classList.toggle(
                "has-error",
                Boolean(
                    normalizedMessage
                )
            );

            input.setAttribute(
                "aria-invalid",
                String(
                    Boolean(
                        normalizedMessage
                    )
                )
            );
        }

        return true;
    }

    function clearMobileError() {
        return showMobileError(
            ""
        );
    }

    /* =====================================================
       MOBILE UI STATE
    ===================================================== */

    function renderMobileState(profile) {
        const authenticated =
            profile.isAuthenticated;

        const locked =
            profile.isMobileLocked ===
                true &&
            Boolean(
                profile.mobileNumber
            );

        const emptyState =
            getElement(
                "profileMobileEmptyState"
            );

        const savedState =
            getElement(
                "profileMobileSavedState"
            );

        const input =
            getElement(
                "profileMobileInput"
            );

        const submitButton =
            getElement(
                "profileMobileSubmitButton"
            );

        const help =
            getElement(
                "profileMobileHelp"
            );

        if (
            !emptyState ||
            !savedState ||
            !input ||
            !submitButton
        ) {
            return false;
        }

        if (locked) {
            emptyState.hidden =
                true;

            emptyState.setAttribute(
                "aria-hidden",
                "true"
            );

            savedState.hidden =
                false;

            savedState.setAttribute(
                "aria-hidden",
                "false"
            );

            setText(
                "profileInfoMobile",
                profile.mobileNumber,
                "Not set"
            );

            input.value =
                "";

            input.disabled =
                true;

            input.readOnly =
                true;

            submitButton.disabled =
                true;

            submitButton.setAttribute(
                "aria-disabled",
                "true"
            );

            submitButton.textContent =
                "Submitted";

            submitButton.classList.remove(
                "is-loading"
            );

            submitButton.classList.add(
                "is-locked"
            );

            clearMobileError();

            return true;
        }

        emptyState.hidden =
            false;

        emptyState.setAttribute(
            "aria-hidden",
            "false"
        );

        savedState.hidden =
            true;

        savedState.setAttribute(
            "aria-hidden",
            "true"
        );

        input.readOnly =
            false;

        input.disabled =
            !authenticated ||
            state.isSubmittingMobile;

        submitButton.disabled =
            !authenticated ||
            state.isSubmittingMobile;

        submitButton.setAttribute(
            "aria-disabled",
            String(
                submitButton.disabled
            )
        );

        submitButton.textContent =
            state.isSubmittingMobile
                ? "Saving..."
                : "Submit";

        submitButton.classList.toggle(
            "is-loading",
            state.isSubmittingMobile
        );

        submitButton.classList.remove(
            "is-locked"
        );

        if (
            !authenticated
        ) {
            input.value =
                "";

            input.placeholder =
                "Sign in to add number";

            if (help) {
                help.textContent =
                    "Sign in with Google to add your mobile number.";
            }
        } else {
            input.placeholder =
                "1XXXXXXXXX";

            if (help) {
                help.textContent =
                    "Enter 10 digits after +880. This number can be submitted only once.";
            }
        }

        return true;
    }

    function setMobileSubmitting(
        isSubmitting
    ) {
        state.isSubmittingMobile =
            Boolean(
                isSubmitting
            );

        renderMobileState(
            state.currentProfile
        );

        return true;
    }

    function markMobileAsSaved(
        mobileNumber
    ) {
        const normalizedMobile =
            normalizeMobileForDisplay(
                mobileNumber
            );

        if (!normalizedMobile) {
            return false;
        }

        state.isSubmittingMobile =
            false;

        state.currentProfile = {
            ...state.currentProfile,

            mobileNumber:
                normalizedMobile,

            mobileAdded:
                true,

            mobileLocked:
                true,

            isMobileLocked:
                true
        };

        renderMobileState(
            state.currentProfile
        );

        showStatus(
            "Mobile number saved successfully.",
            "success",
            4000
        );

        return true;
    }

    /* =====================================================
       ELIGIBLE ACTIVE DAYS
    ===================================================== */

    function getUsingTimeSource(value) {
        if (
            isPlainObject(
                value
            )
        ) {
            return normalizeActivity(
                value
            );
        }

        return normalizeActivity({
            uid:
                state.currentProfile
                    .uid,

            eligibleActiveDays:
                toNonNegativeInteger(
                    value
                ),

            requiredActiveDays:
                REQUIRED_ACTIVE_DAYS,

            requiredDailySeconds:
                REQUIRED_DAILY_SECONDS
        });
    }

    function updateUsingTimeFallback(
        activity
    ) {
        const source =
            getUsingTimeSource(
                activity
            );

        const eligibleActiveDays =
            source.eligibleActiveDays;

        const requiredActiveDays =
            source.requiredActiveDays;

        const remainingActiveDays =
            source.remainingActiveDays;

        const todaySeconds =
            source.todayActiveSeconds;

        const todayHours =
            Math.floor(
                todaySeconds /
                3600
            );

        const todayMinutes =
            Math.floor(
                (
                    todaySeconds %
                    3600
                ) /
                60
            );

        const todayRemainingMinutes =
            source.remainingTodayMinutes;

        const progress =
            clamp(
                source.progressPercent,
                0,
                100
            );

        const dailyProgress =
            clamp(
                source.dailyProgressPercent,
                0,
                100
            );

        const completed =
            source.completed ===
            true;

        /*
         * Existing markup is preserved.
         *
         * Days = completed Eligible Active Days.
         * Hours/Minutes = today's accepted eligible activity.
         *
         * This changes values only, not layout/design.
         */
        const existingElementValues = {
            usingTimeYears:
                "00",

            usingTimeMonths:
                "00",

            usingTimeDays:
                String(
                    eligibleActiveDays
                ).padStart(
                    2,
                    "0"
                ),

            usingTimeHours:
                String(
                    todayHours
                ).padStart(
                    2,
                    "0"
                ),

            usingTimeMinutes:
                String(
                    todayMinutes
                ).padStart(
                    2,
                    "0"
                ),

            usingTimeSeconds:
                "00"
        };

        Object.entries(
            existingElementValues
        ).forEach(
            ([
                id,
                value
            ]) => {
                setText(
                    id,
                    value,
                    "00"
                );
            }
        );

        /*
         * Forward-compatible IDs.
         * No HTML change is required if they do not exist yet.
         */
        setText(
            "usingTimeActiveDays",
            String(
                eligibleActiveDays
            ),
            "0"
        );

        setText(
            "usingTimeRequiredDays",
            String(
                requiredActiveDays
            ),
            String(
                REQUIRED_ACTIVE_DAYS
            )
        );

        setText(
            "usingTimeRemainingDays",
            String(
                remainingActiveDays
            ),
            String(
                requiredActiveDays
            )
        );

        setText(
            "usingTimeTodayMinutes",
            String(
                source.todayActiveMinutes
            ),
            "0"
        );

        setText(
            "usingTimeRequiredDailyMinutes",
            String(
                source.requiredDailyMinutes
            ),
            String(
                REQUIRED_DAILY_MINUTES
            )
        );

        setText(
            "usingTimeRemainingTodayMinutes",
            String(
                todayRemainingMinutes
            ),
            String(
                REQUIRED_DAILY_MINUTES
            )
        );

        const status =
            getElement(
                "usingTimeStatus"
            );

        const progressElement =
            getElement(
                "usingTimeProgress"
            );

        const container =
            getElement(
                "profileUsingTime"
            );

        if (status) {
            if (completed) {
                status.textContent =
                    `Eligible Active Days: ${eligibleActiveDays}/${requiredActiveDays} • Requirement completed`;
            } else if (
                source.currentDayCompleted
            ) {
                status.textContent =
                    `Eligible Active Days: ${eligibleActiveDays}/${requiredActiveDays} • Today's 2-hour requirement completed`;
            } else {
                status.textContent =
                    `Eligible Active Days: ${eligibleActiveDays}/${requiredActiveDays} • Today: ${source.todayActiveMinutes}/${source.requiredDailyMinutes} min`;
            }

            status.dataset.completed =
                String(
                    completed
                );

            status.dataset
                .currentDayCompleted =
                String(
                    source
                        .currentDayCompleted
                );
        }

        /*
         * Existing overall progress bar stays based on
         * completed Eligible Active Days.
         *
         * Partial time today never creates a partial Active Day.
         */
        if (
            progressElement
        ) {
            progressElement.style.width =
                `${progress}%`;

            progressElement.setAttribute(
                "aria-valuemin",
                "0"
            );

            progressElement.setAttribute(
                "aria-valuemax",
                "100"
            );

            progressElement.setAttribute(
                "aria-valuenow",
                String(
                    Math.floor(
                        progress
                    )
                )
            );

            progressElement.setAttribute(
                "aria-valuetext",
                `${eligibleActiveDays} of ${requiredActiveDays} eligible active days completed; today ${source.todayActiveMinutes} of ${source.requiredDailyMinutes} minutes`
            );
        }

        if (container) {
            container.dataset.completed =
                String(
                    completed
                );

            container.dataset
                .eligibleActiveDays =
                String(
                    eligibleActiveDays
                );

            container.dataset
                .requiredActiveDays =
                String(
                    requiredActiveDays
                );

            container.dataset
                .remainingActiveDays =
                String(
                    remainingActiveDays
                );

            container.dataset
                .progressPercent =
                String(
                    progress
                );

            container.dataset
                .currentDayKey =
                source.currentDayKey;

            container.dataset
                .currentDaySeconds =
                String(
                    source.currentDaySeconds
                );

            container.dataset
                .todayActiveSeconds =
                String(
                    source.todayActiveSeconds
                );

            container.dataset
                .todayActiveMinutes =
                String(
                    source.todayActiveMinutes
                );

            container.dataset
                .requiredDailySeconds =
                String(
                    source.requiredDailySeconds
                );

            container.dataset
                .requiredDailyMinutes =
                String(
                    source.requiredDailyMinutes
                );

            container.dataset
                .remainingTodaySeconds =
                String(
                    source.remainingTodaySeconds
                );

            container.dataset
                .remainingTodayMinutes =
                String(
                    source.remainingTodayMinutes
                );

            container.dataset
                .currentDayCompleted =
                String(
                    source.currentDayCompleted
                );

            container.dataset
                .dailyProgressPercent =
                String(
                    dailyProgress
                );

            container.dataset
                .deviceBound =
                String(
                    source.deviceBound
                );

            /*
             * Compatibility datasets.
             *
             * New model total:
             * 7 days × 2 hours = 50,400 seconds.
             */
            container.dataset
                .totalActiveSeconds =
                String(
                    source.totalActiveSeconds
                );

            container.dataset
                .requiredActiveSeconds =
                String(
                    source.requiredActiveSeconds
                );

            container.dataset
                .remainingActiveSeconds =
                String(
                    source.remainingActiveSeconds
                );
        }

        return true;
    }

    function renderUsingTime(activity) {
        const source =
            getUsingTimeSource(
                activity
            );

        if (
            window.ProfileUsingTime &&
            typeof window
                .ProfileUsingTime
                .refresh ===
                "function"
        ) {
            try {
                window.ProfileUsingTime
                    .refresh(
                        source
                    );

                return true;
            } catch (error) {
                console.warn(
                    "[ProfileUI] ProfileUsingTime could not render the activity data.",
                    error
                );
            }
        }

        return updateUsingTimeFallback(
            source
        );
    }

    function updateUsingTime(activity) {
        return renderUsingTime(
            activity
        );
    }

    function renderActivity(activity) {
        return renderUsingTime(
            activity
        );
    }

    function updateActivity(activity) {
        return renderUsingTime(
            activity
        );
    }

    /* =====================================================
       AUTHENTICATION UI
    ===================================================== */

    function getAccountTypeLabel(profile) {
        if (
            !profile.isAuthenticated
        ) {
            return "Guest";
        }

        if (
            isGoogleConnectedProfile(
                profile,
                profile.uid
            )
        ) {
            return "Registered • Google Connected";
        }

        return "Registered";
    }

    function renderAuthState(profile) {
        const page =
            getElement(
                "profilePage"
            );

        const button =
            getElement(
                "profileAuthButton"
            );

        const buttonText =
            getElement(
                "profileAuthButtonText"
            );

        const buttonIcon =
            getElement(
                "profileAuthButtonIcon"
            );

        if (page) {
            page.dataset.accountState =
                profile.isAuthenticated
                    ? "google"
                    : "guest";
        }

        if (
            !button ||
            !buttonText
        ) {
            return false;
        }

        button.disabled =
            state.isAuthLoading;

        button.setAttribute(
            "aria-busy",
            String(
                state.isAuthLoading
            )
        );

        button.classList.toggle(
            "is-loading",
            state.isAuthLoading
        );

        if (
            state.isAuthLoading
        ) {
            buttonText.textContent =
                "Please wait...";

            return true;
        }

        if (
            profile.isAuthenticated
        ) {
            button.dataset.action =
                "logout";

            button.classList.add(
                "is-logout"
            );

            button.classList.remove(
                "is-google-sign-in"
            );

            buttonText.textContent =
                "Logout";

            if (
                buttonIcon
            ) {
                buttonIcon.textContent =
                    "↪";
            }

            return true;
        }

        button.dataset.action =
            "google-sign-in";

        button.classList.add(
            "is-google-sign-in"
        );

        button.classList.remove(
            "is-logout"
        );

        buttonText.textContent =
            "Sign up with Google Account";

        if (
            buttonIcon
        ) {
            buttonIcon.textContent =
                "G";
        }

        return true;
    }

    /* =====================================================
       COMPLETE PROFILE RENDER
    ===================================================== */

    function render(profileData = {}) {
        const profile =
            normalizeProfile(
                profileData
            );

        state.currentProfile =
            profile;

        renderAvatar(
            profile
        );

        renderUsername(
            profile
        );

        renderAuthState(
            profile
        );

        syncProfileSections(
            profile
        );

        renderMobileState(
            profile
        );

        setText(
            "profileInfoName",
            profile.isAuthenticated
                ? profile.displayName
                : "Guest User",
            "Guest User"
        );

        setText(
            "profileInfoEmail",
            profile.isAuthenticated
                ? profile.email
                : "Not signed in",
            "Not signed in"
        );

        setText(
            "profileRegistrationDate",
            profile.isAuthenticated
                ? formatDate(
                    profile.registrationDate
                )
                : "Not registered",
            "Not registered"
        );

        setText(
            "profileAccountType",
            getAccountTypeLabel(
                profile
            ),
            "Guest"
        );

        setText(
            "profileLastLogin",
            profile.isAuthenticated
                ? formatDateTime(
                    profile.lastLogin
                )
                : "Not available",
            "Not available"
        );

        renderUsingTime(
            profile.isAuthenticated
                ? profile.usingTime
                : DEFAULT_PROFILE
                    .usingTime
        );

        return profile;
    }

    function renderGuest(
        overrides = {}
    ) {
        return render({
            ...DEFAULT_PROFILE,
            ...overrides,

            uid:
                "",

            isAuthenticated:
                false,

            authenticated:
                false,

            accountType:
                "guest",

            isGoogleConnected:
                false,

            googleConnected:
                false,

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            isMobileLocked:
                false,

            deviceId:
                "",

            deviceBound:
                false,

            usingTime:
                normalizeActivity({
                    requiredActiveDays:
                        REQUIRED_ACTIVE_DAYS,

                    requiredDailySeconds:
                        REQUIRED_DAILY_SECONDS
                })
        });
    }

    function renderRegisteredUser(
        profile = {}
    ) {
        return render({
            ...profile,

            isAuthenticated:
                true,

            authenticated:
                true,

            accountType:
                normalizeString(
                    profile.accountType,
                    "google"
                )
        });
    }

    /* =====================================================
       AUTH ACTION
    ===================================================== */

    function setAuthButtonLoading(
        isLoading
    ) {
        state.isAuthLoading =
            Boolean(
                isLoading
            );

        renderAuthState(
            state.currentProfile
        );

        return true;
    }

    async function handleAuthAction() {
        const button =
            getElement(
                "profileAuthButton"
            );

        if (
            !button ||
            button.disabled ||
            state.isAuthLoading
        ) {
            return;
        }

        const action =
            normalizeString(
                button.dataset.action
            );

        clearMobileError();
        hideStatus();
        setAuthButtonLoading(
            true
        );

        try {
            if (
                action ===
                    "logout" &&
                typeof state.handlers
                    .logout ===
                    "function"
            ) {
                await state.handlers
                    .logout();

                return;
            }

            if (
                action ===
                    "google-sign-in" &&
                typeof state.handlers
                    .signIn ===
                    "function"
            ) {
                await state.handlers
                    .signIn();

                return;
            }

            window.dispatchEvent(
                new CustomEvent(
                    "profile:auth-action",
                    {
                        detail: {
                            action
                        }
                    }
                )
            );
        } catch (error) {
            console.error(
                "[ProfileUI] Authentication action failed.",
                error
            );

            showStatus(
                getReadableErrorMessage(
                    error,
                    "The account action could not be completed."
                ),
                "error",
                5000
            );
        } finally {
            setAuthButtonLoading(
                false
            );
        }
    }

    /* =====================================================
       MOBILE SUBMISSION
    ===================================================== */

    function handleMobileInput(event) {
        const input =
            event.currentTarget;

        const digits =
            sanitizeMobileDigits(
                input.value
            );

        if (
            input.value !==
            digits
        ) {
            input.value =
                digits;
        }

        clearMobileError();
    }

    function extractSavedMobile(
        result,
        fallbackMobile
    ) {
        return normalizeMobileForDisplay(
            result?.profile
                ?.mobileNumber ||
            result?.mobileNumber ||
            result?.data
                ?.profile
                ?.mobileNumber ||
            result?.data
                ?.mobileNumber ||
            fallbackMobile
        );
    }

    async function handleMobileSubmit() {
        if (
            state.isSubmittingMobile
        ) {
            return;
        }

        const input =
            getElement(
                "profileMobileInput"
            );

        if (
            !input ||
            input.disabled ||
            input.readOnly
        ) {
            return;
        }

        if (
            !state.currentProfile
                .isAuthenticated
        ) {
            showMobileError(
                "Sign in with Google before adding a mobile number."
            );

            return;
        }

        if (
            state.currentProfile
                .isMobileLocked
        ) {
            showMobileError(
                "The mobile number has already been saved."
            );

            return;
        }

        const validation =
            validateMobileNumber(
                input.value
            );

        if (
            !validation.valid
        ) {
            showMobileError(
                validation.message
            );

            input.focus();

            return;
        }

        clearMobileError();

        if (
            typeof state.handlers
                .saveMobile !==
                "function"
        ) {
            window.dispatchEvent(
                new CustomEvent(
                    "profile:save-mobile",
                    {
                        detail: {
                            mobileNumber:
                                validation
                                    .fullNumber
                        }
                    }
                )
            );

            return;
        }

        setMobileSubmitting(
            true
        );

        try {
            const result =
                await state.handlers
                    .saveMobile(
                        validation
                            .fullNumber
                    );

            if (
                result === false
            ) {
                throw new Error(
                    "Mobile number could not be saved."
                );
            }

            const savedMobile =
                extractSavedMobile(
                    result,
                    validation.fullNumber
                );

            if (
                !savedMobile
            ) {
                throw new Error(
                    "The server did not return a valid mobile number."
                );
            }

            markMobileAsSaved(
                savedMobile
            );
        } catch (error) {
            console.error(
                "[ProfileUI] Mobile number submission failed.",
                error
            );

            setMobileSubmitting(
                false
            );

            showMobileError(
                getReadableErrorMessage(
                    error,
                    "Unable to save the mobile number."
                )
            );
        }
    }

    function handleMobileKeydown(
        event
    ) {
        if (
            event.key !==
            "Enter"
        ) {
            return;
        }

        event.preventDefault();

        void handleMobileSubmit();
    }

    /* =====================================================
       PAGE STATUS
    ===================================================== */

    function showStatus(
        message,
        type = "info",
        duration = 0
    ) {
        const status =
            getElement(
                "profilePageStatus"
            );

        if (
            !status
        ) {
            return false;
        }

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
        }

        const normalizedMessage =
            normalizeString(
                message
            );

        status.textContent =
            normalizedMessage;

        status.hidden =
            !normalizedMessage;

        status.dataset.statusType =
            normalizeString(
                type,
                "info"
            );

        status.classList.toggle(
            "is-success",
            type ===
                "success"
        );

        status.classList.toggle(
            "is-error",
            type ===
                "error"
        );

        status.classList.toggle(
            "is-info",
            type ===
                "info"
        );

        if (
            normalizedMessage &&
            duration >
                0
        ) {
            statusTimer =
                window.setTimeout(
                    hideStatus,
                    duration
                );
        }

        return true;
    }

    function hideStatus() {
        const status =
            getElement(
                "profilePageStatus"
            );

        if (
            !status
        ) {
            return false;
        }

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
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

    /* =====================================================
       PAGE LOADING
    ===================================================== */

    function setPageLoading(
        isLoading
    ) {
        const page =
            getElement(
                "profilePage"
            );

        if (
            !page
        ) {
            return false;
        }

        const loading =
            Boolean(
                isLoading
            );

        page.classList.toggle(
            "is-loading",
            loading
        );

        page.setAttribute(
            "aria-busy",
            String(
                loading
            )
        );

        return true;
    }

    /* =====================================================
       EVENT MANAGEMENT
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

    function removeAllListeners() {
        state.listeners.forEach(
            ({
                element,
                eventName,
                handler,
                options
            }) => {
                try {
                    element
                        .removeEventListener(
                            eventName,
                            handler,
                            options
                        );
                } catch {
                    /*
                     * No additional cleanup is required.
                     */
                }
            }
        );

        state.listeners =
            [];
    }

    function bindEvents() {
        removeAllListeners();

        addManagedListener(
            getElement(
                "profileAuthButton"
            ),
            "click",
            handleAuthAction
        );

        addManagedListener(
            getElement(
                "profileMobileInput"
            ),
            "input",
            handleMobileInput
        );

        addManagedListener(
            getElement(
                "profileMobileInput"
            ),
            "keydown",
            handleMobileKeydown
        );

        addManagedListener(
            getElement(
                "profileMobileSubmitButton"
            ),
            "click",
            handleMobileSubmit
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function initialize(options = {}) {
        destroy();

        state.root =
            options.root instanceof
                HTMLElement
                ? options.root
                : document;

        state.handlers = {
            signIn:
                typeof options
                    .onSignIn ===
                    "function"
                    ? options.onSignIn
                    : null,

            logout:
                typeof options
                    .onLogout ===
                    "function"
                    ? options.onLogout
                    : null,

            saveMobile:
                typeof options
                    .onSaveMobile ===
                    "function"
                    ? options.onSaveMobile
                    : null
        };

        const profilePage =
            getElement(
                "profilePage"
            );

        if (
            !profilePage
        ) {
            console.error(
                "[ProfileUI] ProfileView must be rendered before ProfileUI initialization."
            );

            state.root =
                null;

            return false;
        }

        const initialProfile =
            normalizeProfile(
                options.profile ||
                DEFAULT_PROFILE
            );

        if (
            window.ProfileUsingTime &&
            typeof window
                .ProfileUsingTime
                .init ===
                "function"
        ) {
            try {
                window.ProfileUsingTime
                    .init({
                        root:
                            profilePage,

                        activity:
                            initialProfile
                                .usingTime
                    });

                state.usingTimeInitialized =
                    true;
            } catch (error) {
                state.usingTimeInitialized =
                    false;

                console.warn(
                    "[ProfileUI] ProfileUsingTime initialization failed.",
                    error
                );
            }
        }

        bindEvents();

        state.initialized =
            true;

        render(
            initialProfile
        );

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        removeAllListeners();

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
        }

        const image =
            getElement(
                "profileAvatarImage"
            );

        if (
            image
        ) {
            image.onload =
                null;

            image.onerror =
                null;
        }

        if (
            state.usingTimeInitialized &&
            window.ProfileUsingTime &&
            typeof window
                .ProfileUsingTime
                .destroy ===
                "function"
        ) {
            try {
                window.ProfileUsingTime
                    .destroy();
            } catch {
                /*
                 * No additional cleanup is required.
                 */
            }
        }

        state.root =
            null;

        state.initialized =
            false;

        state.currentProfile = {
            ...DEFAULT_PROFILE
        };

        state.isSubmittingMobile =
            false;

        state.isAuthLoading =
            false;

        state.usingTimeInitialized =
            false;

        state.handlers = {
            signIn:
                null,

            logout:
                null,

            saveMobile:
                null
        };

        return true;
    }

    function isInitialized() {
        return state.initialized;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        initialize,
        destroy,
        isInitialized,

        render,
        renderGuest,
        renderRegisteredUser,

        renderAvatar,
        renderUsername,

        /*
         * Old API retained for compatibility.
         */
        renderUsingTime,
        updateUsingTime,

        /*
         * Canonical activity API.
         */
        renderActivity,
        updateActivity,

        normalizeProfile,
        normalizeActivity,

        validateMobileNumber,
        normalizeMobileForDisplay,

        setMobileSubmitting,
        markMobileAsSaved,

        showMobileError,
        clearMobileError,

        setPageLoading,
        setAuthButtonLoading,

        showStatus,
        hideStatus,

        formatDate,
        formatDateTime,

        getCurrentProfile() {
            return cloneValue(
                state.currentProfile
            );
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileUI =
    ProfileUI;