"use strict";

/* =========================================================
   11PLAY — PROFILE MODULE
   File: js/account/profile/profile.module.js

   Responsibilities:
   - Initialize the Profile page runtime
   - Display Guest and verified Google-user states
   - Initialize ProfileDB and ActivityDB
   - Synchronize Firestore-authoritative Profile data
   - Submit one-time mobile numbers through ProfileDB
   - Render and initialize Shared Account Sections
   - Guest referral/share link = canonical 11Play main URL
   - Signed-in user referral link = that user's unique link
   - Expose 7 Eligible Active Days to the Profile UI
   - Each Eligible Active Day requires minimum 2 active hours
   - Expose today's partial 2-hour activity progress
   - Expose server-authoritative Web Device binding state
   - Clean up only Profile-page listeners and UI runtimes

   Important:
   - No private profile data is stored in localStorage
   - Browser clock time never determines referral eligibility
   - Device identity is never generated or trusted here
   - No referral identity is generated from username
   - Guest users never inherit an Admin referral link
   - No direct Firestore or wallet write occurs here
   - ProfileDB, ActivityDB and AuthService remain app-level services
========================================================= */

const ProfileModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const LEGACY_STORAGE_KEYS =
        Object.freeze([
            "11play.profile.data",
            "11play.profile.activeUsingTime",
            "profile_user",
            "profile_start_time"
        ]);

    const PROFILE_PAGE_NAME =
        "profile";

    const CANONICAL_REFERRAL_BASE_URL =
        "https://11play.github.io/11play/";

    const REFERRAL_QUERY_PARAMETER =
        "ref";

    const REQUIRED_ACTIVE_DAYS =
        7;

    const REQUIRED_DAILY_SECONDS =
        2 * 60 * 60;

    const REQUIRED_TOTAL_SECONDS =
        REQUIRED_ACTIVE_DAYS *
        REQUIRED_DAILY_SECONDS;

    /*
     * Legacy activity compatibility only.
     *
     * Old versions represented one credited Active Day as
     * 24 hours. New activity qualification requires only
     * 2 eligible hours on a Bangladesh calendar day.
     */
    const LEGACY_SECONDS_PER_DAY =
        24 * 60 * 60;

    const ACTIVITY_POLICY_VERSION =
        2;

    const AUTH_EVENTS =
        Object.freeze([
            "auth:state-changed",
            "profile:auth-changed",
            "auth:signed-in",
            "auth:signed-out",
            "profile:logout"
        ]);

    const PROFILE_REFRESH_EVENTS =
        Object.freeze([
            "profile:data-changed",
            "profile:mobile-saved",
            "referral:updated",
            "referral:public-link-updated"
        ]);

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

        listeners:
            [],

        profileUnsubscribe:
            null,

        activityUnsubscribe:
            null,

        pageObserver:
            null,

        readyPromise:
            null,

        currentProfile:
            createGuestProfile(),

        currentUid:
            "",

        lifecycleGeneration:
            0,

        authGeneration:
            0,

        activeAuthUid:
            "",

        activeAuthPromise:
            null
    };

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

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        const number =
            Math.floor(
                Number.isFinite(
                    Number(value)
                )
                    ? Number(value)
                    : Number(fallback) ||
                    0
            );

        return number >= 0
            ? number
            : 0;
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
            return value
                .toDate()
                .getTime();
        }

        if (
            value instanceof
                Date
        ) {
            return value.getTime();
        }

        if (
            typeof value ===
                "string"
        ) {
            const milliseconds =
                Date.parse(value);

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
            return value.seconds * 1000;
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

    function normalizeReferralCode(value) {
        const code =
            normalizeString(value)
                .toUpperCase()
                .replace(
                    /[^A-HJ-NP-Z2-9]/g,
                    ""
                );

        return /^[A-HJ-NP-Z2-9]{8}$/
            .test(code)
                ? code
                : "";
    }

    function buildReferralLink(
        referralCode
    ) {
        const code =
            normalizeReferralCode(
                referralCode
            );

        if (!code) {
            return "";
        }

        try {
            const url =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            url.searchParams.set(
                REFERRAL_QUERY_PARAMETER,
                code
            );

            url.hash =
                "";

            return url.toString();
        } catch {
            return "";
        }
    }

    function normalizeReferralLink(value) {
        const link =
            normalizeString(value);

        if (!link) {
            return "";
        }

        try {
            const parsed =
                new URL(
                    link,
                    CANONICAL_REFERRAL_BASE_URL
                );

            const canonical =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            if (
                parsed.protocol !==
                    "https:" ||
                parsed.origin !==
                    canonical.origin ||
                parsed.pathname !==
                    canonical.pathname
            ) {
                return "";
            }

            const code =
                normalizeReferralCode(
                    parsed.searchParams.get(
                        REFERRAL_QUERY_PARAMETER
                    )
                );

            parsed.hash =
                "";

            parsed.search =
                "";

            if (code) {
                parsed.searchParams.set(
                    REFERRAL_QUERY_PARAMETER,
                    code
                );
            }

            return parsed.toString();
        } catch {
            return "";
        }
    }

    function normalizeActiveDayKeys(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        return Array.from(
            new Set(
                value
                    .map(normalizeString)
                    .filter(
                        dayKey =>
                            /^\d{4}-\d{2}-\d{2}$/
                                .test(dayKey)
                    )
            )
        ).sort();
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
            explicitDays !== undefined
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
            eligibleDayKeys.length > 0
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
         * New policy seconds represent actual 2-hour Eligible Days.
         * Old policy compatibility seconds represented 24-hour days.
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
        const seconds =
            firstDefined(
                source.currentDaySeconds,
                source.todayActiveSeconds,
                source.currentActiveSeconds
            );

        if (
            seconds !== undefined
        ) {
            return toNonNegativeInteger(
                seconds
            );
        }

        const minutes =
            firstDefined(
                source.currentDayMinutes,
                source.todayActiveMinutes,
                source.currentActiveMinutes
            );

        if (
            minutes !== undefined
        ) {
            return (
                toNonNegativeInteger(
                    minutes
                ) * 60
            );
        }

        return 0;
    }

    function normalizeActivity(
        value,
        uid = ""
    ) {
        const source =
            isPlainObject(value)
                ? value
                : {};

        const requiredActiveDays =
            Math.max(
                1,
                toNonNegativeInteger(
                    source.requiredActiveDays,
                    REQUIRED_ACTIVE_DAYS
                ) ||
                REQUIRED_ACTIVE_DAYS
            );

        const requiredDailySeconds =
            Math.max(
                1,
                toNonNegativeInteger(
                    source.requiredDailySeconds,
                    REQUIRED_DAILY_SECONDS
                ) ||
                REQUIRED_DAILY_SECONDS
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

        const currentDayCompleted =
            source.currentDayCompleted ===
                true ||
            currentDaySeconds >=
                requiredDailySeconds;

        const todayActiveSeconds =
            currentDaySeconds;

        const todayActiveMinutes =
            Math.floor(
                todayActiveSeconds /
                60
            );

        const requiredDailyMinutes =
            Math.ceil(
                requiredDailySeconds /
                60
            );

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

        const progressPercent =
            requiredActiveDays > 0
                ? Math.min(
                    100,
                    Number(
                        (
                            eligibleActiveDays /
                            requiredActiveDays *
                            100
                        ).toFixed(4)
                    )
                )
                : 100;

        const dailyProgressPercent =
            requiredDailySeconds > 0
                ? Math.min(
                    100,
                    Number(
                        (
                            currentDaySeconds /
                            requiredDailySeconds *
                            100
                        ).toFixed(4)
                    )
                )
                : 100;

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

        const lastEligibleDayKey =
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
         * Completed Eligible Days already contain their full
         * 2-hour requirement.
         *
         * When currentDayCompleted=true, backend should already
         * have converted that day into activeDays, so do not
         * double-count currentDaySeconds.
         */
        const partialTodaySeconds =
            currentDayCompleted
                ? 0
                : currentDaySeconds;

        const totalActiveSeconds =
            Math.min(
                requiredActiveDays *
                    requiredDailySeconds,

                eligibleActiveDays *
                    requiredDailySeconds +
                partialTodaySeconds
            );

        const requiredActiveSeconds =
            requiredActiveDays *
            requiredDailySeconds;

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
                    source.userId ||
                    uid
                ),

            userId:
                normalizeString(
                    source.userId ||
                    source.uid ||
                    uid
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

            lastEligibleDayKey,

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

            activityPolicyVersion:
                toNonNegativeInteger(
                    source.activityPolicyVersion,
                    ACTIVITY_POLICY_VERSION
                ) ||
                ACTIVITY_POLICY_VERSION,

            updatedAt:
                source.updatedAt ||
                null,

            /*
             * Temporary read-only compatibility aliases.
             *
             * New model:
             * 1 Eligible Active Day = minimum 2 active hours.
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

    function createGuestProfile() {
        if (
            window.ProfileService &&
            typeof window.ProfileService
                .createGuestProfile ===
                "function"
        ) {
            try {
                return window.ProfileService
                    .createGuestProfile();
            } catch {
                /*
                 * Continue to local Guest shape.
                 */
            }
        }

        return {
            isAuthenticated:
                false,

            authenticated:
                false,

            uid:
                "",

            displayName:
                "Guest User",

            username:
                "11guest-xxxxxx",

            email:
                "",

            photoURL:
                "",

            mobileNumber:
                "",

            isMobileLocked:
                false,

            mobileAdded:
                false,

            mobileLocked:
                false,

            deviceId:
                "",

            deviceBound:
                false,

            registrationDate:
                null,

            accountType:
                "guest",

            lastLogin:
                null,

            referralCode:
                "",

            referralLink:
                "",

            usingTime: {
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
                    0,

                remainingActiveDays:
                    0,

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
                    0,

                requiredDailyMinutes:
                    0,

                remainingTodaySeconds:
                    0,

                remainingTodayMinutes:
                    0,

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
                    [],

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

                updatedAt:
                    null,

                totalActiveSeconds:
                    0,

                requiredActiveSeconds:
                    0,

                remainingActiveSeconds:
                    0,

                currentSessionId:
                    "",

                currentSessionActive:
                    false,

                currentSessionStartedAt:
                    null,

                lastHeartbeatAt:
                    null
            },

            activity:
                null
        };
    }

    /* =====================================================
       LEGACY STORAGE CLEANUP
    ===================================================== */

    function removeLegacyStorage() {
        try {
            LEGACY_STORAGE_KEYS.forEach(
                storageKey => {
                    window.localStorage
                        ?.removeItem(
                            storageKey
                        );
                }
            );
        } catch {
            /*
             * Storage may be unavailable.
             */
        }

        return true;
    }

    /* =====================================================
       MANAGED EVENT LISTENERS
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
                     * No additional cleanup is required.
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

    function resolveAuthUser() {
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
                const currentUser =
                    authService
                        .getCurrentUser();

                if (currentUser?.uid) {
                    return currentUser;
                }
            } catch {
                /*
                 * Continue to Firebase user.
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
                const firebaseUser =
                    authService
                        .getFirebaseUser();

                if (firebaseUser?.uid) {
                    return firebaseUser;
                }
            } catch {
                /*
                 * Continue to configured Auth.
                 */
            }
        }

        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        return (
            configuredAuth
                ?.currentUser ||
            null
        );
    }

    async function waitForAuthReady() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService.init ===
                "function"
        ) {
            try {
                await authService.init();
            } catch {
                /*
                 * whenReady may still resolve.
                 */
            }
        }

        if (
            authService &&
            typeof authService
                .whenReady ===
                "function"
        ) {
            try {
                await authService
                    .whenReady();
            } catch {
                /*
                 * Guest UI remains available.
                 */
            }
        }

        return resolveAuthUser();
    }

    function extractEventUser(event) {
        const detail =
            event?.detail;

        if (
            detail?.user?.uid
        ) {
            return detail.user;
        }

        if (
            detail?.profile?.uid
        ) {
            return detail.profile;
        }

        if (detail?.uid) {
            return detail;
        }

        return resolveAuthUser();
    }

    /* =====================================================
       PROFILE DATA SOURCES
    ===================================================== */

    function extractProfile(value) {
        if (!value) {
            return null;
        }

        if (
            isPlainObject(
                value.profile
            )
        ) {
            return value.profile;
        }

        if (
            isPlainObject(
                value.data?.profile
            )
        ) {
            return value.data.profile;
        }

        if (
            isPlainObject(
                value.user
            ) &&
            value.user.uid
        ) {
            return value.user;
        }

        if (
            isPlainObject(value) &&
            (
                value.uid ||
                value.userId ||
                value.email ||
                value.referralCode ||
                value.mobileNumber
            )
        ) {
            return value;
        }

        return null;
    }

    function readProfileDBProfile() {
        const profileDB =
            window.ProfileDB;

        if (!profileDB) {
            return null;
        }

        const methods = [
            "getProfile",
            "getUser",
            "getCurrentUser"
        ];

        for (
            const methodName of
            methods
        ) {
            if (
                typeof profileDB[
                    methodName
                ] !== "function"
            ) {
                continue;
            }

            try {
                const profile =
                    profileDB[
                        methodName
                    ]();

                if (profile) {
                    return profile;
                }
            } catch {
                /*
                 * Continue to next source.
                 */
            }
        }

        return null;
    }

    function readProfileServiceProfile() {
        const profileService =
            window.ProfileService;

        if (
            !profileService ||
            typeof profileService
                .getUser !==
                "function"
        ) {
            return null;
        }

        try {
            return (
                profileService
                    .getUser() ||
                null
            );
        } catch {
            return null;
        }
    }

    function readCurrentProfile() {
        return (
            readProfileDBProfile() ||
            readProfileServiceProfile() ||
            null
        );
    }

    /* =====================================================
       SHARED REFERRAL IDENTITY

       Guest:
       - Always canonical main-site URL.
       - No referral code / no Admin attribution.

       Verified Google user:
       - Own referral identity only.
    ===================================================== */

    function readReferralDBIdentity() {
        const referralDB =
            window.ReferralDB;

        if (
            !referralDB ||
            typeof referralDB
                .getReferralIdentity !==
                "function"
        ) {
            return null;
        }

        try {
            const identity =
                referralDB
                    .getReferralIdentity();

            return isPlainObject(
                identity
            )
                ? identity
                : null;
        } catch {
            return null;
        }
    }

    function isAuthenticatedProfile(
        profile,
        authUser = resolveAuthUser()
    ) {
        const profileUid =
            normalizeString(
                profile?.uid ||
                profile?.userId
            );

        const authUid =
            normalizeString(
                authUser?.uid
            );

        if (
            profile?.isAuthenticated ===
                true ||
            profile?.authenticated ===
                true
        ) {
            return Boolean(
                profileUid ||
                authUid
            );
        }

        return Boolean(
            profileUid &&
            authUid &&
            profileUid ===
                authUid
        );
    }

    function resolveSharedReferralIdentity(
        profileCandidate =
            state.currentProfile
    ) {
        const profile =
            extractProfile(
                profileCandidate
            ) ||
            (
                isPlainObject(
                    profileCandidate
                )
                    ? profileCandidate
                    : {}
            );

        const authUser =
            resolveAuthUser();

        const authenticated =
            isAuthenticatedProfile(
                profile,
                authUser
            );

        if (!authenticated) {
            return {
                referralCode:
                    "",

                referralLink:
                    CANONICAL_REFERRAL_BASE_URL,

                referralSource:
                    "guest",

                source:
                    "guest",

                isGuestReferral:
                    true,

                isPublicAdminReferral:
                    false
            };
        }

        const uid =
            normalizeString(
                profile.uid ||
                profile.userId ||
                authUser?.uid
            );

        const referralDBIdentity =
            readReferralDBIdentity() ||
            {};

        const referralDBSource =
            normalizeString(
                referralDBIdentity.source ||
                referralDBIdentity
                    .referralSource
            ).toLowerCase();

        const referralDBState =
            window.ReferralDB &&
            typeof window.ReferralDB
                .getState ===
                "function"
                ? (() => {
                    try {
                        return window.ReferralDB
                            .getState();
                    } catch {
                        return null;
                    }
                })()
                : null;

        const referralDBUid =
            normalizeString(
                referralDBState
                    ?.currentUser
                    ?.uid
            );

        const referralDBMatches =
            referralDBSource ===
                "user" &&
            referralDBIdentity
                .isPublicAdminReferral !==
                true &&
            (
                !referralDBUid ||
                referralDBUid ===
                    uid
            );

        let referralCode =
            normalizeReferralCode(
                profile.referralCode
            );

        let referralLink =
            normalizeReferralLink(
                profile.referralLink
            );

        if (
            (
                !referralCode ||
                !referralLink
            ) &&
            referralDBMatches
        ) {
            referralCode =
                referralCode ||
                normalizeReferralCode(
                    referralDBIdentity
                        .referralCode
                );

            referralLink =
                referralLink ||
                normalizeReferralLink(
                    referralDBIdentity
                        .referralLink
                );
        }

        if (
            !referralLink &&
            referralCode
        ) {
            referralLink =
                buildReferralLink(
                    referralCode
                );
        }

        if (referralLink) {
            try {
                const codeFromLink =
                    normalizeReferralCode(
                        new URL(
                            referralLink
                        ).searchParams.get(
                            REFERRAL_QUERY_PARAMETER
                        )
                    );

                if (
                    referralCode &&
                    codeFromLink &&
                    referralCode !==
                        codeFromLink
                ) {
                    referralLink =
                        "";
                } else if (
                    !referralCode &&
                    codeFromLink
                ) {
                    referralCode =
                        codeFromLink;
                }
            } catch {
                referralLink =
                    "";
            }
        }

        return {
            referralCode,

            referralLink,

            referralSource:
                referralCode &&
                referralLink
                    ? "user"
                    : "",

            source:
                referralCode &&
                referralLink
                    ? "user"
                    : "",

            isGuestReferral:
                false,

            isPublicAdminReferral:
                false
        };
    }

    /* =====================================================
       ACTIVITY DATA
    ===================================================== */

    function extractActivity(value) {
        if (!value) {
            return null;
        }

        if (
            isPlainObject(
                value.activity
            )
        ) {
            return value.activity;
        }

        if (
            isPlainObject(
                value.usingTime
            )
        ) {
            return value.usingTime;
        }

        if (
            isPlainObject(value) &&
            (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "eligibleActiveDays"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "totalActiveDays"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "activeDays"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "requiredActiveDays"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "currentDaySeconds"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "todayActiveSeconds"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "requiredDailySeconds"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        value,
                        "totalActiveSeconds"
                    )
            )
        ) {
            return value;
        }

        return null;
    }

    function readCurrentActivity(uid = "") {
        const activityDB =
            window.ActivityDB;

        if (
            activityDB &&
            typeof activityDB
                .getState ===
                "function"
        ) {
            try {
                const activityState =
                    activityDB
                        .getState();

                const activity =
                    extractActivity(
                        activityState
                    );

                const activityUid =
                    normalizeString(
                        activity?.uid ||
                        activityState
                            ?.currentUser
                            ?.uid
                    );

                if (
                    activity &&
                    (
                        !uid ||
                        !activityUid ||
                        activityUid ===
                            uid
                    )
                ) {
                    return normalizeActivity(
                        activity,
                        uid
                    );
                }
            } catch {
                /*
                 * Continue to ProfileService.
                 */
            }
        }

        const profileService =
            window.ProfileService;

        if (
            profileService &&
            typeof profileService
                .getActivityProgress ===
                "function"
        ) {
            try {
                return normalizeActivity(
                    profileService
                        .getActivityProgress(),
                    uid
                );
            } catch {
                /*
                 * Continue to getTime.
                 */
            }
        }

        if (
            profileService &&
            typeof profileService
                .getTime ===
                "function"
        ) {
            try {
                return normalizeActivity(
                    profileService
                        .getTime(),
                    uid
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    /* =====================================================
       UI PROFILE CREATION
    ===================================================== */

    function buildUIProfile(
        profileCandidate,
        authUser = resolveAuthUser()
    ) {
        const profile =
            extractProfile(
                profileCandidate
            ) ||
            {};

        const authUid =
            normalizeString(
                authUser?.uid
            );

        const profileUid =
            normalizeString(
                profile.uid ||
                profile.userId
            );

        if (
            profileUid &&
            authUid &&
            profileUid !==
                authUid
        ) {
            return createGuestProfile();
        }

        const uid =
            profileUid ||
            authUid;

        if (!uid) {
            return createGuestProfile();
        }

        const activity =
            readCurrentActivity(uid) ||
            normalizeActivity(
                profile.usingTime ||
                profile.activity ||
                {
                    uid,

                    eligibleActiveDays:
                        0,

                    requiredActiveDays:
                        REQUIRED_ACTIVE_DAYS,

                    requiredDailySeconds:
                        REQUIRED_DAILY_SECONDS
                },
                uid
            );

        const deviceId =
            normalizeString(
                firstDefined(
                    profile.deviceId,
                    profile.webDeviceId,
                    profile.boundDeviceId,
                    activity.deviceId
                )
            );

        const deviceBound =
            profile.deviceBound ===
                true ||
            activity.deviceBound ===
                true ||
            Boolean(
                deviceId
            );

        return {
            ...profile,

            isAuthenticated:
                true,

            authenticated:
                true,

            uid,

            displayName:
                normalizeString(
                    profile.displayName ||
                    profile.name ||
                    authUser?.displayName,
                    "Google User"
                ),

            email:
                normalizeString(
                    profile.email ||
                    authUser?.email
                ).toLowerCase(),

            photoURL:
                normalizeString(
                    profile.photoURL ||
                    profile.photo ||
                    authUser?.photoURL
                ),

            mobileNumber:
                normalizeString(
                    profile.mobileNumber ||
                    profile.mobile
                ),

            isMobileLocked:
                profile.isMobileLocked ===
                    true ||
                profile.mobileLocked ===
                    true ||
                Boolean(
                    normalizeString(
                        profile.mobileNumber ||
                        profile.mobile
                    )
                ),

            mobileAdded:
                profile.mobileAdded ===
                    true ||
                Boolean(
                    normalizeString(
                        profile.mobileNumber ||
                        profile.mobile
                    )
                ),

            mobileLocked:
                profile.mobileLocked ===
                    true ||
                profile.isMobileLocked ===
                    true ||
                Boolean(
                    normalizeString(
                        profile.mobileNumber ||
                        profile.mobile
                    )
                ),

            deviceId,

            deviceBound,

            registrationDate:
                profile.registrationDate ||
                profile.createdAt ||
                null,

            accountType:
                normalizeString(
                    profile.accountType,
                    "google"
                ),

            lastLogin:
                profile.lastLogin ||
                profile.lastLoginAt ||
                null,

            referralCode:
                normalizeReferralCode(
                    profile.referralCode
                ),

            referralLink:
                normalizeReferralLink(
                    profile.referralLink
                ),

            usingTime:
                activity,

            activity
        };
    }

    /* =====================================================
       PROFILE UI
    ===================================================== */

    function initializeProfileUI(
        profile
    ) {
        if (
            !window.ProfileUI ||
            typeof window.ProfileUI
                .initialize !==
                "function"
        ) {
            console.error(
                "[ProfileModule] ProfileUI is unavailable."
            );

            return false;
        }

        const initialized =
            window.ProfileUI
                .initialize({
                    root:
                        state.page,

                    profile,

                    onSignIn:
                        signInWithGoogle,

                    onLogout:
                        logout,

                    onSaveMobile:
                        saveMobileNumber
                });

        return initialized !==
            false;
    }

    function updateProfileActivityUI(
        activity
    ) {
        if (!activity) {
            return false;
        }

        const normalized =
            normalizeActivity(
                activity,
                state.currentUid
            );

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .updateActivity ===
                "function"
        ) {
            window.ProfileUI
                .updateActivity(
                    normalized
                );

            return true;
        }

        /*
         * Compatibility until profile.ui.js is replaced.
         */
        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .updateUsingTime ===
                "function"
        ) {
            window.ProfileUI
                .updateUsingTime(
                    normalized
                );

            return true;
        }

        return false;
    }

    function renderProfile(profile) {
        if (
            !state.initialized ||
            !state.page ||
            !state.page.isConnected
        ) {
            return false;
        }

        const normalizedProfile =
            buildUIProfile(
                profile
            );

        state.currentProfile =
            normalizedProfile;

        state.currentUid =
            normalizeString(
                normalizedProfile.uid
            );

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .render ===
                "function"
        ) {
            window.ProfileUI
                .render(
                    normalizedProfile
                );
        }

        synchronizeSharedReferralLink(
            normalizedProfile
        );

        if (
            window.ProfileStatistics &&
            typeof window.ProfileStatistics
                .refresh ===
                "function"
        ) {
            try {
                window.ProfileStatistics
                    .refresh(
                        normalizedProfile
                    );
            } catch {
                /*
                 * Statistics do not block Profile rendering.
                 */
            }
        }

        return normalizedProfile;
    }

    function renderGuestState() {
        const guestProfile =
            createGuestProfile();

        state.currentUid =
            "";

        state.currentProfile =
            guestProfile;

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .renderGuest ===
                "function"
        ) {
            window.ProfileUI
                .renderGuest(
                    guestProfile
                );
        } else if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .render ===
                "function"
        ) {
            window.ProfileUI
                .render(
                    guestProfile
                );
        }

        /*
         * Guest always receives the canonical main-site link.
         */
        synchronizeSharedReferralLink(
            guestProfile
        );

        return guestProfile;
    }

    /* =====================================================
       SHARED ACCOUNT SECTIONS
    ===================================================== */

    function getSharedMount() {
        if (!state.page) {
            return null;
        }

        return state.page
            .querySelector(
                "#accountSectionsMount"
            );
    }

    function renderSharedSections(
        profile
    ) {
        if (
            !window.AccountSectionsView ||
            typeof window
                .AccountSectionsView
                .render !==
                "function"
        ) {
            console.error(
                "[ProfileModule] AccountSectionsView is unavailable."
            );

            return false;
        }

        const mount =
            getSharedMount();

        if (!mount) {
            console.error(
                "[ProfileModule] Shared Account Sections mount was not found."
            );

            return false;
        }

        state.sharedMount =
            mount;

        const referralIdentity =
            resolveSharedReferralIdentity(
                profile
            );

        return window
            .AccountSectionsView
            .render(
                mount,
                {
                    currentPage:
                        PROFILE_PAGE_NAME,

                    referralLink:
                        referralIdentity
                            .referralLink,

                    referralSource:
                        referralIdentity
                            .referralSource
                }
            ) !== false;
    }

    function initializeSharedSections(
        profile
    ) {
        if (
            !renderSharedSections(
                profile
            )
        ) {
            return false;
        }

        if (
            !window.AccountSectionsModule ||
            typeof window
                .AccountSectionsModule
                .init !==
                "function"
        ) {
            console.error(
                "[ProfileModule] AccountSectionsModule is unavailable."
            );

            return false;
        }

        const referralIdentity =
            resolveSharedReferralIdentity(
                profile
            );

        const initialized =
            window.AccountSectionsModule
                .init({
                    root:
                        state.sharedMount,

                    currentPage:
                        PROFILE_PAGE_NAME,

                    referralLink:
                        referralIdentity
                            .referralLink,

                    referralSource:
                        referralIdentity
                            .referralSource
                });

        if (initialized === false) {
            return false;
        }

        state.sharedSectionsInitialized =
            true;

        return true;
    }

    function synchronizeSharedReferralLink(
        profile
    ) {
        if (
            !state.sharedSectionsInitialized ||
            !window
                .AccountSectionsModule
        ) {
            return false;
        }

        const sharedModule =
            window.AccountSectionsModule;

        const referralIdentity =
            resolveSharedReferralIdentity(
                profile
            );

        if (
            referralIdentity
                .referralLink &&
            typeof sharedModule
                .setReferralLink ===
                "function"
        ) {
            sharedModule
                .setReferralLink(
                    referralIdentity
                        .referralLink,
                    {
                        resolveIdentity:
                            false,

                        referralSource:
                            referralIdentity
                                .referralSource
                    }
                );

            return true;
        }

        let synchronizedLink =
            "";

        if (
            typeof sharedModule
                .synchronizeReferralLink ===
                "function"
        ) {
            synchronizedLink =
                sharedModule
                    .synchronizeReferralLink();
        }

        if (synchronizedLink) {
            return true;
        }

        if (
            typeof sharedModule
                .ensureReferralLink ===
                "function"
        ) {
            void Promise.resolve(
                sharedModule
                    .ensureReferralLink({
                        publishError:
                            false,

                        throwOnError:
                            false
                    })
            ).catch(
                error => {
                    console.warn(
                        "[ProfileModule] Referral link synchronization failed.",
                        error
                    );
                }
            );

            return true;
        }

        /*
         * Compatibility method name.
         * It now returns the Guest main-site URL,
         * never an Admin referral link.
         */
        if (
            typeof sharedModule
                .loadPublicAdminReferral ===
                "function"
        ) {
            void Promise.resolve(
                sharedModule
                    .loadPublicAdminReferral({
                        publishError:
                            false,

                        throwOnError:
                            false
                    })
            ).catch(
                error => {
                    console.warn(
                        "[ProfileModule] Guest referral link could not be loaded.",
                        error
                    );
                }
            );

            return true;
        }

        return false;
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
            !sharedModule ||
            typeof sharedModule.destroy !==
                "function"
        ) {
            state.sharedSectionsInitialized =
                false;

            return true;
        }

        const sharedCurrentPage =
            typeof sharedModule
                .getCurrentPage ===
                "function"
                ? sharedModule
                    .getCurrentPage()
                : PROFILE_PAGE_NAME;

        /*
         * Do not let an old Profile observer destroy
         * Account Sections already used by a new page.
         */
        if (
            sharedCurrentPage ===
            PROFILE_PAGE_NAME
        ) {
            sharedModule.destroy();
        }

        state.sharedSectionsInitialized =
            false;

        return true;
    }

    /* =====================================================
       AUTH ACTIONS
    ===================================================== */

    async function signInWithGoogle() {
        const authService =
            window.AuthService;

        if (
            !authService ||
            typeof authService
                .loginWithGoogle !==
                "function"
        ) {
            throw new Error(
                "Google sign-in service is unavailable."
            );
        }

        return authService
            .loginWithGoogle();
    }

    async function logout() {
        const authService =
            window.AuthService;

        if (
            !authService ||
            typeof authService.logout !==
                "function"
        ) {
            throw new Error(
                "Logout service is unavailable."
            );
        }

        return authService.logout();
    }

    /* =====================================================
       MOBILE NUMBER
    ===================================================== */

    async function saveMobileNumber(
        mobileNumber
    ) {
        const profileDB =
            window.ProfileDB;

        if (
            !profileDB ||
            typeof profileDB
                .saveMobileNumber !==
                "function"
        ) {
            throw new Error(
                "Profile mobile service is unavailable."
            );
        }

        const authUser =
            resolveAuthUser();

        if (!authUser?.uid) {
            throw new Error(
                "Sign in with Google before saving a mobile number."
            );
        }

        const result =
            await profileDB
                .saveMobileNumber(
                    mobileNumber
                );

        const returnedProfile =
            extractProfile(result);

        if (returnedProfile) {
            renderProfile(
                returnedProfile
            );
        } else {
            await refreshProfile({
                includeActivity:
                    false
            });
        }

        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .refresh ===
                "function"
        ) {
            void window.ReferralDB
                .refresh({
                    force:
                        true
                })
                .catch(
                    () => {
                        /*
                         * Referral refresh does not invalidate
                         * the successful mobile save.
                         */
                    }
                );
        }

        window.dispatchEvent(
            new CustomEvent(
                "profile:mobile-saved",
                {
                    detail: {
                        uid:
                            authUser.uid
                    }
                }
            )
        );

        return result;
    }

    /* =====================================================
       SERVICE SUBSCRIPTIONS
    ===================================================== */

    function handleProfileSubscription(
        payload
    ) {
        if (!state.initialized) {
            return;
        }

        const profile =
            extractProfile(payload) ||
            readCurrentProfile();

        if (!profile) {
            return;
        }

        const authUid =
            normalizeString(
                resolveAuthUser()?.uid
            );

        const profileUid =
            normalizeString(
                profile.uid ||
                profile.userId
            );

        if (
            authUid &&
            profileUid &&
            authUid !== profileUid
        ) {
            return;
        }

        renderProfile(profile);
    }

    function handleActivitySubscription(
        payload
    ) {
        if (!state.initialized) {
            return;
        }

        const activity =
            extractActivity(payload);

        if (!activity) {
            return;
        }

        const activityUid =
            normalizeString(
                activity.uid ||
                activity.userId ||
                payload
                    ?.currentUser
                    ?.uid
            );

        if (
            state.currentUid &&
            activityUid &&
            activityUid !==
                state.currentUid
        ) {
            return;
        }

        const normalizedActivity =
            normalizeActivity(
                activity,
                state.currentUid
            );

        updateProfileActivityUI(
            normalizedActivity
        );

        state.currentProfile = {
            ...state.currentProfile,

            deviceId:
                normalizedActivity
                    .deviceId ||
                state.currentProfile
                    .deviceId ||
                "",

            deviceBound:
                normalizedActivity
                    .deviceBound ===
                    true ||
                state.currentProfile
                    .deviceBound ===
                    true,

            usingTime:
                normalizedActivity,

            activity:
                normalizedActivity
        };
    }

    function bindServiceSubscriptions() {
        const profileDB =
            window.ProfileDB;

        if (
            !state.profileUnsubscribe &&
            profileDB &&
            typeof profileDB
                .subscribe ===
                "function"
        ) {
            try {
                state.profileUnsubscribe =
                    profileDB.subscribe(
                        handleProfileSubscription
                    );
            } catch {
                state.profileUnsubscribe =
                    null;
            }
        }

        const activityDB =
            window.ActivityDB;

        if (
            !state.activityUnsubscribe &&
            activityDB &&
            typeof activityDB
                .subscribe ===
                "function"
        ) {
            try {
                state.activityUnsubscribe =
                    activityDB.subscribe(
                        handleActivitySubscription
                    );
            } catch {
                state.activityUnsubscribe =
                    null;
            }
        }

        return true;
    }

    function unbindServiceSubscriptions() {
        if (
            typeof state
                .profileUnsubscribe ===
                "function"
        ) {
            state.profileUnsubscribe();
        }

        if (
            typeof state
                .activityUnsubscribe ===
                "function"
        ) {
            state.activityUnsubscribe();
        }

        state.profileUnsubscribe =
            null;

        state.activityUnsubscribe =
            null;

        return true;
    }

    /* =====================================================
       PROFILE AND ACTIVITY INITIALIZATION
    ===================================================== */

    function isCurrentOperation(
        lifecycleGeneration,
        authGeneration,
        expectedUid = ""
    ) {
        if (
            !state.initialized ||
            lifecycleGeneration !==
                state.lifecycleGeneration ||
            authGeneration !==
                state.authGeneration
        ) {
            return false;
        }

        if (
            expectedUid &&
            resolveAuthUser()?.uid !==
                expectedUid
        ) {
            return false;
        }

        return true;
    }

    async function initializeProfileDB() {
        const profileDB =
            window.ProfileDB;

        if (!profileDB) {
            throw new Error(
                "ProfileDB is unavailable."
            );
        }

        if (
            typeof profileDB.init ===
                "function"
        ) {
            await profileDB.init();
        }

        if (
            typeof profileDB
                .whenReady ===
                "function"
        ) {
            await profileDB
                .whenReady();
        }

        return profileDB;
    }

    async function initializeActivityDB() {
        const activityDB =
            window.ActivityDB;

        if (!activityDB) {
            return null;
        }

        if (
            typeof activityDB.init ===
                "function"
        ) {
            await activityDB.init();
        }

        if (
            typeof activityDB.start ===
                "function" &&
            (
                typeof activityDB
                    .isRunning !==
                    "function" ||
                !activityDB.isRunning()
            )
        ) {
            await activityDB.start();
        }

        return activityDB;
    }

    async function initializeAuthenticatedUser(
        user
    ) {
        const uid =
            normalizeString(
                user?.uid
            );

        if (!uid) {
            renderGuestState();

            return false;
        }

        if (
            state.activeAuthPromise &&
            state.activeAuthUid ===
                uid
        ) {
            return state
                .activeAuthPromise;
        }

        const lifecycleGeneration =
            state.lifecycleGeneration;

        const authGeneration =
            ++state.authGeneration;

        state.activeAuthUid =
            uid;

        state.currentUid =
            uid;

        /*
         * Render trusted Firebase Auth fields first.
         * Firestore profile data replaces this temporary state.
         */

        renderProfile({
            uid,

            isAuthenticated:
                true,

            authenticated:
                true,

            displayName:
                user.displayName,

            email:
                user.email,

            photoURL:
                user.photoURL,

            accountType:
                "google",

            usingTime:
                readCurrentActivity(uid) ||
                normalizeActivity(
                    {
                        uid,

                        eligibleActiveDays:
                            0,

                        requiredActiveDays:
                            REQUIRED_ACTIVE_DAYS,

                        requiredDailySeconds:
                            REQUIRED_DAILY_SECONDS
                    },
                    uid
                )
        });

        const authPromise =
            (async () => {
                try {
                    const profileDB =
                        await initializeProfileDB();

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    let ensuredProfile =
                        null;

                    if (
                        typeof profileDB
                            .ensureProfile ===
                            "function"
                    ) {
                        const ensureResult =
                            await profileDB
                                .ensureProfile();

                        ensuredProfile =
                            extractProfile(
                                ensureResult
                            );
                    }

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    if (ensuredProfile) {
                        renderProfile(
                            ensuredProfile
                        );
                    }

                    const activityPromise =
                        initializeActivityDB();

                    const profileRefreshPromise =
                        typeof profileDB
                            .refresh ===
                            "function"
                            ? profileDB.refresh()
                            : Promise.resolve(
                                null
                            );

                    const [
                        profileRefreshResult
                    ] =
                        await Promise.all([
                            profileRefreshPromise,
                            activityPromise
                        ]);

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    const refreshedProfile =
                        extractProfile(
                            profileRefreshResult
                        ) ||
                        readCurrentProfile();

                    if (refreshedProfile) {
                        renderProfile(
                            refreshedProfile
                        );
                    }

                    const activityDB =
                        window.ActivityDB;

                    if (
                        activityDB &&
                        typeof activityDB
                            .refresh ===
                            "function"
                    ) {
                        try {
                            await activityDB
                                .refresh();
                        } catch {
                            /*
                             * Profile remains usable.
                             */
                        }
                    }

                    if (
                        isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        const activity =
                            readCurrentActivity(
                                uid
                            );

                        if (activity) {
                            updateProfileActivityUI(
                                activity
                            );
                        }

                        synchronizeSharedReferralLink(
                            state.currentProfile
                        );
                    }

                    return true;
                } catch (error) {
                    if (
                        isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        ) &&
                        window.ProfileUI &&
                        typeof window.ProfileUI
                            .showStatus ===
                            "function"
                    ) {
                        window.ProfileUI
                            .showStatus(
                                normalizeString(
                                    error?.message,
                                    "Profile information could not be loaded."
                                ),
                                "error",
                                6000
                            );
                    }

                    return false;
                } finally {
                    if (
                        state.activeAuthPromise ===
                        authPromise
                    ) {
                        state.activeAuthPromise =
                            null;

                        state.activeAuthUid =
                            "";
                    }
                }
            })();

        state.activeAuthPromise =
            authPromise;

        state.readyPromise =
            authPromise;

        return authPromise;
    }

    /* =====================================================
       AUTH SYNCHRONIZATION
    ===================================================== */

    function synchronizeAuthState(user) {
        const currentUser =
            user?.uid
                ? user
                : resolveAuthUser();

        if (!currentUser?.uid) {
            state.authGeneration +=
                1;

            state.activeAuthUid =
                "";

            state.activeAuthPromise =
                null;

            renderGuestState();

            return Promise.resolve(
                false
            );
        }

        return initializeAuthenticatedUser(
            currentUser
        );
    }

    function handleAuthEvent(event) {
        if (!state.initialized) {
            return;
        }

        const user =
            extractEventUser(event);

        void synchronizeAuthState(
            user
        );
    }

    function handleProfileRefreshEvent() {
        if (!state.initialized) {
            return;
        }

        const profile =
            readCurrentProfile();

        if (profile) {
            renderProfile(profile);

            return;
        }

        if (!resolveAuthUser()?.uid) {
            renderGuestState();
        }
    }

    function bindBrowserEvents() {
        AUTH_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleAuthEvent
                );
            }
        );

        PROFILE_REFRESH_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleProfileRefreshEvent
                );
            }
        );

        return true;
    }

    /* =====================================================
       MANUAL REFRESH
    ===================================================== */

    async function refreshProfile(
        options = {}
    ) {
        const user =
            resolveAuthUser();

        if (!user?.uid) {
            renderGuestState();

            return cloneValue(
                state.currentProfile
            );
        }

        const profileDB =
            await initializeProfileDB();

        let refreshResult =
            null;

        if (
            typeof profileDB.refresh ===
                "function"
        ) {
            refreshResult =
                await profileDB.refresh();
        }

        const profile =
            extractProfile(
                refreshResult
            ) ||
            readCurrentProfile();

        if (profile) {
            renderProfile(profile);
        }

        if (
            options.includeActivity !==
                false &&
            window.ActivityDB &&
            typeof window.ActivityDB
                .refresh ===
                "function"
        ) {
            try {
                await window.ActivityDB
                    .refresh();

                const activity =
                    readCurrentActivity(
                        user.uid
                    );

                if (activity) {
                    updateProfileActivityUI(
                        activity
                    );

                    state.currentProfile = {
                        ...state.currentProfile,

                        deviceId:
                            activity.deviceId ||
                            state.currentProfile
                                .deviceId ||
                            "",

                        deviceBound:
                            activity.deviceBound ===
                                true ||
                            state.currentProfile
                                .deviceBound ===
                                true,

                        usingTime:
                            activity,

                        activity
                    };
                }
            } catch {
                /*
                 * Activity refresh does not invalidate Profile.
                 */
            }
        }

        synchronizeSharedReferralLink(
            state.currentProfile
        );

        return cloneValue(
            state.currentProfile
        );
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
                        state.lifecycleGeneration !==
                            observedGeneration ||
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

    function init() {
        destroy();

        const page =
            document.getElementById(
                "profilePage"
            );

        if (!page) {
            console.error(
                "[ProfileModule] ProfileView must be rendered before ProfileModule.init()."
            );

            return false;
        }

        removeLegacyStorage();

        state.lifecycleGeneration +=
            1;

        const lifecycleGeneration =
            state.lifecycleGeneration;

        state.page =
            page;

        state.initialized =
            true;

        const initialAuthUser =
            resolveAuthUser();

        const initialProfile =
            buildUIProfile(
                readCurrentProfile(),
                initialAuthUser
            );

        state.currentProfile =
            initialProfile;

        state.currentUid =
            normalizeString(
                initialProfile.uid
            );

        if (
            !initializeProfileUI(
                initialProfile
            )
        ) {
            destroy();

            return false;
        }

        if (
            !initializeSharedSections(
                initialProfile
            )
        ) {
            destroy();

            return false;
        }

        bindServiceSubscriptions();
        bindBrowserEvents();
        observePageRemoval();

        if (
            window.ProfileStatistics &&
            typeof window.ProfileStatistics
                .init ===
                "function"
        ) {
            try {
                window.ProfileStatistics
                    .init();
            } catch {
                /*
                 * Statistics do not block Profile page.
                 */
            }
        }

        /*
         * Guest main-site link is available immediately.
         * Authenticated users resolve their own referral link.
         */
        synchronizeSharedReferralLink(
            initialProfile
        );

        state.readyPromise =
            (async () => {
                const user =
                    await waitForAuthReady();

                if (
                    !state.initialized ||
                    lifecycleGeneration !==
                        state.lifecycleGeneration
                ) {
                    return false;
                }

                return synchronizeAuthState(
                    user
                );
            })().catch(
                error => {
                    if (
                        state.initialized &&
                        lifecycleGeneration ===
                            state.lifecycleGeneration &&
                        window.ProfileUI &&
                        typeof window.ProfileUI
                            .showStatus ===
                            "function"
                    ) {
                        window.ProfileUI
                            .showStatus(
                                normalizeString(
                                    error?.message,
                                    "Profile initialization failed."
                                ),
                                "error",
                                6000
                            );
                    }

                    return false;
                }
            );

        return true;
    }

    function whenReady() {
        return (
            state.readyPromise ||
            Promise.resolve(
                state.initialized
            )
        );
    }

    /* =====================================================
       LIVE REWARD COMPATIBILITY
    ===================================================== */

    function maskAccountNumber(
        accountNumber
    ) {
        if (
            window.AccountSectionsModule &&
            typeof window
                .AccountSectionsModule
                .maskAccountNumber ===
                "function"
        ) {
            return window
                .AccountSectionsModule
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
            typeof window
                .AccountSectionsModule
                .refreshLiveRewards !==
                "function"
        ) {
            return false;
        }

        return window
            .AccountSectionsModule
            .refreshLiveRewards();
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        state.authGeneration +=
            1;

        state.activeAuthUid =
            "";

        state.activeAuthPromise =
            null;

        state.readyPromise =
            null;

        removeManagedListeners();
        unbindServiceSubscriptions();

        if (state.pageObserver) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        destroySharedSections();

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .destroy ===
                "function" &&
            (
                typeof window.ProfileUI
                    .isInitialized !==
                    "function" ||
                window.ProfileUI
                    .isInitialized()
            )
        ) {
            window.ProfileUI.destroy();
        }

        state.initialized =
            false;

        state.page =
            null;

        state.sharedMount =
            null;

        state.sharedSectionsInitialized =
            false;

        state.currentUid =
            "";

        state.currentProfile =
            createGuestProfile();

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
        destroy,
        whenReady,
        isInitialized,

        refresh:
            refreshProfile,

        refreshProfile,
        saveMobileNumber,

        getCurrentProfile() {
            return cloneValue(
                state.currentProfile
            );
        },

        getCurrentUid() {
            return state.currentUid;
        },

        maskAccountNumber,
        refreshLiveRewards
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileModule =
    ProfileModule;