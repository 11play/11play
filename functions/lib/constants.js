"use strict";

/* =========================================================
   11PLAY — PROFILE SYSTEM CONSTANTS
   File: functions/lib/constants.js

   Profile, activity, referral, reward, wallet,
   withdrawal এবং admin system-এর shared constants।

   এই ফাইলের value পরিবর্তন করলে সংশ্লিষ্ট backend,
   frontend এবং Firestore rules-এও একই contract
   অনুসরণ করতে হবে।
========================================================= */

/* =========================================================
   FIRESTORE COLLECTIONS
========================================================= */

const COLLECTIONS = Object.freeze({
    USERS: "profileUsers",

    REFERRAL_CODES: "profileReferralCodes",
    REFERRALS: "profileReferrals",
    REFERRAL_STATS: "profileReferralStats",

    ACTIVITY: "profileActivity",
    ACTIVITY_SESSIONS: "profileActivitySessions",

    REWARD_EVENTS: "profileRewardEvents",

    WALLETS: "profileWallets",
    WALLET_TRANSACTIONS: "profileWalletTransactions",

    WITHDRAWALS: "profileWithdrawals",

    AUDIT_LOGS: "profileAuditLogs",
    SETTINGS: "profileSettings"
});

/* =========================================================
   PROFILE
========================================================= */

const PROFILE_STATUS = Object.freeze({
    ACTIVE: "active",
    SUSPENDED: "suspended",
    BLOCKED: "blocked"
});

const ACCOUNT_TYPE = Object.freeze({
    GOOGLE: "google",
    GUEST: "guest"
});

/* =========================================================
   REFERRAL
========================================================= */

const REFERRAL = Object.freeze({
    REWARD_AMOUNT: 1000,

    CODE_LENGTH: 8,

    QUERY_PARAMETER: "ref",

    STORAGE_KEY: "11play_pending_referral_code",

    STATUS: Object.freeze({
        CAPTURED: "captured",
        PENDING: "pending",
        QUALIFIED: "qualified",
        APPROVED: "approved",
        REJECTED: "rejected",
        REWARDED: "rewarded"
    })
});

/* =========================================================
   REFERRAL ELIGIBILITY
========================================================= */

const REFERRAL_REQUIREMENTS = Object.freeze({
    GOOGLE_CONNECTED: true,
    MOBILE_ADDED: true,
    USING_TIME_COMPLETED: true,
    ADMIN_APPROVAL_REQUIRED: true
});

/* =========================================================
   ACTIVITY / USING TIME

   ৭ দিন cumulative active time:
   7 × 24 × 60 × 60 = 604,800 seconds
========================================================= */

const ACTIVITY = Object.freeze({
    REQUIRED_ACTIVE_DAYS: 7,

    REQUIRED_ACTIVE_SECONDS:
        7 * 24 * 60 * 60,

    HEARTBEAT_INTERVAL_SECONDS: 60,

    MAX_CREDIT_PER_HEARTBEAT_SECONDS: 90,

    INACTIVITY_TIMEOUT_SECONDS: 120,

    SESSION_STATUS: Object.freeze({
        ACTIVE: "active",
        PAUSED: "paused",
        CLOSED: "closed"
    })
});

/* =========================================================
   REWARD
========================================================= */

const REWARD = Object.freeze({
    TYPE: Object.freeze({
        REFERRAL: "referral",
        ADMIN_BONUS: "admin_bonus",
        ADJUSTMENT: "adjustment"
    }),

    STATUS: Object.freeze({
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
        CREDITED: "credited",
        REVERSED: "reversed"
    })
});

/* =========================================================
   WALLET
========================================================= */

const WALLET = Object.freeze({
    SUPPORTED_PROVIDERS: Object.freeze([
        "bkash",
        "nagad",
        "rocket"
    ]),

    TRANSACTION_TYPE: Object.freeze({
        REFERRAL_REWARD:
            "referral_reward",

        WITHDRAW_HOLD:
            "withdraw_hold",

        WITHDRAW_SUCCESS:
            "withdraw_success",

        WITHDRAW_REFUND:
            "withdraw_refund",

        ADMIN_ADJUSTMENT:
            "admin_adjustment"
    }),

    TRANSACTION_DIRECTION: Object.freeze({
        CREDIT: "credit",
        DEBIT: "debit"
    }),

    TRANSACTION_STATUS: Object.freeze({
        PENDING: "pending",
        COMPLETED: "completed",
        REVERSED: "reversed",
        FAILED: "failed"
    })
});

/* =========================================================
   WITHDRAWAL

   Withdrawal business rules:
   - Minimum withdrawal amount: ৳1000
   - Amount must be a multiple of ৳1000
========================================================= */

const WITHDRAWAL = Object.freeze({
    MINIMUM_AMOUNT: 1000,

    AMOUNT_MULTIPLE: 1000,

    STATUS: Object.freeze({
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
        CANCELLED: "cancelled"
    })
});

/* =========================================================
   ADMIN

   একমাত্র স্থায়ী verified Google account Admin হবে:
   casinobuzzbd@gmail.com

   Admin email functions/lib/security.js-এ স্থায়ীভাবে
   নির্ধারিত। Environment variable, custom claim,
   Firestore role অথবা terminal command দিয়ে Admin account
   পরিবর্তন বা নতুন Admin যোগ করা যাবে না।

   কোনো Super Admin থাকবে না।
========================================================= */

const ADMIN = Object.freeze({
    ROLE: "admin",

    ACTION: Object.freeze({
        REFERRAL_APPROVED:
            "referral_approved",

        REFERRAL_REJECTED:
            "referral_rejected",

        WITHDRAWAL_APPROVED:
            "withdrawal_approved",

        WITHDRAWAL_REJECTED:
            "withdrawal_rejected",

        PROFILE_STATUS_CHANGED:
            "profile_status_changed",

        WALLET_ADJUSTED:
            "wallet_adjusted"
    })
});

/* =========================================================
   ERROR CODES
========================================================= */

const ERROR_CODES = Object.freeze({
    UNAUTHENTICATED:
        "unauthenticated",

    PERMISSION_DENIED:
        "permission-denied",

    INVALID_ARGUMENT:
        "invalid-argument",

    NOT_FOUND:
        "not-found",

    ALREADY_EXISTS:
        "already-exists",

    FAILED_PRECONDITION:
        "failed-precondition",

    ABORTED:
        "aborted",

    INTERNAL:
        "internal"
});

/* =========================================================
   SYSTEM
========================================================= */

const SYSTEM = Object.freeze({
    NAME: "11Play Profile System",
    SCHEMA_VERSION: 2
});

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    COLLECTIONS,

    PROFILE_STATUS,
    ACCOUNT_TYPE,

    REFERRAL,
    REFERRAL_REQUIREMENTS,

    ACTIVITY,
    REWARD,

    WALLET,
    WITHDRAWAL,

    ADMIN,

    ERROR_CODES,
    SYSTEM
});