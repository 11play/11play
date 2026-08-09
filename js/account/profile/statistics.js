"use strict";

/* =========================================================
   11PLAY — PROFILE STATISTICS
   File: js/account/profile/statistics.js

   Responsibilities:
   - Combine server-authoritative account statistics
   - Read Activity, Referral, Wallet, Reward and Withdrawal data
   - Provide one normalized snapshot to the Profile UI
   - Refresh automatically when linked modules update
   - Prevent statistics from one account appearing for another
   - Never write statistics directly to Firebase
   - Never modify wallet, referral, reward or withdrawal data

   Final Activity model:
   - 7 different Bangladesh calendar days
   - Minimum 2 eligible active hours (120 minutes) per day
   - 15-minute server-authorized checkpoints
   - A day counts only after the full daily requirement is completed
   - ActivityDB / Firestore remains authoritative
   - Browser clock never creates eligible time

   Device model:
   - Web-device binding is an anti-abuse signal only
   - This module only displays/normalizes device state
   - It never creates or changes a device binding
========================================================= */

(function initializeProfileStatistics(
    window
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

    const REWARD_PER_REFERRAL =
        1000;

    const EVENT_UPDATED =
        "profile:statistics-updated";

    const RELATED_EVENTS =
        Object.freeze([
            "activity:updated",
            "activity:state-changed",
            "activity:access-blocked",

            "referral:updated",

            "wallet:updated",
            "wallet:transactions-updated",

            "reward:updated",
            "reward:transactions-updated",

            "withdrawal:updated",
            "withdrawal:summary-updated",

            "profile:data-changed",
            "profile:updated",
            "PROFILE_UPDATED",
            "profile:mobile-saved",

            "auth:state-changed",
            "profile:auth-changed"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const state = {
        initialized:
            false,

        statistics:
            createEmptyStatistics(),

        updatedAt:
            null
    };

    let boundEvents =
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

    /* =====================================================
       FORMATTING
    ===================================================== */

    function formatMoney(
        amount,
        options = {}
    ) {
        const includeSymbol =
            options.includeSymbol !==
            false;

        const value =
            toNonNegativeInteger(
                amount
            );

        const formatted =
            new Intl.NumberFormat(
                "en-BD",
                {
                    minimumFractionDigits:
                        0,

                    maximumFractionDigits:
                        0
                }
            ).format(
                value
            );

        return includeSymbol
            ? `৳${formatted}`
            : formatted;
    }

    function formatActiveDays(
        value,
        options = {}
    ) {
        const activeDays =
            toNonNegativeInteger(
                value
            );

        const compact =
            options.compact ===
            true;

        return {
            days:
                activeDays,

            value:
                activeDays,

            text:
                compact
                    ? `${activeDays}d`
                    : `${activeDays} active day${
                        activeDays === 1
                            ? ""
                            : "s"
                    }`
        };
    }

    function formatDuration(
        totalSeconds
    ) {
        /*
         * Compatibility helper only.
         * It formats the supplied duration and never participates
         * in referral/activity qualification.
         */

        const normalizedSeconds =
            toNonNegativeInteger(
                totalSeconds
            );

        const days =
            Math.floor(
                normalizedSeconds /
                86400
            );

        const hours =
            Math.floor(
                (
                    normalizedSeconds %
                    86400
                ) /
                3600
            );

        const minutes =
            Math.floor(
                (
                    normalizedSeconds %
                    3600
                ) /
                60
            );

        const seconds =
            normalizedSeconds %
            60;

        return {
            days,
            hours,
            minutes,
            seconds,

            text:
                `${days}d ${hours}h ${minutes}m ${seconds}s`
        };
    }

    function formatMinutes(
        totalSeconds
    ) {
        const seconds =
            toNonNegativeInteger(
                totalSeconds
            );

        const minutes =
            Math.floor(
                seconds /
                60
            );

        return {
            seconds,
            minutes,
            text:
                `${minutes} min`
        };
    }

    /* =====================================================
       EMPTY STATISTICS
    ===================================================== */

    function createEmptyStatistics(
        uid = ""
    ) {
        return {
            uid:
                toSafeString(
                    uid
                ),

            authenticated:
                false,

            accountType:
                "guest",

            activity: {
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

                activityPolicyVersion:
                    ACTIVITY_POLICY_VERSION,

                checkpointSeconds:
                    CHECKPOINT_SECONDS,

                totalActiveSeconds:
                    0,

                requiredActiveSeconds:
                    REQUIRED_ACTIVE_DAYS *
                    REQUIRED_DAILY_SECONDS,

                remainingActiveSeconds:
                    REQUIRED_ACTIVE_DAYS *
                    REQUIRED_DAILY_SECONDS
            },

            referrals: {
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
            },

            wallet: {
                availableBalance:
                    0,

                heldBalance:
                    0,

                totalBalance:
                    0,

                totalEarned:
                    0,

                totalWithdrawn:
                    0
            },

            rewards: {
                creditedReward:
                    0,

                pendingPotentialReward:
                    0,

                qualifiedPotentialReward:
                    0,

                rewardPerReferral:
                    REWARD_PER_REFERRAL
            },

            withdrawals: {
                total:
                    0,

                pending:
                    0,

                approved:
                    0,

                rejected:
                    0,

                /*
                 * Historical compatibility only.
                 * New withdrawal cancellation is disabled elsewhere.
                 */
                cancelled:
                    0,

                totalRequestedAmount:
                    0
            },

            updatedAt:
                null
        };
    }

    /* =====================================================
       CURRENT PROFILE
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

                if (profile) {
                    return profile;
                }
            } catch {
                /*
                 * Continue to ProfileService.
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

    function getCurrentUid() {
        return toSafeString(
            readCurrentProfile()
                ?.uid
        );
    }

    /* =====================================================
       MODULE STATE READER
    ===================================================== */

    function readModuleState(
        moduleName
    ) {
        const module =
            window[moduleName];

        if (
            !module ||
            typeof module.getState !==
                "function"
        ) {
            return null;
        }

        try {
            const moduleState =
                module.getState();

            return isPlainObject(
                moduleState
            )
                ? moduleState
                : null;
        } catch {
            return null;
        }
    }

    function stateBelongsToUser(
        moduleState,
        uid,
        fallbackUid = ""
    ) {
        if (!uid) {
            return false;
        }

        const stateUid =
            toSafeString(
                moduleState
                    ?.currentUser
                    ?.uid ||
                fallbackUid
            );

        return (
            !stateUid ||
            stateUid === uid
        );
    }

    /* =====================================================
       ACTIVITY NORMALIZATION
    ===================================================== */

    function normalizeActivity(
        source
    ) {
        const activity =
            isPlainObject(source)
                ? source
                : {};

        const requiredActiveDays =
            Math.max(
                1,
                toNonNegativeInteger(
                    activity
                        .requiredActiveDays,
                    REQUIRED_ACTIVE_DAYS
                ) ||
                REQUIRED_ACTIVE_DAYS
            );

        const requiredDailySeconds =
            Math.max(
                60,
                toNonNegativeInteger(
                    activity
                        .requiredDailySeconds,
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
                activity
                    .eligibleActiveDays ??
                activity
                    .activeDays ??
                activity
                    .totalActiveDays ??
                activity
                    .completedActiveDays
            );

        /*
         * Important migration safety:
         * Do NOT reinterpret old 24-hour second counters as the new
         * 2-hour-per-day policy. FunctionsClient/Rules own migration.
         * Only an explicit completed=true legacy state maps to 7 days.
         */
        if (
            suppliedActiveDays === 0 &&
            activity.completed ===
                true
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

        const currentDaySeconds =
            clamp(
                toNonNegativeInteger(
                    activity
                        .currentDaySeconds ??
                    activity
                        .todayActiveSeconds
                ),
                0,
                requiredDailySeconds
            );

        const currentDayCompleted =
            activity
                .currentDayCompleted ===
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

        const remainingTodaySeconds =
            currentDayCompleted
                ? 0
                : Math.max(
                    0,
                    requiredDailySeconds -
                    todayActiveSeconds
                );

        const remainingTodayMinutes =
            remainingTodaySeconds > 0
                ? Math.ceil(
                    remainingTodaySeconds /
                    60
                )
                : 0;

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

        const calculatedProgress =
            requiredActiveDays > 0
                ? (
                    activeDays /
                    requiredActiveDays
                ) *
                100
                : 100;

        const completed =
            activity.completed ===
                true ||
            activity.activityCompleted ===
                true ||
            activity.requirementMet ===
                true ||
            activeDays >=
                requiredActiveDays;

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

        const deviceId =
            toSafeString(
                activity.deviceId
            );

        const deviceConflict =
            activity.deviceConflict ===
                true ||
            toSafeString(
                activity.deviceStatus
            ).toLowerCase() ===
                "conflict" ||
            toSafeString(
                activity.reason
            ).toLowerCase() ===
                "device_mismatch";

        const deviceBound =
            activity.deviceBound ===
                true ||
            Boolean(deviceId);

        return {
            deviceId,

            deviceBound,

            deviceConflict,

            activeDays,

            eligibleActiveDays:
                activeDays,

            requiredActiveDays,

            remainingActiveDays,

            currentDaySeconds,

            todayActiveSeconds,

            todayActiveMinutes,

            requiredDailySeconds,

            requiredDailyMinutes,

            remainingTodaySeconds,

            remainingTodayMinutes,

            currentDayStartedAt:
                activity
                    .currentDayStartedAt ||
                null,

            currentDayCompleted,

            lastCheckpointAt:
                activity
                    .lastCheckpointAt ||
                null,

            dailyProgressPercent,

            progressPercent:
                completed
                    ? 100
                    : clamp(
                        calculatedProgress,
                        0,
                        100
                    ),

            completed,

            completedAt:
                activity.completedAt ||
                null,

            lastActiveAt:
                activity.lastActiveAt ||
                activity.lastEligibleAt ||
                activity.lastCheckpointAt ||
                activity.lastActivityAt ||
                null,

            activityPolicyVersion:
                toNonNegativeInteger(
                    activity
                        .activityPolicyVersion,
                    ACTIVITY_POLICY_VERSION
                ) ||
                ACTIVITY_POLICY_VERSION,

            checkpointSeconds:
                toNonNegativeInteger(
                    activity
                        .checkpointSeconds,
                    CHECKPOINT_SECONDS
                ) ||
                CHECKPOINT_SECONDS,

            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds
        };
    }

    /* =====================================================
       REFERRAL NORMALIZATION
    ===================================================== */

    function normalizeReferrals(
        source
    ) {
        const stats =
            isPlainObject(source)
                ? source
                : {};

        return {
            total:
                toNonNegativeInteger(
                    stats.total
                ),

            pending:
                toNonNegativeInteger(
                    stats.pending ??
                    stats.observing
                ),

            qualified:
                toNonNegativeInteger(
                    stats.qualified ??
                    stats.pendingReview
                ),

            approved:
                toNonNegativeInteger(
                    stats.approved
                ),

            rejected:
                toNonNegativeInteger(
                    stats.rejected ??
                    stats.invalid
                ),

            rewarded:
                toNonNegativeInteger(
                    stats.rewarded ??
                    stats.valid
                ),

            totalReward:
                toNonNegativeInteger(
                    stats.totalReward
                )
        };
    }

    /* =====================================================
       WALLET NORMALIZATION
    ===================================================== */

    function normalizeWallet(
        source
    ) {
        const wallet =
            isPlainObject(source)
                ? source
                : {};

        const availableBalance =
            toNonNegativeInteger(
                wallet.availableBalance
            );

        const heldBalance =
            toNonNegativeInteger(
                wallet.heldBalance
            );

        return {
            availableBalance,

            heldBalance,

            totalBalance:
                safeAdd(
                    availableBalance,
                    heldBalance
                ),

            totalEarned:
                toNonNegativeInteger(
                    wallet.totalEarned
                ),

            totalWithdrawn:
                toNonNegativeInteger(
                    wallet.totalWithdrawn
                )
        };
    }

    /* =====================================================
       REWARD NORMALIZATION
    ===================================================== */

    function normalizeRewards(
        source
    ) {
        const rewards =
            isPlainObject(source)
                ? source
                : {};

        return {
            creditedReward:
                toNonNegativeInteger(
                    rewards.creditedReward ??
                    rewards.approvedReward
                ),

            pendingPotentialReward:
                toNonNegativeInteger(
                    rewards
                        .pendingPotentialReward ??
                    rewards
                        .observingPotentialReward
                ),

            qualifiedPotentialReward:
                toNonNegativeInteger(
                    rewards
                        .qualifiedPotentialReward ??
                    rewards
                        .pendingReviewReward
                ),

            rewardPerReferral:
                toNonNegativeInteger(
                    rewards.rewardPerReferral ??
                    rewards
                        .rewardPerValidReferral,
                    REWARD_PER_REFERRAL
                ) ||
                REWARD_PER_REFERRAL
        };
    }

    /* =====================================================
       WITHDRAWAL NORMALIZATION
    ===================================================== */

    function normalizeWithdrawals(
        source
    ) {
        const summary =
            isPlainObject(source)
                ? source
                : {};

        return {
            total:
                toNonNegativeInteger(
                    summary.total
                ),

            pending:
                toNonNegativeInteger(
                    summary.pending ??
                    summary.processing
                ),

            approved:
                toNonNegativeInteger(
                    summary.approved ??
                    summary.successful
                ),

            rejected:
                toNonNegativeInteger(
                    summary.rejected
                ),

            /*
             * Historical compatibility only.
             * New user cancellation is disabled by the final flow.
             */
            cancelled:
                toNonNegativeInteger(
                    summary.cancelled ??
                    summary.canceled
                ),

            totalRequestedAmount:
                toNonNegativeInteger(
                    summary
                        .totalRequestedAmount
                )
        };
    }

    /* =====================================================
       STATISTICS CREATION
    ===================================================== */

    function createStatistics(
        profile = null
    ) {
        const currentProfile =
            profile ||
            readCurrentProfile() ||
            {};

        const uid =
            toSafeString(
                currentProfile.uid ||
                currentProfile.userId
            );

        if (!uid) {
            return createEmptyStatistics();
        }

        const activityState =
            readModuleState(
                "ActivityDB"
            );

        const referralState =
            readModuleState(
                "ReferralDB"
            );

        const walletState =
            readModuleState(
                "WalletDB"
            );

        const rewardState =
            readModuleState(
                "RewardDB"
            );

        const withdrawalState =
            readModuleState(
                "WithdrawDB"
            );

        const activitySource =
            stateBelongsToUser(
                activityState,
                uid,
                activityState
                    ?.activity
                    ?.uid ||
                activityState
                    ?.activity
                    ?.userId
            )
                ? activityState
                    ?.activity
                : null;

        const referralSource =
            stateBelongsToUser(
                referralState,
                uid,
                referralState
                    ?.stats
                    ?.uid
            )
                ? referralState
                    ?.stats
                : null;

        const walletSource =
            stateBelongsToUser(
                walletState,
                uid,
                walletState
                    ?.wallet
                    ?.uid ||
                walletState
                    ?.wallet
                    ?.userId
            )
                ? walletState
                    ?.wallet
                : null;

        const rewardSource =
            stateBelongsToUser(
                rewardState,
                uid,
                rewardState
                    ?.summary
                    ?.uid ||
                rewardState
                    ?.summary
                    ?.userId
            )
                ? rewardState
                    ?.summary
                : null;

        const withdrawalSource =
            stateBelongsToUser(
                withdrawalState,
                uid,
                withdrawalState
                    ?.summary
                    ?.uid ||
                withdrawalState
                    ?.summary
                    ?.userId
            )
                ? withdrawalState
                    ?.summary
                : null;

        const updatedAt =
            new Date()
                .toISOString();

        return {
            uid,

            authenticated:
                currentProfile
                    .isAuthenticated ===
                    true ||
                currentProfile
                    .authenticated ===
                    true ||
                Boolean(uid),

            accountType:
                (
                    toSafeString(
                        currentProfile
                            .accountType
                    ) ||
                    "google"
                ).toLowerCase(),

            activity:
                normalizeActivity(
                    activitySource ||
                    currentProfile
                        .usingTime ||
                    currentProfile
                        .activity
                ),

            referrals:
                normalizeReferrals(
                    referralSource ||
                    currentProfile
                        .referrals ||
                    currentProfile
                        .referralStats
                ),

            wallet:
                normalizeWallet(
                    walletSource ||
                    currentProfile.wallet
                ),

            rewards:
                normalizeRewards(
                    rewardSource
                ),

            withdrawals:
                normalizeWithdrawals(
                    withdrawalSource
                ),

            updatedAt
        };
    }

    /* =====================================================
       FORMATTED SNAPSHOT
    ===================================================== */

    function createFormattedStatistics(
        statistics
    ) {
        const source =
            statistics ||
            createEmptyStatistics();

        const activeDays =
            formatActiveDays(
                source.activity
                    .activeDays
            );

        const remainingActiveDays =
            formatActiveDays(
                source.activity
                    .remainingActiveDays
            );

        const todayMinutes =
            formatMinutes(
                source.activity
                    .todayActiveSeconds
            );

        const remainingTodayMinutes =
            formatMinutes(
                source.activity
                    .remainingTodaySeconds
            );

        let activityStatusText;

        if (
            source.activity
                .completed
        ) {
            activityStatusText =
                "Activity requirement completed";
        } else if (
            source.activity
                .deviceConflict
        ) {
            activityStatusText =
                "Device verification required";
        } else if (
            source.activity
                .currentDayCompleted
        ) {
            activityStatusText =
                `${source.activity.remainingActiveDays} eligible active day${
                    source.activity
                        .remainingActiveDays ===
                    1
                        ? ""
                        : "s"
                } remaining • Today's 120-minute requirement completed`;
        } else {
            activityStatusText =
                `${source.activity.remainingActiveDays} eligible active day${
                    source.activity
                        .remainingActiveDays ===
                    1
                        ? ""
                        : "s"
                } remaining • Today ${source.activity.todayActiveMinutes}/${source.activity.requiredDailyMinutes} min`;
        }

        return {
            ...cloneValue(
                source
            ),

            activity: {
                ...source.activity,

                activeDaysText:
                    activeDays.text,

                remainingActiveDaysText:
                    remainingActiveDays
                        .text,

                progressText:
                    `${Math.floor(
                        source.activity
                            .progressPercent
                    )}%`,

                dailyProgressText:
                    `${Math.floor(
                        source.activity
                            .dailyProgressPercent
                    )}%`,

                todayActiveMinutesText:
                    `${source.activity.todayActiveMinutes}/${source.activity.requiredDailyMinutes} min`,

                remainingTodayMinutesText:
                    `${source.activity.remainingTodayMinutes} min`,

                requirementText:
                    `${source.activity.activeDays}/${source.activity.requiredActiveDays} eligible active days • ${source.activity.requiredDailyMinutes} min/day`,

                statusText:
                    activityStatusText,

                deviceStatusText:
                    source.activity
                        .deviceConflict
                        ? "Device conflict"
                        : (
                            source.activity
                                .deviceBound
                                ? "Device bound"
                                : "Device pending"
                        ),

                /*
                 * Compatibility aliases.
                 * These are formatting objects only and do not
                 * participate in activity qualification.
                 */
                totalDuration:
                    formatDuration(
                        source.activity
                            .totalActiveSeconds
                    ),

                remainingDuration:
                    formatDuration(
                        source.activity
                            .remainingActiveSeconds
                    ),

                todayDuration:
                    todayMinutes,

                remainingTodayDuration:
                    remainingTodayMinutes
            },

            referrals: {
                ...source.referrals,

                totalRewardText:
                    formatMoney(
                        source.referrals
                            .totalReward
                    )
            },

            wallet: {
                ...source.wallet,

                availableBalanceText:
                    formatMoney(
                        source.wallet
                            .availableBalance
                    ),

                heldBalanceText:
                    formatMoney(
                        source.wallet
                            .heldBalance
                    ),

                totalBalanceText:
                    formatMoney(
                        source.wallet
                            .totalBalance
                    ),

                totalEarnedText:
                    formatMoney(
                        source.wallet
                            .totalEarned
                    ),

                totalWithdrawnText:
                    formatMoney(
                        source.wallet
                            .totalWithdrawn
                    )
            },

            rewards: {
                ...source.rewards,

                creditedRewardText:
                    formatMoney(
                        source.rewards
                            .creditedReward
                    ),

                pendingPotentialRewardText:
                    formatMoney(
                        source.rewards
                            .pendingPotentialReward
                    ),

                qualifiedPotentialRewardText:
                    formatMoney(
                        source.rewards
                            .qualifiedPotentialReward
                    )
            },

            withdrawals: {
                ...source.withdrawals,

                totalRequestedAmountText:
                    formatMoney(
                        source.withdrawals
                            .totalRequestedAmount
                    )
            }
        };
    }

    /* =====================================================
       EVENTS AND SUBSCRIBERS
    ===================================================== */

    function getStatistics() {
        return cloneValue(
            state.statistics
        );
    }

    function getFormattedStatistics() {
        return createFormattedStatistics(
            state.statistics
        );
    }

    function notify() {
        const snapshot =
            getFormattedStatistics();

        listeners.forEach(
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[ProfileStatistics] Subscriber failed.",
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
        profile = null
    ) {
        state.statistics =
            createStatistics(
                profile
            );

        state.updatedAt =
            state.statistics
                .updatedAt;

        return notify();
    }

    function reset() {
        state.statistics =
            createEmptyStatistics();

        state.updatedAt =
            null;

        return notify();
    }

    function handleRelatedUpdate(
        event
    ) {
        const eventUser =
            event?.detail?.user ||
            event?.detail?.profile ||
            null;

        const eventUid =
            toSafeString(
                eventUser?.uid ||
                event?.detail?.uid
            );

        if (
            (
                event?.type ===
                    "auth:state-changed" ||
                event?.type ===
                    "profile:auth-changed"
            ) &&
            !eventUid &&
            !getCurrentUid()
        ) {
            reset();

            return;
        }

        refresh();
    }

    function bindEvents() {
        if (boundEvents) {
            return true;
        }

        boundEvents =
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

    function unbindEvents() {
        if (!boundEvents) {
            return true;
        }

        boundEvents =
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

    function init() {
        if (
            state.initialized
        ) {
            return getFormattedStatistics();
        }

        state.initialized =
            true;

        bindEvents();

        return refresh();
    }

    function destroy() {
        unbindEvents();

        listeners.clear();

        state.initialized =
            false;

        state.statistics =
            createEmptyStatistics();

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
                "ProfileStatistics subscriber must be a function."
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
                getFormattedStatistics()
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

    window.ProfileStatistics =
        Object.freeze({
            init,
            destroy,
            refresh,
            reset,
            subscribe,

            createStatistics,
            createEmptyStatistics,

            getStatistics,

            getStats:
                getStatistics,

            getFormattedStatistics,

            normalizeActivity,

            formatMoney,
            formatActiveDays,
            formatDuration,
            formatMinutes,

            isInitialized() {
                return state.initialized;
            },

            getUpdatedAt() {
                return state.updatedAt;
            },

            REQUIRED_ACTIVE_DAYS,
            REQUIRED_DAILY_SECONDS,
            REQUIRED_DAILY_MINUTES,
            CHECKPOINT_SECONDS,
            ACTIVITY_POLICY_VERSION
        });
})(
    window
);