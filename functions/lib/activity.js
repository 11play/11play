"use strict";

/* =========================================================
   11PLAY — USING TIME BACKEND
   File: functions/lib/activity.js

   Responsibilities:
   - Record verified Google user's activity heartbeat
   - Count only one active browser session at a time
   - Use Firebase server time as the only credit authority
   - Count only short, continuous and previously active periods
   - Pause/release the active lease when the user becomes inactive
   - Complete Using Time after the configured active duration
   - Qualify the related referral when all conditions are complete
   - Return the current user's Using Time summary
========================================================= */

const {
    getFirestore,
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const {
    COLLECTIONS,
    PROFILE_STATUS,
    ACTIVITY,
    REFERRAL,
    SYSTEM,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    validateHeartbeatPayload,
    validateSessionId,
    normalizeText
} = require(
    "./validators"
);

const {
    assertGoogleVerifiedUser,
    createHttpsError,
    throwHttpsError
} = require(
    "./security"
);

/* =========================================================
   GENERAL HELPERS
========================================================= */

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
    return Math.max(
        0,
        Math.floor(
            toSafeNumber(
                value,
                fallback
            )
        )
    );
}

function toSafeString(value) {
    return normalizeText(value);
}

function timestampToMilliseconds(
    timestamp
) {
    if (!timestamp) {
        return 0;
    }

    if (
        typeof timestamp.toMillis ===
        "function"
    ) {
        return timestamp.toMillis();
    }

    if (
        typeof timestamp.toDate ===
        "function"
    ) {
        return timestamp
            .toDate()
            .getTime();
    }

    if (
        typeof timestamp.seconds ===
        "number"
    ) {
        return (
            timestamp.seconds * 1000
        ) + Math.floor(
            toSafeNumber(
                timestamp.nanoseconds,
                0
            ) / 1000000
        );
    }

    const parsedMilliseconds =
        new Date(timestamp)
            .getTime();

    return Number.isFinite(
        parsedMilliseconds
    )
        ? parsedMilliseconds
        : 0;
}

function calculateElapsedSeconds(
    previousTimestamp,
    currentTimestamp
) {
    const previousMilliseconds =
        timestampToMilliseconds(
            previousTimestamp
        );

    const currentMilliseconds =
        timestampToMilliseconds(
            currentTimestamp
        );

    if (
        previousMilliseconds <= 0 ||
        currentMilliseconds <=
            previousMilliseconds
    ) {
        return 0;
    }

    return Math.floor(
        (
            currentMilliseconds -
            previousMilliseconds
        ) / 1000
    );
}

function isActiveProfile(profile) {
    return (
        toSafeString(
            profile?.status
        ) === PROFILE_STATUS.ACTIVE
    );
}

/* =========================================================
   FIRESTORE REFERENCES
========================================================= */

function getProfileReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.USERS
        )
        .doc(uid);
}

function getActivityReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.ACTIVITY
        )
        .doc(uid);
}

function getActivitySessionReference(
    database,
    uid,
    sessionId
) {
    /*
     * Session document IDs are scoped by UID so that two users
     * can never collide even if their browser generates the
     * same session ID.
     */

    return database
        .collection(
            COLLECTIONS
                .ACTIVITY_SESSIONS
        )
        .doc(`${uid}__${sessionId}`);
}

function getReferralReference(
    database,
    referredUid
) {
    return database
        .collection(
            COLLECTIONS.REFERRALS
        )
        .doc(referredUid);
}

function getReferralStatsReference(
    database,
    referrerUid
) {
    return database
        .collection(
            COLLECTIONS
                .REFERRAL_STATS
        )
        .doc(referrerUid);
}

/* =========================================================
   ACTIVITY STATE
========================================================= */

function isHeartbeatActive(
    heartbeat
) {
    return Boolean(
        heartbeat.active === true &&
        heartbeat.visible === true &&
        heartbeat.online === true
    );
}

function isSessionStatusActive(
    status
) {
    return (
        status ===
        ACTIVITY.SESSION_STATUS.ACTIVE
    );
}

function isSessionStatusClosed(
    status
) {
    return (
        status ===
        ACTIVITY.SESSION_STATUS.CLOSED
    );
}

function isCurrentLeaseFresh({
    activity,
    incomingSessionId,
    timestamp
}) {
    const currentSessionId =
        toSafeString(
            activity.currentSessionId
        );

    if (
        !currentSessionId ||
        currentSessionId ===
            incomingSessionId
    ) {
        return false;
    }

    /*
     * Older activity documents may not have currentSessionActive.
     * For safe migration, a fresh unknown lease is treated as active.
     */

    if (
        activity.currentSessionActive ===
        false
    ) {
        return false;
    }

    const elapsedSeconds =
        calculateElapsedSeconds(
            activity.lastHeartbeatAt,
            timestamp
        );

    return (
        elapsedSeconds >= 0 &&
        elapsedSeconds <=
            ACTIVITY
                .INACTIVITY_TIMEOUT_SECONDS
    );
}

/* =========================================================
   CREDIT CALCULATION

   Credit is based on the previous server-confirmed session
   state. This allows the last active interval to be credited
   when the current heartbeat pauses the session.
========================================================= */

function calculateCreditedSeconds({
    activity,
    session,
    sessionExists,
    ownsCurrentLease,
    timestamp
}) {
    const requiredSeconds =
        ACTIVITY
            .REQUIRED_ACTIVE_SECONDS;

    const totalActiveSeconds =
        toNonNegativeInteger(
            activity.totalActiveSeconds
        );

    const remainingSeconds =
        Math.max(
            0,
            requiredSeconds -
                totalActiveSeconds
        );

    if (
        remainingSeconds <= 0 ||
        activity.completed === true
    ) {
        return {
            creditedSeconds:
                0,

            reason:
                "using_time_completed"
        };
    }

    if (
        !sessionExists ||
        !ownsCurrentLease
    ) {
        return {
            creditedSeconds:
                0,

            reason:
                "session_started"
        };
    }

    const previousStateWasActive =
        isSessionStatusActive(
            session.status
        ) &&
        session.active === true &&
        session.visible === true &&
        session.online === true;

    if (!previousStateWasActive) {
        return {
            creditedSeconds:
                0,

            reason:
                "activity_resumed"
        };
    }

    const elapsedSeconds =
        calculateElapsedSeconds(
            session.lastHeartbeatAt,
            timestamp
        );

    if (elapsedSeconds <= 0) {
        return {
            creditedSeconds:
                0,

            reason:
                "no_elapsed_time"
        };
    }

    if (
        elapsedSeconds >
        ACTIVITY
            .INACTIVITY_TIMEOUT_SECONDS
    ) {
        return {
            creditedSeconds:
                0,

            reason:
                "heartbeat_timeout"
        };
    }

    const creditedSeconds =
        Math.min(
            elapsedSeconds,

            ACTIVITY
                .MAX_CREDIT_PER_HEARTBEAT_SECONDS,

            remainingSeconds
        );

    return {
        creditedSeconds:
            Math.max(
                0,
                Math.floor(
                    creditedSeconds
                )
            ),

        reason:
            creditedSeconds > 0
                ? "activity_credited"
                : "no_credit"
    };
}

/* =========================================================
   PROGRESS SUMMARY
========================================================= */

function createActivitySummary(
    activity
) {
    const requiredActiveSeconds =
        toNonNegativeInteger(
            activity
                .requiredActiveSeconds,
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS
        ) ||
        ACTIVITY
            .REQUIRED_ACTIVE_SECONDS;

    const totalActiveSeconds =
        Math.min(
            requiredActiveSeconds,

            toNonNegativeInteger(
                activity
                    .totalActiveSeconds
            )
        );

    const remainingActiveSeconds =
        Math.max(
            0,
            requiredActiveSeconds -
                totalActiveSeconds
        );

    const progressPercent =
        requiredActiveSeconds > 0
            ? Math.min(
                100,
                Number(
                    (
                        totalActiveSeconds /
                        requiredActiveSeconds *
                        100
                    ).toFixed(4)
                )
            )
            : 100;

    return {
        uid:
            toSafeString(
                activity.uid
            ),

        totalActiveSeconds,

        requiredActiveSeconds,

        remainingActiveSeconds,

        requiredActiveDays:
            toNonNegativeInteger(
                activity
                    .requiredActiveDays,
                ACTIVITY
                    .REQUIRED_ACTIVE_DAYS
            ),

        progressPercent,

        completed:
            activity.completed ===
                true ||
            remainingActiveSeconds ===
                0,

        currentSessionId:
            toSafeString(
                activity
                    .currentSessionId
            ),

        currentSessionActive:
            activity
                .currentSessionActive ===
            true,

        currentSessionStartedAt:
            activity
                .currentSessionStartedAt ||
            null,

        lastHeartbeatAt:
            activity
                .lastHeartbeatAt ||
            null,

        completedAt:
            activity.completedAt ||
            null
    };
}

/* =========================================================
   REFERRAL STATISTICS
========================================================= */

function readReferralStats(
    snapshot
) {
    if (!snapshot?.exists) {
        return {
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

    const existing =
        snapshot.data() || {};

    return {
        total:
            toNonNegativeInteger(
                existing.total
            ),

        pending:
            toNonNegativeInteger(
                existing.pending ??
                existing.observing
            ),

        qualified:
            toNonNegativeInteger(
                existing.qualified ??
                existing.pendingReview
            ),

        approved:
            toNonNegativeInteger(
                existing.approved ??
                existing.valid
            ),

        rejected:
            toNonNegativeInteger(
                existing.rejected ??
                existing.invalid
            ),

        rewarded:
            toNonNegativeInteger(
                existing.rewarded ??
                existing.valid
            ),

        totalReward:
            toNonNegativeInteger(
                existing.totalReward
            )
    };
}

function createQualifiedReferralStats({
    referrerUid,
    statsSnapshot,
    timestamp
}) {
    const existing =
        readReferralStats(
            statsSnapshot
        );

    const update = {
        uid:
            referrerUid,

        total:
            Math.max(
                existing.total,
                1
            ),

        pending:
            Math.max(
                existing.pending - 1,
                0
            ),

        qualified:
            existing.qualified + 1,

        approved:
            existing.approved,

        rejected:
            existing.rejected,

        rewarded:
            existing.rewarded,

        totalReward:
            existing.totalReward,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };

    if (!statsSnapshot.exists) {
        update.createdAt =
            timestamp;
    }

    return update;
}

function isPendingReferralStatus(
    status
) {
    return [
        REFERRAL.STATUS.CAPTURED,
        REFERRAL.STATUS.PENDING,

        /* Legacy status */
        "observing"
    ].includes(
        toSafeString(status)
    );
}

function isLegacyQualifiedStatus(
    status
) {
    return (
        toSafeString(status) ===
        "pending_review"
    );
}

/* =========================================================
   ACTIVITY HEARTBEAT
========================================================= */

async function recordActivityHeartbeat(
    request
) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const heartbeat =
            validateHeartbeatPayload(
                request.data || {}
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const profileRef =
            getProfileReference(
                database,
                authenticatedUser.uid
            );

        const activityRef =
            getActivityReference(
                database,
                authenticatedUser.uid
            );

        const sessionRef =
            getActivitySessionReference(
                database,
                authenticatedUser.uid,
                heartbeat.sessionId
            );

        const referralRef =
            getReferralReference(
                database,
                authenticatedUser.uid
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const [
                        profileSnapshot,
                        activitySnapshot,
                        sessionSnapshot,
                        referralSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            profileRef
                        ),

                        transaction.get(
                            activityRef
                        ),

                        transaction.get(
                            sessionRef
                        ),

                        transaction.get(
                            referralRef
                        )
                    ]);

                    if (
                        !profileSnapshot.exists ||
                        !activitySnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Create the user profile before recording Using Time."
                        );
                    }

                    const profile =
                        profileSnapshot.data() ||
                        {};

                    if (
                        !isActiveProfile(
                            profile
                        )
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This profile cannot record Using Time."
                        );
                    }

                    const activity =
                        activitySnapshot.data() ||
                        {};

                    const session =
                        sessionSnapshot.exists
                            ? sessionSnapshot.data() ||
                              {}
                            : {};

                    const sessionOwnerUid =
                        toSafeString(
                            session.userId ||
                            session.uid
                        );

                    if (
                        sessionSnapshot.exists &&
                        sessionOwnerUid &&
                        sessionOwnerUid !==
                            authenticatedUser.uid
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This activity session belongs to another user."
                        );
                    }

                    if (
                        sessionSnapshot.exists &&
                        isSessionStatusClosed(
                            session.status
                        )
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "This activity session has already been closed."
                        );
                    }

                    const heartbeatActive =
                        isHeartbeatActive(
                            heartbeat
                        );

                    const currentSessionId =
                        toSafeString(
                            activity
                                .currentSessionId
                        );

                    const ownsCurrentLease =
                        currentSessionId ===
                        heartbeat.sessionId;

                    const anotherSessionHasLease =
                        heartbeatActive &&
                        isCurrentLeaseFresh({
                            activity,

                            incomingSessionId:
                                heartbeat.sessionId,

                            timestamp
                        });

                    if (
                        anotherSessionHasLease
                    ) {
                        const blockedSessionUpdate = {
                            userId:
                                authenticatedUser.uid,

                            uid:
                                authenticatedUser.uid,

                            sessionId:
                                heartbeat.sessionId,

                            status:
                                ACTIVITY
                                    .SESSION_STATUS
                                    .PAUSED,

                            active:
                                false,

                            visible:
                                heartbeat.visible,

                            online:
                                heartbeat.online,

                            blockedReason:
                                "another_session_active",

                            lastClientTimestamp:
                                heartbeat
                                    .clientTimestamp,

                            lastHeartbeatAt:
                                timestamp,

                            heartbeatCount:
                                toNonNegativeInteger(
                                    session
                                        .heartbeatCount
                                ) + 1,

                            totalCreditedSeconds:
                                toNonNegativeInteger(
                                    session
                                        .totalCreditedSeconds
                                ),

                            lastCreditedSeconds:
                                0,

                            lastCreditReason:
                                "another_session_active",

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SYSTEM
                                    .SCHEMA_VERSION
                        };

                        if (
                            !sessionSnapshot.exists
                        ) {
                            blockedSessionUpdate
                                .createdAt =
                                timestamp;

                            blockedSessionUpdate
                                .startedAt =
                                timestamp;
                        }

                        transaction.set(
                            sessionRef,
                            blockedSessionUpdate,
                            {
                                merge:
                                    true
                            }
                        );

                        return {
                            creditedSeconds:
                                0,

                            reason:
                                "another_session_active",

                            activity:
                                createActivitySummary(
                                    activity
                                ),

                            session: {
                                sessionId:
                                    heartbeat
                                        .sessionId,

                                status:
                                    ACTIVITY
                                        .SESSION_STATUS
                                        .PAUSED,

                                active:
                                    false,

                                blocked:
                                    true
                            },

                            referralQualified:
                                false
                        };
                    }

                    const creditResult =
                        calculateCreditedSeconds({
                            activity,
                            session,

                            sessionExists:
                                sessionSnapshot.exists,

                            ownsCurrentLease,
                            timestamp
                        });

                    const currentTotal =
                        toNonNegativeInteger(
                            activity
                                .totalActiveSeconds
                        );

                    const newTotalActiveSeconds =
                        Math.min(
                            ACTIVITY
                                .REQUIRED_ACTIVE_SECONDS,

                            currentTotal +
                            creditResult
                                .creditedSeconds
                        );

                    const wasCompleted =
                        activity.completed ===
                            true ||
                        currentTotal >=
                            ACTIVITY
                                .REQUIRED_ACTIVE_SECONDS;

                    const completed =
                        newTotalActiveSeconds >=
                        ACTIVITY
                            .REQUIRED_ACTIVE_SECONDS;

                    const completedNow =
                        !wasCompleted &&
                        completed;

                    const nextSessionStatus =
                        heartbeatActive
                            ? ACTIVITY
                                .SESSION_STATUS
                                .ACTIVE
                            : ACTIVITY
                                .SESSION_STATUS
                                .PAUSED;

                    const claimsOrKeepsLease =
                        heartbeatActive;

                    const activityUpdate = {
                        uid:
                            authenticatedUser.uid,

                        totalActiveSeconds:
                            newTotalActiveSeconds,

                        requiredActiveSeconds:
                            ACTIVITY
                                .REQUIRED_ACTIVE_SECONDS,

                        requiredActiveDays:
                            ACTIVITY
                                .REQUIRED_ACTIVE_DAYS,

                        completed,

                        currentSessionId:
                            claimsOrKeepsLease
                                ? heartbeat.sessionId
                                : null,

                        currentSessionActive:
                            claimsOrKeepsLease,

                        currentSessionStartedAt:
                            claimsOrKeepsLease
                                ? (
                                    ownsCurrentLease &&
                                    activity
                                        .currentSessionStartedAt
                                        ? activity
                                            .currentSessionStartedAt
                                        : timestamp
                                )
                                : null,

                        lastHeartbeatAt:
                            timestamp,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    if (
                        completedNow &&
                        !activity.completedAt
                    ) {
                        activityUpdate.completedAt =
                            timestamp;
                    }

                    const sessionUpdate = {
                        userId:
                            authenticatedUser.uid,

                        uid:
                            authenticatedUser.uid,

                        sessionId:
                            heartbeat.sessionId,

                        status:
                            nextSessionStatus,

                        active:
                            heartbeat.active,

                        visible:
                            heartbeat.visible,

                        online:
                            heartbeat.online,

                        blockedReason:
                            "",

                        lastClientTimestamp:
                            heartbeat
                                .clientTimestamp,

                        lastHeartbeatAt:
                            timestamp,

                        heartbeatCount:
                            toNonNegativeInteger(
                                session
                                    .heartbeatCount
                            ) + 1,

                        totalCreditedSeconds:
                            toNonNegativeInteger(
                                session
                                    .totalCreditedSeconds
                            ) +
                            creditResult
                                .creditedSeconds,

                        lastCreditedSeconds:
                            creditResult
                                .creditedSeconds,

                        lastCreditReason:
                            creditResult.reason,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    if (
                        !sessionSnapshot.exists
                    ) {
                        sessionUpdate.createdAt =
                            timestamp;

                        sessionUpdate.startedAt =
                            timestamp;
                    }

                    let referralUpdate =
                        null;

                    let referralQualified =
                        false;

                    let referralStatsRef =
                        null;

                    let referralStatsSnapshot =
                        null;

                    if (
                        referralSnapshot.exists
                    ) {
                        const referral =
                            referralSnapshot.data() ||
                            {};

                        const referralStatus =
                            toSafeString(
                                referral.status
                            );

                        const referrerUid =
                            toSafeString(
                                referral
                                    .referrerUid
                            );

                        referralUpdate = {
                            activeSeconds:
                                newTotalActiveSeconds,

                            requiredActiveSeconds:
                                ACTIVITY
                                    .REQUIRED_ACTIVE_SECONDS,

                            usingTimeCompleted:
                                completed,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SYSTEM
                                    .SCHEMA_VERSION
                        };

                        if (
                            isLegacyQualifiedStatus(
                                referralStatus
                            )
                        ) {
                            referralUpdate.status =
                                REFERRAL.STATUS
                                    .QUALIFIED;

                            referralUpdate.eligible =
                                true;

                            referralUpdate.qualifiedAt =
                                referral.qualifiedAt ||
                                referral.eligibleAt ||
                                timestamp;
                        } else if (
                            completed &&
                            referral.mobileAdded ===
                                true &&
                            isPendingReferralStatus(
                                referralStatus
                            ) &&
                            referrerUid
                        ) {
                            referralStatsRef =
                                getReferralStatsReference(
                                    database,
                                    referrerUid
                                );

                            referralStatsSnapshot =
                                await transaction.get(
                                    referralStatsRef
                                );

                            referralUpdate.status =
                                REFERRAL.STATUS
                                    .QUALIFIED;

                            referralUpdate.eligible =
                                true;

                            referralUpdate.qualifiedAt =
                                referral.qualifiedAt ||
                                timestamp;

                            referralQualified =
                                true;
                        }
                    }

                    /*
                     * All required reads are complete.
                     */

                    transaction.set(
                        activityRef,
                        activityUpdate,
                        {
                            merge:
                                true
                        }
                    );

                    transaction.set(
                        sessionRef,
                        sessionUpdate,
                        {
                            merge:
                                true
                        }
                    );

                    if (referralUpdate) {
                        transaction.set(
                            referralRef,
                            referralUpdate,
                            {
                                merge:
                                    true
                            }
                        );
                    }

                    if (
                        referralQualified &&
                        referralStatsRef &&
                        referralStatsSnapshot
                    ) {
                        const referral =
                            referralSnapshot.data() ||
                            {};

                        transaction.set(
                            referralStatsRef,
                            createQualifiedReferralStats({
                                referrerUid:
                                    referral
                                        .referrerUid,

                                statsSnapshot:
                                    referralStatsSnapshot,

                                timestamp
                            }),
                            {
                                merge:
                                    true
                            }
                        );
                    }

                    return {
                        creditedSeconds:
                            creditResult
                                .creditedSeconds,

                        reason:
                            creditResult.reason,

                        activity:
                            createActivitySummary({
                                ...activity,
                                ...activityUpdate
                            }),

                        session: {
                            sessionId:
                                heartbeat.sessionId,

                            status:
                                nextSessionStatus,

                            active:
                                heartbeatActive,

                            blocked:
                                false,

                            totalCreditedSeconds:
                                sessionUpdate
                                    .totalCreditedSeconds
                        },

                        referralQualified
                    };
                }
            );

        return {
            success:
                true,

            ...result
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Using Time could not be recorded."
        );
    }
}

/* =========================================================
   GET CURRENT USER ACTIVITY
========================================================= */

async function getMyActivity(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const database =
            getFirestore();

        const [
            profileSnapshot,
            activitySnapshot
        ] = await Promise.all([
            getProfileReference(
                database,
                authenticatedUser.uid
            ).get(),

            getActivityReference(
                database,
                authenticatedUser.uid
            ).get()
        ]);

        if (
            !profileSnapshot.exists ||
            !activitySnapshot.exists
        ) {
            throw createHttpsError(
                ERROR_CODES.NOT_FOUND,
                "Using Time information does not exist."
            );
        }

        return {
            success:
                true,

            activity:
                createActivitySummary(
                    activitySnapshot.data() ||
                    {}
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Using Time information could not be loaded."
        );
    }
}

/* =========================================================
   CLOSE ACTIVITY SESSION

   Called during logout or explicit session shutdown.
   Closing is idempotent and releases the active-session lease.
========================================================= */

async function closeActivitySession(
    request
) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const sessionId =
            validateSessionId(
                request?.data
                    ?.sessionId
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const activityRef =
            getActivityReference(
                database,
                authenticatedUser.uid
            );

        const sessionRef =
            getActivitySessionReference(
                database,
                authenticatedUser.uid,
                sessionId
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const [
                        activitySnapshot,
                        sessionSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            activityRef
                        ),

                        transaction.get(
                            sessionRef
                        )
                    ]);

                    if (
                        !sessionSnapshot.exists
                    ) {
                        return {
                            closed:
                                false,

                            alreadyClosed:
                                true,

                            reason:
                                "session_not_found"
                        };
                    }

                    const session =
                        sessionSnapshot.data() ||
                        {};

                    const sessionOwnerUid =
                        toSafeString(
                            session.userId ||
                            session.uid
                        );

                    if (
                        sessionOwnerUid &&
                        sessionOwnerUid !==
                            authenticatedUser.uid
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This activity session belongs to another user."
                        );
                    }

                    if (
                        isSessionStatusClosed(
                            session.status
                        )
                    ) {
                        return {
                            closed:
                                false,

                            alreadyClosed:
                                true,

                            reason:
                                "already_closed"
                        };
                    }

                    transaction.set(
                        sessionRef,
                        {
                            status:
                                ACTIVITY
                                    .SESSION_STATUS
                                    .CLOSED,

                            active:
                                false,

                            visible:
                                false,

                            online:
                                false,

                            closedAt:
                                timestamp,

                            lastHeartbeatAt:
                                timestamp,

                            updatedAt:
                                timestamp
                        },
                        {
                            merge:
                                true
                        }
                    );

                    if (
                        activitySnapshot.exists
                    ) {
                        const activity =
                            activitySnapshot.data() ||
                            {};

                        if (
                            toSafeString(
                                activity
                                    .currentSessionId
                            ) === sessionId
                        ) {
                            transaction.set(
                                activityRef,
                                {
                                    currentSessionId:
                                        null,

                                    currentSessionActive:
                                        false,

                                    currentSessionStartedAt:
                                        null,

                                    lastHeartbeatAt:
                                        timestamp,

                                    updatedAt:
                                        timestamp
                                },
                                {
                                    merge:
                                        true
                                }
                            );
                        }
                    }

                    return {
                        closed:
                            true,

                        alreadyClosed:
                            false,

                        reason:
                            "session_closed"
                    };
                }
            );

        return {
            success:
                true,

            sessionId,

            ...result
        };
    } catch (error) {
        throwHttpsError(
            error,
            "The activity session could not be closed."
        );
    }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    recordActivityHeartbeat,
    getMyActivity,
    closeActivitySession,

    createActivitySummary,
    calculateElapsedSeconds
});
