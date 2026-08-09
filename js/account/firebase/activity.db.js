"use strict";

/* =========================================================
   11PLAY — ACTIVITY / 7 DAYS × 2 HOURS CLIENT
   File: js/account/firebase/activity.db.js

   Contract:
   - Firebase Spark optimized
   - Verified Google users only
   - 7 different Bangladesh calendar days
   - Minimum 2 eligible active hours per day
   - 15-minute server-authorized checkpoints
   - Page must remain visible, focused, online and recently active
   - No activity-session Firestore writes
   - Existing window.ActivityDB API preserved

   Security:
   - FunctionsClient + Firestore Rules are authoritative.
   - Browser timers/state are quota and UX controls only.
========================================================= */

(function initializeActivityDB(window, document) {
    const GOOGLE_PROVIDER_ID = "google.com";
    const REQUIRED_ACTIVE_DAYS = 7;
    const REQUIRED_DAILY_SECONDS = 2 * 60 * 60;
    const REQUIRED_TOTAL_SECONDS = REQUIRED_ACTIVE_DAYS * REQUIRED_DAILY_SECONDS;
    const CHECKPOINT_SECONDS = 15 * 60;
    const CHECKPOINT_INTERVAL_MS = CHECKPOINT_SECONDS * 1000;
    const ACTIVITY_CHECK_INTERVAL_MS = 15 * 1000;
    const INACTIVITY_TIMEOUT_MS = 120 * 1000;
    const RECORD_RETRY_GUARD_MS = 5 * 1000;
    const ACTIVITY_POLICY_VERSION = 2;

    const SESSION_STORAGE_KEY = "11play.activity.sessionId";
    const USER_STORAGE_KEY = "11play.activity.userId";

    const EVENT_UPDATED = "activity:updated";
    const EVENT_ERROR = "activity:error";
    const EVENT_STATE_CHANGED = "activity:state-changed";
    const EVENT_BLOCKED = "activity:access-blocked";

    const listeners = new Set();

    let activityCheckTimer = null;
    let authUnsubscribe = null;
    let readyPromise = null;
    let stopPromise = null;
    let boundEvents = false;
    let lifecycleGeneration = 0;

    function toSafeString(value) {
        if (value === null || value === undefined) return "";
        return String(value).normalize("NFKC").trim();
    }

    function toSafeNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function toNonNegativeInteger(value, fallback = 0) {
        const number = Math.floor(toSafeNumber(value, fallback));
        return Number.isFinite(number) && number >= 0 ? number : 0;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function cloneValue(value) {
        if (value === null || value === undefined) return value;

        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    }

    function timestampToMillis(value) {
        if (!value) return 0;

        if (typeof value.toMillis === "function") {
            return value.toMillis();
        }

        if (typeof value.toDate === "function") {
            return value.toDate().getTime();
        }

        if (value instanceof Date) {
            return value.getTime();
        }

        if (typeof value === "string") {
            const milliseconds = Date.parse(value);
            return Number.isFinite(milliseconds)
                ? milliseconds
                : 0;
        }

        if (Number.isFinite(value?.seconds)) {
            return value.seconds * 1000;
        }

        return 0;
    }

    function bangladeshDayKey(value = Date.now()) {
        const milliseconds = typeof value === "number"
            ? value
            : (timestampToMillis(value) || Date.now());

        return new Date(
            milliseconds + 6 * 60 * 60 * 1000
        )
            .toISOString()
            .slice(0, 10);
    }

    function createDefaultActivity(uid = "") {
        return {
            uid: toSafeString(uid),
            userId: toSafeString(uid),

            deviceId: "",

            activeDays: 0,
            requiredActiveDays: REQUIRED_ACTIVE_DAYS,
            remainingActiveDays: REQUIRED_ACTIVE_DAYS,

            currentDaySeconds: 0,
            todayActiveSeconds: 0,
            requiredDailySeconds: REQUIRED_DAILY_SECONDS,
            remainingTodaySeconds: REQUIRED_DAILY_SECONDS,

            currentDayStartedAt: null,
            currentDayCompleted: false,
            lastCheckpointAt: null,

            dailyProgressPercent: 0,
            progressPercent: 0,

            completed: false,
            lastActiveAt: null,
            completedAt: null,

            activityPolicyVersion: ACTIVITY_POLICY_VERSION,

            totalActiveSeconds: 0,
            requiredActiveSeconds: REQUIRED_TOTAL_SECONDS,
            remainingActiveSeconds: REQUIRED_TOTAL_SECONDS,

            /*
             * Compatibility only.
             * No Firestore activity-session document exists.
             */
            currentSessionId: "",
            currentSessionActive: false,
            currentSessionStartedAt: null,
            lastHeartbeatAt: null
        };
    }

    const state = {
        initialized: false,
        running: false,

        heartbeatInProgress: false,
        heartbeatQueued: false,

        currentUser: null,

        /*
         * Compatibility/local-only session ID.
         */
        sessionId: "",

        visible: document.visibilityState === "visible",

        focused: typeof document.hasFocus === "function"
            ? document.hasFocus()
            : true,

        online: window.navigator.onLine !== false,

        userActive: false,

        lastInteractionAt: Date.now(),

        /*
         * Local anti-idle gate.
         * It must survive continuously for one 15-minute checkpoint.
         */
        activeWindowStartedAt: 0,

        lastHeartbeatSentAt: null,
        lastHeartbeatReceivedAt: null,

        lastRecordAttemptAt: 0,
        nextRecordAttemptAt: 0,

        lastRecordedDayKey: "",

        lastCreditedDays: 0,
        lastCreditedSeconds: 0,
        lastCreditReason: "",

        sessionStatus: "retired",

        /*
         * Existing compatibility name.
         * A device mismatch can also surface through this old flag.
         */
        blockedByAnotherSession: false,

        activity: createDefaultActivity(),

        error: null
    };

    /* =====================================================
       ERROR / RESULT HELPERS
    ===================================================== */

    function normalizeError(error) {
        const details =
            error?.details &&
            typeof error.details === "object"
                ? error.details
                : null;

        return {
            code:
                toSafeString(error?.code)
                    .replace(/^functions\//, "")
                    .replace(/^firestore\//, "") ||
                "activity-error",

            message:
                toSafeString(
                    error?.message ||
                    details?.message
                ) ||
                "Activity operation failed.",

            reason:
                toSafeString(
                    details?.reason ||
                    details?.code
                ),

            field:
                toSafeString(
                    details?.field
                ),

            details
        };
    }

    function unwrapCallableResult(response) {
        if (
            response &&
            typeof response === "object" &&
            Object.prototype.hasOwnProperty.call(
                response,
                "data"
            ) &&
            !Object.prototype.hasOwnProperty.call(
                response,
                "activity"
            )
        ) {
            return response.data;
        }

        return response;
    }

    /* =====================================================
       STATE / EVENTS
    ===================================================== */

    function getState() {
        return cloneValue({
            ...state,

            currentUser:
                state.currentUser
                    ? {
                        uid:
                            toSafeString(
                                state.currentUser.uid
                            ),

                        email:
                            toSafeString(
                                state.currentUser.email
                            )
                    }
                    : null
        });
    }

    function notify(eventName = EVENT_UPDATED) {
        const snapshot = getState();

        listeners.forEach(listener => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error(
                    "[ActivityDB] Subscriber failed.",
                    error
                );
            }
        });

        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail: snapshot
                }
            )
        );

        return snapshot;
    }

    function setError(error) {
        state.error = normalizeError(error);

        notify(
            EVENT_ERROR
        );

        return state.error;
    }

    function clearError() {
        state.error = null;
    }

    function reportBlocked(
        code,
        message
    ) {
        state.error = {
            code,
            message,
            reason: code,
            field: "",
            details: null
        };

        notify(
            EVENT_BLOCKED
        );

        return getState();
    }

    /* =====================================================
       ACTIVITY NORMALIZATION
    ===================================================== */

    function normalizeActivity(activity) {
        const source =
            activity &&
            typeof activity === "object"
                ? activity
                : {};

        const requiredActiveDays =
            toNonNegativeInteger(
                source.requiredActiveDays,
                REQUIRED_ACTIVE_DAYS
            ) ||
            REQUIRED_ACTIVE_DAYS;

        const requiredDailySeconds =
            toNonNegativeInteger(
                source.requiredDailySeconds,
                REQUIRED_DAILY_SECONDS
            ) ||
            REQUIRED_DAILY_SECONDS;

        let activeDays =
            toNonNegativeInteger(
                source.activeDays
            );

        if (
            source.activeDays === undefined &&
            source.completed === true
        ) {
            activeDays =
                requiredActiveDays;
        }

        activeDays =
            clamp(
                activeDays,
                0,
                requiredActiveDays
            );

        const currentDaySeconds =
            clamp(
                toNonNegativeInteger(
                    source.currentDaySeconds ??
                    source.todayActiveSeconds
                ),
                0,
                requiredDailySeconds
            );

        const currentDayCompleted =
            source.currentDayCompleted === true ||
            currentDaySeconds >= requiredDailySeconds;

        const completed =
            source.completed === true ||
            activeDays >= requiredActiveDays;

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays - activeDays
            );

        const remainingTodaySeconds =
            currentDayCompleted
                ? 0
                : Math.max(
                    0,
                    requiredDailySeconds -
                    currentDaySeconds
                );

        const progressPercent =
            requiredActiveDays > 0
                ? clamp(
                    (
                        activeDays /
                        requiredActiveDays
                    ) * 100,
                    0,
                    100
                )
                : 100;

        const dailyProgressPercent =
            requiredDailySeconds > 0
                ? clamp(
                    (
                        currentDaySeconds /
                        requiredDailySeconds
                    ) * 100,
                    0,
                    100
                )
                : 100;

        /*
         * IMPORTANT:
         * Old 24-hours-per-day compatibility counters are ignored.
         *
         * New total = completed eligible days × 2h
         *           + today's eligible partial time.
         */
        const totalActiveSeconds =
            Math.min(
                requiredActiveDays *
                    requiredDailySeconds,

                activeDays *
                    requiredDailySeconds +
                (
                    currentDayCompleted
                        ? 0
                        : currentDaySeconds
                )
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
                toSafeString(
                    source.uid ||
                    source.userId ||
                    state.currentUser?.uid
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid ||
                    state.currentUser?.uid
                ),

            deviceId:
                toSafeString(
                    source.deviceId
                ),

            activeDays,
            requiredActiveDays,
            remainingActiveDays,

            currentDaySeconds,

            todayActiveSeconds:
                currentDaySeconds,

            requiredDailySeconds,
            remainingTodaySeconds,

            currentDayStartedAt:
                source.currentDayStartedAt ||
                null,

            currentDayCompleted,

            lastCheckpointAt:
                source.lastCheckpointAt ||
                null,

            dailyProgressPercent,
            progressPercent,

            completed,

            lastActiveAt:
                source.lastActiveAt ||
                null,

            completedAt:
                source.completedAt ||
                null,

            activityPolicyVersion:
                toNonNegativeInteger(
                    source.activityPolicyVersion,
                    ACTIVITY_POLICY_VERSION
                ) ||
                ACTIVITY_POLICY_VERSION,

            totalActiveSeconds,
            requiredActiveSeconds,
            remainingActiveSeconds,

            /*
             * Compatibility aliases.
             */
            currentSessionId: "",
            currentSessionActive: false,
            currentSessionStartedAt: null,

            lastHeartbeatAt:
                source.lastCheckpointAt ||
                source.lastActiveAt ||
                null
        };
    }

    function isCurrentActivityDay(
        activity = state.activity
    ) {
        if (
            !activity?.currentDayStartedAt
        ) {
            return false;
        }

        return (
            bangladeshDayKey(
                activity.currentDayStartedAt
            ) ===
            bangladeshDayKey()
        );
    }

    function hasCompletedToday(
        activity = state.activity
    ) {
        return (
            isCurrentActivityDay(activity) &&
            activity?.currentDayCompleted === true
        );
    }

    function synchronizeProfileService() {
        if (
            !window.ProfileService ||
            typeof window.ProfileService
                .setActivity !== "function"
        ) {
            return false;
        }

        try {
            window.ProfileService.setActivity(
                state.activity
            );

            return true;
        } catch (error) {
            console.warn(
                "[ActivityDB] ProfileService activity synchronization failed.",
                error
            );

            return false;
        }
    }

    function updateActivity(activity) {
        state.activity =
            normalizeActivity(
                activity
            );

        state.lastRecordedDayKey =
            hasCompletedToday(
                state.activity
            )
                ? bangladeshDayKey()
                : "";

        synchronizeProfileService();

        return state.activity;
    }

    function extractActivity(result) {
        if (
            result?.activity &&
            typeof result.activity === "object"
        ) {
            return result.activity;
        }

        if (
            result &&
            typeof result === "object" &&
            (
                Object.prototype.hasOwnProperty.call(
                    result,
                    "activeDays"
                ) ||
                Object.prototype.hasOwnProperty.call(
                    result,
                    "currentDaySeconds"
                ) ||
                Object.prototype.hasOwnProperty.call(
                    result,
                    "totalActiveSeconds"
                )
            )
        ) {
            return result;
        }

        return null;
    }

    /* =====================================================
       LOCAL CHECKPOINT SCHEDULER
    ===================================================== */

    function resetBackendSchedule() {
        state.nextRecordAttemptAt = 0;
    }

    function resetActiveWindow() {
        state.activeWindowStartedAt = 0;
    }

    function beginActiveWindow() {
        if (
            state.userActive &&
            !state.activeWindowStartedAt
        ) {
            state.activeWindowStartedAt =
                Date.now();
        }

        return state.activeWindowStartedAt;
    }

    function hasContinuousCheckpointWindow() {
        return Boolean(
            state.activeWindowStartedAt &&
            (
                Date.now() -
                state.activeWindowStartedAt
            ) >= CHECKPOINT_INTERVAL_MS
        );
    }

    function scheduleNextAttempt(delayMs) {
        const safeDelay =
            Math.max(
                RECORD_RETRY_GUARD_MS,
                toNonNegativeInteger(
                    delayMs
                )
            );

        state.nextRecordAttemptAt =
            Date.now() +
            safeDelay;
    }

    function scheduleFromResult(result) {
        const reason =
            toSafeString(
                result?.reason
            );

        const nextCheckpointInSeconds =
            toNonNegativeInteger(
                result?.nextCheckpointInSeconds
            );

        if (
            nextCheckpointInSeconds > 0
        ) {
            scheduleNextAttempt(
                nextCheckpointInSeconds *
                1000
            );

            return;
        }

        if (
            [
                "day_started",
                "checkpoint_anchor_created",
                "activity_resumed",
                "checkpoint_credited"
            ].includes(reason)
        ) {
            /*
             * A fresh valid 15-minute continuous-active window
             * must start after every accepted checkpoint/anchor.
             */
            state.activeWindowStartedAt =
                Date.now();

            scheduleNextAttempt(
                CHECKPOINT_INTERVAL_MS
            );

            return;
        }

        if (
            [
                "eligible_day_completed",
                "daily_goal_completed",
                "activity_completed"
            ].includes(reason)
        ) {
            resetActiveWindow();

            /*
             * No more activity writes today / after final completion.
             * Next Bangladesh date is handled specially below.
             */
            state.nextRecordAttemptAt =
                Number.POSITIVE_INFINITY;

            return;
        }

        if (
            [
                "mobile_required",
                "device_required",
                "device_mismatch"
            ].includes(reason)
        ) {
            scheduleNextAttempt(
                60 * 1000
            );

            return;
        }

        scheduleNextAttempt(
            RECORD_RETRY_GUARD_MS
        );
    }

    /* =====================================================
       LOCAL COMPATIBILITY SESSION ID
       No Firestore session is created.
    ===================================================== */

    function createRandomPart() {
        if (
            window.crypto &&
            typeof window.crypto
                .getRandomValues === "function"
        ) {
            const values =
                new Uint32Array(4);

            window.crypto.getRandomValues(
                values
            );

            return Array.from(values)
                .map(
                    value =>
                        value.toString(36)
                )
                .join("");
        }

        return (
            Math.random()
                .toString(36)
                .slice(2) +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }

    function createSessionId() {
        return [
            "activity",
            Date.now()
                .toString(36),
            createRandomPart()
                .slice(0, 32)
        ].join("_");
    }

    function readStoredSessionId(uid) {
        try {
            const storedUid =
                window.sessionStorage
                    .getItem(
                        USER_STORAGE_KEY
                    );

            const sessionId =
                window.sessionStorage
                    .getItem(
                        SESSION_STORAGE_KEY
                    );

            return (
                storedUid === uid &&
                sessionId
                    ? toSafeString(sessionId)
                    : ""
            );
        } catch {
            return "";
        }
    }

    function storeSession(
        uid,
        sessionId
    ) {
        try {
            window.sessionStorage
                .setItem(
                    USER_STORAGE_KEY,
                    uid
                );

            window.sessionStorage
                .setItem(
                    SESSION_STORAGE_KEY,
                    sessionId
                );

            return true;
        } catch {
            return false;
        }
    }

    function clearStoredSession() {
        try {
            window.sessionStorage
                .removeItem(
                    USER_STORAGE_KEY
                );

            window.sessionStorage
                .removeItem(
                    SESSION_STORAGE_KEY
                );

            return true;
        } catch {
            return false;
        }
    }

    function resolveSessionId(uid) {
        const stored =
            readStoredSessionId(uid);

        if (stored) {
            return stored;
        }

        const sessionId =
            createSessionId();

        storeSession(
            uid,
            sessionId
        );

        return sessionId;
    }

    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    function resolveAuth() {
        const configured =
            window.FirebaseConfig?.auth ||
            window.firebaseAuth ||
            null;

        if (configured) {
            return configured;
        }

        if (
            window.firebase &&
            typeof window.firebase.auth === "function"
        ) {
            try {
                return window.firebase.auth();
            } catch {
                return null;
            }
        }

        return null;
    }

    function resolveFirebaseUser() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService
                .getFirebaseUser === "function"
        ) {
            const user =
                authService.getFirebaseUser();

            if (user?.uid) {
                return user;
            }
        }

        return (
            resolveAuth()?.currentUser ||
            null
        );
    }

    async function waitForAuthReady() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService.whenReady === "function"
        ) {
            try {
                await authService.whenReady();
            } catch (error) {
                console.warn(
                    "[ActivityDB] AuthService initialization warning.",
                    error
                );
            }
        }

        return resolveFirebaseUser();
    }

    function getProviderIds(firebaseUser) {
        if (
            !firebaseUser ||
            !Array.isArray(
                firebaseUser.providerData
            )
        ) {
            return [];
        }

        return Array.from(
            new Set(
                firebaseUser.providerData
                    .map(
                        provider =>
                            toSafeString(
                                provider?.providerId
                            )
                    )
                    .filter(Boolean)
            )
        );
    }

    async function isEligibleGoogleUser(
        firebaseUser
    ) {
        if (
            !firebaseUser?.uid ||
            firebaseUser.emailVerified !== true
        ) {
            return false;
        }

        if (
            !getProviderIds(
                firebaseUser
            ).includes(
                GOOGLE_PROVIDER_ID
            )
        ) {
            return false;
        }

        const authServiceUser =
            window.AuthService &&
            typeof window.AuthService
                .getCurrentUser === "function"
                ? window.AuthService
                    .getCurrentUser()
                : null;

        if (
            authServiceUser?.uid ===
                firebaseUser.uid &&
            authServiceUser.isGoogleSignIn === true
        ) {
            return true;
        }

        if (
            typeof firebaseUser
                .getIdTokenResult !== "function"
        ) {
            return false;
        }

        try {
            const tokenResult =
                await firebaseUser
                    .getIdTokenResult(false);

            const signInProvider =
                toSafeString(
                    tokenResult?.signInProvider ||
                    tokenResult
                        ?.claims
                        ?.firebase
                        ?.sign_in_provider
                );

            return (
                signInProvider ===
                GOOGLE_PROVIDER_ID
            );
        } catch {
            return false;
        }
    }

    /* =====================================================
       FUNCTIONSCLIENT / SPARK CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (client) {
            return client;
        }

        const error =
            new Error(
                "Firebase Spark Client is not loaded."
            );

        error.code =
            "functions-client-not-loaded";

        throw error;
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
            ] === "function"
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
            typeof client.call === "function"
        ) {
            return unwrapCallableResult(
                await client.call(
                    functionName,
                    payload
                )
            );
        }

        const error =
            new Error(
                `Client method is unavailable: ${functionName}`
            );

        error.code =
            "callable-method-unavailable";

        throw error;
    }

    /* =====================================================
       LOCAL ACTIVE STATE

       Requirement:
       - visible
       - focused
       - online
       - recently interacted

       If no interaction occurs for 2 minutes, the local
       continuous checkpoint window is discarded.
    ===================================================== */

    function calculateUserActive() {
        return Boolean(
            state.running &&
            state.visible &&
            state.focused &&
            state.online &&
            (
                Date.now() -
                state.lastInteractionAt
            ) <=
                INACTIVITY_TIMEOUT_MS
        );
    }

    function canAttemptCheckpoint(
        options = {}
    ) {
        if (
            !state.running ||
            !state.currentUser?.uid ||
            !state.userActive ||
            !state.visible ||
            !state.focused ||
            !state.online ||
            state.activity.completed === true ||
            hasCompletedToday()
        ) {
            return false;
        }

        /*
         * force is used only for day/anchor initialization.
         * FunctionsClient still prevents an early 15-minute credit.
         */
        if (
            options.force === true
        ) {
            return true;
        }

        /*
         * A completed previous day sets nextRecordAttemptAt=Infinity.
         * Once the Bangladesh date changes, allow a new day anchor.
         */
        if (
            !isCurrentActivityDay(
                state.activity
            )
        ) {
            return (
                state.nextRecordAttemptAt ===
                    Number.POSITIVE_INFINITY ||
                Date.now() >=
                    state.nextRecordAttemptAt
            );
        }

        if (
            !state.activity
                .lastCheckpointAt
        ) {
            return (
                Date.now() >=
                state.nextRecordAttemptAt
            );
        }

        /*
         * A real checkpoint needs BOTH:
         * 1. server checkpoint cadence is due
         * 2. local continuous active window reached 15 minutes
         */
        return (
            Date.now() >=
                state.nextRecordAttemptAt &&
            hasContinuousCheckpointWindow()
        );
    }

    function queueHeartbeat(
        options = {}
    ) {
        if (
            !canAttemptCheckpoint(
                options
            )
        ) {
            return false;
        }

        if (
            state.heartbeatInProgress
        ) {
            state.heartbeatQueued =
                true;

            return true;
        }

        window.setTimeout(
            () => {
                void sendHeartbeat(
                    options
                );
            },
            0
        );

        return true;
    }

    function updateActiveState(
        attemptCheckpoint = true
    ) {
        const previousActive =
            state.userActive;

        state.visible =
            document.visibilityState ===
            "visible";

        state.online =
            window.navigator.onLine !==
            false;

        state.userActive =
            calculateUserActive();

        if (
            state.userActive
        ) {
            beginActiveWindow();
        } else {
            resetActiveWindow();
        }

        if (
            previousActive !==
            state.userActive
        ) {
            notify(
                EVENT_STATE_CHANGED
            );
        }

        if (
            attemptCheckpoint &&
            state.userActive
        ) {
            queueHeartbeat();
        }

        return state.userActive;
    }

    function markInteraction() {
        if (
            document.visibilityState !==
                "visible" ||
            state.focused !== true
        ) {
            return;
        }

        const wasActive =
            state.userActive;

        state.lastInteractionAt =
            Date.now();

        state.visible =
            true;

        state.online =
            window.navigator.onLine !==
            false;

        state.userActive =
            calculateUserActive();

        /*
         * Coming back after inactivity starts a completely
         * fresh local 15-minute window.
         */
        if (
            state.userActive &&
            !wasActive
        ) {
            state.activeWindowStartedAt =
                Date.now();
        } else if (
            state.userActive
        ) {
            beginActiveWindow();
        } else {
            resetActiveWindow();
        }

        if (
            !wasActive &&
            state.userActive
        ) {
            notify(
                EVENT_STATE_CHANGED
            );
        }

        if (
            state.userActive
        ) {
            queueHeartbeat();
        }
    }

    /* =====================================================
       SERVER-AUTHORITATIVE REFRESH
    ===================================================== */

    async function refresh() {
        const firebaseUser =
            resolveFirebaseUser();

        if (
            !firebaseUser?.uid
        ) {
            return getState();
        }

        const expectedUid =
            firebaseUser.uid;

        const expectedGeneration =
            lifecycleGeneration;

        try {
            clearError();

            const result =
                await callBackend(
                    "getMyActivity",
                    "getMyActivity",
                    {}
                );

            if (
                lifecycleGeneration !==
                    expectedGeneration ||
                state.currentUser?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            const activity =
                extractActivity(
                    result
                );

            if (activity) {
                updateActivity(
                    activity
                );

                if (
                    state.activity.completed ||
                    hasCompletedToday()
                ) {
                    resetActiveWindow();

                    state.nextRecordAttemptAt =
                        Number.POSITIVE_INFINITY;
                } else if (
                    isCurrentActivityDay(
                        state.activity
                    ) &&
                    state.activity
                        .lastCheckpointAt
                ) {
                    const checkpointMs =
                        timestampToMillis(
                            state.activity
                                .lastCheckpointAt
                        );

                    state.nextRecordAttemptAt =
                        checkpointMs
                            ? checkpointMs +
                                CHECKPOINT_INTERVAL_MS
                            : 0;
                } else {
                    resetBackendSchedule();
                }
            }

            notify();

            return getState();
        } catch (error) {
            if (
                lifecycleGeneration ===
                expectedGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        }
    }

    /* =====================================================
       ACTIVITY CHECKPOINT

       Existing public method name sendHeartbeat() is kept,
       but this is NOT a 60-second heartbeat.

       Valid credited checkpoint:
       - active
       - visible
       - focused
       - online
       - local continuous 15-minute window
       - FunctionsClient server-time validation
       - Firestore Rules validation
    ===================================================== */

    async function sendHeartbeat(
        options = {}
    ) {
        if (
            !state.running
        ) {
            return {
                success: true,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,
                reason: "not_running"
            };
        }

        const firebaseUser =
            resolveFirebaseUser();

        if (
            !firebaseUser?.uid ||
            firebaseUser.uid !==
                state.currentUser?.uid
        ) {
            return {
                success: false,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,
                reason: "authentication_changed"
            };
        }

        state.visible =
            document.visibilityState ===
            "visible";

        state.focused =
            typeof document.hasFocus ===
                "function"
                ? document.hasFocus()
                : state.focused;

        state.online =
            window.navigator.onLine !==
            false;

        state.userActive =
            calculateUserActive();

        if (
            !state.online
        ) {
            return {
                success: false,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,
                reason: "offline"
            };
        }

        if (
            !canAttemptCheckpoint(
                options
            )
        ) {
            return {
                success: true,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,

                reason:
                    state.activity.completed
                        ? "activity_completed"
                        : (
                            hasCompletedToday()
                                ? "daily_goal_completed"
                                : "not_currently_active"
                        )
            };
        }

        const now =
            Date.now();

        if (
            options.force !== true &&
            (
                now -
                state.lastRecordAttemptAt
            ) <
                RECORD_RETRY_GUARD_MS
        ) {
            return {
                success: true,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,
                reason: "retry_guard"
            };
        }

        if (
            state.heartbeatInProgress
        ) {
            state.heartbeatQueued =
                true;

            return {
                success: true,
                skipped: true,
                creditedDays: 0,
                creditedSeconds: 0,
                reason: "record_in_progress"
            };
        }

        const expectedUid =
            firebaseUser.uid;

        const expectedGeneration =
            lifecycleGeneration;

        state.heartbeatInProgress =
            true;

        state.lastRecordAttemptAt =
            now;

        state.lastHeartbeatSentAt =
            new Date()
                .toISOString();

        try {
            clearError();

            const result =
                await callBackend(
                    "recordActivityHeartbeat",
                    "recordActivityHeartbeat",
                    {
                        /*
                         * Compatibility only.
                         */
                        sessionId:
                            state.sessionId,

                        active: true,
                        visible: state.visible,
                        focused: state.focused,
                        online: state.online,

                        /*
                         * FunctionsClient does not allow force to
                         * bypass the real 15-minute server gate.
                         */
                        force:
                            options.force === true
                    }
                );

            if (
                lifecycleGeneration !==
                    expectedGeneration ||
                state.currentUser?.uid !==
                    expectedUid
            ) {
                return result;
            }

            state.lastHeartbeatReceivedAt =
                new Date()
                    .toISOString();

            state.lastCreditedDays =
                toNonNegativeInteger(
                    result?.creditedDays
                );

            /*
             * Normally 900 seconds for a successful checkpoint.
             * A day becomes +1 only after eight valid checkpoints.
             */
            state.lastCreditedSeconds =
                toNonNegativeInteger(
                    result?.creditedSeconds
                );

            state.lastCreditReason =
                toSafeString(
                    result?.reason
                );

            state.blockedByAnotherSession =
                state.lastCreditReason ===
                "device_mismatch";

            state.sessionStatus =
                "retired";

            const activity =
                extractActivity(
                    result
                );

            if (activity) {
                updateActivity(
                    activity
                );
            }

            scheduleFromResult(
                result
            );

            if (
                state.activity.completed ||
                hasCompletedToday()
            ) {
                state.lastRecordedDayKey =
                    bangladeshDayKey();
            }

            if (
                state.lastCreditReason ===
                "device_mismatch"
            ) {
                state.error = {
                    code:
                        "device-mismatch",

                    message:
                        "This account is bound to another Web Device.",

                    reason:
                        "device_mismatch",

                    field:
                        "",

                    details:
                        null
                };

                notify(
                    EVENT_BLOCKED
                );
            } else {
                notify();
            }

            return result;
        } catch (error) {
            if (
                lifecycleGeneration ===
                expectedGeneration
            ) {
                /*
                 * Do not hammer Firestore on a transient failure.
                 */
                scheduleNextAttempt(
                    30 * 1000
                );

                setError(
                    error
                );
            }

            throw error;
        } finally {
            state.heartbeatInProgress =
                false;

            if (
                state.heartbeatQueued
            ) {
                state.heartbeatQueued =
                    false;

                if (
                    canAttemptCheckpoint()
                ) {
                    window.setTimeout(
                        () => {
                            void sendHeartbeat();
                        },
                        0
                    );
                }
            }
        }
    }

    /* =====================================================
       SESSION CLOSE COMPATIBILITY
       No Firestore write.
    ===================================================== */

    async function closeSession(
        sessionId = state.sessionId,
        options = {}
    ) {
        const normalizedSessionId =
            toSafeString(
                sessionId
            );

        if (
            options.clearSession === true
        ) {
            clearStoredSession();

            state.sessionId =
                "";
        }

        state.sessionStatus =
            "retired";

        state.blockedByAnotherSession =
            false;

        return {
            success: true,
            closed: false,
            skipped: true,
            sessionId: normalizedSessionId,
            reason: "activity_sessions_retired"
        };
    }

    /* =====================================================
       TIMER
       15-second timer checks local state only.
       It does not itself create a Firestore write.
    ===================================================== */

    function clearTimers() {
        if (
            activityCheckTimer !== null
        ) {
            window.clearInterval(
                activityCheckTimer
            );

            activityCheckTimer =
                null;
        }
    }

    function startTimers() {
        clearTimers();

        activityCheckTimer =
            window.setInterval(
                () => {
                    const active =
                        updateActiveState(
                            false
                        );

                    if (active) {
                        queueHeartbeat();
                    }
                },
                ACTIVITY_CHECK_INTERVAL_MS
            );
    }

    /* =====================================================
       START
    ===================================================== */

    async function start(
        providedUser = null
    ) {
        const firebaseUser =
            providedUser ||
            resolveFirebaseUser() ||
            await waitForAuthReady();

        if (
            !firebaseUser?.uid
        ) {
            state.running =
                false;

            state.currentUser =
                null;

            state.userActive =
                false;

            resetActiveWindow();

            notify(
                EVENT_STATE_CHANGED
            );

            return getState();
        }

        const eligible =
            await isEligibleGoogleUser(
                firebaseUser
            );

        if (!eligible) {
            state.running =
                false;

            state.currentUser =
                null;

            state.userActive =
                false;

            resetActiveWindow();

            return reportBlocked(
                "google-verification-required",
                "Verified Google sign-in is required for activity."
            );
        }

        if (
            state.running &&
            state.currentUser?.uid ===
                firebaseUser.uid
        ) {
            if (
                state.userActive
            ) {
                queueHeartbeat();
            }

            return getState();
        }

        lifecycleGeneration += 1;

        if (
            state.currentUser?.uid &&
            state.currentUser.uid !==
                firebaseUser.uid
        ) {
            clearStoredSession();

            state.activity =
                createDefaultActivity(
                    firebaseUser.uid
                );

            state.lastRecordedDayKey =
                "";

            resetBackendSchedule();
            resetActiveWindow();
        }

        state.currentUser =
            firebaseUser;

        state.sessionId =
            resolveSessionId(
                firebaseUser.uid
            );

        state.running =
            true;

        state.visible =
            document.visibilityState ===
            "visible";

        state.focused =
            typeof document.hasFocus ===
                "function"
                ? document.hasFocus()
                : true;

        state.online =
            window.navigator.onLine !==
            false;

        /*
         * Opening/focusing the page counts only as the start
         * of a local activity window. It gives zero seconds.
         */
        state.lastInteractionAt =
            Date.now();

        state.userActive =
            calculateUserActive();

        state.activeWindowStartedAt =
            state.userActive
                ? Date.now()
                : 0;

        state.blockedByAnotherSession =
            false;

        state.sessionStatus =
            "retired";

        state.lastCreditedDays =
            0;

        state.lastCreditedSeconds =
            0;

        state.lastCreditReason =
            "";

        clearError();

        startTimers();

        notify(
            EVENT_STATE_CHANGED
        );

        /*
         * Always load authoritative Firestore activity first.
         */
        try {
            await refresh();
        } catch {
            /*
             * refresh() already published the error.
             */
        }

        /*
         * Only a missing/new day anchor is force-called.
         *
         * IMPORTANT:
         * This does not grant 15 minutes and does not grant a day.
         * Existing checkpoints are never force-called merely because
         * a user reloaded the page.
         */
        if (
            state.running &&
            state.userActive &&
            state.activity.completed !== true &&
            !hasCompletedToday() &&
            (
                !isCurrentActivityDay(
                    state.activity
                ) ||
                !state.activity
                    .lastCheckpointAt
            )
        ) {
            try {
                await sendHeartbeat({
                    force: true
                });
            } catch {
                /*
                 * sendHeartbeat() already published the error.
                 */
            }
        }

        return getState();
    }

    /* =====================================================
       STOP
    ===================================================== */

    async function stop(
        options = {}
    ) {
        if (stopPromise) {
            return stopPromise;
        }

        const shouldClearSession =
            options.clearSession !== false;

        const shouldResetActivity =
            options.resetActivity === true;

        lifecycleGeneration += 1;

        state.running =
            false;

        state.userActive =
            false;

        state.heartbeatQueued =
            false;

        resetActiveWindow();

        clearTimers();

        stopPromise =
            (async () => {
                if (
                    shouldClearSession
                ) {
                    clearStoredSession();

                    state.sessionId =
                        "";
                }

                state.currentUser =
                    null;

                state.sessionStatus =
                    "retired";

                state.blockedByAnotherSession =
                    false;

                state.lastRecordAttemptAt =
                    0;

                state.nextRecordAttemptAt =
                    0;

                state.lastRecordedDayKey =
                    "";

                if (
                    shouldResetActivity
                ) {
                    state.activity =
                        createDefaultActivity();

                    synchronizeProfileService();
                }

                notify(
                    EVENT_STATE_CHANGED
                );

                return {
                    success: true,
                    closed: false,
                    reason: "activity_sessions_retired"
                };
            })().finally(
                () => {
                    stopPromise =
                        null;
                }
            );

        return stopPromise;
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function handleVisibilityChange() {
        state.visible =
            document.visibilityState ===
            "visible";

        if (
            state.visible
        ) {
            state.focused =
                typeof document.hasFocus ===
                    "function"
                    ? document.hasFocus()
                    : true;

            state.lastInteractionAt =
                Date.now();
        } else {
            state.focused =
                false;

            state.userActive =
                false;

            /*
             * Hidden tab cannot continue a valid 15-minute window.
             */
            resetActiveWindow();
        }

        updateActiveState(
            state.visible
        );
    }

    function handleOnline() {
        state.online =
            true;

        state.lastInteractionAt =
            Date.now();

        updateActiveState(
            true
        );
    }

    function handleOffline() {
        const wasActive =
            state.userActive;

        state.online =
            false;

        state.userActive =
            false;

        resetActiveWindow();

        if (wasActive) {
            notify(
                EVENT_STATE_CHANGED
            );
        }
    }

    function handleWindowFocus() {
        state.focused =
            true;

        state.lastInteractionAt =
            Date.now();

        updateActiveState(
            true
        );
    }

    function handleWindowBlur() {
        state.focused =
            false;

        state.userActive =
            false;

        /*
         * Switching away from the site breaks continuous activity.
         */
        resetActiveWindow();

        notify(
            EVENT_STATE_CHANGED
        );
    }

    function handlePageHide() {
        state.visible =
            false;

        state.focused =
            false;

        state.userActive =
            false;

        state.running =
            false;

        resetActiveWindow();

        clearTimers();

        /*
         * No Firestore close-session request.
         */
        notify(
            EVENT_STATE_CHANGED
        );
    }

    function handlePageShow() {
        const firebaseUser =
            resolveFirebaseUser();

        if (
            firebaseUser?.uid
        ) {
            void start(
                firebaseUser
            );
        }
    }

    function handleBeforeLogout() {
        void stop({
            clearSession: true,
            resetActivity: true
        });
    }

    function bindBrowserEvents() {
        if (boundEvents) {
            return;
        }

        boundEvents =
            true;

        /*
         * Interaction keeps the local activity state alive.
         * It does not generate Firestore writes.
         */
        [
            "pointerdown",
            "keydown",
            "touchstart",
            "mousemove",
            "scroll"
        ].forEach(
            eventName => {
                window.addEventListener(
                    eventName,
                    markInteraction,
                    {
                        passive: true
                    }
                );
            }
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        window.addEventListener(
            "online",
            handleOnline
        );

        window.addEventListener(
            "offline",
            handleOffline
        );

        window.addEventListener(
            "focus",
            handleWindowFocus
        );

        window.addEventListener(
            "blur",
            handleWindowBlur
        );

        window.addEventListener(
            "pagehide",
            handlePageHide
        );

        window.addEventListener(
            "pageshow",
            handlePageShow
        );

        window.addEventListener(
            "auth:before-logout",
            handleBeforeLogout
        );

        window.addEventListener(
            "profile:logout",
            handleBeforeLogout
        );
    }

    function unbindBrowserEvents() {
        if (!boundEvents) {
            return;
        }

        boundEvents =
            false;

        [
            "pointerdown",
            "keydown",
            "touchstart",
            "mousemove",
            "scroll"
        ].forEach(
            eventName => {
                window.removeEventListener(
                    eventName,
                    markInteraction
                );
            }
        );

        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        window.removeEventListener(
            "online",
            handleOnline
        );

        window.removeEventListener(
            "offline",
            handleOffline
        );

        window.removeEventListener(
            "focus",
            handleWindowFocus
        );

        window.removeEventListener(
            "blur",
            handleWindowBlur
        );

        window.removeEventListener(
            "pagehide",
            handlePageHide
        );

        window.removeEventListener(
            "pageshow",
            handlePageShow
        );

        window.removeEventListener(
            "auth:before-logout",
            handleBeforeLogout
        );

        window.removeEventListener(
            "profile:logout",
            handleBeforeLogout
        );
    }

    /* =====================================================
       AUTH STATE LISTENER
    ===================================================== */

    function bindAuthState() {
        if (authUnsubscribe) {
            return true;
        }

        const auth =
            resolveAuth();

        if (
            !auth ||
            typeof auth
                .onAuthStateChanged !== "function"
        ) {
            return false;
        }

        authUnsubscribe =
            auth.onAuthStateChanged(
                firebaseUser => {
                    if (
                        firebaseUser?.uid
                    ) {
                        void start(
                            firebaseUser
                        );

                        return;
                    }

                    if (
                        state.running ||
                        state.currentUser ||
                        state.sessionId
                    ) {
                        void stop({
                            clearSession: true,
                            resetActivity: true
                        });
                    }
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
        if (readyPromise) {
            return readyPromise;
        }

        readyPromise =
            (async () => {
                bindBrowserEvents();
                bindAuthState();

                const firebaseUser =
                    await waitForAuthReady();

                state.initialized =
                    true;

                if (
                    firebaseUser?.uid
                ) {
                    await start(
                        firebaseUser
                    );
                } else {
                    state.activity =
                        createDefaultActivity();

                    synchronizeProfileService();

                    notify(
                        EVENT_STATE_CHANGED
                    );
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
       SUBSCRIPTION
    ===================================================== */

    function subscribe(
        listener,
        options = {}
    ) {
        if (
            typeof listener !== "function"
        ) {
            throw new TypeError(
                "ActivityDB subscriber must be a function."
            );
        }

        listeners.add(
            listener
        );

        if (
            options.emitCurrent !== false
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

    /* =====================================================
       FORMAT COMPATIBILITY
    ===================================================== */

    function formatDuration(
        totalSeconds
    ) {
        const normalizedSeconds =
            toNonNegativeInteger(
                totalSeconds
            );

        const years =
            Math.floor(
                normalizedSeconds /
                (
                    365 *
                    24 *
                    60 *
                    60
                )
            );

        let remainingSeconds =
            normalizedSeconds %
            (
                365 *
                24 *
                60 *
                60
            );

        const months =
            Math.floor(
                remainingSeconds /
                (
                    30 *
                    24 *
                    60 *
                    60
                )
            );

        remainingSeconds %=
            30 *
            24 *
            60 *
            60;

        const days =
            Math.floor(
                remainingSeconds /
                86400
            );

        remainingSeconds %=
            86400;

        const hours =
            Math.floor(
                remainingSeconds /
                3600
            );

        remainingSeconds %=
            3600;

        const minutes =
            Math.floor(
                remainingSeconds /
                60
            );

        const seconds =
            remainingSeconds %
            60;

        return {
            years,
            months,
            days,
            hours,
            minutes,
            seconds,

            y: years,
            mo: months,
            d: days,
            h: hours,
            m: minutes,
            s: seconds,

            text:
                `${days}d ${hours}h ${minutes}m ${seconds}s`
        };
    }

    function getProgress() {
        const activity =
            state.activity;

        return {
            activeDays:
                activity.activeDays,

            requiredActiveDays:
                activity.requiredActiveDays,

            remainingActiveDays:
                activity.remainingActiveDays,

            currentDaySeconds:
                activity.currentDaySeconds,

            todayActiveSeconds:
                activity.todayActiveSeconds,

            requiredDailySeconds:
                activity.requiredDailySeconds,

            remainingTodaySeconds:
                activity.remainingTodaySeconds,

            currentDayCompleted:
                activity.currentDayCompleted,

            dailyProgressPercent:
                activity.dailyProgressPercent,

            progressPercent:
                activity.progressPercent,

            completed:
                activity.completed,

            completedAt:
                activity.completedAt,

            lastActiveAt:
                activity.lastActiveAt,

            totalActiveSeconds:
                activity.totalActiveSeconds,

            requiredActiveSeconds:
                activity.requiredActiveSeconds,

            remainingActiveSeconds:
                activity.remainingActiveSeconds,

            total:
                formatDuration(
                    activity.totalActiveSeconds
                ),

            remaining:
                formatDuration(
                    activity.remainingActiveSeconds
                ),

            today:
                formatDuration(
                    activity.todayActiveSeconds
                ),

            remainingToday:
                formatDuration(
                    activity.remainingTodaySeconds
                )
        };
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    async function destroy() {
        lifecycleGeneration += 1;

        await stop({
            clearSession: false,
            resetActivity: false
        });

        if (
            typeof authUnsubscribe === "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        unbindBrowserEvents();

        clearTimers();

        listeners.clear();

        readyPromise =
            null;

        state.initialized =
            false;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.ActivityDB =
        Object.freeze({
            init,
            destroy,

            start,
            stop,

            refresh,

            /*
             * Existing name kept for compatibility.
             * It now means an eligible activity checkpoint attempt.
             */
            sendHeartbeat,

            /*
             * Compatibility no-op.
             */
            closeSession,

            getState,
            getProgress,
            formatDuration,

            subscribe,

            isRunning() {
                return state.running;
            },

            isActive() {
                return state.userActive;
            },

            isCompleted() {
                return state.activity.completed;
            },

            getSessionId() {
                return state.sessionId;
            }
        });
})(
    window,
    document
);
