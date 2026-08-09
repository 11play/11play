/* =========================================================
   11PLAY — PROFILE STATE SERVICE
   File: js/services/profile.service.js

   Responsibilities:
   - Maintain current Profile UI state
   - Keep persistent non-sensitive Guest identity
   - Keep authenticated profile data in memory only
   - Expose server-authoritative 7 Eligible Active Days
   - Each Eligible Active Day requires minimum 2 active hours
   - Expose today's partial active-time progress
   - Expose server-authoritative Web Device binding state
   - Keep temporary read-only legacy time aliases
   - Synchronize wallet/referral/activity state with the UI

   Important:
   - Browser clock time never determines eligibility
   - Device identity/binding is never trusted from this service alone
   - Financial/referral/activity data remain Firestore-authoritative
   - Private authenticated profile data is never stored locally
========================================================= */

const ProfileService = (() => {
    "use strict";

    const LEGACY_USER_KEY = "profile_user";
    const LEGACY_START_TIME_KEY = "profile_start_time";
    const GUEST_IDENTITY_KEY = "11play_guest_identity_v1";
    const GUEST_USERNAME_PREFIX = "11guest-";
    const GUEST_TOKEN_LENGTH = 6;

    const REQUIRED_ACTIVE_DAYS = 7;
    const REQUIRED_DAILY_SECONDS = 2 * 60 * 60;
    const REQUIRED_TOTAL_SECONDS =
        REQUIRED_ACTIVE_DAYS * REQUIRED_DAILY_SECONDS;

    /*
     * Old activity models represented one completed day as 24 hours.
     * This constant is used only when reading legacy data that has no
     * explicit active-day counter.
     */
    const LEGACY_SECONDS_PER_DAY = 24 * 60 * 60;

    const ACTIVITY_POLICY_VERSION = 2;

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

    function toSafeString(value) {
        return value === null || value === undefined
            ? ""
            : String(value)
                .normalize("NFKC")
                .trim();
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
                    : Number(fallback) || 0
            );

        return number >= 0
            ? number
            : 0;
    }

    function toNullableValue(value) {
        return value === undefined ||
            value === ""
            ? null
            : value;
    }

    function uniqueStrings(values) {
        return Array.isArray(values)
            ? Array.from(
                new Set(
                    values
                        .map(toSafeString)
                        .filter(Boolean)
                )
            )
            : [];
    }

    function cloneValue(value) {
        try {
            return JSON.parse(
                JSON.stringify(value)
            );
        } catch {
            return null;
        }
    }

    function freezeObject(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Object.isFrozen(value)
        ) {
            return value;
        }

        Object.values(value)
            .forEach((nested) => {
                if (
                    nested &&
                    typeof nested === "object"
                ) {
                    freezeObject(nested);
                }
            });

        return Object.freeze(value);
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
            typeof value.toMillis === "function"
        ) {
            return value.toMillis();
        }

        if (
            typeof value.toDate === "function"
        ) {
            return value
                .toDate()
                .getTime();
        }

        if (
            value instanceof Date
        ) {
            return value.getTime();
        }

        if (
            typeof value === "string"
        ) {
            const milliseconds =
                Date.parse(value);

            return Number.isFinite(milliseconds)
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
            timestampToMillis(value);

        if (!milliseconds) {
            return "";
        }

        return new Date(
            milliseconds +
            6 * 60 * 60 * 1000
        )
            .toISOString()
            .slice(0, 10);
    }

    /* =====================================================
       GUEST IDENTITY
    ===================================================== */

    function normalizeGuestToken(value) {
        return toSafeString(value)
            .replace(
                /^@+/,
                ""
            )
            .replace(
                /^guest_/i,
                ""
            )
            .replace(
                /^youare11guest/i,
                ""
            )
            .replace(
                /^11guest[-_]?/i,
                ""
            )
            .replace(
                /[^a-z0-9]/gi,
                ""
            )
            .toLowerCase()
            .slice(
                0,
                GUEST_TOKEN_LENGTH
            );
    }

    function createGuestToken() {
        const alphabet =
            "abcdefghijklmnopqrstuvwxyz0123456789";

        const values =
            new Uint32Array(
                GUEST_TOKEN_LENGTH
            );

        let secure = false;

        try {
            if (
                window.crypto &&
                typeof window.crypto
                    .getRandomValues === "function"
            ) {
                window.crypto
                    .getRandomValues(values);

                secure = true;
            }
        } catch {
            secure = false;
        }

        return Array.from(
            {
                length:
                    GUEST_TOKEN_LENGTH
            },

            (_, index) => {
                const randomNumber =
                    secure
                        ? values[index]
                        : Math.floor(
                            Math.random() *
                            alphabet.length
                        );

                return alphabet[
                    randomNumber %
                    alphabet.length
                ];
            }
        ).join("");
    }

    function buildGuestIdentity(token) {
        const normalizedToken =
            normalizeGuestToken(token) ||
            createGuestToken();

        return {
            token:
                normalizedToken,

            guestId:
                `guest_${normalizedToken}`,

            username:
                `${GUEST_USERNAME_PREFIX}${normalizedToken}`
        };
    }

    function readStoredGuestIdentity() {
        try {
            const raw =
                window.localStorage
                    .getItem(
                        GUEST_IDENTITY_KEY
                    );

            if (!raw) {
                return null;
            }

            const parsed =
                JSON.parse(raw);

            if (!isPlainObject(parsed)) {
                return null;
            }

            const token =
                normalizeGuestToken(
                    parsed.token ||
                    parsed.guestId ||
                    parsed.username
                );

            return token
                ? buildGuestIdentity(token)
                : null;
        } catch {
            return null;
        }
    }

    function storeGuestIdentity(identity) {
        if (!isPlainObject(identity)) {
            return false;
        }

        const token =
            normalizeGuestToken(
                identity.token ||
                identity.guestId ||
                identity.username
            );

        if (!token) {
            return false;
        }

        try {
            window.localStorage
                .setItem(
                    GUEST_IDENTITY_KEY,
                    JSON.stringify({
                        token
                    })
                );

            return true;
        } catch {
            return false;
        }
    }

    function getGuestIdentity() {
        const stored =
            readStoredGuestIdentity();

        if (stored) {
            return stored;
        }

        const identity =
            buildGuestIdentity(
                createGuestToken()
            );

        storeGuestIdentity(
            identity
        );

        return identity;
    }

    /* =====================================================
       ACTIVITY NORMALIZATION — 7 DAYS × 2 HOURS
    ===================================================== */

    function normalizeActiveDayKeys(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        return Array.from(
            new Set(
                value
                    .map(toSafeString)
                    .filter(
                        dayKey =>
                            /^\d{4}-\d{2}-\d{2}$/
                                .test(dayKey)
                    )
            )
        ).sort();
    }

    function deriveActiveDayCount(source) {
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
            return toNonNegativeInteger(
                explicitDays
            );
        }

        const dayKeys =
            normalizeActiveDayKeys(
                firstDefined(
                    source.eligibleDayKeys,
                    source.activeDayKeys,
                    source.creditedDayKeys
                )
            );

        if (dayKeys.length) {
            return dayKeys.length;
        }

        const sourcePolicyVersion =
            toNonNegativeInteger(
                source.activityPolicyVersion
            );

        const legacySeconds =
            toNonNegativeInteger(
                source.totalActiveSeconds
            );

        if (
            sourcePolicyVersion >=
                ACTIVITY_POLICY_VERSION
        ) {
            return Math.floor(
                legacySeconds /
                REQUIRED_DAILY_SECONDS
            );
        }

        /*
         * Legacy migration only.
         * Old data represented one credited day as 24 hours.
         */
        return Math.floor(
            legacySeconds /
            LEGACY_SECONDS_PER_DAY
        );
    }

    function deriveCurrentDaySeconds(source) {
        const explicitSeconds =
            firstDefined(
                source.currentDaySeconds,
                source.todayActiveSeconds,
                source.currentActiveSeconds
            );

        if (
            explicitSeconds !== undefined
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
            explicitMinutes !== undefined
        ) {
            return (
                toNonNegativeInteger(
                    explicitMinutes
                ) * 60
            );
        }

        return 0;
    }

    function normalizeUsingTime(value) {
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

        const eligibleActiveDays =
            Math.min(
                requiredActiveDays,
                Math.max(
                    deriveActiveDayCount(
                        source
                    ),
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
            source.currentDayCompleted === true ||
            currentDaySeconds >=
                requiredDailySeconds;

        const todayActiveSeconds =
            currentDaySeconds;

        const todayActiveMinutes =
            Math.floor(
                todayActiveSeconds / 60
            );

        const requiredDailyMinutes =
            Math.ceil(
                requiredDailySeconds / 60
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
                remainingTodaySeconds / 60
            );

        const dailyProgressPercent =
            requiredDailySeconds > 0
                ? Math.min(
                    100,
                    Number(
                        (
                            (
                                currentDaySeconds /
                                requiredDailySeconds
                            ) *
                            100
                        ).toFixed(4)
                    )
                )
                : 100;

        /*
         * Keep progressPercent as completed-day progress so old UI
         * does not accidentally treat a partial day as an Eligible Day.
         */
        const progressPercent =
            Math.min(
                100,
                Number(
                    (
                        (
                            eligibleActiveDays /
                            requiredActiveDays
                        ) *
                        100
                    ).toFixed(4)
                )
            );

        const completed =
            source.completed === true ||
            eligibleActiveDays >=
                requiredActiveDays;

        const currentDayStartedAt =
            toNullableValue(
                firstDefined(
                    source.currentDayStartedAt,
                    source.activityDayAt,
                    source.dayStartedAt
                )
            );

        const currentDayKey =
            toSafeString(
                firstDefined(
                    source.currentDayKey,
                    source.activityDayKey
                )
            ) ||
            bangladeshDayKey(
                currentDayStartedAt
            );

        const lastEligibleDayKey =
            toSafeString(
                firstDefined(
                    source.lastEligibleDayKey,
                    source.lastActiveDayKey,
                    source.lastCreditedDayKey,
                    eligibleDayKeys[
                        eligibleDayKeys.length - 1
                    ]
                )
            );

        const deviceId =
            toSafeString(
                firstDefined(
                    source.deviceId,
                    source.webDeviceId,
                    source.boundDeviceId
                )
            );

        const deviceBound =
            source.deviceBound === true ||
            Boolean(deviceId);

        const completedEligibleSeconds =
            eligibleActiveDays *
            requiredDailySeconds;

        /*
         * Once currentDayCompleted is true, the authoritative backend
         * should already have incremented activeDays. Do not double-count
         * that same day in compatibility totals.
         */
        const partialTodaySeconds =
            currentDayCompleted
                ? 0
                : currentDaySeconds;

        const totalActiveSeconds =
            Math.min(
                requiredActiveDays *
                    requiredDailySeconds,

                completedEligibleSeconds +
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
                    ? toNullableValue(
                        source.completedAt
                    )
                    : null,

            eligibleDayKeys,

            lastEligibleDayKey,

            lastEligibleAt:
                toNullableValue(
                    firstDefined(
                        source.lastEligibleAt,
                        source.lastActiveDayAt,
                        source.lastCreditedAt,
                        currentDayCompleted
                            ? source.lastActiveAt
                            : undefined
                    )
                ),

            lastCheckpointAt:
                toNullableValue(
                    source.lastCheckpointAt
                ),

            lastActiveAt:
                toNullableValue(
                    source.lastActiveAt
                ),

            lastActivityAt:
                toNullableValue(
                    firstDefined(
                        source.lastActivityAt,
                        source.lastActiveAt,
                        source.lastCheckpointAt,
                        source.updatedAt
                    )
                ),

            activityPolicyVersion:
                toNonNegativeInteger(
                    source.activityPolicyVersion,
                    ACTIVITY_POLICY_VERSION
                ) ||
                ACTIVITY_POLICY_VERSION,

            updatedAt:
                toNullableValue(
                    source.updatedAt
                ),

            /*
             * Read-only compatibility totals.
             * New model = 2 hours per Eligible Active Day,
             * not 24 hours per day.
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
                toNullableValue(
                    firstDefined(
                        source.lastCheckpointAt,
                        source.lastActiveAt
                    )
                )
        };
    }

    function createGuestUsingTime() {
        return {
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
        };
    }

    /* =====================================================
       WALLET / REFERRAL NORMALIZATION
    ===================================================== */

    function normalizeWallet(value) {
        const source =
            isPlainObject(value)
                ? value
                : {};

        return {
            availableBalance:
                toNonNegativeInteger(
                    source.availableBalance
                ),

            heldBalance:
                toNonNegativeInteger(
                    source.heldBalance
                ),

            totalEarned:
                toNonNegativeInteger(
                    source.totalEarned
                ),

            totalWithdrawn:
                toNonNegativeInteger(
                    source.totalWithdrawn
                ),

            lastWithdrawalAmount:
                toNonNegativeInteger(
                    source.lastWithdrawalAmount
                ),

            lastWithdrawalAt:
                toNullableValue(
                    source.lastWithdrawalAt
                ),

            revision:
                toNonNegativeInteger(
                    source.revision
                )
        };
    }

    function normalizeReferralStats(value) {
        const source =
            isPlainObject(value)
                ? value
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

        const approved =
            toNonNegativeInteger(
                source.approved
            );

        const calculatedTotal =
            pending +
            qualified +
            rejected +
            rewarded;

        return {
            total:
                Math.max(
                    toNonNegativeInteger(
                        source.total
                    ),
                    calculatedTotal
                ),

            pending,

            qualified,

            approved,

            rejected,

            rewarded,

            totalReward:
                toNonNegativeInteger(
                    source.totalReward
                ),

            observing:
                pending,

            pendingReview:
                qualified,

            valid:
                rewarded,

            invalid:
                rejected
        };
    }

    /* =====================================================
       GUEST PROFILE
    ===================================================== */

    function createGuestProfile() {
        const guest =
            getGuestIdentity();

        return {
            uid:
                "",

            guestId:
                guest.guestId,

            name:
                "Guest User",

            displayName:
                "Guest User",

            username:
                guest.username,

            email:
                "",

            photo:
                "",

            photoURL:
                "",

            emailVerified:
                false,

            phoneNumber:
                "",

            providerIds:
                [],

            signInProvider:
                "",

            googleConnected:
                false,

            isGoogleConnected:
                false,

            isGoogleSignIn:
                false,

            accountType:
                "guest",

            isAuthenticated:
                false,

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            deviceId:
                "",

            deviceBound:
                false,

            referralCode:
                "",

            referralLink:
                "",

            referredByUid:
                "",

            referredByCode:
                "",

            registrationDate:
                null,

            createdAt:
                null,

            lastLogin:
                null,

            status:
                "",

            usingTime:
                createGuestUsingTime(),

            wallet:
                normalizeWallet({}),

            referrals:
                normalizeReferralStats({}),

            schemaVersion:
                0
        };
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function deriveUsername(
        explicitUsername,
        email,
        fallback = ""
    ) {
        const normalizedEmail =
            toSafeString(email)
                .toLowerCase();

        const atIndex =
            normalizedEmail
                .indexOf("@");

        if (atIndex > 0) {
            return normalizedEmail
                .slice(
                    0,
                    atIndex
                );
        }

        const username =
            toSafeString(
                explicitUsername
            )
                .replace(
                    /^@+/,
                    ""
                )
                .replace(
                    /\s+/g,
                    ""
                );

        return (
            username ||
            toSafeString(
                fallback
            )
        );
    }

    function normalizeProfile(value) {
        if (!isPlainObject(value)) {
            return createGuestProfile();
        }

        const uid =
            toSafeString(
                value.uid ||
                value.userId
            );

        const isAuthenticated =
            Boolean(
                uid &&
                value.isAuthenticated !==
                    false
            );

        if (!isAuthenticated) {
            return createGuestProfile();
        }

        const email =
            toSafeString(
                value.email
            )
                .toLowerCase();

        const providerIds =
            uniqueStrings(
                value.providerIds
            );

        const googleConnected =
            Boolean(
                value.isGoogleConnected ===
                    true ||
                value.googleConnected ===
                    true ||
                providerIds.includes(
                    "google.com"
                )
            );

        const mobileNumber =
            toSafeString(
                value.mobileNumber
            );

        const sourceUsingTime =
            isPlainObject(
                value.usingTime
            )
                ? value.usingTime
                : isPlainObject(
                    value.activity
                )
                    ? value.activity
                    : {};

        const normalizedUsingTime =
            normalizeUsingTime(
                sourceUsingTime
            );

        const sourceReferralStats =
            isPlainObject(
                value.referrals
            )
                ? value.referrals
                : isPlainObject(
                    value.referralStats
                )
                    ? value.referralStats
                    : {};

        const displayName =
            toSafeString(
                value.displayName ||
                value.name
            );

        const photoURL =
            toSafeString(
                value.photoURL ||
                value.photo
            );

        const deviceId =
            toSafeString(
                firstDefined(
                    value.deviceId,
                    value.webDeviceId,
                    value.boundDeviceId,
                    normalizedUsingTime.deviceId
                )
            );

        const deviceBound =
            value.deviceBound === true ||
            normalizedUsingTime.deviceBound === true ||
            Boolean(deviceId);

        return {
            uid,

            guestId:
                "",

            name:
                displayName,

            displayName,

            username:
                deriveUsername(
                    value.username,
                    email
                ),

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                value.emailVerified ===
                true,

            phoneNumber:
                toSafeString(
                    value.phoneNumber
                ),

            providerIds,

            signInProvider:
                toSafeString(
                    value.signInProvider
                ),

            googleConnected,

            isGoogleConnected:
                googleConnected,

            isGoogleSignIn:
                Boolean(
                    value.isGoogleSignIn ===
                        true ||
                    value.signInProvider ===
                        "google.com" ||
                    providerIds.includes(
                        "google.com"
                    )
                ),

            accountType:
                googleConnected
                    ? "google"
                    : (
                        toSafeString(
                            value.accountType
                        ) ||
                        "google"
                    ),

            isAuthenticated:
                true,

            mobileNumber,

            mobileAdded:
                value.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked:
                value.mobileLocked ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            deviceId,

            deviceBound,

            referralCode:
                toSafeString(
                    value.referralCode
                ),

            referralLink:
                toSafeString(
                    value.referralLink
                ),

            referredByUid:
                toSafeString(
                    value.referredByUid
                ),

            referredByCode:
                toSafeString(
                    value.referredByCode
                ),

            registrationDate:
                toNullableValue(
                    value.registrationDate
                ),

            createdAt:
                toNullableValue(
                    value.createdAt
                ),

            lastLogin:
                toNullableValue(
                    value.lastLogin
                ),

            status:
                toSafeString(
                    value.status
                ),

            usingTime:
                normalizedUsingTime,

            wallet:
                normalizeWallet(
                    value.wallet
                ),

            referrals:
                normalizeReferralStats(
                    sourceReferralStats
                ),

            schemaVersion:
                toNonNegativeInteger(
                    value.schemaVersion
                )
        };
    }

    /* =====================================================
       STATE / EVENTS
    ===================================================== */

    let currentProfile =
        freezeObject(
            createGuestProfile()
        );

    function getUser() {
        return cloneValue(
            currentProfile
        );
    }

    function getCurrentUser() {
        return getUser();
    }

    function dispatchProfileUpdate(
        previousProfile
    ) {
        const profile =
            getUser();

        window.dispatchEvent(
            new Event(
                "PROFILE_UPDATED"
            )
        );

        window.dispatchEvent(
            new CustomEvent(
                "profile:updated",
                {
                    detail: {
                        user:
                            profile,

                        previousUser:
                            cloneValue(
                                previousProfile
                            ),

                        authenticated:
                            profile
                                ?.isAuthenticated ===
                            true
                    }
                }
            )
        );
    }

    function setUser(user) {
        const previousProfile =
            currentProfile;

        currentProfile =
            freezeObject(
                user
                    ? normalizeProfile(
                        user
                    )
                    : createGuestProfile()
            );

        dispatchProfileUpdate(
            previousProfile
        );

        return getUser();
    }

    function patchUser(updates) {
        if (!isPlainObject(updates)) {
            return getUser();
        }

        return setUser({
            ...getUser(),
            ...updates
        });
    }

    function clearUser() {
        return setUser(
            createGuestProfile()
        );
    }

    function setActivity(activity) {
        if (
            !currentProfile
                .isAuthenticated
        ) {
            return getUser();
        }

        const normalizedActivity =
            normalizeUsingTime(
                activity
            );

        return patchUser({
            usingTime:
                normalizedActivity,

            deviceId:
                normalizedActivity.deviceId ||
                currentProfile.deviceId ||
                "",

            deviceBound:
                normalizedActivity.deviceBound === true ||
                currentProfile.deviceBound === true
        });
    }

    function setWallet(wallet) {
        if (
            !currentProfile
                .isAuthenticated
        ) {
            return getUser();
        }

        return patchUser({
            wallet:
                normalizeWallet(
                    wallet
                )
        });
    }

    function setReferralStats(stats) {
        if (
            !currentProfile
                .isAuthenticated
        ) {
            return getUser();
        }

        return patchUser({
            referrals:
                normalizeReferralStats(
                    stats
                )
        });
    }

    function isAuthenticated() {
        return (
            currentProfile
                .isAuthenticated ===
            true
        );
    }

    function isGuest() {
        return !isAuthenticated();
    }

    /* =====================================================
       ACTIVITY PROGRESS
    ===================================================== */

    function getTime() {
        if (!isAuthenticated()) {
            return {
                y:
                    0,

                mo:
                    0,

                d:
                    0,

                h:
                    0,

                m:
                    0,

                s:
                    0,

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

                totalActiveSeconds:
                    0,

                requiredActiveSeconds:
                    0,

                remainingActiveSeconds:
                    0
            };
        }

        const time =
            normalizeUsingTime(
                currentProfile
                    .usingTime
            );

        const todaySeconds =
            time.todayActiveSeconds;

        const hours =
            Math.floor(
                todaySeconds / 3600
            );

        const minutes =
            Math.floor(
                (
                    todaySeconds % 3600
                ) / 60
            );

        const seconds =
            todaySeconds % 60;

        return {
            /*
             * Legacy display shape:
             * d = completed Eligible Active Days
             * h/m/s = today's eligible partial activity
             */
            y:
                0,

            mo:
                0,

            d:
                time.eligibleActiveDays,

            h:
                hours,

            m:
                minutes,

            s:
                seconds,

            deviceId:
                time.deviceId,

            deviceBound:
                time.deviceBound,

            eligibleActiveDays:
                time.eligibleActiveDays,

            totalActiveDays:
                time.totalActiveDays,

            activeDays:
                time.activeDays,

            requiredActiveDays:
                time.requiredActiveDays,

            remainingActiveDays:
                time.remainingActiveDays,

            currentDayKey:
                time.currentDayKey,

            currentDaySeconds:
                time.currentDaySeconds,

            todayActiveSeconds:
                time.todayActiveSeconds,

            todayActiveMinutes:
                time.todayActiveMinutes,

            requiredDailySeconds:
                time.requiredDailySeconds,

            requiredDailyMinutes:
                time.requiredDailyMinutes,

            remainingTodaySeconds:
                time.remainingTodaySeconds,

            remainingTodayMinutes:
                time.remainingTodayMinutes,

            currentDayCompleted:
                time.currentDayCompleted,

            dailyProgressPercent:
                time.dailyProgressPercent,

            progressPercent:
                time.progressPercent,

            completed:
                time.completed,

            completedAt:
                time.completedAt,

            lastEligibleDayKey:
                time.lastEligibleDayKey,

            lastEligibleAt:
                time.lastEligibleAt,

            lastCheckpointAt:
                time.lastCheckpointAt,

            lastActiveAt:
                time.lastActiveAt,

            lastActivityAt:
                time.lastActivityAt,

            totalActiveSeconds:
                time.totalActiveSeconds,

            requiredActiveSeconds:
                time.requiredActiveSeconds,

            remainingActiveSeconds:
                time.remainingActiveSeconds
        };
    }

    function getActivityProgress() {
        if (!isAuthenticated()) {
            return cloneValue(
                createGuestUsingTime()
            );
        }

        return cloneValue(
            normalizeUsingTime(
                currentProfile
                    .usingTime
            )
        );
    }

    /* =====================================================
       LEGACY LOCAL DATA CLEANUP
    ===================================================== */

    function removeLegacyLocalData() {
        try {
            window.localStorage
                .removeItem(
                    LEGACY_USER_KEY
                );

            window.localStorage
                .removeItem(
                    LEGACY_START_TIME_KEY
                );

            return true;
        } catch (error) {
            console.warn(
                "[ProfileService] Legacy local profile data could not be removed.",
                error
            );

            return false;
        }
    }

    removeLegacyLocalData();

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        getUser,
        getCurrentUser,

        setUser,
        patchUser,
        clearUser,

        setActivity,
        setWallet,
        setReferralStats,

        getTime,
        getActivityProgress,

        isAuthenticated,
        isGuest,

        getGuestIdentity,
        createGuestProfile,

        normalizeUsingTime
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileService =
    ProfileService;