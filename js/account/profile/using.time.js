"use strict";

/* =========================================================
   11PLAY — PROFILE ACTIVITY PROGRESS
   File: js/account/profile/using.time.js

   Responsibilities:
   - Read server-authoritative eligible activity data
   - Render 7 different Bangladesh days × 2 eligible hours/day
   - Render today's credited eligible minutes without creating time
   - Preserve the existing ProfileUsingTime public API
   - Preserve the existing six-box Profile visual structure
   - Show zero progress for Guest users
   - Refresh when ActivityDB or ProfileService updates
   - Never calculate additional activity from browser elapsed time
   - Never write activity data to Firebase

   Final activity model:
   - Required eligible active days: 7
   - Required eligible time per day: 120 minutes
   - Firestore-authorized checkpoint: 15 minutes
   - A day counts only after the full 120-minute requirement
   - Firestore server timestamps/rules remain authoritative

   Important:
   - Browser time is used only to decide how to PRESENT a stale
     previous-day partial counter as "Today: 0/120 min".
   - Browser time never grants seconds, minutes or Active Days.
========================================================= */

(function initializeProfileUsingTime(
    window,
    document
) {
    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const REQUIRED_ACTIVE_DAYS =
        7;

    const REQUIRED_DAILY_SECONDS =
        2 * 60 * 60;

    const REQUIRED_DAILY_MINUTES =
        REQUIRED_DAILY_SECONDS /
        60;

    const CHECKPOINT_SECONDS =
        15 * 60;

    const ACTIVITY_POLICY_VERSION =
        2;

    const EVENT_UPDATED =
        "profile:using-time-updated";

    const RELATED_EVENTS =
        Object.freeze([
            "activity:updated",
            "activity:state-changed",
            "activity:access-blocked",
            "profile:updated",
            "PROFILE_UPDATED",
            "profile:auth-changed",
            "auth:state-changed",
            "profile:mobile-saved"
        ]);

    const VALUE_SELECTORS =
        Object.freeze({
            activeDays:
                Object.freeze([
                    "[data-using-time-value='active-days']",
                    "#usingTimeActiveDays"
                ]),

            requiredDays:
                Object.freeze([
                    "[data-using-time-value='required-days']",
                    "#usingTimeRequiredDays"
                ]),

            remainingDays:
                Object.freeze([
                    "[data-using-time-value='remaining-days']",
                    "#usingTimeRemainingDays"
                ]),

            progress:
                Object.freeze([
                    "[data-using-time-value='progress']",
                    "#usingTimeProgressText"
                ]),

            lastActiveDay:
                Object.freeze([
                    "[data-using-time-value='last-active-day']",
                    "#usingTimeLastActiveDay"
                ]),

            eligibilityState:
                Object.freeze([
                    "[data-using-time-value='eligibility-state']",
                    "#usingTimeEligibilityState"
                ]),

            todayMinutes:
                Object.freeze([
                    "[data-using-time-value='today-minutes']",
                    "#usingTimeTodayMinutes"
                ]),

            requiredDailyMinutes:
                Object.freeze([
                    "[data-using-time-value='required-daily-minutes']",
                    "#usingTimeRequiredDailyMinutes"
                ]),

            remainingTodayMinutes:
                Object.freeze([
                    "[data-using-time-value='remaining-today-minutes']",
                    "#usingTimeRemainingTodayMinutes"
                ])
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const state = {
        initialized:
            false,

        root:
            null,

        activityUnsubscribe:
            null,

        model:
            createEmptyModel(),

        updatedAt:
            null
    };

    let browserEventsBound =
        false;

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
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    function padValue(
        value,
        length = 2
    ) {
        return String(
            toNonNegativeInteger(value)
        ).padStart(
            length,
            "0"
        );
    }

    function resolveDate(value) {
        if (!value) {
            return null;
        }

        if (
            typeof value?.toDate ===
                "function"
        ) {
            try {
                const date =
                    value.toDate();

                return Number.isNaN(
                    date.getTime()
                )
                    ? null
                    : date;
            } catch {
                return null;
            }
        }

        if (
            typeof value?.toMillis ===
                "function"
        ) {
            try {
                const date =
                    new Date(
                        value.toMillis()
                    );

                return Number.isNaN(
                    date.getTime()
                )
                    ? null
                    : date;
            } catch {
                return null;
            }
        }

        if (
            isPlainObject(value) &&
            Number.isFinite(
                value.seconds
            )
        ) {
            const date =
                new Date(
                    value.seconds *
                    1000
                );

            return Number.isNaN(
                date.getTime()
            )
                ? null
                : date;
        }

        const date =
            value instanceof Date
                ? value
                : new Date(value);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function timestampToMillis(value) {
        const date =
            resolveDate(value);

        return date
            ? date.getTime()
            : 0;
    }

    function bangladeshDayKey(
        value = Date.now()
    ) {
        const milliseconds =
            typeof value ===
                "number"
                ? value
                : (
                    timestampToMillis(value) ||
                    Date.now()
                );

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

    function isPresentationCurrentBangladeshDay(
        value
    ) {
        if (!value) {
            return false;
        }

        /*
         * Presentation-only comparison.
         * This never grants or removes activity in Firestore.
         */
        return (
            bangladeshDayKey(value) ===
            bangladeshDayKey()
        );
    }

    function formatActiveDate(value) {
        const date =
            resolveDate(value);

        if (!date) {
            return "—";
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

                        timeZone:
                            "Asia/Dhaka"
                    }
                )
                .format(date);
        } catch {
            return "—";
        }
    }

    function secondsToWholeMinutes(
        seconds
    ) {
        return Math.floor(
            toNonNegativeInteger(
                seconds
            ) /
            60
        );
    }

    function remainingSecondsToMinutes(
        seconds
    ) {
        const normalized =
            toNonNegativeInteger(
                seconds
            );

        return normalized > 0
            ? Math.ceil(
                normalized /
                60
            )
            : 0;
    }

    /* =====================================================
       EMPTY MODEL
    ===================================================== */

    function createEmptyModel() {
        return {
            uid:
                "",

            deviceId:
                "",

            deviceBound:
                false,

            deviceConflict:
                false,

            activeDays:
                0,

            eligibleActiveDays:
                0,

            requiredActiveDays:
                REQUIRED_ACTIVE_DAYS,

            remainingActiveDays:
                REQUIRED_ACTIVE_DAYS,

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

            currentDayStartedAt:
                null,

            currentDayKey:
                "",

            currentDayCompleted:
                false,

            lastCheckpointAt:
                null,

            dailyProgressPercent:
                0,

            progressPercent:
                0,

            completed:
                false,

            completedAt:
                null,

            lastActiveAt:
                null,

            lastActiveDay:
                "—",

            eligibilityState:
                "Pending",

            activityPolicyVersion:
                ACTIVITY_POLICY_VERSION,

            totalActiveSeconds:
                0,

            requiredActiveSeconds:
                REQUIRED_ACTIVE_DAYS *
                REQUIRED_DAILY_SECONDS,

            remainingActiveSeconds:
                REQUIRED_ACTIVE_DAYS *
                REQUIRED_DAILY_SECONDS,

            checkpointSeconds:
                CHECKPOINT_SECONDS,

            statusText:
                `Eligible Active Days: 0/${REQUIRED_ACTIVE_DAYS} • Today: 0/${REQUIRED_DAILY_MINUTES} min`,

            values: {
                activeDays:
                    "00",

                requiredDays:
                    padValue(
                        REQUIRED_ACTIVE_DAYS
                    ),

                remainingDays:
                    padValue(
                        REQUIRED_ACTIVE_DAYS
                    ),

                progress:
                    "0%",

                lastActiveDay:
                    "—",

                eligibilityState:
                    "Pending",

                todayMinutes:
                    "0",

                requiredDailyMinutes:
                    String(
                        REQUIRED_DAILY_MINUTES
                    ),

                remainingTodayMinutes:
                    String(
                        REQUIRED_DAILY_MINUTES
                    )
            }
        };
    }

    /* =====================================================
       ACTIVITY NORMALIZATION
    ===================================================== */

    function normalizeActivity(activity) {
        const source =
            isPlainObject(activity)
                ? activity
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
                60,
                toNonNegativeInteger(
                    source.requiredDailySeconds,
                    REQUIRED_DAILY_SECONDS
                ) ||
                REQUIRED_DAILY_SECONDS
            );

        const requiredDailyMinutes =
            Math.max(
                1,
                Math.ceil(
                    requiredDailySeconds /
                    60
                )
            );

        let suppliedActiveDays =
            toNonNegativeInteger(
                source.eligibleActiveDays ??
                source.activeDays ??
                source.totalActiveDays ??
                source.completedActiveDays
            );

        if (
            suppliedActiveDays === 0 &&
            source.completed === true
        ) {
            suppliedActiveDays =
                requiredActiveDays;
        }

        const activeDays =
            Math.min(
                requiredActiveDays,
                suppliedActiveDays
            );

        const remainingActiveDays =
            Math.max(
                0,
                requiredActiveDays -
                activeDays
            );

        const completed =
            source.completed === true ||
            source.requirementMet === true ||
            source.activityCompleted === true ||
            activeDays >=
                requiredActiveDays;

        const currentDayStartedAt =
            source.currentDayStartedAt ||
            null;

        const currentDayKey =
            currentDayStartedAt
                ? bangladeshDayKey(
                    currentDayStartedAt
                )
                : toSafeString(
                    source.currentDayKey
                );

        const presentationIsToday =
            currentDayStartedAt
                ? isPresentationCurrentBangladeshDay(
                    currentDayStartedAt
                )
                : false;

        const rawCurrentDaySeconds =
            clamp(
                toNonNegativeInteger(
                    source.currentDaySeconds ??
                    source.todayActiveSeconds
                ),
                0,
                requiredDailySeconds
            );

        const storedCurrentDayCompleted =
            source.currentDayCompleted ===
                true ||
            rawCurrentDaySeconds >=
                requiredDailySeconds;

        /*
         * If Firestore still contains yesterday's completed/partial
         * day until the next server anchor is created, the UI shows
         * Today as zero. No server-authoritative value is changed.
         */
        const todayActiveSeconds =
            presentationIsToday
                ? rawCurrentDaySeconds
                : 0;

        const currentDayCompleted =
            presentationIsToday &&
            storedCurrentDayCompleted;

        const todayActiveMinutes =
            secondsToWholeMinutes(
                todayActiveSeconds
            );

        const remainingTodaySeconds =
            currentDayCompleted
                ? 0
                : Math.max(
                    0,
                    requiredDailySeconds -
                    todayActiveSeconds
                );

        const remainingTodayMinutes =
            remainingSecondsToMinutes(
                remainingTodaySeconds
            );

        const dailyProgressPercent =
            requiredDailySeconds > 0
                ? clamp(
                    (
                        todayActiveSeconds /
                        requiredDailySeconds
                    ) *
                    100,
                    0,
                    100
                )
                : 100;

        /*
         * Overall Profile progress counts completed Eligible Days.
         * Today's partial minutes do not create a partial Active Day.
         */
        const progressPercent =
            completed
                ? 100
                : (
                    requiredActiveDays > 0
                        ? clamp(
                            (
                                activeDays /
                                requiredActiveDays
                            ) *
                            100,
                            0,
                            100
                        )
                        : 100
                );

        const totalActiveSeconds =
            Math.min(
                requiredActiveDays *
                    requiredDailySeconds,

                activeDays *
                    requiredDailySeconds +
                (
                    currentDayCompleted
                        ? 0
                        : todayActiveSeconds
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

        const lastCheckpointAt =
            source.lastCheckpointAt ||
            null;

        const lastActiveAt =
            source.lastActiveAt ||
            source.lastEligibleAt ||
            lastCheckpointAt ||
            source.lastActivityAt ||
            source.updatedAt ||
            null;

        const lastActiveDay =
            formatActiveDate(
                lastActiveAt
            );

        const deviceId =
            toSafeString(
                source.deviceId
            );

        const deviceConflict =
            source.deviceConflict ===
                true ||
            toSafeString(
                source.deviceStatus
            ).toLowerCase() ===
                "conflict" ||
            toSafeString(
                source.reason
            ).toLowerCase() ===
                "device_mismatch";

        const deviceBound =
            source.deviceBound ===
                true ||
            Boolean(
                deviceId
            );

        let eligibilityState =
            "Pending";

        if (completed) {
            eligibilityState =
                "Completed";
        } else if (deviceConflict) {
            eligibilityState =
                "Blocked";
        } else if (currentDayCompleted) {
            eligibilityState =
                "Day Complete";
        }

        let statusText;

        if (completed) {
            statusText =
                `${requiredActiveDays}/${requiredActiveDays} Eligible Active Days completed`;
        } else if (deviceConflict) {
            statusText =
                `Eligible Active Days: ${activeDays}/${requiredActiveDays} • Device verification required`;
        } else {
            statusText =
                `Eligible Active Days: ${activeDays}/${requiredActiveDays} • Today: ${todayActiveMinutes}/${requiredDailyMinutes} min`;
        }

        const activityPolicyVersion =
            toNonNegativeInteger(
                source.activityPolicyVersion,
                ACTIVITY_POLICY_VERSION
            ) ||
            ACTIVITY_POLICY_VERSION;

        return {
            uid:
                toSafeString(
                    source.uid ||
                    source.userId
                ),

            deviceId,

            deviceBound,

            deviceConflict,

            activeDays,

            eligibleActiveDays:
                activeDays,

            requiredActiveDays,

            remainingActiveDays,

            currentDaySeconds:
                todayActiveSeconds,

            todayActiveSeconds,

            todayActiveMinutes,

            requiredDailySeconds,

            requiredDailyMinutes,

            remainingTodaySeconds,

            remainingTodayMinutes,

            currentDayStartedAt:
                presentationIsToday
                    ? currentDayStartedAt
                    : null,

            currentDayKey:
                presentationIsToday
                    ? currentDayKey
                    : "",

            currentDayCompleted,

            lastCheckpointAt,

            dailyProgressPercent,

            progressPercent,

            completed,

            completedAt:
                source.completedAt ||
                null,

            lastActiveAt,

            lastActiveDay,

            eligibilityState,

            activityPolicyVersion,

            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds,

            checkpointSeconds:
                CHECKPOINT_SECONDS,

            statusText,

            values: {
                activeDays:
                    padValue(
                        activeDays
                    ),

                requiredDays:
                    padValue(
                        requiredActiveDays
                    ),

                remainingDays:
                    padValue(
                        remainingActiveDays
                    ),

                progress:
                    `${Math.floor(
                        progressPercent
                    )}%`,

                lastActiveDay,

                eligibilityState,

                todayMinutes:
                    String(
                        todayActiveMinutes
                    ),

                requiredDailyMinutes:
                    String(
                        requiredDailyMinutes
                    ),

                remainingTodayMinutes:
                    String(
                        remainingTodayMinutes
                    )
            }
        };
    }

    /* =====================================================
       COMPATIBILITY FORMATTING HELPERS
    ===================================================== */

    function formatActiveDays(value) {
        const activeDays =
            toNonNegativeInteger(
                value
            );

        return {
            activeDays,

            days:
                activeDays,

            value:
                padValue(
                    activeDays
                ),

            text:
                `${activeDays} active day${
                    activeDays === 1
                        ? ""
                        : "s"
                }`
        };
    }

    function formatDuration(totalSeconds) {
        /*
         * Compatibility API only.
         * Under the final activity policy, one completed
         * eligible day represents 2 credited eligible hours,
         * not 24 elapsed browser hours.
         */
        const eligibleDays =
            Math.floor(
                toNonNegativeInteger(
                    totalSeconds
                ) /
                REQUIRED_DAILY_SECONDS
            );

        return formatActiveDays(
            eligibleDays
        );
    }

    /* =====================================================
       AUTHORITATIVE ACTIVITY SOURCE
    ===================================================== */

    function readActivityDB() {
        if (
            !window.ActivityDB ||
            typeof window.ActivityDB
                .getState !==
                "function"
        ) {
            return null;
        }

        try {
            const activityState =
                window.ActivityDB
                    .getState();

            if (
                isPlainObject(
                    activityState?.activity
                )
            ) {
                return activityState
                    .activity;
            }
        } catch {
            return null;
        }

        return null;
    }

    function readProfileServiceActivity() {
        if (
            !window.ProfileService
        ) {
            return null;
        }

        if (
            typeof window.ProfileService
                .getActivityProgress ===
                "function"
        ) {
            try {
                const progress =
                    window.ProfileService
                        .getActivityProgress();

                if (
                    isPlainObject(
                        progress
                    )
                ) {
                    return progress;
                }
            } catch {
                /*
                 * Continue to getTime().
                 */
            }
        }

        if (
            typeof window.ProfileService
                .getTime ===
                "function"
        ) {
            try {
                const time =
                    window.ProfileService
                        .getTime();

                if (
                    isPlainObject(
                        time
                    )
                ) {
                    return time;
                }
            } catch {
                /*
                 * Continue to profile object.
                 */
            }
        }

        if (
            typeof window.ProfileService
                .getUser ===
                "function"
        ) {
            try {
                const profile =
                    window.ProfileService
                        .getUser();

                return (
                    profile?.usingTime ||
                    profile?.activity ||
                    null
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    function resolveActivity() {
        /*
         * ActivityDB is preferred because it mirrors the
         * Firestore-authoritative checkpoint document directly.
         */
        return (
            readActivityDB() ||
            readProfileServiceActivity() ||
            {}
        );
    }

    /* =====================================================
       AUTHENTICATION STATE
    ===================================================== */

    function resolveAuthenticatedUid() {
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
                    return toSafeString(
                        user.uid
                    );
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

                if (
                    user?.uid
                ) {
                    return toSafeString(
                        user.uid
                    );
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

        return toSafeString(
            configuredAuth
                ?.currentUser
                ?.uid
        );
    }

    /* =====================================================
       ROOT AND ELEMENT RESOLUTION
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

        return (
            document.getElementById(
                "profilePage"
            ) ||
            document.getElementById(
                "profileRoot"
            ) ||
            document.getElementById(
                "app-view"
            ) ||
            document.getElementById(
                "appContent"
            ) ||
            document.getElementById(
                "mainContent"
            ) ||
            document.getElementById(
                "app"
            ) ||
            document.body
        );
    }

    function findElement(selectors) {
        const root =
            state.root;

        if (!root) {
            return null;
        }

        for (
            const selector of
            selectors
        ) {
            const element =
                root.querySelector(
                    selector
                );

            if (element) {
                return element;
            }
        }

        return null;
    }

    /* =====================================================
       DOM UPDATE
    ===================================================== */

    function updateValueElements(model) {
        Object.entries(
            VALUE_SELECTORS
        ).forEach(
            ([
                key,
                selectors
            ]) => {
                const element =
                    findElement(
                        selectors
                    );

                if (!element) {
                    return;
                }

                element.textContent =
                    model.values[
                        key
                    ];

                element.dataset
                    .usingTimeValueResolved =
                    toSafeString(
                        model.values[
                            key
                        ]
                    );
            }
        );
    }

    function updateProgressElement(model) {
        const progressElement =
            findElement([
                "[data-using-time-progress]",
                "#usingTimeProgress"
            ]);

        if (!progressElement) {
            return;
        }

        const progressPercent =
            clamp(
                model.progressPercent,
                0,
                100
            );

        if (
            progressElement instanceof
            HTMLProgressElement
        ) {
            progressElement.max =
                100;

            progressElement.value =
                progressPercent;
        } else {
            progressElement.style.width =
                `${progressPercent}%`;
        }

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
                    progressPercent
                )
            )
        );

        progressElement.setAttribute(
            "aria-valuetext",
            `${model.activeDays} of ${model.requiredActiveDays} eligible active days completed; today ${model.todayActiveMinutes} of ${model.requiredDailyMinutes} eligible minutes`
        );
    }

    function updateStatusElement(model) {
        const statusElement =
            findElement([
                "[data-using-time-status]",
                "#usingTimeStatus"
            ]);

        if (!statusElement) {
            return;
        }

        statusElement.textContent =
            model.statusText;

        statusElement.dataset
            .completed =
            String(
                model.completed
            );

        statusElement.dataset
            .currentDayCompleted =
            String(
                model.currentDayCompleted
            );

        statusElement.dataset
            .activeDays =
            String(
                model.activeDays
            );

        statusElement.dataset
            .requiredActiveDays =
            String(
                model.requiredActiveDays
            );

        statusElement.dataset
            .todayActiveMinutes =
            String(
                model.todayActiveMinutes
            );

        statusElement.dataset
            .requiredDailyMinutes =
            String(
                model.requiredDailyMinutes
            );
    }

    function updateContainer(model) {
        const container =
            findElement([
                "[data-using-time]",
                "#profileUsingTime",
                "#usingTime"
            ]);

        if (!container) {
            return;
        }

        container.dataset
            .completed =
            String(
                model.completed
            );

        container.dataset
            .activityModel =
            "eligible-active-days";

        container.dataset
            .activityPolicyVersion =
            String(
                model.activityPolicyVersion
            );

        container.dataset
            .deviceBound =
            String(
                model.deviceBound
            );

        container.dataset
            .deviceConflict =
            String(
                model.deviceConflict
            );

        container.dataset
            .currentDayCompleted =
            String(
                model.currentDayCompleted
            );

        container.dataset
            .currentDayKey =
            toSafeString(
                model.currentDayKey
            );

        container.dataset
            .currentDaySeconds =
            String(
                model.currentDaySeconds
            );

        container.dataset
            .todayActiveSeconds =
            String(
                model.todayActiveSeconds
            );

        container.dataset
            .todayActiveMinutes =
            String(
                model.todayActiveMinutes
            );

        container.dataset
            .requiredDailySeconds =
            String(
                model.requiredDailySeconds
            );

        container.dataset
            .requiredDailyMinutes =
            String(
                model.requiredDailyMinutes
            );

        container.dataset
            .remainingTodaySeconds =
            String(
                model.remainingTodaySeconds
            );

        container.dataset
            .remainingTodayMinutes =
            String(
                model.remainingTodayMinutes
            );

        container.dataset
            .dailyProgressPercent =
            String(
                model.dailyProgressPercent
            );

        container.dataset
            .eligibleActiveDays =
            String(
                model.activeDays
            );

        container.dataset
            .requiredActiveDays =
            String(
                model.requiredActiveDays
            );

        container.dataset
            .remainingActiveDays =
            String(
                model.remainingActiveDays
            );

        container.dataset
            .progressPercent =
            String(
                model.progressPercent
            );

        container.dataset
            .totalActiveSeconds =
            String(
                model.totalActiveSeconds
            );

        container.dataset
            .requiredActiveSeconds =
            String(
                model.requiredActiveSeconds
            );

        container.dataset
            .remainingActiveSeconds =
            String(
                model.remainingActiveSeconds
            );

        container.setAttribute(
            "aria-label",
            model.completed
                ? `Eligible activity requirement completed: ${model.activeDays} of ${model.requiredActiveDays} days, ${model.requiredDailyMinutes} eligible minutes required per day`
                : `Eligible activity progress: ${model.activeDays} of ${model.requiredActiveDays} days; today ${model.todayActiveMinutes} of ${model.requiredDailyMinutes} eligible minutes`
        );
    }

    function applyToDOM(model) {
        if (
            !state.root ||
            !state.root.isConnected
        ) {
            return false;
        }

        updateValueElements(
            model
        );

        updateProgressElement(
            model
        );

        updateStatusElement(
            model
        );

        updateContainer(
            model
        );

        return true;
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return cloneValue({
            initialized:
                state.initialized,

            model:
                state.model,

            updatedAt:
                state.updatedAt
        });
    }

    function getTime() {
        return cloneValue(
            state.model
        );
    }

    function notify() {
        const snapshot =
            getTime();

        listeners.forEach(
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[ProfileUsingTime] Subscriber failed.",
                        error
                    );
                }
            }
        );

        window.dispatchEvent(
            new CustomEvent(
                EVENT_UPDATED,
                {
                    detail:
                        snapshot
                }
            )
        );

        return snapshot;
    }

    function refresh(
        activity = null
    ) {
        const authenticatedUid =
            resolveAuthenticatedUid();

        const source =
            activity ||
            resolveActivity();

        const sourceUid =
            toSafeString(
                source?.uid ||
                source?.userId
            );

        if (
            !authenticatedUid
        ) {
            state.model =
                createEmptyModel();
        } else if (
            sourceUid &&
            sourceUid !==
                authenticatedUid
        ) {
            state.model =
                createEmptyModel();
        } else {
            state.model =
                normalizeActivity({
                    ...(
                        isPlainObject(
                            source
                        )
                            ? source
                            : {}
                    ),

                    uid:
                        sourceUid ||
                        authenticatedUid
                });
        }

        state.updatedAt =
            new Date()
                .toISOString();

        applyToDOM(
            state.model
        );

        return notify();
    }

    function reset() {
        state.model =
            createEmptyModel();

        state.updatedAt =
            null;

        applyToDOM(
            state.model
        );

        return notify();
    }

    /* =====================================================
       ACTIVITY SUBSCRIPTION
    ===================================================== */

    function bindActivityDB() {
        if (
            state.activityUnsubscribe ||
            !window.ActivityDB ||
            typeof window.ActivityDB
                .subscribe !==
                "function"
        ) {
            return false;
        }

        state.activityUnsubscribe =
            window.ActivityDB
                .subscribe(
                    activityState => {
                        refresh(
                            activityState
                                ?.activity ||
                            null
                        );
                    }
                );

        return true;
    }

    function unbindActivityDB() {
        if (
            typeof state
                .activityUnsubscribe ===
                "function"
        ) {
            state.activityUnsubscribe();
        }

        state.activityUnsubscribe =
            null;
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function handleRelatedUpdate(event) {
        if (
            event.type ===
                "auth:state-changed" ||
            event.type ===
                "profile:auth-changed"
        ) {
            if (
                !resolveAuthenticatedUid()
            ) {
                reset();

                return;
            }
        }

        refresh();
    }

    function bindBrowserEvents() {
        if (
            browserEventsBound
        ) {
            return true;
        }

        browserEventsBound =
            true;

        RELATED_EVENTS.forEach(
            eventName => {
                window.addEventListener(
                    eventName,
                    handleRelatedUpdate
                );
            }
        );

        return true;
    }

    function unbindBrowserEvents() {
        if (
            !browserEventsBound
        ) {
            return true;
        }

        browserEventsBound =
            false;

        RELATED_EVENTS.forEach(
            eventName => {
                window.removeEventListener(
                    eventName,
                    handleRelatedUpdate
                );
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
            options instanceof
                HTMLElement ||
            typeof options ===
                "string"
        ) {
            return {
                root:
                    options
            };
        }

        return isPlainObject(
            options
        )
            ? options
            : {};
    }

    function init(
        options = {}
    ) {
        const normalizedOptions =
            normalizeInitOptions(
                options
            );

        state.root =
            resolveRoot(
                normalizedOptions
                    .root
            );

        state.initialized =
            true;

        bindActivityDB();
        bindBrowserEvents();

        return refresh(
            normalizedOptions
                .activity ||
            null
        );
    }

    function destroy() {
        unbindActivityDB();
        unbindBrowserEvents();

        listeners.clear();

        state.initialized =
            false;

        state.root =
            null;

        state.model =
            createEmptyModel();

        state.updatedAt =
            null;

        return true;
    }

    /* =====================================================
       SUBSCRIPTION
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
                "ProfileUsingTime subscriber must be a function."
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
                getTime()
            );
        }

        return function unsubscribe() {
            listeners.delete(
                listener
            );
        };
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    const ProfileUsingTime =
        Object.freeze({
            init,
            destroy,
            refresh,
            reset,
            subscribe,

            getState,
            getTime,

            normalizeActivity,
            formatActiveDays,
            formatDuration,
            formatActiveDate,

            applyToDOM,

            isInitialized() {
                return state.initialized;
            },

            REQUIRED_ACTIVE_DAYS,

            REQUIRED_DAILY_SECONDS,

            REQUIRED_DAILY_MINUTES,

            CHECKPOINT_SECONDS,

            ACTIVITY_POLICY_VERSION
        });

    window.ProfileUsingTime =
        ProfileUsingTime;

    /*
     * Compatibility alias for older Profile modules.
     */
    if (
        !window.UsingTime
    ) {
        window.UsingTime =
            ProfileUsingTime;
    }
})(
    window,
    document
);