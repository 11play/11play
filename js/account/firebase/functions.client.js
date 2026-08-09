/* =========================================================
   11PLAY — FIREBASE SPARK CLIENT
   File: js/account/firebase/functions.client.js

   Production contract:
   - GitHub Pages + Firebase Spark only
   - Firebase Authentication + Cloud Firestore directly
   - No Cloud Functions / no Firebase Storage dependency
   - Schema v3
   - Verified Google + unique BD mobile + unique Web Device
   - 7 eligible Bangladesh calendar days
   - Minimum 2 real eligible hours per day
   - 15-minute server-authorized activity checkpoints
   - Referral reward requires Admin approval before wallet credit
   - User cannot cancel/edit/delete a submitted withdrawal
   - Admin withdrawal review is Approve / Reject only
   - Sensitive balance changes are paired with immutable ledger rows

   IMPORTANT:
   - Firestore Security Rules remain the security boundary.
   - Web Device means one browser/site-data installation binding;
     it is not a hardware IMEI/serial identifier.
   - Web Device ID generation requires secure browser cryptography.
   - Web Device binding requires persistent browser localStorage.
   - No weak random fallback is permitted for Web Device identity.
   - Keep this client and firestore.rules on the same contract.
========================================================= */

(() => {
    "use strict";

    const COMPATIBILITY_REGION = "asia-south1";
    const ADMIN_EMAIL = "casinobuzzbd@gmail.com";
    const REFERRAL_BASE_URL = "https://11play.github.io/11play/";

    const SCHEMA_VERSION = 3;
    const ACTIVITY_POLICY_VERSION = 2;

    const COLLECTIONS = Object.freeze({
        USERS: "profileUsers",
        REFERRAL_CODES: "profileReferralCodes",
        MOBILES: "profileMobiles",
        DEVICES: "profileDevices",
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

    const FUNCTION_NAMES = Object.freeze({
        ENSURE_PROFILE: "ensureProfile",
        GET_MY_PROFILE: "getMyProfile",
        GET_PUBLIC_ADMIN_REFERRAL: "getPublicAdminReferral",
        SAVE_MOBILE_NUMBER: "saveMobileNumber",

        RECORD_ACTIVITY_HEARTBEAT: "recordActivityHeartbeat",
        GET_MY_ACTIVITY: "getMyActivity",
        CLOSE_ACTIVITY_SESSION: "closeActivitySession",

        GET_MY_REFERRAL_STATS: "getMyReferralStats",
        GET_MY_REFERRALS: "getMyReferrals",
        GET_PENDING_REFERRALS: "getPendingReferrals",
        APPROVE_REFERRAL: "approveReferral",
        REJECT_REFERRAL: "rejectReferral",

        GET_MY_WALLET: "getMyWallet",
        GET_MY_WALLET_TRANSACTIONS: "getMyWalletTransactions",

        SUBMIT_WITHDRAWAL: "submitWithdrawal",
        CANCEL_WITHDRAWAL: "cancelWithdrawal",
        GET_MY_WITHDRAWALS: "getMyWithdrawals",
        GET_MY_WITHDRAWAL_SUMMARY: "getMyWithdrawalSummary",
        GET_PENDING_WITHDRAWALS: "getPendingWithdrawals",
        APPROVE_WITHDRAWAL: "approveWithdrawal",
        REJECT_WITHDRAWAL: "rejectWithdrawal",

        GET_ADMIN_SESSION: "getAdminSession",
        GET_ADMIN_DASHBOARD_SUMMARY: "getAdminDashboardSummary",
        GET_ADMIN_USERS: "getAdminUsers",
        GET_ADMIN_USER_DETAILS: "getAdminUserDetails",
        UPDATE_ADMIN_USER_PROFILE: "updateAdminUserProfile",
        ADJUST_ADMIN_WALLET: "adjustAdminWallet",
        GET_ADMIN_TRANSACTIONS: "getAdminTransactions",
        GET_ADMIN_AUDIT_LOGS: "getAdminAuditLogs"
    });

    const REFERRAL_STATUS = Object.freeze({
        CAPTURED: "captured",
        PENDING: "pending",
        QUALIFIED: "qualified",
        APPROVED: "approved",
        REJECTED: "rejected",
        REWARDED: "rewarded"
    });

    const WITHDRAWAL_STATUS = Object.freeze({
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
        CANCELLED: "cancelled"
    });

    const PROFILE_STATUS = Object.freeze({
        ACTIVE: "active",
        SUSPENDED: "suspended",
        BLOCKED: "blocked"
    });

    const ACTIVITY = Object.freeze({
        REQUIRED_DAYS:
            7,

        REQUIRED_DAILY_SECONDS:
            2 * 60 * 60,

        CHECKPOINT_SECONDS:
            15 * 60,

        CHECKPOINT_MIN_MS:
            15 * 60 * 1000,

        CHECKPOINT_MAX_MS:
            20 * 60 * 1000,

        REQUIRED_TOTAL_SECONDS:
            7 * 2 * 60 * 60,

        /*
         * Old Schema-v2 compatibility only.
         * It is never used as the new qualification target.
         */
        LEGACY_REQUIRED_SECONDS:
            7 * 24 * 60 * 60,

        POLICY_VERSION:
            ACTIVITY_POLICY_VERSION
    });

    const REWARD_AMOUNT = 1000;
    const MINIMUM_WITHDRAWAL = 1000;
    const WITHDRAWAL_MULTIPLE = 1000;

    const REFERRAL_ALPHABET =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    const DEVICE_STORAGE_KEY =
        "11play:web-device:v1";

    const VALID_PROVIDERS =
        new Set([
            "bkash",
            "nagad",
            "rocket"
        ]);

    const VALID_PROFILE_STATUSES =
        new Set(
            Object.values(
                PROFILE_STATUS
            )
        );

    let firestoreInstance = null;
    let authInstance = null;
    let initialized = false;

    class FunctionsClientError extends Error {
        constructor({
            code = "unknown",
            message =
                "The requested operation could not be completed.",
            details = null,
            functionName = ""
        } = {}) {
            super(message);

            this.name =
                "FunctionsClientError";

            this.code =
                String(
                    code ||
                    "unknown"
                );

            this.details =
                details;

            this.functionName =
                String(
                    functionName ||
                    ""
                );

            this.field =
                details &&
                typeof details ===
                    "object"
                    ? String(
                        details.field ||
                        ""
                    )
                    : "";

            Error.captureStackTrace?.(
                this,
                FunctionsClientError
            );
        }
    }

    /* =====================================================
       GENERIC HELPERS
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

    function normalizeEmail(value) {
        return toSafeString(
            value
        ).toLowerCase();
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

        return (
            Number.isSafeInteger(
                number
            ) &&
            number >= 0
        )
            ? number
            : 0;
    }

    function toPositiveInteger(
        value,
        fallback = 50,
        maximum = 100
    ) {
        const number =
            Math.floor(
                toSafeNumber(
                    value,
                    fallback
                )
            );

        return Math.min(
            maximum,
            Math.max(
                1,
                number ||
                fallback
            )
        );
    }

    function normalizePayload(
        payload
    ) {
        if (
            payload === null ||
            payload === undefined
        ) {
            return {};
        }

        if (
            !isPlainObject(
                payload
            )
        ) {
            throw clientError(
                "invalid-argument",
                "Function data must be a plain object."
            );
        }

        return {
            ...payload
        };
    }

    function clientError(
        code,
        message,
        field = "",
        details = null
    ) {
        return new FunctionsClientError({
            code,
            message,

            details:
                details ||
                (
                    field
                        ? {
                            field
                        }
                        : null
                )
        });
    }

    function dispatchClientEvent(
        eventName,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail
                }
            )
        );
    }

    function normalizeError(
        error,
        functionName = ""
    ) {
        if (
            error instanceof
                FunctionsClientError
        ) {
            if (
                !error.functionName
            ) {
                error.functionName =
                    functionName;
            }

            return error;
        }

        const rawCode =
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
            "unknown";

        const messages = {
            "permission-denied":
                "You do not have permission to complete this operation.",

            "unauthenticated":
                "Google sign-in is required.",

            "invalid-argument":
                "The submitted information is not valid.",

            "failed-precondition":
                "This operation is not available yet.",

            "already-exists":
                "This information has already been saved.",

            "not-found":
                "The requested information was not found.",

            "unavailable":
                "The service is temporarily unavailable. Please try again.",

            "deadline-exceeded":
                "The request took too long. Please try again.",

            "aborted":
                "The operation was interrupted. Please try again."
        };

        return new FunctionsClientError({
            code:
                rawCode,

            message:
                toSafeString(
                    error?.message
                ) ||
                messages[
                    rawCode
                ] ||
                "The requested operation could not be completed.",

            details:
                error?.details ||
                null,

            functionName
        });
    }

    function sanitizeId(
        value,
        field = "id"
    ) {
        const id =
            toSafeString(
                value
            );

        if (
            !id ||
            id.length >
                512 ||
            id.includes("/")
        ) {
            throw clientError(
                "invalid-argument",
                `A valid ${field} is required.`,
                field
            );
        }

        return id;
    }

    function stableHash(
        value
    ) {
        const source =
            toSafeString(
                value
            );

        let first =
            2166136261;

        let second =
            2246822507;

        for (
            let index = 0;
            index <
                source.length;
            index += 1
        ) {
            const code =
                source.charCodeAt(
                    index
                );

            first =
                Math.imul(
                    first ^ code,
                    16777619
                );

            second =
                Math.imul(
                    second ^ code,
                    3266489917
                );
        }

        return (
            `${(first >>> 0)
                .toString(16)
                .padStart(
                    8,
                    "0"
                )}` +

            `${(second >>> 0)
                .toString(16)
                .padStart(
                    8,
                    "0"
                )}`
        );
    }

    function randomId(
        prefix
    ) {
        const id =
            window.crypto
                ?.randomUUID?.() ||
            (
                `${Date.now()
                    .toString(36)}_` +

                `${Math.random()
                    .toString(36)
                    .slice(2)}`
            );

        return (
            `${prefix}_` +

            id.replace(
                /[^a-zA-Z0-9_-]/g,
                ""
            )
        );
    }

    /* =====================================================
       FIREBASE HELPERS
    ===================================================== */

    function assertFirebaseAvailable() {
        if (
            !window.firebase
        ) {
            throw clientError(
                "firebase-not-loaded",
                "Firebase SDK is not loaded."
            );
        }
    }

    function resolveFirestore() {
        if (
            firestoreInstance
        ) {
            return firestoreInstance;
        }

        assertFirebaseAvailable();

        firestoreInstance =
            window.FirebaseConfig
                ?.firestore ||
            window.firebaseDB ||
            null;

        if (
            !firestoreInstance &&
            typeof window.firebase
                .firestore ===
                "function"
        ) {
            firestoreInstance =
                window.firebase
                    .firestore();
        }

        if (
            !firestoreInstance ||
            typeof firestoreInstance
                .collection !==
                "function"
        ) {
            firestoreInstance =
                null;

            throw clientError(
                "firestore-not-ready",
                "Firebase Firestore is not available."
            );
        }

        return firestoreInstance;
    }

    function resolveAuth() {
        if (
            authInstance
        ) {
            return authInstance;
        }

        assertFirebaseAvailable();

        authInstance =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (
            !authInstance &&
            typeof window.firebase
                .auth ===
                "function"
        ) {
            authInstance =
                window.firebase
                    .auth();
        }

        if (
            !authInstance
        ) {
            throw clientError(
                "auth-not-ready",
                "Firebase Authentication is not available."
            );
        }

        return authInstance;
    }

    function fieldValue() {
        assertFirebaseAvailable();

        const value =
            window.firebase
                ?.firestore
                ?.FieldValue;

        if (!value) {
            throw clientError(
                "firestore-not-ready",
                "Firebase Firestore FieldValue is not available."
            );
        }

        return value;
    }

    function serverTimestamp() {
        return fieldValue()
            .serverTimestamp();
    }

    async function waitForAuthentication() {
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
                    "[FunctionsClient] Auth initialization warning.",
                    error
                );
            }
        }

        const user =
            resolveAuth()
                .currentUser ||
            null;

        if (!user) {
            throw clientError(
                "unauthenticated",
                "Google sign-in is required."
            );
        }

        const providerIds =
            Array.isArray(
                user.providerData
            )
                ? user.providerData
                    .map(
                        item =>
                            toSafeString(
                                item?.providerId
                            )
                    )
                    .filter(
                        Boolean
                    )
                : [];

        if (
            !providerIds.includes(
                "google.com"
            ) ||
            user.emailVerified !==
                true
        ) {
            throw clientError(
                "permission-denied",
                "A verified Google account is required."
            );
        }

        let signInProvider =
            "";

        try {
            const tokenResult =
                typeof user
                    .getIdTokenResult ===
                    "function"
                    ? await user
                        .getIdTokenResult()
                    : null;

            signInProvider =
                toSafeString(
                    tokenResult
                        ?.signInProvider ||
                    tokenResult
                        ?.claims
                        ?.firebase
                        ?.sign_in_provider
                );
        } catch (error) {
            console.warn(
                "[FunctionsClient] ID token provider check warning.",
                error
            );
        }

        if (
            signInProvider &&
            signInProvider !==
                "google.com"
        ) {
            throw clientError(
                "permission-denied",
                "Sign in directly with Google to continue."
            );
        }

        return user;
    }

    async function requireAdmin() {
        const user =
            await waitForAuthentication();

        if (
            normalizeEmail(
                user.email
            ) !==
            ADMIN_EMAIL
        ) {
            throw clientError(
                "permission-denied",
                "Admin access is required."
            );
        }

        return user;
    }

    /* =====================================================
       TIME / SERIALIZATION
    ===================================================== */

    function timestampToMillis(
        value
    ) {
        if (!value) {
            return 0;
        }

        if (
            typeof value
                .toMillis ===
                "function"
        ) {
            return value
                .toMillis();
        }

        if (
            typeof value
                .toDate ===
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
            return value
                .getTime();
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

    function isServerTimestampSentinel(
        value
    ) {
        if (
            !value ||
            typeof value !==
                "object"
        ) {
            return false;
        }

        return toSafeString(
            value?._methodName
        )
            .toLowerCase()
            .includes(
                "servertimestamp"
            );
    }

    function serializeValue(
        value
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            isServerTimestampSentinel(
                value
            )
        ) {
            return new Date()
                .toISOString();
        }

        if (
            typeof value
                .toDate ===
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
            value instanceof
                Date
        ) {
            return value
                .toISOString();
        }

        if (
            Array.isArray(
                value
            )
        ) {
            return value.map(
                serializeValue
            );
        }

        if (
            isPlainObject(
                value
            )
        ) {
            const output =
                {};

            Object.entries(
                value
            ).forEach(
                (
                    [
                        key,
                        nested
                    ]
                ) => {
                    output[
                        key
                    ] =
                        serializeValue(
                            nested
                        );
                }
            );

            return output;
        }

        return value;
    }

    function snapshotData(
        snapshot
    ) {
        if (
            !snapshot?.exists
        ) {
            return null;
        }

        return serializeValue({
            id:
                snapshot.id,

            ...snapshot.data()
        });
    }

    function bangladeshDayKey(
        value = Date.now()
    ) {
        const milliseconds =
            typeof value ===
                "number"
                ? value
                : (
                    timestampToMillis(
                        value
                    ) ||
                    Date.now()
                );

        const shifted =
            new Date(
                milliseconds +
                (
                    6 *
                    60 *
                    60 *
                    1000
                )
            );

        return shifted
            .toISOString()
            .slice(
                0,
                10
            );
    }

    /* =====================================================
       INPUT NORMALIZATION
    ===================================================== */

    function getUsernameFromEmail(
        email
    ) {
        return (
            normalizeEmail(
                email
            )
                .split("@")[0] ||
            "user"
        );
    }

    function normalizeReferralCode(
        value
    ) {
        return toSafeString(
            value
        )
            .toUpperCase()
            .replace(
                /[^A-Z0-9]/g,
                ""
            );
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

    function generateReferralCode() {
        const bytes =
            new Uint8Array(
                8
            );

        if (
            window.crypto
                ?.getRandomValues
        ) {
            window.crypto
                .getRandomValues(
                    bytes
                );
        } else {
            for (
                let index = 0;
                index <
                    bytes.length;
                index += 1
            ) {
                bytes[
                    index
                ] =
                    Math.floor(
                        Math.random() *
                        256
                    );
            }
        }

        return Array.from(
            bytes,

            byte =>
                REFERRAL_ALPHABET[
                    byte %
                    REFERRAL_ALPHABET
                        .length
                ]
        ).join("");
    }

    function buildReferralLink(
        code
    ) {
        const normalized =
            normalizeReferralCode(
                code
            );

        if (
            !isValidReferralCode(
                normalized
            )
        ) {
            return REFERRAL_BASE_URL;
        }

        const url =
            new URL(
                REFERRAL_BASE_URL
            );

        url.searchParams.set(
            "ref",
            normalized
        );

        return url.toString();
    }

    function normalizeMobileNumber(
        value
    ) {
        let number =
            toSafeString(
                value
            )
                .replace(
                    /[\s\-()]/g,
                    ""
                );

        if (
            /^1[3-9]\d{8}$/
                .test(
                    number
                )
        ) {
            number =
                `+880${number}`;
        } else if (
            /^01[3-9]\d{8}$/
                .test(
                    number
                )
        ) {
            number =
                `+88${number}`;
        } else if (
            /^8801[3-9]\d{8}$/
                .test(
                    number
                )
        ) {
            number =
                `+${number}`;
        }

        if (
            !/^\+8801[3-9]\d{8}$/
                .test(
                    number
                )
        ) {
            throw clientError(
                "invalid-argument",
                "Enter a valid Bangladesh mobile number.",
                "mobileNumber"
            );
        }

        return number;
    }

    function normalizeProvider(
        value
    ) {
        const provider =
            toSafeString(
                value
            )
                .toLowerCase();

        if (
            !VALID_PROVIDERS
                .has(
                    provider
                )
        ) {
            throw clientError(
                "invalid-argument",
                "Select bKash, Nagad or Rocket.",
                "provider"
            );
        }

        return provider;
    }

    function normalizeAmount(
        value,
        field = "amount"
    ) {
        const amount =
            Math.floor(
                toSafeNumber(
                    value
                )
            );

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0
        ) {
            throw clientError(
                "invalid-argument",
                "Enter a valid amount.",
                field
            );
        }

        return amount;
    }

    function normalizeAdminNote(
        value,
        required = false
    ) {
        const note =
            toSafeString(
                value
            )
                .slice(
                    0,
                    500
                );

        if (
            required &&
            !note
        ) {
            throw clientError(
                "invalid-argument",
                "Admin note is required.",
                "adminNote"
            );
        }

        return note;
    }

    /* =====================================================
       UNIQUE WEB DEVICE
    ===================================================== */

    function requireSecureDeviceCrypto() {
        const cryptoAPI =
            window.crypto;

        if (
            !cryptoAPI ||
            typeof cryptoAPI
                .getRandomValues !==
                "function"
        ) {
            throw clientError(
                "failed-precondition",
                "Secure browser cryptography is required for Web Device Binding. Update or use a supported browser.",
                "deviceId"
            );
        }

        return cryptoAPI;
    }

    function requireDeviceStorage() {
        let storage =
            null;

        try {
            storage =
                window.localStorage;
        } catch {
            throw clientError(
                "failed-precondition",
                "Browser site storage is required for Web Device Binding. Enable site storage and try again.",
                "deviceId"
            );
        }

        if (
            !storage ||
            typeof storage.getItem !==
                "function" ||
            typeof storage.setItem !==
                "function"
        ) {
            throw clientError(
                "failed-precondition",
                "Browser site storage is required for Web Device Binding. Enable site storage and try again.",
                "deviceId"
            );
        }

        return storage;
    }

    function generateDeviceId() {
        const bytes =
            new Uint8Array(
                32
            );

        /*
         * Production security requirement:
         * Web Device identity must never use Math.random().
         */
        requireSecureDeviceCrypto()
            .getRandomValues(
                bytes
            );

        const deviceId =
            Array.from(
                bytes,
                byte =>
                    byte
                        .toString(16)
                        .padStart(
                            2,
                            "0"
                        )
            ).join("");

        if (
            !/^[a-f0-9]{64}$/
                .test(
                    deviceId
                )
        ) {
            throw clientError(
                "failed-precondition",
                "A secure Web Device identifier could not be generated.",
                "deviceId"
            );
        }

        return deviceId;
    }

    function isValidDeviceId(
        value
    ) {
        return /^[a-f0-9]{64}$/
            .test(
                toSafeString(
                    value
                )
            );
    }

    function getOrCreateDeviceId() {
        const storage =
            requireDeviceStorage();

        let existing =
            "";

        try {
            existing =
                toSafeString(
                    storage.getItem(
                        DEVICE_STORAGE_KEY
                    )
                );
        } catch {
            throw clientError(
                "failed-precondition",
                "11Play could not read the saved Web Device identifier. Enable browser site storage and try again.",
                "deviceId"
            );
        }

        if (
            isValidDeviceId(
                existing
            )
        ) {
            return existing;
        }

        const deviceId =
            generateDeviceId();

        try {
            storage.setItem(
                DEVICE_STORAGE_KEY,
                deviceId
            );

            const persistedDeviceId =
                toSafeString(
                    storage.getItem(
                        DEVICE_STORAGE_KEY
                    )
                );

            if (
                persistedDeviceId !==
                    deviceId ||
                !isValidDeviceId(
                    persistedDeviceId
                )
            ) {
                throw new Error(
                    "Web Device persistence verification failed."
                );
            }
        } catch {
            /*
             * Fail closed:
             * never continue with an identifier that was not
             * verifiably persisted in this browser installation.
             */
            try {
                storage.removeItem(
                    DEVICE_STORAGE_KEY
                );
            } catch {
                /*
                 * Best-effort cleanup only.
                 */
            }

            throw clientError(
                "failed-precondition",
                "11Play could not securely save the Web Device identifier. Enable browser site storage and try again.",
                "deviceId"
            );
        }

        return deviceId;
    }

    /* =====================================================
       FIRESTORE REFERENCES
    ===================================================== */

    function refs(
        uid = ""
    ) {
        const db =
            resolveFirestore();

        return {
            db,

            user:
                uid
                    ? db
                        .collection(
                            COLLECTIONS.USERS
                        )
                        .doc(
                            uid
                        )
                    : null,

            code:
                id =>
                    db
                        .collection(
                            COLLECTIONS.REFERRAL_CODES
                        )
                        .doc(
                            id
                        ),

            mobile:
                id =>
                    db
                        .collection(
                            COLLECTIONS.MOBILES
                        )
                        .doc(
                            id
                        ),

            device:
                id =>
                    db
                        .collection(
                            COLLECTIONS.DEVICES
                        )
                        .doc(
                            id
                        ),

            referral:
                id =>
                    db
                        .collection(
                            COLLECTIONS.REFERRALS
                        )
                        .doc(
                            id
                        ),

            stats:
                id =>
                    db
                        .collection(
                            COLLECTIONS.REFERRAL_STATS
                        )
                        .doc(
                            id
                        ),

            activity:
                id =>
                    db
                        .collection(
                            COLLECTIONS.ACTIVITY
                        )
                        .doc(
                            id
                        ),

            session:
                id =>
                    db
                        .collection(
                            COLLECTIONS.ACTIVITY_SESSIONS
                        )
                        .doc(
                            id
                        ),

            wallet:
                id =>
                    db
                        .collection(
                            COLLECTIONS.WALLETS
                        )
                        .doc(
                            id
                        ),

            walletTx:
                id =>
                    db
                        .collection(
                            COLLECTIONS.WALLET_TRANSACTIONS
                        )
                        .doc(
                            id
                        ),

            withdrawal:
                id =>
                    db
                        .collection(
                            COLLECTIONS.WITHDRAWALS
                        )
                        .doc(
                            id
                        ),

            reward:
                id =>
                    db
                        .collection(
                            COLLECTIONS.REWARD_EVENTS
                        )
                        .doc(
                            id
                        ),

            audit:
                id =>
                    db
                        .collection(
                            COLLECTIONS.AUDIT_LOGS
                        )
                        .doc(
                            id
                        ),

            setting:
                id =>
                    db
                        .collection(
                            COLLECTIONS.SETTINGS
                        )
                        .doc(
                            id
                        )
        };
    }

    /* =====================================================
       STATE FACTORIES
    ===================================================== */

    function createInitialStats(
        uid,
        timestamp
    ) {
        return {
            uid,

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

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function createInitialActivity(
        uid,
        timestamp
    ) {
        return {
            uid,

            userId:
                uid,

            deviceId:
                "",

            activeDays:
                0,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            currentDaySeconds:
                0,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            currentDayStartedAt:
                null,

            currentDayCompleted:
                false,

            lastCheckpointAt:
                null,

            completed:
                false,

            lastActiveAt:
                null,

            completedAt:
                null,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function createInitialWallet(
        uid,
        timestamp
    ) {
        return {
            uid,

            userId:
                uid,

            availableBalance:
                0,

            heldBalance:
                0,

            totalEarned:
                0,

            totalWithdrawn:
                0,

            lastWithdrawalAmount:
                0,

            lastWithdrawalAt:
                null,

            revision:
                0,

            lastOperationId:
                "",

            lastOperationType:
                "",

            lastOperationAt:
                null,

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function readStats(
        data,
        uid = ""
    ) {
        const source =
            data ||
            {};

        return {
            uid:
                toSafeString(
                    source.uid ||
                    uid
                ),

            total:
                toNonNegativeInteger(
                    source.total
                ),

            pending:
                toNonNegativeInteger(
                    source.pending
                ),

            qualified:
                toNonNegativeInteger(
                    source.qualified
                ),

            approved:
                toNonNegativeInteger(
                    source.approved
                ),

            rejected:
                toNonNegativeInteger(
                    source.rejected
                ),

            rewarded:
                toNonNegativeInteger(
                    source.rewarded
                ),

            totalReward:
                toNonNegativeInteger(
                    source.totalReward
                ),

            createdAt:
                source.createdAt ||
                null,

            updatedAt:
                source.updatedAt ||
                null,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function readWallet(
        data,
        uid = ""
    ) {
        const source =
            data ||
            {};

        return {
            uid:
                toSafeString(
                    source.uid ||
                    source.userId ||
                    uid
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid ||
                    uid
                ),

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
                source.lastWithdrawalAt ||
                null,

            revision:
                toNonNegativeInteger(
                    source.revision
                ),

            lastOperationId:
                toSafeString(
                    source.lastOperationId
                ),

            lastOperationType:
                toSafeString(
                    source.lastOperationType
                ),

            lastOperationAt:
                source.lastOperationAt ||
                null,

            createdAt:
                source.createdAt ||
                null,

            updatedAt:
                source.updatedAt ||
                null,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function withWalletOperation(
        wallet,
        operationId,
        operationType,
        timestamp
    ) {
        return {
            ...wallet,

            lastOperationId:
                operationId,

            lastOperationType:
                operationType,

            lastOperationAt:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function readActivity(
        data,
        uid = ""
    ) {
        const source =
            data ||
            {};

        const schemaVersion =
            toNonNegativeInteger(
                source.schemaVersion
            );

        const policyVersion =
            toNonNegativeInteger(
                source.activityPolicyVersion
            );

        const legacyCompleted =
            source.completed ===
                true ||
            toNonNegativeInteger(
                source.totalActiveSeconds
            ) >=
                ACTIVITY.LEGACY_REQUIRED_SECONDS;

        const finalLegacy =
            legacyCompleted &&
            (
                toNonNegativeInteger(
                    source.activeDays
                ) >=
                    ACTIVITY.REQUIRED_DAYS ||
                toNonNegativeInteger(
                    source.totalActiveSeconds
                ) >=
                    ACTIVITY.LEGACY_REQUIRED_SECONDS
            );

        const currentPolicy =
            schemaVersion ===
                SCHEMA_VERSION &&
            policyVersion ===
                ACTIVITY.POLICY_VERSION;

        const activeDays =
            currentPolicy
                ? Math.min(
                    ACTIVITY.REQUIRED_DAYS,
                    toNonNegativeInteger(
                        source.activeDays
                    )
                )
                : (
                    finalLegacy
                        ? ACTIVITY.REQUIRED_DAYS
                        : 0
                );

        const currentDaySeconds =
            currentPolicy
                ? Math.min(
                    ACTIVITY.REQUIRED_DAILY_SECONDS,
                    toNonNegativeInteger(
                        source.currentDaySeconds
                    )
                )
                : 0;

        return {
            uid:
                toSafeString(
                    source.uid ||
                    source.userId ||
                    uid
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid ||
                    uid
                ),

            deviceId:
                currentPolicy
                    ? toSafeString(
                        source.deviceId
                    )
                    : "",

            activeDays,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            currentDaySeconds,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            currentDayStartedAt:
                currentPolicy
                    ? source.currentDayStartedAt ||
                    null
                    : null,

            currentDayCompleted:
                currentPolicy
                    ? source.currentDayCompleted ===
                    true
                    : false,

            lastCheckpointAt:
                currentPolicy
                    ? source.lastCheckpointAt ||
                    null
                    : null,

            completed:
                currentPolicy
                    ? source.completed ===
                    true
                    : finalLegacy,

            lastActiveAt:
                currentPolicy
                    ? source.lastActiveAt ||
                    null
                    : null,

            completedAt:
                source.completedAt ||
                null,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            createdAt:
                source.createdAt ||
                null,

            updatedAt:
                source.updatedAt ||
                null,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function activityForResponse(
        data,
        uid = ""
    ) {
        const activity =
            readActivity(
                data,
                uid
            );

        const completedSeconds =
            activity.activeDays *
            ACTIVITY.REQUIRED_DAILY_SECONDS;

        const totalActiveSeconds =
            Math.min(
                ACTIVITY.REQUIRED_TOTAL_SECONDS,

                completedSeconds +
                (
                    activity.currentDayCompleted
                        ? 0
                        : activity.currentDaySeconds
                )
            );

        return serializeValue({
            ...activity,

            todayActiveSeconds:
                activity.currentDaySeconds,

            remainingTodaySeconds:
                activity.currentDayCompleted
                    ? 0
                    : Math.max(
                        0,

                        ACTIVITY.REQUIRED_DAILY_SECONDS -
                        activity.currentDaySeconds
                    ),

            totalActiveSeconds,

            requiredActiveSeconds:
                ACTIVITY.REQUIRED_TOTAL_SECONDS,

            remainingActiveDays:
                Math.max(
                    0,

                    ACTIVITY.REQUIRED_DAYS -
                    activity.activeDays
                ),

            dailyProgressPercent:
                Math.min(
                    100,

                    Number(
                        (
                            (
                                activity.currentDaySeconds /
                                ACTIVITY.REQUIRED_DAILY_SECONDS
                            ) *
                            100
                        )
                            .toFixed(
                                2
                            )
                    )
                ),

            progressPercent:
                Math.min(
                    100,

                    Number(
                        (
                            (
                                activity.activeDays /
                                ACTIVITY.REQUIRED_DAYS
                            ) *
                            100
                        )
                            .toFixed(
                                2
                            )
                    )
                )
        });
    }

    function isActiveProfile(
        profile
    ) {
        return (
            toSafeString(
                profile?.status
            ) ||
            PROFILE_STATUS.ACTIVE
        ) ===
            PROFILE_STATUS.ACTIVE;
    }

    function isValidMobileString(
        value
    ) {
        return /^\+8801[3-9]\d{8}$/
            .test(
                toSafeString(
                    value
                )
            );
    }

    function cleanProfileForCreate(
        user,
        referralCode,
        referralBinding,
        timestamp
    ) {
        const email =
            normalizeEmail(
                user.email
            );

        const displayName =
            toSafeString(
                user.displayName
            ) ||
            getUsernameFromEmail(
                email
            );

        const photoURL =
            toSafeString(
                user.photoURL
            );

        const providerIds =
            Array.isArray(
                user.providerData
            )
                ? Array.from(
                    new Set(
                        user.providerData
                            .map(
                                item =>
                                    toSafeString(
                                        item?.providerId
                                    )
                            )
                            .filter(
                                Boolean
                            )
                    )
                )
                : [
                    "google.com"
                ];

        const admin =
            email ===
            ADMIN_EMAIL;

        return {
            uid:
                user.uid,

            name:
                displayName,

            displayName,

            username:
                getUsernameFromEmail(
                    email
                ),

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                user.emailVerified ===
                true,

            providerIds,

            googleConnected:
                true,

            isGoogleConnected:
                true,

            accountType:
                "google",

            isAdmin:
                admin,

            role:
                admin
                    ? "admin"
                    : "user",

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            deviceId:
                "",

            deviceAdded:
                false,

            deviceLocked:
                false,

            referralCode,

            referralLink:
                buildReferralLink(
                    referralCode
                ),

            referredByUid:
                referralBinding
                    ?.referrerUid ||
                "",

            referredByCode:
                referralBinding
                    ?.referralCode ||
                "",

            registrationDate:
                timestamp,

            createdAt:
                timestamp,

            lastLogin:
                timestamp,

            updatedAt:
                timestamp,

            status:
                PROFILE_STATUS.ACTIVE,

            statusChangedAt:
                null,

            statusChangedBy:
                "",

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function migrateProfileData(
        user,
        source,
        timestamp
    ) {
        const email =
            normalizeEmail(
                user.email
            );

        const displayName =
            toSafeString(
                user.displayName ||
                source.displayName ||
                source.name
            ) ||
            getUsernameFromEmail(
                email
            );

        const photoURL =
            toSafeString(
                user.photoURL ||
                source.photoURL ||
                source.photo
            );

        const providerIds =
            Array.isArray(
                user.providerData
            )
                ? Array.from(
                    new Set(
                        user.providerData
                            .map(
                                item =>
                                    toSafeString(
                                        item?.providerId
                                    )
                            )
                            .filter(
                                Boolean
                            )
                    )
                )
                : [
                    "google.com"
                ];

        const admin =
            email ===
            ADMIN_EMAIL;

        const mobileNumber =
            isValidMobileString(
                source.mobileNumber
            )
                ? toSafeString(
                    source.mobileNumber
                )
                : "";

        const referralCode =
            toSafeString(
                source.referralCode
            );

        if (
            !isValidReferralCode(
                referralCode
            )
        ) {
            throw clientError(
                "failed-precondition",
                "The legacy profile referral code is invalid. Contact support."
            );
        }

        return {
            uid:
                user.uid,

            name:
                displayName,

            displayName,

            username:
                toSafeString(
                    source.username
                ) ||
                getUsernameFromEmail(
                    email
                ),

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                true,

            providerIds,

            googleConnected:
                true,

            isGoogleConnected:
                true,

            accountType:
                "google",

            isAdmin:
                admin,

            role:
                admin
                    ? "admin"
                    : "user",

            mobileNumber,

            mobileAdded:
                Boolean(
                    mobileNumber
                ),

            mobileLocked:
                Boolean(
                    mobileNumber
                ),

            deviceId:
                "",

            deviceAdded:
                false,

            deviceLocked:
                false,

            referralCode,

            referralLink:
                buildReferralLink(
                    referralCode
                ),

            referredByUid:
                toSafeString(
                    source.referredByUid
                ),

            referredByCode:
                toSafeString(
                    source.referredByCode
                ),

            registrationDate:
                source.registrationDate ??
                null,

            createdAt:
                source.createdAt ??
                null,

            lastLogin:
                timestamp,

            updatedAt:
                timestamp,

            status:
                toSafeString(
                    source.status
                ) ||
                PROFILE_STATUS.ACTIVE,

            statusChangedAt:
                source.statusChangedAt ||
                null,

            statusChangedBy:
                toSafeString(
                    source.statusChangedBy
                ),

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function profileRefreshPatch(
        user,
        timestamp
    ) {
        const providerIds =
            Array.isArray(
                user.providerData
            )
                ? Array.from(
                    new Set(
                        user.providerData
                            .map(
                                item =>
                                    toSafeString(
                                        item?.providerId
                                    )
                            )
                            .filter(
                                Boolean
                            )
                    )
                )
                : [
                    "google.com"
                ];

        const displayName =
            toSafeString(
                user.displayName
            ) ||
            getUsernameFromEmail(
                user.email
            );

        const photoURL =
            toSafeString(
                user.photoURL
            );

        return {
            name:
                displayName,

            displayName,

            photo:
                photoURL,

            photoURL,

            providerIds,

            lastLogin:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function createReferralRecord({
        referrerUid,
        referredUid,
        referralCode,
        profile,
        timestamp
    }) {
        return {
            referralId:
                referredUid,

            referrerUid,

            referredUid,

            referralCode,

            referredProfile: {
                uid:
                    referredUid,

                name:
                    toSafeString(
                        profile.displayName ||
                        profile.name
                    ),

                displayName:
                    toSafeString(
                        profile.displayName ||
                        profile.name
                    ),

                email:
                    normalizeEmail(
                        profile.email
                    ),

                photoURL:
                    toSafeString(
                        profile.photoURL ||
                        profile.photo
                    ),

                mobileNumber:
                    ""
            },

            googleConnected:
                true,

            mobileAdded:
                false,

            deviceAdded:
                false,

            activeDays:
                0,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            activityCompleted:
                false,

            eligible:
                false,

            status:
                REFERRAL_STATUS.PENDING,

            rewardAmount:
                REWARD_AMOUNT,

            rewardGranted:
                false,

            rewardGrantedAt:
                null,

            createdAt:
                timestamp,

            capturedAt:
                timestamp,

            qualifiedAt:
                null,

            reviewedAt:
                null,

            reviewedBy:
                "",

            approvedAt:
                null,

            rejectedAt:
                null,

            rewardedAt:
                null,

            adminNote:
                "",

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function createReferralProjection(
        referral,
        profile,
        activity,
        timestamp,
        options = {}
    ) {
        const normalizedActivity =
            readActivity(
                activity,

                profile?.uid ||
                referral?.referredUid
            );

        const mobileNumber =
            toSafeString(
                profile?.mobileNumber
            );

        const deviceId =
            toSafeString(
                profile?.deviceId
            );

        const mobileAdded =
            isValidMobileString(
                mobileNumber
            ) &&
            profile?.mobileLocked ===
                true;

        const deviceAdded =
            isValidDeviceId(
                deviceId
            ) &&
            profile?.deviceLocked ===
                true;

        const activityCompleted =
            normalizedActivity.completed ===
                true &&
            normalizedActivity.activeDays ===
                ACTIVITY.REQUIRED_DAYS &&
            normalizedActivity.activityPolicyVersion ===
                ACTIVITY.POLICY_VERSION;

        const eligible =
            profile?.googleConnected !==
                false &&
            mobileAdded &&
            deviceAdded &&
            activityCompleted;

        const rawStatus =
            toSafeString(
                referral?.status
            ) ||
            REFERRAL_STATUS.PENDING;

        const currentStatus =
            rawStatus ===
                REFERRAL_STATUS.CAPTURED
                ? REFERRAL_STATUS.PENDING
                : rawStatus;

        let status =
            currentStatus;

        let qualifiedAt =
            rawStatus ===
                REFERRAL_STATUS.CAPTURED
                ? null
                : (
                    referral?.qualifiedAt ||
                    null
                );

        if (
            options.allowPolicyReset ===
                true &&
            currentStatus ===
                REFERRAL_STATUS.QUALIFIED &&
            !eligible &&
            referral?.rewardGranted !==
                true
        ) {
            status =
                REFERRAL_STATUS.PENDING;

            qualifiedAt =
                null;
        } else if (
            options.allowQualification ===
                true &&
            currentStatus ===
                REFERRAL_STATUS.PENDING &&
            eligible
        ) {
            status =
                REFERRAL_STATUS.QUALIFIED;

            qualifiedAt =
                timestamp;
        }

        return {
            referralId:
                toSafeString(
                    referral?.referralId ||
                    referral?.referredUid
                ),

            referrerUid:
                toSafeString(
                    referral?.referrerUid
                ),

            referredUid:
                toSafeString(
                    referral?.referredUid ||
                    referral?.referralId
                ),

            referralCode:
                normalizeReferralCode(
                    referral?.referralCode
                ),

            referredProfile: {
                uid:
                    toSafeString(
                        profile?.uid ||
                        referral?.referredUid
                    ),

                name:
                    toSafeString(
                        profile?.displayName ||
                        profile?.name
                    ),

                displayName:
                    toSafeString(
                        profile?.displayName ||
                        profile?.name
                    ),

                email:
                    normalizeEmail(
                        profile?.email
                    ),

                photoURL:
                    toSafeString(
                        profile?.photoURL ||
                        profile?.photo
                    ),

                mobileNumber
            },

            googleConnected:
                profile?.googleConnected !==
                false,

            mobileAdded,

            deviceAdded,

            activeDays:
                normalizedActivity.activeDays,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            activityCompleted,

            eligible,

            status,

            rewardAmount:
                toNonNegativeInteger(
                    referral?.rewardAmount,
                    REWARD_AMOUNT
                ) ||
                REWARD_AMOUNT,

            rewardGranted:
                referral?.rewardGranted ===
                true,

            rewardGrantedAt:
                referral?.rewardGrantedAt ||
                null,

            createdAt:
                referral?.createdAt ||
                timestamp,

            capturedAt:
                referral?.capturedAt ||
                referral?.createdAt ||
                timestamp,

            qualifiedAt,

            reviewedAt:
                referral?.reviewedAt ||
                null,

            reviewedBy:
                toSafeString(
                    referral?.reviewedBy
                ),

            approvedAt:
                referral?.approvedAt ||
                null,

            rejectedAt:
                referral?.rejectedAt ||
                null,

            rewardedAt:
                referral?.rewardedAt ||
                null,

            adminNote:
                toSafeString(
                    referral?.adminNote
                ),

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function legacyActivityPreviouslyCompleted(
        source
    ) {
        return (
            source?.completed ===
                true ||
            toNonNegativeInteger(
                source?.activeDays
            ) >=
                ACTIVITY.REQUIRED_DAYS ||
            toNonNegativeInteger(
                source?.totalActiveSeconds
            ) >=
                ACTIVITY.LEGACY_REQUIRED_SECONDS
        );
    }

    function migrationActivityData(
        uid,
        source,
        timestamp,
        grandfatherCompleted = false
    ) {
        return {
            uid,

            userId:
                uid,

            deviceId:
                "",

            activeDays:
                grandfatherCompleted
                    ? ACTIVITY.REQUIRED_DAYS
                    : 0,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            currentDaySeconds:
                0,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            currentDayStartedAt:
                null,

            currentDayCompleted:
                false,

            lastCheckpointAt:
                null,

            completed:
                grandfatherCompleted,

            lastActiveAt:
                null,

            completedAt:
                grandfatherCompleted
                    ? (
                        source?.completedAt ||
                        timestamp
                    )
                    : null,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            createdAt:
                source?.createdAt ||
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function migrationStatsData(
        uid,
        source,
        timestamp
    ) {
        return {
            ...readStats(
                source,
                uid
            ),

            uid,

            createdAt:
                source?.createdAt ||
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function migrationWalletData(
        uid,
        source,
        timestamp
    ) {
        const wallet =
            readWallet(
                source,
                uid
            );

        return {
            ...wallet,

            uid,

            userId:
                uid,

            createdAt:
                source?.createdAt ||
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    function normalizeReferralRecord(
        data,
        id = ""
    ) {
        const source =
            data ||
            {};

        const rawStatus =
            toSafeString(
                source.status
            ) ||
            REFERRAL_STATUS.PENDING;

        const status =
            rawStatus ===
                REFERRAL_STATUS.CAPTURED
                ? REFERRAL_STATUS.PENDING
                : rawStatus;

        const currentPolicy =
            toNonNegativeInteger(
                source.schemaVersion
            ) ===
                SCHEMA_VERSION &&
            toNonNegativeInteger(
                source.activityPolicyVersion
            ) ===
                ACTIVITY.POLICY_VERSION;

        const legacyFinal =
            status ===
                REFERRAL_STATUS.REWARDED ||
            status ===
                REFERRAL_STATUS.APPROVED ||
            source.rewardGranted ===
                true;

        const activeDays =
            currentPolicy
                ? Math.min(
                    ACTIVITY.REQUIRED_DAYS,

                    toNonNegativeInteger(
                        source.activeDays
                    )
                )
                : (
                    legacyFinal
                        ? ACTIVITY.REQUIRED_DAYS
                        : 0
                );

        return serializeValue({
            id:
                id ||
                toSafeString(
                    source.referralId ||
                    source.referredUid
                ),

            ...source,

            referralId:
                toSafeString(
                    source.referralId ||
                    id ||
                    source.referredUid
                ),

            referredUid:
                toSafeString(
                    source.referredUid ||
                    id
                ),

            status,

            activeDays,

            requiredActiveDays:
                ACTIVITY.REQUIRED_DAYS,

            requiredDailySeconds:
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            activityPolicyVersion:
                ACTIVITY.POLICY_VERSION,

            activityCompleted:
                currentPolicy
                    ? source.activityCompleted ===
                    true
                    : legacyFinal,

            rewardAmount:
                toNonNegativeInteger(
                    source.rewardAmount,
                    REWARD_AMOUNT
                ) ||
                REWARD_AMOUNT,

            rewardGranted:
                source.rewardGranted ===
                true,

            eligible:
                source.eligible ===
                true,

            /*
             * Compatibility aliases only.
             * New Firestore writes never use an old seconds model.
             */
            activeSeconds:
                activeDays *
                ACTIVITY.REQUIRED_DAILY_SECONDS,

            requiredActiveSeconds:
                ACTIVITY.REQUIRED_TOTAL_SECONDS,

            usingTimeCompleted:
                currentPolicy
                    ? source.activityCompleted ===
                    true
                    : legacyFinal
        });
    }

    /* =====================================================
       QUERY HELPERS
    ===================================================== */

    async function pagedQuery({
        query,
        collection,
        cursor = "",
        limit = 50
    }) {
        let activeQuery =
            query;

        const safeLimit =
            toPositiveInteger(
                limit
            );

        const normalizedCursor =
            toSafeString(
                cursor
            );

        if (
            normalizedCursor
        ) {
            const cursorSnapshot =
                await collection
                    .doc(
                        normalizedCursor
                    )
                    .get();

            if (
                cursorSnapshot.exists
            ) {
                activeQuery =
                    activeQuery
                        .startAfter(
                            cursorSnapshot
                        );
            }
        }

        const snapshot =
            await activeQuery
                .limit(
                    safeLimit +
                    1
                )
                .get();

        const hasMore =
            snapshot.docs.length >
            safeLimit;

        const visibleDocs =
            hasMore
                ? snapshot.docs
                    .slice(
                        0,
                        safeLimit
                    )
                : snapshot.docs;

        return {
            docs:
                visibleDocs,

            hasMore,

            nextCursor:
                hasMore &&
                visibleDocs.length
                    ? visibleDocs[
                        visibleDocs.length -
                        1
                    ].id
                    : ""
        };
    }

    async function queryCount(
        query
    ) {
        try {
            if (
                typeof query
                    ?.count ===
                    "function"
            ) {
                const aggregate =
                    await query
                        .count()
                        .get();

                const data =
                    typeof aggregate
                        ?.data ===
                        "function"
                        ? aggregate
                            .data()
                        : null;

                if (
                    Number.isFinite(
                        Number(
                            data?.count
                        )
                    )
                ) {
                    return toNonNegativeInteger(
                        data.count
                    );
                }
            }
        } catch (error) {
            console.warn(
                "[FunctionsClient] Aggregate count fallback used.",
                error
            );
        }

        const snapshot =
            await query
                .get();

        return snapshot.size;
    }

    class ReferralCodeCollisionError extends Error {}

    /* =====================================================
       UNIQUE DEVICE BINDING
    ===================================================== */

    async function ensureDeviceBinding(
        user
    ) {
        const deviceId =
            getOrCreateDeviceId();

        const dbRefs =
            refs(
                user.uid
            );

        try {
            return await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const profileSnapshot =
                            await transaction
                                .get(
                                    dbRefs.user
                                );

                        if (
                            !profileSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "Profile was not found."
                            );
                        }

                        const profile =
                            profileSnapshot
                                .data() ||
                            {};

                        if (
                            !isActiveProfile(
                                profile
                            )
                        ) {
                            throw clientError(
                                "permission-denied",
                                "This profile is not active."
                            );
                        }

                        if (
                            toNonNegativeInteger(
                                profile.schemaVersion
                            ) !==
                            SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Profile migration must complete before device binding."
                            );
                        }

                        const savedDeviceId =
                            toSafeString(
                                profile.deviceId
                            );

                        if (
                            savedDeviceId
                        ) {
                            if (
                                savedDeviceId !==
                                deviceId
                            ) {
                                return {
                                    changed:
                                        false,

                                    deviceMatched:
                                        false,

                                    deviceId:
                                        savedDeviceId,

                                    currentDeviceId:
                                        deviceId,

                                    profile
                                };
                            }

                            return {
                                changed:
                                    false,

                                deviceMatched:
                                    true,

                                deviceId,

                                currentDeviceId:
                                    deviceId,

                                profile
                            };
                        }

                        const timestamp =
                            serverTimestamp();

                        const profileAfter = {
                            ...profile,

                            deviceId,

                            deviceAdded:
                                true,

                            deviceLocked:
                                true,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.update(
                            dbRefs.user,
                            {
                                deviceId,

                                deviceAdded:
                                    true,

                                deviceLocked:
                                    true,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        /*
                         * Create-style blind set.
                         * If another UID already owns this installation,
                         * immutable Firestore Rules reject the transaction.
                         */
                        transaction.set(
                            dbRefs.device(
                                deviceId
                            ),
                            {
                                deviceId,

                                uid:
                                    user.uid,

                                userId:
                                    user.uid,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            changed:
                                true,

                            deviceMatched:
                                true,

                            deviceId,

                            currentDeviceId:
                                deviceId,

                            profile:
                                profileAfter
                        };
                    }
                );
        } catch (error) {
            const normalized =
                normalizeError(
                    error,
                    "ensureDeviceBinding"
                );

            if (
                normalized.code ===
                "permission-denied"
            ) {
                throw clientError(
                    "failed-precondition",
                    "This Web Device is already bound to another account or the saved device binding is inconsistent."
                );
            }

            throw normalized;
        }
    }

    /* =====================================================
       PROFILE BOOTSTRAP / MIGRATION
    ===================================================== */

    async function ensureProfile(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const incomingCode =
            normalizeReferralCode(
                payload.referralCode
            );

        const dbRefs =
            refs(
                user.uid
            );

        for (
            let attempt = 0;
            attempt < 20;
            attempt += 1
        ) {
            const generatedCode =
                generateReferralCode();

            try {
                const bootstrapResult =
                    await dbRefs
                        .db
                        .runTransaction(
                            async transaction => {
                                const profileRef =
                                    dbRefs.user;

                                const walletRef =
                                    dbRefs.wallet(
                                        user.uid
                                    );

                                const statsRef =
                                    dbRefs.stats(
                                        user.uid
                                    );

                                const activityRef =
                                    dbRefs.activity(
                                        user.uid
                                    );

                                const referralRef =
                                    dbRefs.referral(
                                        user.uid
                                    );

                                const [
                                    profileSnapshot,
                                    walletSnapshot,
                                    statsSnapshot,
                                    activitySnapshot,
                                    referralSnapshot
                                ] =
                                    await Promise.all([
                                        transaction.get(
                                            profileRef
                                        ),

                                        transaction.get(
                                            walletRef
                                        ),

                                        transaction.get(
                                            statsRef
                                        ),

                                        transaction.get(
                                            activityRef
                                        ),

                                        transaction.get(
                                            referralRef
                                        )
                                    ]);

                                const existingProfile =
                                    profileSnapshot.exists
                                        ? profileSnapshot
                                            .data() ||
                                        {}
                                        : null;

                                if (
                                    existingProfile &&
                                    !isActiveProfile(
                                        existingProfile
                                    )
                                ) {
                                    throw clientError(
                                        "permission-denied",
                                        "This profile is not active."
                                    );
                                }

                                const existingCode =
                                    normalizeReferralCode(
                                        existingProfile
                                            ?.referralCode
                                    );

                                const ownCode =
                                    isValidReferralCode(
                                        existingCode
                                    )
                                        ? existingCode
                                        : generatedCode;

                                const ownCodeRef =
                                    dbRefs.code(
                                        ownCode
                                    );

                                const ownCodeSnapshot =
                                    await transaction
                                        .get(
                                            ownCodeRef
                                        );

                                if (
                                    ownCodeSnapshot.exists &&
                                    toSafeString(
                                        ownCodeSnapshot
                                            .data()
                                            ?.uid
                                    ) !==
                                    user.uid
                                ) {
                                    if (
                                        profileSnapshot.exists &&
                                        isValidReferralCode(
                                            existingCode
                                        )
                                    ) {
                                        throw clientError(
                                            "failed-precondition",
                                            "The saved referral identity is inconsistent. Contact support."
                                        );
                                    }

                                    throw new ReferralCodeCollisionError();
                                }

                                let referralBinding =
                                    null;

                                const canCaptureReferral =
                                    !profileSnapshot.exists &&
                                    !referralSnapshot.exists &&
                                    isValidReferralCode(
                                        incomingCode
                                    ) &&
                                    incomingCode !==
                                    ownCode;

                                if (
                                    canCaptureReferral
                                ) {
                                    const incomingCodeSnapshot =
                                        await transaction
                                            .get(
                                                dbRefs.code(
                                                    incomingCode
                                                )
                                            );

                                    if (
                                        incomingCodeSnapshot.exists
                                    ) {
                                        const ownerUid =
                                            toSafeString(
                                                incomingCodeSnapshot
                                                    .data()
                                                    ?.uid
                                            );

                                        const active =
                                            incomingCodeSnapshot
                                                .data()
                                                ?.active ===
                                            true;

                                        if (
                                            ownerUid &&
                                            ownerUid !==
                                                user.uid &&
                                            active
                                        ) {
                                            referralBinding = {
                                                referrerUid:
                                                    ownerUid,

                                                referralCode:
                                                    incomingCode
                                            };
                                        }
                                    }
                                }

                                const timestamp =
                                    serverTimestamp();

                                const profileWasLegacy =
                                    profileSnapshot.exists &&
                                    toNonNegativeInteger(
                                        existingProfile
                                            ?.schemaVersion
                                    ) ===
                                    2;

                                let profile;
                                let legacyMobileReservation =
                                    "";

                                if (
                                    !profileSnapshot.exists
                                ) {
                                    profile =
                                        cleanProfileForCreate(
                                            user,
                                            ownCode,
                                            referralBinding,
                                            timestamp
                                        );

                                    transaction.set(
                                        profileRef,
                                        profile
                                    );
                                } else if (
                                    profileWasLegacy
                                ) {
                                    profile =
                                        migrateProfileData(
                                            user,
                                            existingProfile,
                                            timestamp
                                        );

                                    legacyMobileReservation =
                                        profile.mobileNumber;

                                    transaction.set(
                                        profileRef,
                                        profile
                                    );
                                } else {
                                    const patch =
                                        profileRefreshPatch(
                                            user,
                                            timestamp
                                        );

                                    profile = {
                                        ...existingProfile,
                                        ...patch
                                    };

                                    transaction.update(
                                        profileRef,
                                        patch
                                    );
                                }

                                if (
                                    !ownCodeSnapshot.exists
                                ) {
                                    transaction.set(
                                        ownCodeRef,
                                        {
                                            code:
                                                ownCode,

                                            referralCode:
                                                ownCode,

                                            uid:
                                                user.uid,

                                            userId:
                                                user.uid,

                                            active:
                                                true,

                                            createdAt:
                                                timestamp,

                                            updatedAt:
                                                timestamp,

                                            schemaVersion:
                                                SCHEMA_VERSION
                                        }
                                    );
                                }

                                if (
                                    profileWasLegacy &&
                                    legacyMobileReservation &&
                                    payload
                                        .__skipLegacyMobileReservation !==
                                    true
                                ) {
                                    transaction.set(
                                        dbRefs.mobile(
                                            legacyMobileReservation
                                        ),
                                        {
                                            mobile:
                                                legacyMobileReservation,

                                            uid:
                                                user.uid,

                                            userId:
                                                user.uid,

                                            createdAt:
                                                timestamp,

                                            updatedAt:
                                                timestamp,

                                            schemaVersion:
                                                SCHEMA_VERSION
                                        }
                                    );
                                }

                                const referralRaw =
                                    referralSnapshot.exists
                                        ? referralSnapshot
                                            .data() ||
                                        {}
                                        : null;

                                const referralIsFinalLegacy =
                                    Boolean(
                                        referralRaw &&

                                        [
                                            REFERRAL_STATUS.APPROVED,
                                            REFERRAL_STATUS.REWARDED
                                        ].includes(
                                            toSafeString(
                                                referralRaw.status
                                            )
                                        ) &&

                                        activitySnapshot.exists &&

                                        legacyActivityPreviouslyCompleted(
                                            activitySnapshot
                                                .data() ||
                                            {}
                                        )
                                    );

                                let activityAfter;

                                const activityNeedsMigration =
                                    activitySnapshot.exists &&
                                    (
                                        toNonNegativeInteger(
                                            activitySnapshot
                                                .data()
                                                ?.schemaVersion
                                        ) ===
                                            2 ||

                                        toNonNegativeInteger(
                                            activitySnapshot
                                                .data()
                                                ?.activityPolicyVersion
                                        ) !==
                                            ACTIVITY.POLICY_VERSION
                                    );

                                if (
                                    !activitySnapshot.exists
                                ) {
                                    activityAfter =
                                        createInitialActivity(
                                            user.uid,
                                            timestamp
                                        );

                                    transaction.set(
                                        activityRef,
                                        activityAfter
                                    );
                                } else if (
                                    activityNeedsMigration
                                ) {
                                    activityAfter =
                                        migrationActivityData(
                                            user.uid,

                                            activitySnapshot
                                                .data() ||
                                            {},

                                            timestamp,

                                            referralIsFinalLegacy
                                        );

                                    transaction.set(
                                        activityRef,
                                        activityAfter
                                    );
                                } else {
                                    activityAfter =
                                        activitySnapshot
                                            .data() ||
                                        {};
                                }

                                if (
                                    !statsSnapshot.exists
                                ) {
                                    transaction.set(
                                        statsRef,
                                        createInitialStats(
                                            user.uid,
                                            timestamp
                                        )
                                    );
                                } else if (
                                    toNonNegativeInteger(
                                        statsSnapshot
                                            .data()
                                            ?.schemaVersion
                                    ) ===
                                    2
                                ) {
                                    transaction.set(
                                        statsRef,
                                        migrationStatsData(
                                            user.uid,
                                            statsSnapshot
                                                .data() ||
                                            {},
                                            timestamp
                                        )
                                    );
                                }

                                if (
                                    !walletSnapshot.exists
                                ) {
                                    transaction.set(
                                        walletRef,
                                        createInitialWallet(
                                            user.uid,
                                            timestamp
                                        )
                                    );
                                } else if (
                                    toNonNegativeInteger(
                                        walletSnapshot
                                            .data()
                                            ?.schemaVersion
                                    ) ===
                                    2
                                ) {
                                    transaction.set(
                                        walletRef,
                                        migrationWalletData(
                                            user.uid,
                                            walletSnapshot
                                                .data() ||
                                            {},
                                            timestamp
                                        )
                                    );
                                }

                                let referralAfter =
                                    referralRaw;

                                if (
                                    referralBinding
                                ) {
                                    referralAfter =
                                        createReferralRecord({
                                            referrerUid:
                                                referralBinding
                                                    .referrerUid,

                                            referredUid:
                                                user.uid,

                                            referralCode:
                                                referralBinding
                                                    .referralCode,

                                            profile,

                                            timestamp
                                        });

                                    transaction.set(
                                        referralRef,
                                        referralAfter
                                    );

                                    /*
                                     * Do not read another user's private
                                     * referral-statistics document.
                                     * Rules validate these exact deltas.
                                     */
                                    transaction.update(
                                        dbRefs.stats(
                                            referralBinding
                                                .referrerUid
                                        ),
                                        {
                                            total:
                                                fieldValue()
                                                    .increment(
                                                        1
                                                    ),

                                            pending:
                                                fieldValue()
                                                    .increment(
                                                        1
                                                    ),

                                            updatedAt:
                                                timestamp,

                                            schemaVersion:
                                                SCHEMA_VERSION
                                        }
                                    );
                                } else if (
                                    referralRaw &&
                                    toNonNegativeInteger(
                                        referralRaw
                                            .schemaVersion
                                    ) ===
                                    2
                                ) {
                                    /*
                                     * Keep the legacy relation unchanged
                                     * during profile migration.
                                     * Referral v2 -> v3 is deferred until
                                     * both mobile and device are ready.
                                     */
                                    referralAfter =
                                        referralRaw;
                                }

                                return {
                                    profile,

                                    referral:
                                        referralAfter,

                                    migratedProfile:
                                        profileWasLegacy,

                                    migratedActivity:
                                        activityNeedsMigration,

                                    schemaVersion:
                                        SCHEMA_VERSION
                                };
                            }
                        );

                let deviceResult =
                    null;

                try {
                    deviceResult =
                        await ensureDeviceBinding(
                            user
                        );
                } catch (error) {
                    console.warn(
                        "[FunctionsClient] Device binding warning.",
                        error
                    );

                    deviceResult = {
                        changed:
                            false,

                        deviceMatched:
                            false,

                        error:
                            normalizeError(
                                error,
                                "ensureDeviceBinding"
                            )
                    };
                }

                try {
                    await syncReferralProjectionFully(
                        user,
                        {
                            allowQualification:
                                true,

                            allowPolicyReset:
                                true
                        }
                    );
                } catch (error) {
                    console.warn(
                        "[FunctionsClient] Referral bootstrap sync warning.",
                        error
                    );
                }

                const latestProfileSnapshot =
                    await dbRefs
                        .user
                        .get();

                const latestProfile =
                    latestProfileSnapshot.exists
                        ? latestProfileSnapshot
                            .data() ||
                        bootstrapResult.profile
                        : bootstrapResult.profile;

                const result = {
                    ...bootstrapResult,

                    profile:
                        latestProfile,

                    device:
                        deviceResult
                };

                dispatchClientEvent(
                    "profile:ensured",
                    {
                        result:
                            serializeValue(
                                result
                            )
                    }
                );

                return {
                    success:
                        true,

                    ...serializeValue(
                        result
                    )
                };
            } catch (error) {
                if (
                    error instanceof
                        ReferralCodeCollisionError
                ) {
                    continue;
                }

                const normalized =
                    normalizeError(
                        error,
                        FUNCTION_NAMES.ENSURE_PROFILE
                    );

                /*
                 * Legacy v2 profiles can already have a valid
                 * immutable mobile reservation from an earlier
                 * partial migration. Retry once without trying
                 * to rewrite that immutable document.
                 */
                if (
                    normalized.code ===
                        "permission-denied" &&
                    payload
                        .__skipLegacyMobileReservation !==
                    true
                ) {
                    try {
                        const profileSnapshot =
                            await dbRefs
                                .user
                                .get();

                        const profile =
                            profileSnapshot.exists
                                ? profileSnapshot
                                    .data() ||
                                {}
                                : {};

                        if (
                            toNonNegativeInteger(
                                profile.schemaVersion
                            ) ===
                                2 &&
                            isValidMobileString(
                                profile.mobileNumber
                            )
                        ) {
                            return ensureProfile({
                                ...payload,

                                __skipLegacyMobileReservation:
                                    true
                            });
                        }
                    } catch {
                        /*
                         * Preserve the original error.
                         */
                    }
                }

                throw normalized;
            }
        }

        throw clientError(
            "aborted",
            "A unique referral code could not be created."
        );
    }

    async function getMyProfile() {
        const user =
            await waitForAuthentication();

        const dbRefs =
            refs(
                user.uid
            );

        let snapshot =
            await dbRefs
                .user
                .get();

        if (
            !snapshot.exists ||
            toNonNegativeInteger(
                snapshot
                    .data()
                    ?.schemaVersion
            ) !==
                SCHEMA_VERSION
        ) {
            await ensureProfile();

            snapshot =
                await dbRefs
                    .user
                    .get();
        } else {
            const profile =
                snapshot
                    .data() ||
                {};

            if (
                !isValidDeviceId(
                    profile.deviceId
                )
            ) {
                try {
                    await ensureDeviceBinding(
                        user
                    );

                    snapshot =
                        await dbRefs
                            .user
                            .get();
                } catch (error) {
                    console.warn(
                        "[FunctionsClient] Device binding warning.",
                        error
                    );
                }
            }
        }

        return {
            success:
                true,

            profile:
                snapshotData(
                    snapshot
                )
        };
    }

    /* =====================================================
       GUEST SHARE LINK
    ===================================================== */

    async function getPublicAdminReferral() {
        const result = {
            success:
                true,

            referralCode:
                "",

            referralLink:
                REFERRAL_BASE_URL,

            isGuestLink:
                true,

            source:
                "main-site"
        };

        dispatchClientEvent(
            "profile:admin-referral-loaded",
            {
                referralCode:
                    "",

                referralLink:
                    REFERRAL_BASE_URL,

                isGuestLink:
                    true
            }
        );

        return result;
    }

    /* =====================================================
       REFERRAL PROJECTION
    ===================================================== */

    async function syncReferralProjectionForUser(
        user,
        options = {}
    ) {
        const dbRefs =
            refs(
                user.uid
            );

        const referralRef =
            dbRefs.referral(
                user.uid
            );

        return dbRefs
            .db
            .runTransaction(
                async transaction => {
                    const [
                        profileSnapshot,
                        activitySnapshot,
                        referralSnapshot
                    ] =
                        await Promise.all([
                            transaction.get(
                                dbRefs.user
                            ),

                            transaction.get(
                                dbRefs.activity(
                                    user.uid
                                )
                            ),

                            transaction.get(
                                referralRef
                            )
                        ]);

                    if (
                        !referralSnapshot.exists ||
                        !profileSnapshot.exists ||
                        !activitySnapshot.exists
                    ) {
                        return {
                            changed:
                                false,

                            qualified:
                                false,

                            referral:
                                null
                        };
                    }

                    const referral =
                        referralSnapshot
                            .data() ||
                        {};

                    const profile =
                        profileSnapshot
                            .data() ||
                        {};

                    const activity =
                        activitySnapshot
                            .data() ||
                        {};

                    const rawStatus =
                        toSafeString(
                            referral.status
                        ) ||
                        REFERRAL_STATUS.PENDING;

                    const status =
                        rawStatus ===
                            REFERRAL_STATUS.CAPTURED
                            ? REFERRAL_STATUS.PENDING
                            : rawStatus;

                    const legacyReferral =
                        toNonNegativeInteger(
                            referral.schemaVersion
                        ) ===
                        2;

                    if (
                        [
                            REFERRAL_STATUS.REWARDED,
                            REFERRAL_STATUS.REJECTED
                        ].includes(
                            status
                        ) ||
                        (
                            status ===
                                REFERRAL_STATUS.APPROVED &&
                            !legacyReferral
                        )
                    ) {
                        return {
                            changed:
                                false,

                            qualified:
                                false,

                            referral
                        };
                    }

                    /*
                     * Projection only becomes security relevant
                     * after both immutable reservations are ready.
                     */
                    if (
                        !isValidMobileString(
                            profile.mobileNumber
                        ) ||
                        !isValidDeviceId(
                            profile.deviceId
                        ) ||
                        profile.mobileLocked !==
                            true ||
                        profile.deviceLocked !==
                            true
                    ) {
                        return {
                            changed:
                                false,

                            qualified:
                                false,

                            referral
                        };
                    }

                    const timestamp =
                        serverTimestamp();

                    const projected =
                        createReferralProjection(
                            referral,
                            profile,
                            activity,
                            timestamp,
                            {
                                allowQualification:
                                    !legacyReferral &&
                                    options
                                        .allowQualification !==
                                    false,

                                allowPolicyReset:
                                    !legacyReferral &&
                                    options
                                        .allowPolicyReset !==
                                    false
                            }
                        );

                    const qualifies =
                        !legacyReferral &&
                        status ===
                            REFERRAL_STATUS.PENDING &&
                        projected.status ===
                            REFERRAL_STATUS.QUALIFIED;

                    const policyReset =
                        !legacyReferral &&
                        status ===
                            REFERRAL_STATUS.QUALIFIED &&
                        projected.status ===
                            REFERRAL_STATUS.PENDING;

                    const relevantChanged =
                        legacyReferral ||
                        qualifies ||
                        policyReset ||
                        referral.mobileAdded !==
                            projected.mobileAdded ||
                        referral.deviceAdded !==
                            projected.deviceAdded ||
                        toNonNegativeInteger(
                            referral.activeDays
                        ) !==
                            projected.activeDays ||
                        toNonNegativeInteger(
                            referral.requiredDailySeconds
                        ) !==
                            ACTIVITY.REQUIRED_DAILY_SECONDS ||
                        toNonNegativeInteger(
                            referral.activityPolicyVersion
                        ) !==
                            ACTIVITY.POLICY_VERSION ||
                        referral.activityCompleted !==
                            projected.activityCompleted ||
                        referral.eligible !==
                            projected.eligible ||
                        toSafeString(
                            referral
                                ?.referredProfile
                                ?.mobileNumber
                        ) !==
                            toSafeString(
                                projected
                                    ?.referredProfile
                                    ?.mobileNumber
                            );

                    if (
                        !relevantChanged
                    ) {
                        return {
                            changed:
                                false,

                            qualified:
                                false,

                            referral
                        };
                    }

                    transaction.set(
                        referralRef,
                        projected
                    );

                    if (
                        qualifies
                    ) {
                        transaction.update(
                            dbRefs.stats(
                                projected.referrerUid
                            ),
                            {
                                pending:
                                    fieldValue()
                                        .increment(
                                            -1
                                        ),

                                qualified:
                                    fieldValue()
                                        .increment(
                                            1
                                        ),

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );
                    } else if (
                        policyReset
                    ) {
                        transaction.update(
                            dbRefs.stats(
                                projected.referrerUid
                            ),
                            {
                                pending:
                                    fieldValue()
                                        .increment(
                                            1
                                        ),

                                qualified:
                                    fieldValue()
                                        .increment(
                                            -1
                                        ),

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );
                    }

                    return {
                        changed:
                            true,

                        migrated:
                            legacyReferral,

                        qualified:
                            qualifies,

                        policyReset,

                        referral:
                            projected
                    };
                }
            );
    }

    async function syncReferralProjectionFully(
        user,
        options = {}
    ) {
        let result =
            await syncReferralProjectionForUser(
                user,
                options
            );

        /*
         * Referral migration cannot also reset a previously
         * qualified legacy status in the same Rules transition.
         */
        if (
            result?.migrated ===
            true
        ) {
            result =
                await syncReferralProjectionForUser(
                    user,
                    options
                );
        }

        return result;
    }

    /* =====================================================
       MOBILE
    ===================================================== */

    async function saveMobileNumber(
        mobileNumber
    ) {
        const user =
            await waitForAuthentication();

        const normalizedMobile =
            normalizeMobileNumber(
                mobileNumber
            );

        const dbRefs =
            refs(
                user.uid
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const profileRef =
                            dbRefs.user;

                        const profileSnapshot =
                            await transaction
                                .get(
                                    profileRef
                                );

                        if (
                            !profileSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "Profile was not found."
                            );
                        }

                        const profile =
                            profileSnapshot
                                .data() ||
                            {};

                        if (
                            !isActiveProfile(
                                profile
                            )
                        ) {
                            throw clientError(
                                "permission-denied",
                                "This profile is not active."
                            );
                        }

                        if (
                            toNonNegativeInteger(
                                profile.schemaVersion
                            ) !==
                            SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Profile migration is required. Sign in again and retry."
                            );
                        }

                        const existingMobile =
                            toSafeString(
                                profile.mobileNumber
                            );

                        if (
                            existingMobile &&
                            existingMobile !==
                            normalizedMobile
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "The saved mobile number is permanently locked.",
                                "mobileNumber"
                            );
                        }

                        if (
                            existingMobile ===
                                normalizedMobile &&
                            profile.mobileAdded ===
                                true &&
                            profile.mobileLocked ===
                                true
                        ) {
                            return {
                                changed:
                                    false,

                                duplicate:
                                    true,

                                profile
                            };
                        }

                        const timestamp =
                            serverTimestamp();

                        const profileUpdate = {
                            mobileNumber:
                                normalizedMobile,

                            mobileAdded:
                                true,

                            mobileLocked:
                                true,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.update(
                            profileRef,
                            profileUpdate
                        );

                        /*
                         * Create-style immutable reservation.
                         */
                        transaction.set(
                            dbRefs.mobile(
                                normalizedMobile
                            ),
                            {
                                mobile:
                                    normalizedMobile,

                                uid:
                                    user.uid,

                                userId:
                                    user.uid,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            changed:
                                true,

                            duplicate:
                                false,

                            profile: {
                                ...profile,
                                ...profileUpdate
                            }
                        };
                    }
                );

        try {
            await syncReferralProjectionFully(
                user,
                {
                    allowQualification:
                        true,

                    allowPolicyReset:
                        true
                }
            );
        } catch (error) {
            console.warn(
                "[FunctionsClient] Referral post-mobile sync warning.",
                error
            );
        }

        dispatchClientEvent(
            "profile:mobile-saved",
            {
                result:
                    serializeValue(
                        result
                    )
            }
        );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    /* =====================================================
       ACTIVITY — 7 DAYS × 2 REAL HOURS / DAY
    ===================================================== */

    async function getMyActivity() {
        const user =
            await waitForAuthentication();

        const dbRefs =
            refs(
                user.uid
            );

        let snapshot =
            await dbRefs
                .activity(
                    user.uid
                )
                .get();

        if (
            !snapshot.exists ||
            toNonNegativeInteger(
                snapshot
                    .data()
                    ?.activityPolicyVersion
            ) !==
                ACTIVITY.POLICY_VERSION
        ) {
            await ensureProfile();

            snapshot =
                await dbRefs
                    .activity(
                        user.uid
                    )
                    .get();
        }

        return {
            success:
                true,

            activity:
                activityForResponse(
                    snapshot.exists
                        ? snapshot
                            .data()
                        : null,

                    user.uid
                )
        };
    }

    async function recordActivityHeartbeat(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const active =
            payload.active !==
                false &&
            payload.visible !==
                false &&
            payload.focused !==
                false &&
            payload.online !==
                false;

        if (
            !active
        ) {
            return {
                success:
                    true,

                creditedDays:
                    0,

                creditedSeconds:
                    0,

                reason:
                    "inactive",

                activity:
                    null,

                session:
                    null,

                referral:
                    null
            };
        }

        /*
         * This call now fails closed if secure cryptography or
         * persistent browser storage is unavailable.
         */
        const currentDeviceId =
            getOrCreateDeviceId();

        const dbRefs =
            refs(
                user.uid
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const profileRef =
                            dbRefs.user;

                        const activityRef =
                            dbRefs.activity(
                                user.uid
                            );

                        const referralRef =
                            dbRefs.referral(
                                user.uid
                            );

                        const [
                            profileSnapshot,
                            activitySnapshot,
                            referralSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    profileRef
                                ),

                                transaction.get(
                                    activityRef
                                ),

                                transaction.get(
                                    referralRef
                                )
                            ]);

                        if (
                            !profileSnapshot.exists ||
                            !isActiveProfile(
                                profileSnapshot
                                    .data()
                            )
                        ) {
                            throw clientError(
                                "permission-denied",
                                "This profile is not active."
                            );
                        }

                        if (
                            !activitySnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Activity state is not initialized. Sign in again to repair the profile."
                            );
                        }

                        const profile =
                            profileSnapshot
                                .data() ||
                            {};

                        const currentActivity =
                            activitySnapshot
                                .data() ||
                            {};

                        const currentReferral =
                            referralSnapshot.exists
                                ? referralSnapshot
                                    .data() ||
                                {}
                                : null;

                        if (
                            !isValidMobileString(
                                profile.mobileNumber
                            ) ||
                            profile.mobileAdded !==
                                true ||
                            profile.mobileLocked !==
                                true
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "mobile_required",

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        if (
                            !isValidDeviceId(
                                profile.deviceId
                            ) ||
                            profile.deviceAdded !==
                                true ||
                            profile.deviceLocked !==
                                true
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "device_required",

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        if (
                            toSafeString(
                                profile.deviceId
                            ) !==
                            currentDeviceId
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "device_mismatch",

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        const needsActivityMigration =
                            toNonNegativeInteger(
                                currentActivity
                                    .schemaVersion
                            ) !==
                                SCHEMA_VERSION ||
                            toNonNegativeInteger(
                                currentActivity
                                    .activityPolicyVersion
                            ) !==
                                ACTIVITY.POLICY_VERSION;

                        if (
                            needsActivityMigration
                        ) {
                            const finalLegacyReferral =
                                Boolean(
                                    currentReferral &&

                                    [
                                        REFERRAL_STATUS.APPROVED,
                                        REFERRAL_STATUS.REWARDED
                                    ].includes(
                                        toSafeString(
                                            currentReferral.status
                                        )
                                    ) &&

                                    legacyActivityPreviouslyCompleted(
                                        currentActivity
                                    )
                                );

                            const timestamp =
                                serverTimestamp();

                            const migratedActivity =
                                migrationActivityData(
                                    user.uid,
                                    currentActivity,
                                    timestamp,
                                    finalLegacyReferral
                                );

                            transaction.set(
                                activityRef,
                                migratedActivity
                            );

                            if (
                                currentReferral &&
                                toNonNegativeInteger(
                                    currentReferral
                                        .schemaVersion
                                ) ===
                                2
                            ) {
                                transaction.set(
                                    referralRef,
                                    createReferralProjection(
                                        currentReferral,
                                        profile,
                                        migratedActivity,
                                        timestamp,
                                        {
                                            allowQualification:
                                                false,

                                            allowPolicyReset:
                                                false
                                        }
                                    )
                                );
                            }

                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "activity_policy_migrated",

                                activity:
                                    migratedActivity,

                                referral:
                                    currentReferral,

                                needsReferralSync:
                                    true
                            };
                        }

                        const activity =
                            readActivity(
                                currentActivity,
                                user.uid
                            );

                        if (
                            activity.completed ||
                            activity.activeDays >=
                                ACTIVITY.REQUIRED_DAYS
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "activity_completed",

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        const nowMs =
                            Date.now();

                        const dayStartMs =
                            timestampToMillis(
                                activity.currentDayStartedAt
                            );

                        const lastCheckpointMs =
                            timestampToMillis(
                                activity.lastCheckpointAt
                            );

                        const localToday =
                            bangladeshDayKey(
                                nowMs
                            );

                        const storedDay =
                            dayStartMs
                                ? bangladeshDayKey(
                                    dayStartMs
                                )
                                : "";

                        const timestamp =
                            serverTimestamp();

                        /*
                         * Browser date only selects which write to try.
                         * Firestore Rules validate the real server date.
                         */
                        if (
                            !dayStartMs ||
                            storedDay !==
                            localToday
                        ) {
                            const activityAfter = {
                                ...activity,

                                deviceId:
                                    currentDeviceId,

                                currentDaySeconds:
                                    0,

                                currentDayStartedAt:
                                    timestamp,

                                currentDayCompleted:
                                    false,

                                lastCheckpointAt:
                                    timestamp,

                                lastActiveAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            };

                            transaction.set(
                                activityRef,
                                activityAfter
                            );

                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "day_started",

                                activity:
                                    activityAfter,

                                referral:
                                    currentReferral
                            };
                        }

                        if (
                            activity.currentDayCompleted
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "daily_goal_completed",

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        if (
                            !lastCheckpointMs
                        ) {
                            const activityAfter = {
                                ...activity,

                                deviceId:
                                    currentDeviceId,

                                lastCheckpointAt:
                                    timestamp,

                                lastActiveAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            };

                            transaction.set(
                                activityRef,
                                activityAfter
                            );

                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "checkpoint_anchor_created",

                                activity:
                                    activityAfter,

                                referral:
                                    currentReferral
                            };
                        }

                        const elapsedMs =
                            nowMs -
                            lastCheckpointMs;

                        /*
                         * force=true cannot bypass 15 real minutes.
                         */
                        if (
                            elapsedMs <
                            ACTIVITY.CHECKPOINT_MIN_MS
                        ) {
                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "checkpoint_not_due",

                                nextCheckpointInSeconds:
                                    Math.max(
                                        0,

                                        Math.ceil(
                                            (
                                                ACTIVITY.CHECKPOINT_MIN_MS -
                                                elapsedMs
                                            ) /
                                            1000
                                        )
                                    ),

                                activity:
                                    currentActivity,

                                referral:
                                    currentReferral
                            };
                        }

                        /*
                         * More than 20 minutes between checkpoints means
                         * that gap is not counted. A new anchor is created.
                         */
                        if (
                            elapsedMs >
                            ACTIVITY.CHECKPOINT_MAX_MS
                        ) {
                            const activityAfter = {
                                ...activity,

                                deviceId:
                                    currentDeviceId,

                                lastCheckpointAt:
                                    timestamp,

                                lastActiveAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            };

                            transaction.set(
                                activityRef,
                                activityAfter
                            );

                            return {
                                creditedDays:
                                    0,

                                creditedSeconds:
                                    0,

                                reason:
                                    "activity_resumed",

                                activity:
                                    activityAfter,

                                referral:
                                    currentReferral
                            };
                        }

                        const nextDailySeconds =
                            Math.min(
                                ACTIVITY.REQUIRED_DAILY_SECONDS,

                                activity.currentDaySeconds +
                                ACTIVITY.CHECKPOINT_SECONDS
                            );

                        const completesDay =
                            nextDailySeconds ===
                            ACTIVITY.REQUIRED_DAILY_SECONDS;

                        const nextDays =
                            Math.min(
                                ACTIVITY.REQUIRED_DAYS,

                                activity.activeDays +
                                (
                                    completesDay
                                        ? 1
                                        : 0
                                )
                            );

                        const completesAll =
                            nextDays ===
                            ACTIVITY.REQUIRED_DAYS;

                        const activityAfter = {
                            ...activity,

                            deviceId:
                                currentDeviceId,

                            activeDays:
                                nextDays,

                            currentDaySeconds:
                                nextDailySeconds,

                            currentDayCompleted:
                                completesDay,

                            lastCheckpointAt:
                                timestamp,

                            completed:
                                completesAll,

                            lastActiveAt:
                                timestamp,

                            completedAt:
                                completesAll
                                    ? timestamp
                                    : activity.completedAt ||
                                    null,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        let referralAfter =
                            currentReferral;

                        let qualifies =
                            false;

                        let policyReset =
                            false;

                        if (
                            currentReferral
                        ) {
                            referralAfter =
                                createReferralProjection(
                                    currentReferral,
                                    profile,
                                    activityAfter,
                                    timestamp,
                                    {
                                        allowQualification:
                                            true,

                                        allowPolicyReset:
                                            true
                                    }
                                );

                            const currentStatus =
                                toSafeString(
                                    currentReferral.status
                                ) ===
                                    REFERRAL_STATUS.CAPTURED
                                    ? REFERRAL_STATUS.PENDING
                                    : (
                                        toSafeString(
                                            currentReferral.status
                                        ) ||
                                        REFERRAL_STATUS.PENDING
                                    );

                            qualifies =
                                currentStatus ===
                                    REFERRAL_STATUS.PENDING &&
                                referralAfter.status ===
                                    REFERRAL_STATUS.QUALIFIED;

                            policyReset =
                                currentStatus ===
                                    REFERRAL_STATUS.QUALIFIED &&
                                referralAfter.status ===
                                    REFERRAL_STATUS.PENDING;
                        }

                        transaction.set(
                            activityRef,
                            activityAfter
                        );

                        if (
                            currentReferral
                        ) {
                            const projectionChanged =
                                currentReferral.mobileAdded !==
                                    referralAfter.mobileAdded ||

                                currentReferral.deviceAdded !==
                                    referralAfter.deviceAdded ||

                                toNonNegativeInteger(
                                    currentReferral.activeDays
                                ) !==
                                    referralAfter.activeDays ||

                                currentReferral.activityCompleted !==
                                    referralAfter.activityCompleted ||

                                currentReferral.eligible !==
                                    referralAfter.eligible ||

                                toSafeString(
                                    currentReferral.status
                                ) !==
                                    referralAfter.status ||

                                toNonNegativeInteger(
                                    currentReferral.requiredDailySeconds
                                ) !==
                                    ACTIVITY.REQUIRED_DAILY_SECONDS ||

                                toNonNegativeInteger(
                                    currentReferral.activityPolicyVersion
                                ) !==
                                    ACTIVITY.POLICY_VERSION;

                            if (
                                projectionChanged
                            ) {
                                transaction.set(
                                    referralRef,
                                    referralAfter
                                );
                            }

                            if (
                                qualifies
                            ) {
                                transaction.update(
                                    dbRefs.stats(
                                        referralAfter.referrerUid
                                    ),
                                    {
                                        pending:
                                            fieldValue()
                                                .increment(
                                                    -1
                                                ),

                                        qualified:
                                            fieldValue()
                                                .increment(
                                                    1
                                                ),

                                        updatedAt:
                                            timestamp,

                                        schemaVersion:
                                            SCHEMA_VERSION
                                    }
                                );
                            } else if (
                                policyReset
                            ) {
                                transaction.update(
                                    dbRefs.stats(
                                        referralAfter.referrerUid
                                    ),
                                    {
                                        pending:
                                            fieldValue()
                                                .increment(
                                                    1
                                                ),

                                        qualified:
                                            fieldValue()
                                                .increment(
                                                    -1
                                                ),

                                        updatedAt:
                                            timestamp,

                                        schemaVersion:
                                            SCHEMA_VERSION
                                    }
                                );
                            }
                        }

                        return {
                            creditedDays:
                                completesDay
                                    ? 1
                                    : 0,

                            creditedSeconds:
                                ACTIVITY.CHECKPOINT_SECONDS,

                            reason:
                                completesAll
                                    ? "activity_completed"
                                    : (
                                        completesDay
                                            ? "eligible_day_completed"
                                            : "checkpoint_credited"
                                    ),

                            activity:
                                activityAfter,

                            referral:
                                referralAfter
                        };
                    }
                );

        if (
            result.needsReferralSync ===
            true
        ) {
            try {
                const syncResult =
                    await syncReferralProjectionFully(
                        user,
                        {
                            allowQualification:
                                true,

                            allowPolicyReset:
                                true
                        }
                    );

                if (
                    syncResult
                        ?.referral
                ) {
                    result.referral =
                        syncResult.referral;
                }
            } catch (error) {
                console.warn(
                    "[FunctionsClient] Referral activity-policy sync warning.",
                    error
                );
            }
        }

        return {
            success:
                true,

            creditedDays:
                toNonNegativeInteger(
                    result.creditedDays
                ),

            creditedSeconds:
                toNonNegativeInteger(
                    result.creditedSeconds
                ),

            reason:
                result.reason,

            nextCheckpointInSeconds:
                toNonNegativeInteger(
                    result.nextCheckpointInSeconds
                ),

            activity:
                activityForResponse(
                    result.activity,
                    user.uid
                ),

            session:
                null,

            referral:
                result.referral
                    ? normalizeReferralRecord(
                        result.referral,
                        user.uid
                    )
                    : null
        };
    }

    async function closeActivitySession(
        payload = {}
    ) {
        await waitForAuthentication();

        return {
            success:
                true,

            closed:
                false,

            legacySessionId:
                toSafeString(
                    payload.sessionId
                ),

            reason:
                "activity_sessions_retired",

            session:
                null
        };
    }

    /* =====================================================
       REFERRAL READS
    ===================================================== */

    async function getMyReferralStats() {
        const user =
            await waitForAuthentication();

        const dbRefs =
            refs(
                user.uid
            );

        let snapshot =
            await dbRefs
                .stats(
                    user.uid
                )
                .get();

        if (
            !snapshot.exists
        ) {
            await ensureProfile();

            snapshot =
                await dbRefs
                    .stats(
                        user.uid
                    )
                    .get();
        }

        return {
            success:
                true,

            stats:
                serializeValue(
                    readStats(
                        snapshot.exists
                            ? snapshot
                                .data()
                            : null,

                        user.uid
                    )
                )
        };
    }

    async function getMyReferrals(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.REFERRALS
            );

        let query =
            collection.where(
                "referrerUid",
                "==",
                user.uid
            );

        const status =
            toSafeString(
                payload.status
            )
                .toLowerCase();

        if (
            status
        ) {
            query =
                query.where(
                    "status",
                    "==",
                    status
                );
        }

        query =
            query.orderBy(
                "createdAt",
                "desc"
            );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const referrals =
            page.docs.map(
                snapshot =>
                    normalizeReferralRecord(
                        snapshot.data(),
                        snapshot.id
                    )
            );

        return {
            success:
                true,

            referrals,

            count:
                referrals.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            status:
                status ||
                "all"
        };
    }

    async function getPendingReferrals(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.REFERRALS
            );

        const query =
            collection
                .where(
                    "status",
                    "==",
                    REFERRAL_STATUS.QUALIFIED
                )
                .orderBy(
                    "createdAt",
                    "desc"
                );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const referrals =
            page.docs.map(
                snapshot =>
                    normalizeReferralRecord(
                        snapshot.data(),
                        snapshot.id
                    )
            );

        return {
            success:
                true,

            referrals,

            count:
                referrals.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            status:
                REFERRAL_STATUS.QUALIFIED
        };
    }

    /* =====================================================
       WALLET LEDGER FACTORY
    ===================================================== */

    function createWalletTransaction({
        transactionId,
        uid,
        type,
        direction,
        amount,
        referenceId,
        operationId,
        before,
        after,
        admin,
        note,
        metadata,
        timestamp
    }) {
        return {
            transactionId,

            userId:
                uid,

            uid,

            type,

            direction,

            amount,

            referenceId:
                toSafeString(
                    referenceId
                ),

            operationId:
                toSafeString(
                    operationId
                ),

            availableBalanceBefore:
                before.availableBalance,

            availableBalanceAfter:
                after.availableBalance,

            heldBalanceBefore:
                before.heldBalance,

            heldBalanceAfter:
                after.heldBalance,

            totalEarnedBefore:
                before.totalEarned,

            totalEarnedAfter:
                after.totalEarned,

            totalWithdrawnBefore:
                before.totalWithdrawn,

            totalWithdrawnAfter:
                after.totalWithdrawn,

            adminUid:
                toSafeString(
                    admin?.uid
                ),

            adminEmail:
                normalizeEmail(
                    admin?.email
                ),

            note:
                toSafeString(
                    note
                ),

            status:
                "completed",

            metadata:
                isPlainObject(
                    metadata
                )
                    ? metadata
                    : {},

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    /* =====================================================
       ADMIN REFERRAL REVIEW
    ===================================================== */

    async function approveReferral(
        payload = {}
    ) {
        const admin =
            await requireAdmin();

        const referralId =
            sanitizeId(
                payload.referralId ||
                payload.referredUid,
                "referralId"
            );

        const adminNote =
            normalizeAdminNote(
                payload.adminNote ||
                payload.note,
                false
            );

        const dbRefs =
            refs();

        const referralRef =
            dbRefs.referral(
                referralId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const referralSnapshot =
                            await transaction
                                .get(
                                    referralRef
                                );

                        if (
                            !referralSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "Referral record was not found."
                            );
                        }

                        const referral =
                            referralSnapshot
                                .data() ||
                            {};

                        if (
                            referral.rewardGranted ===
                                true ||
                            referral.status ===
                                REFERRAL_STATUS.REWARDED
                        ) {
                            return {
                                reviewed:
                                    false,

                                alreadyReviewed:
                                    true,

                                referralId,

                                status:
                                    REFERRAL_STATUS.REWARDED,

                                rewardGranted:
                                    true
                            };
                        }

                        if (
                            ![
                                REFERRAL_STATUS.QUALIFIED,
                                REFERRAL_STATUS.APPROVED
                            ].includes(
                                toSafeString(
                                    referral.status
                                )
                            )
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This referral is not ready for Admin approval."
                            );
                        }

                        if (
                            toNonNegativeInteger(
                                referral.schemaVersion
                            ) !==
                                SCHEMA_VERSION ||
                            toNonNegativeInteger(
                                referral.activityPolicyVersion
                            ) !==
                                ACTIVITY.POLICY_VERSION ||
                            toNonNegativeInteger(
                                referral.requiredDailySeconds
                            ) !==
                                ACTIVITY.REQUIRED_DAILY_SECONDS
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This referral must complete the current 7-day, 2-hour activity policy first."
                            );
                        }

                        const referrerUid =
                            sanitizeId(
                                referral.referrerUid,
                                "referrerUid"
                            );

                        const referredUid =
                            sanitizeId(
                                referral.referredUid ||
                                referralId,
                                "referredUid"
                            );

                        if (
                            referredUid !==
                                referralId ||
                            referrerUid ===
                                referredUid
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral identity data is inconsistent."
                            );
                        }

                        const statsRef =
                            dbRefs.stats(
                                referrerUid
                            );

                        const walletRef =
                            dbRefs.wallet(
                                referrerUid
                            );

                        const referrerProfileRef =
                            dbRefs.db
                                .collection(
                                    COLLECTIONS.USERS
                                )
                                .doc(
                                    referrerUid
                                );

                        const referredProfileRef =
                            dbRefs.db
                                .collection(
                                    COLLECTIONS.USERS
                                )
                                .doc(
                                    referredUid
                                );

                        const activityRef =
                            dbRefs.activity(
                                referredUid
                            );

                        const rewardId =
                            `referral_${referralId}`;

                        const rewardRef =
                            dbRefs.reward(
                                rewardId
                            );

                        const walletTransactionId =
                            `referral_reward_${referralId}`;

                        const walletTransactionRef =
                            dbRefs.walletTx(
                                walletTransactionId
                            );

                        const auditId =
                            `referral_approved_${referralId}`;

                        const auditRef =
                            dbRefs.audit(
                                auditId
                            );

                        const [
                            statsSnapshot,
                            walletSnapshot,
                            referrerProfileSnapshot,
                            referredProfileSnapshot,
                            activitySnapshot,
                            rewardSnapshot,
                            ledgerSnapshot,
                            auditSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    statsRef
                                ),

                                transaction.get(
                                    walletRef
                                ),

                                transaction.get(
                                    referrerProfileRef
                                ),

                                transaction.get(
                                    referredProfileRef
                                ),

                                transaction.get(
                                    activityRef
                                ),

                                transaction.get(
                                    rewardRef
                                ),

                                transaction.get(
                                    walletTransactionRef
                                ),

                                transaction.get(
                                    auditRef
                                )
                            ]);

                        if (
                            !referrerProfileSnapshot.exists ||
                            !isActiveProfile(
                                referrerProfileSnapshot
                                    .data()
                            )
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "The referrer profile is not active."
                            );
                        }

                        if (
                            !referredProfileSnapshot.exists ||
                            !isActiveProfile(
                                referredProfileSnapshot
                                    .data()
                            )
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "The referred profile is not active."
                            );
                        }

                        if (
                            !statsSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral statistics are not initialized."
                            );
                        }

                        if (
                            !activitySnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral activity is not initialized."
                            );
                        }

                        const referredProfile =
                            referredProfileSnapshot
                                .data() ||
                            {};

                        const activity =
                            readActivity(
                                activitySnapshot
                                    .data() ||
                                {},

                                referredUid
                            );

                        const mobileNumber =
                            toSafeString(
                                referredProfile
                                    .mobileNumber
                            );

                        const deviceId =
                            toSafeString(
                                referredProfile
                                    .deviceId
                            );

                        if (
                            !isValidMobileString(
                                mobileNumber
                            ) ||
                            !isValidDeviceId(
                                deviceId
                            )
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Mobile or Web Device qualification is incomplete."
                            );
                        }

                        const [
                            mobileReservationSnapshot,
                            deviceReservationSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    dbRefs.mobile(
                                        mobileNumber
                                    )
                                ),

                                transaction.get(
                                    dbRefs.device(
                                        deviceId
                                    )
                                )
                            ]);

                        const eligible =
                            referral.eligible ===
                                true &&

                            referral.googleConnected ===
                                true &&

                            referral.mobileAdded ===
                                true &&

                            referral.deviceAdded ===
                                true &&

                            referral.activityCompleted ===
                                true &&

                            toNonNegativeInteger(
                                referral.activeDays
                            ) ===
                                ACTIVITY.REQUIRED_DAYS &&

                            toNonNegativeInteger(
                                referral.requiredDailySeconds
                            ) ===
                                ACTIVITY.REQUIRED_DAILY_SECONDS &&

                            toNonNegativeInteger(
                                referral.activityPolicyVersion
                            ) ===
                                ACTIVITY.POLICY_VERSION &&

                            referredProfile.googleConnected ===
                                true &&

                            referredProfile.isGoogleConnected ===
                                true &&

                            activity.completed ===
                                true &&

                            activity.activeDays ===
                                ACTIVITY.REQUIRED_DAYS &&

                            activity.activityPolicyVersion ===
                                ACTIVITY.POLICY_VERSION &&

                            activity.requiredDailySeconds ===
                                ACTIVITY.REQUIRED_DAILY_SECONDS &&

                            mobileReservationSnapshot.exists &&

                            toSafeString(
                                mobileReservationSnapshot
                                    .data()
                                    ?.uid
                            ) ===
                                referredUid &&

                            deviceReservationSnapshot.exists &&

                            toSafeString(
                                deviceReservationSnapshot
                                    .data()
                                    ?.uid
                            ) ===
                                referredUid &&

                            toSafeString(
                                deviceReservationSnapshot
                                    .data()
                                    ?.deviceId
                            ) ===
                                deviceId;

                        if (
                            !eligible
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This referral has not completed all Google, mobile, device and activity requirements."
                            );
                        }

                        if (
                            rewardSnapshot.exists ||
                            ledgerSnapshot.exists ||
                            auditSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral reward records are inconsistent or were already created."
                            );
                        }

                        const timestamp =
                            serverTimestamp();

                        const stats =
                            readStats(
                                statsSnapshot
                                    .data() ||
                                {},

                                referrerUid
                            );

                        const walletBefore =
                            readWallet(
                                walletSnapshot.exists
                                    ? walletSnapshot
                                        .data() ||
                                    {}
                                    : null,

                                referrerUid
                            );

                        const walletAfter =
                            withWalletOperation(
                                {
                                    ...walletBefore,

                                    availableBalance:
                                        walletBefore.availableBalance +
                                        REWARD_AMOUNT,

                                    totalEarned:
                                        walletBefore.totalEarned +
                                        REWARD_AMOUNT,

                                    revision:
                                        walletBefore.revision +
                                        1,

                                    createdAt:
                                        walletBefore.createdAt ||
                                        timestamp
                                },

                                walletTransactionId,

                                "referral_reward",

                                timestamp
                            );

                        const referralUpdate = {
                            ...createReferralProjection(
                                referral,
                                referredProfile,
                                activity,
                                timestamp,
                                {
                                    allowQualification:
                                        false,

                                    allowPolicyReset:
                                        false
                                }
                            ),

                            status:
                                REFERRAL_STATUS.REWARDED,

                            eligible:
                                true,

                            rewardAmount:
                                REWARD_AMOUNT,

                            rewardGranted:
                                true,

                            rewardGrantedAt:
                                timestamp,

                            reviewedAt:
                                timestamp,

                            reviewedBy:
                                admin.uid,

                            approvedAt:
                                timestamp,

                            rejectedAt:
                                null,

                            rewardedAt:
                                timestamp,

                            adminNote,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.set(
                            referralRef,
                            referralUpdate
                        );

                        transaction.set(
                            statsRef,
                            {
                                ...stats,

                                qualified:
                                    referral.status ===
                                        REFERRAL_STATUS.QUALIFIED
                                        ? Math.max(
                                            0,
                                            stats.qualified -
                                            1
                                        )
                                        : stats.qualified,

                                approved:
                                    stats.approved +
                                    (
                                        referral.status ===
                                            REFERRAL_STATUS.APPROVED
                                            ? 0
                                            : 1
                                    ),

                                rewarded:
                                    stats.rewarded +
                                    1,

                                totalReward:
                                    stats.totalReward +
                                    REWARD_AMOUNT,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        transaction.set(
                            walletRef,
                            walletAfter
                        );

                        transaction.set(
                            walletTransactionRef,
                            createWalletTransaction({
                                transactionId:
                                    walletTransactionId,

                                uid:
                                    referrerUid,

                                type:
                                    "referral_reward",

                                direction:
                                    "credit",

                                amount:
                                    REWARD_AMOUNT,

                                referenceId:
                                    referralId,

                                operationId:
                                    rewardId,

                                before:
                                    walletBefore,

                                after:
                                    walletAfter,

                                admin,

                                note:
                                    adminNote,

                                metadata: {
                                    referralId,

                                    referredUid,

                                    referralCode:
                                        normalizeReferralCode(
                                            referral.referralCode
                                        ),

                                    activityPolicyVersion:
                                        ACTIVITY.POLICY_VERSION,

                                    requiredDailySeconds:
                                        ACTIVITY.REQUIRED_DAILY_SECONDS
                                },

                                timestamp
                            })
                        );

                        transaction.set(
                            rewardRef,
                            {
                                rewardEventId:
                                    rewardId,

                                type:
                                    "referral",

                                status:
                                    "credited",

                                userId:
                                    referrerUid,

                                uid:
                                    referrerUid,

                                referredUid,

                                referralId,

                                referralCode:
                                    normalizeReferralCode(
                                        referral.referralCode
                                    ),

                                amount:
                                    REWARD_AMOUNT,

                                walletTransactionId,

                                approvedBy:
                                    admin.uid,

                                approvedByEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                approvedAt:
                                    timestamp,

                                creditedAt:
                                    timestamp,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        transaction.set(
                            auditRef,
                            {
                                auditId,

                                action:
                                    "referral_approved",

                                adminUid:
                                    admin.uid,

                                adminEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                adminRole:
                                    "admin",

                                targetUid:
                                    referredUid,

                                referrerUid,

                                referralId,

                                previousStatus:
                                    referral.status,

                                newStatus:
                                    REFERRAL_STATUS.REWARDED,

                                rewardAmount:
                                    REWARD_AMOUNT,

                                walletTransactionId,

                                note:
                                    adminNote,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            reviewed:
                                true,

                            alreadyReviewed:
                                false,

                            referralId,

                            status:
                                REFERRAL_STATUS.REWARDED,

                            rewardAmount:
                                REWARD_AMOUNT,

                            rewardGranted:
                                true,

                            wallet:
                                walletAfter,

                            walletTransactionId,

                            auditId,

                            referral:
                                referralUpdate
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    async function rejectReferral(
        payload = {}
    ) {
        const admin =
            await requireAdmin();

        const referralId =
            sanitizeId(
                payload.referralId ||
                payload.referredUid,
                "referralId"
            );

        const adminNote =
            normalizeAdminNote(
                payload.adminNote ||
                payload.note,
                false
            );

        const dbRefs =
            refs();

        const referralRef =
            dbRefs.referral(
                referralId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const referralSnapshot =
                            await transaction
                                .get(
                                    referralRef
                                );

                        if (
                            !referralSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "Referral record was not found."
                            );
                        }

                        const referral =
                            referralSnapshot
                                .data() ||
                            {};

                        if (
                            referral.status ===
                                REFERRAL_STATUS.REJECTED
                        ) {
                            return {
                                reviewed:
                                    false,

                                alreadyReviewed:
                                    true,

                                referralId,

                                status:
                                    REFERRAL_STATUS.REJECTED,

                                rewardGranted:
                                    false
                            };
                        }

                        if (
                            referral.status !==
                                REFERRAL_STATUS.QUALIFIED ||
                            toNonNegativeInteger(
                                referral.schemaVersion
                            ) !==
                                SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This referral is not ready for rejection."
                            );
                        }

                        const referrerUid =
                            sanitizeId(
                                referral.referrerUid,
                                "referrerUid"
                            );

                        const statsRef =
                            dbRefs.stats(
                                referrerUid
                            );

                        const auditId =
                            `referral_rejected_${referralId}`;

                        const auditRef =
                            dbRefs.audit(
                                auditId
                            );

                        const [
                            statsSnapshot,
                            auditSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    statsRef
                                ),

                                transaction.get(
                                    auditRef
                                )
                            ]);

                        if (
                            !statsSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral statistics are not initialized."
                            );
                        }

                        if (
                            auditSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Referral review records are inconsistent."
                            );
                        }

                        const timestamp =
                            serverTimestamp();

                        const stats =
                            readStats(
                                statsSnapshot
                                    .data() ||
                                {},

                                referrerUid
                            );

                        const referralUpdate = {
                            ...referral,

                            status:
                                REFERRAL_STATUS.REJECTED,

                            rewardGranted:
                                false,

                            reviewedAt:
                                timestamp,

                            reviewedBy:
                                admin.uid,

                            rejectedAt:
                                timestamp,

                            approvedAt:
                                null,

                            rewardedAt:
                                null,

                            adminNote,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.set(
                            referralRef,
                            referralUpdate
                        );

                        transaction.set(
                            statsRef,
                            {
                                ...stats,

                                qualified:
                                    Math.max(
                                        0,
                                        stats.qualified -
                                        1
                                    ),

                                rejected:
                                    stats.rejected +
                                    1,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        transaction.set(
                            auditRef,
                            {
                                auditId,

                                action:
                                    "referral_rejected",

                                adminUid:
                                    admin.uid,

                                adminEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                adminRole:
                                    "admin",

                                targetUid:
                                    toSafeString(
                                        referral.referredUid ||
                                        referralId
                                    ),

                                referrerUid,

                                referralId,

                                previousStatus:
                                    referral.status,

                                newStatus:
                                    REFERRAL_STATUS.REJECTED,

                                rewardAmount:
                                    0,

                                walletTransactionId:
                                    "",

                                note:
                                    adminNote,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            reviewed:
                                true,

                            alreadyReviewed:
                                false,

                            referralId,

                            status:
                                REFERRAL_STATUS.REJECTED,

                            rewardGranted:
                                false,

                            auditId,

                            referral:
                                referralUpdate
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    /* =====================================================
       WALLET READS
    ===================================================== */

    async function getMyWallet() {
        const user =
            await waitForAuthentication();

        const dbRefs =
            refs(
                user.uid
            );

        let snapshot =
            await dbRefs
                .wallet(
                    user.uid
                )
                .get();

        if (
            !snapshot.exists
        ) {
            await ensureProfile();

            snapshot =
                await dbRefs
                    .wallet(
                        user.uid
                    )
                    .get();
        }

        return {
            success:
                true,

            wallet:
                serializeValue(
                    readWallet(
                        snapshot.exists
                            ? snapshot
                                .data()
                            : null,

                        user.uid
                    )
                )
        };
    }

    async function getMyWalletTransactions(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.WALLET_TRANSACTIONS
            );

        const query =
            collection
                .where(
                    "userId",
                    "==",
                    user.uid
                )
                .orderBy(
                    "createdAt",
                    "desc"
                );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const transactions =
            page.docs.map(
                snapshot =>
                    snapshotData(
                        snapshot
                    )
            );

        return {
            success:
                true,

            transactions,

            count:
                transactions.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor
        };
    }

    /* =====================================================
       WITHDRAWALS
    ===================================================== */

    function normalizeWithdrawalRecord(
        data,
        id = ""
    ) {
        const source =
            data ||
            {};

        return serializeValue({
            id:
                id ||
                toSafeString(
                    source.withdrawalId
                ),

            ...source,

            withdrawalId:
                toSafeString(
                    source.withdrawalId ||
                    id
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid
                ),

            uid:
                toSafeString(
                    source.uid ||
                    source.userId
                ),

            provider:
                toSafeString(
                    source.provider
                )
                    .toLowerCase(),

            walletNumber:
                toSafeString(
                    source.walletNumber ||
                    source.wallet ||
                    source.number
                ),

            wallet:
                toSafeString(
                    source.wallet ||
                    source.walletNumber ||
                    source.number
                ),

            number:
                toSafeString(
                    source.number ||
                    source.walletNumber ||
                    source.wallet
                ),

            amount:
                toNonNegativeInteger(
                    source.amount
                ),

            status:
                toSafeString(
                    source.status
                ) ||
                WITHDRAWAL_STATUS.PENDING,

            paymentConfirmed:
                source.paymentConfirmed ===
                true,

            paymentReference:
                toSafeString(
                    source.paymentReference
                )
        });
    }

    async function submitWithdrawal(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const provider =
            normalizeProvider(
                payload.provider
            );

        const walletNumber =
            normalizeMobileNumber(
                payload.walletNumber ||
                payload.wallet ||
                payload.number
            );

        const amount =
            normalizeAmount(
                payload.amount
            );

        const requestId =
            sanitizeId(
                payload.requestId ||
                randomId(
                    "request"
                ),
                "requestId"
            );

        if (
            amount <
                MINIMUM_WITHDRAWAL ||
            amount %
                WITHDRAWAL_MULTIPLE !==
                0
        ) {
            throw clientError(
                "invalid-argument",
                `Withdrawal must be at least ৳${MINIMUM_WITHDRAWAL} and a multiple of ৳${WITHDRAWAL_MULTIPLE}.`,
                "amount"
            );
        }

        const dbRefs =
            refs(
                user.uid
            );

        const withdrawalId =
            `wd_${stableHash(
                `${user.uid}:${requestId}`
            )}`;

        const withdrawalRef =
            dbRefs.withdrawal(
                withdrawalId
            );

        const holdTransactionId =
            `withdraw_hold_${withdrawalId}`;

        const holdTransactionRef =
            dbRefs.walletTx(
                holdTransactionId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const [
                            profileSnapshot,
                            walletSnapshot,
                            withdrawalSnapshot,
                            holdSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    dbRefs.user
                                ),

                                transaction.get(
                                    dbRefs.wallet(
                                        user.uid
                                    )
                                ),

                                transaction.get(
                                    withdrawalRef
                                ),

                                transaction.get(
                                    holdTransactionRef
                                )
                            ]);

                        if (
                            !profileSnapshot.exists ||
                            !isActiveProfile(
                                profileSnapshot
                                    .data()
                            )
                        ) {
                            throw clientError(
                                "permission-denied",
                                "This profile is not active."
                            );
                        }

                        if (
                            withdrawalSnapshot.exists
                        ) {
                            const existing =
                                withdrawalSnapshot
                                    .data() ||
                                {};

                            if (
                                toSafeString(
                                    existing.requestId
                                ) !==
                                    requestId ||

                                toSafeString(
                                    existing.provider
                                ) !==
                                    provider ||

                                toSafeString(
                                    existing.walletNumber ||
                                    existing.number
                                ) !==
                                    walletNumber ||

                                toNonNegativeInteger(
                                    existing.amount
                                ) !==
                                    amount
                            ) {
                                throw clientError(
                                    "already-exists",
                                    "This request ID is already used by another withdrawal."
                                );
                            }

                            return {
                                created:
                                    false,

                                duplicate:
                                    true,

                                idempotent:
                                    true,

                                requestId,

                                withdrawal:
                                    existing,

                                wallet:
                                    walletSnapshot.exists
                                        ? walletSnapshot
                                            .data()
                                        : null,

                                walletTransactionId:
                                    holdTransactionId
                            };
                        }

                        if (
                            holdSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "A withdrawal hold record already exists without its request."
                            );
                        }

                        if (
                            !walletSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Wallet is not initialized. Sign in again and retry."
                            );
                        }

                        const walletRaw =
                            walletSnapshot
                                .data() ||
                            {};

                        if (
                            toNonNegativeInteger(
                                walletRaw.schemaVersion
                            ) !==
                            SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Wallet migration is required before withdrawal. Sign in again and retry."
                            );
                        }

                        const walletBefore =
                            readWallet(
                                walletRaw,
                                user.uid
                            );

                        if (
                            walletBefore.availableBalance <
                            amount
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Your wallet balance is not sufficient.",
                                "amount"
                            );
                        }

                        const timestamp =
                            serverTimestamp();

                        const walletAfter =
                            withWalletOperation(
                                {
                                    ...walletBefore,

                                    availableBalance:
                                        walletBefore.availableBalance -
                                        amount,

                                    heldBalance:
                                        walletBefore.heldBalance +
                                        amount,

                                    revision:
                                        walletBefore.revision +
                                        1
                                },

                                holdTransactionId,

                                "withdraw_hold",

                                timestamp
                            );

                        const withdrawal = {
                            withdrawalId,

                            userId:
                                user.uid,

                            uid:
                                user.uid,

                            provider,

                            walletNumber,

                            wallet:
                                walletNumber,

                            number:
                                walletNumber,

                            amount,

                            status:
                                WITHDRAWAL_STATUS.PENDING,

                            requestId,

                            transactionId:
                                holdTransactionId,

                            holdTransactionId,

                            completionTransactionId:
                                "",

                            refundTransactionId:
                                "",

                            paymentConfirmed:
                                false,

                            paymentConfirmedAt:
                                null,

                            paymentReference:
                                "",

                            reviewedAt:
                                null,

                            approvedAt:
                                null,

                            rejectedAt:
                                null,

                            cancelledAt:
                                null,

                            reviewedBy:
                                "",

                            adminNote:
                                "",

                            date:
                                timestamp,

                            createdAt:
                                timestamp,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.set(
                            dbRefs.wallet(
                                user.uid
                            ),
                            walletAfter
                        );

                        transaction.set(
                            withdrawalRef,
                            withdrawal
                        );

                        transaction.set(
                            holdTransactionRef,

                            createWalletTransaction({
                                transactionId:
                                    holdTransactionId,

                                uid:
                                    user.uid,

                                type:
                                    "withdraw_hold",

                                direction:
                                    "debit",

                                amount,

                                referenceId:
                                    withdrawalId,

                                operationId:
                                    requestId,

                                before:
                                    walletBefore,

                                after:
                                    walletAfter,

                                admin:
                                    null,

                                note:
                                    "Withdrawal amount held",

                                metadata: {
                                    withdrawalId,
                                    requestId,
                                    provider
                                },

                                timestamp
                            })
                        );

                        return {
                            created:
                                true,

                            duplicate:
                                false,

                            idempotent:
                                false,

                            requestId,

                            withdrawal,

                            wallet:
                                walletAfter,

                            walletTransactionId:
                                holdTransactionId
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    async function cancelWithdrawal(
        payload = {}
    ) {
        await waitForAuthentication();

        toSafeString(
            payload.withdrawalId
        );

        throw clientError(
            "failed-precondition",
            "A submitted withdrawal cannot be cancelled, edited or removed by the user.",
            "withdrawalId"
        );
    }

    async function getMyWithdrawals(
        payload = {}
    ) {
        const user =
            await waitForAuthentication();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.WITHDRAWALS
            );

        let query =
            collection.where(
                "userId",
                "==",
                user.uid
            );

        const status =
            toSafeString(
                payload.status
            )
                .toLowerCase();

        if (
            status
        ) {
            query =
                query.where(
                    "status",
                    "==",
                    status
                );
        }

        query =
            query.orderBy(
                "createdAt",
                "desc"
            );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const withdrawals =
            page.docs.map(
                snapshot =>
                    normalizeWithdrawalRecord(
                        snapshot.data(),
                        snapshot.id
                    )
            );

        return {
            success:
                true,

            withdrawals,

            count:
                withdrawals.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            status:
                status ||
                "all"
        };
    }

    function createWithdrawalSummary(
        withdrawals
    ) {
        const summary = {
            total:
                0,

            pending:
                0,

            approved:
                0,

            rejected:
                0,

            cancelled:
                0,

            totalRequestedAmount:
                0,

            totalPendingAmount:
                0,

            totalApprovedAmount:
                0,

            totalRejectedAmount:
                0,

            totalCancelledAmount:
                0,

            minimumWithdrawalAmount:
                MINIMUM_WITHDRAWAL,

            lastWithdrawal:
                withdrawals[0] ||
                null
        };

        withdrawals.forEach(
            withdrawal => {
                const amount =
                    toNonNegativeInteger(
                        withdrawal.amount
                    );

                summary.total +=
                    1;

                summary.totalRequestedAmount +=
                    amount;

                if (
                    withdrawal.status ===
                        WITHDRAWAL_STATUS.PENDING
                ) {
                    summary.pending +=
                        1;

                    summary.totalPendingAmount +=
                        amount;
                } else if (
                    withdrawal.status ===
                        WITHDRAWAL_STATUS.APPROVED
                ) {
                    summary.approved +=
                        1;

                    summary.totalApprovedAmount +=
                        amount;
                } else if (
                    withdrawal.status ===
                        WITHDRAWAL_STATUS.REJECTED
                ) {
                    summary.rejected +=
                        1;

                    summary.totalRejectedAmount +=
                        amount;
                } else if (
                    withdrawal.status ===
                        WITHDRAWAL_STATUS.CANCELLED
                ) {
                    summary.cancelled +=
                        1;

                    summary.totalCancelledAmount +=
                        amount;
                }
            }
        );

        summary.processing =
            summary.pending;

        summary.successful =
            summary.approved;

        summary.totalProcessingAmount =
            summary.totalPendingAmount;

        summary.totalSuccessfulAmount =
            summary.totalApprovedAmount;

        return summary;
    }

    async function getMyWithdrawalSummary() {
        const user =
            await waitForAuthentication();

        const snapshot =
            await resolveFirestore()
                .collection(
                    COLLECTIONS.WITHDRAWALS
                )
                .where(
                    "userId",
                    "==",
                    user.uid
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .get();

        const withdrawals =
            snapshot.docs.map(
                item =>
                    normalizeWithdrawalRecord(
                        item.data(),
                        item.id
                    )
            );

        return {
            success:
                true,

            summary:
                createWithdrawalSummary(
                    withdrawals
                )
        };
    }

    async function getPendingWithdrawals(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.WITHDRAWALS
            );

        const query =
            collection
                .where(
                    "status",
                    "==",
                    WITHDRAWAL_STATUS.PENDING
                )
                .orderBy(
                    "createdAt",
                    "desc"
                );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const withdrawals =
            page.docs.map(
                snapshot =>
                    normalizeWithdrawalRecord(
                        snapshot.data(),
                        snapshot.id
                    )
            );

        return {
            success:
                true,

            withdrawals,

            count:
                withdrawals.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            status:
                WITHDRAWAL_STATUS.PENDING
        };
    }

    /* =====================================================
       ADMIN WITHDRAWAL — APPROVE / REJECT ONLY
    ===================================================== */

    async function reviewWithdrawal(
        payload = {},
        approved
    ) {
        const admin =
            await requireAdmin();

        const withdrawalId =
            sanitizeId(
                payload.withdrawalId,
                "withdrawalId"
            );

        const adminNote =
            normalizeAdminNote(
                payload.adminNote ||
                payload.note,
                false
            );

        const dbRefs =
            refs();

        const withdrawalRef =
            dbRefs.withdrawal(
                withdrawalId
            );

        const ledgerId =
            `${
                approved
                    ? "withdraw_success"
                    : "withdraw_refund"
            }_${withdrawalId}`;

        const ledgerRef =
            dbRefs.walletTx(
                ledgerId
            );

        const auditId =
            `withdrawal_${
                approved
                    ? "approved"
                    : "rejected"
            }_${withdrawalId}`;

        const auditRef =
            dbRefs.audit(
                auditId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const withdrawalSnapshot =
                            await transaction
                                .get(
                                    withdrawalRef
                                );

                        if (
                            !withdrawalSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "Withdrawal request was not found."
                            );
                        }

                        const withdrawal =
                            withdrawalSnapshot
                                .data() ||
                            {};

                        const targetStatus =
                            approved
                                ? WITHDRAWAL_STATUS.APPROVED
                                : WITHDRAWAL_STATUS.REJECTED;

                        if (
                            withdrawal.status ===
                            targetStatus
                        ) {
                            return {
                                reviewed:
                                    false,

                                alreadyReviewed:
                                    true,

                                withdrawalId,

                                status:
                                    targetStatus,

                                withdrawal
                            };
                        }

                        if (
                            withdrawal.status !==
                            WITHDRAWAL_STATUS.PENDING
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This withdrawal has already received a final decision."
                            );
                        }

                        if (
                            toNonNegativeInteger(
                                withdrawal.schemaVersion
                            ) !==
                            SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This legacy withdrawal must be resolved under the current data contract first."
                            );
                        }

                        const uid =
                            sanitizeId(
                                withdrawal.userId ||
                                withdrawal.uid,
                                "userId"
                            );

                        const walletRef =
                            dbRefs.wallet(
                                uid
                            );

                        const [
                            walletSnapshot,
                            ledgerSnapshot,
                            auditSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    walletRef
                                ),

                                transaction.get(
                                    ledgerRef
                                ),

                                transaction.get(
                                    auditRef
                                )
                            ]);

                        if (
                            ledgerSnapshot.exists ||
                            auditSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Withdrawal decision records are inconsistent or already exist."
                            );
                        }

                        if (
                            !walletSnapshot.exists
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Wallet is not initialized."
                            );
                        }

                        const walletBefore =
                            readWallet(
                                walletSnapshot
                                    .data() ||
                                {},

                                uid
                            );

                        const amount =
                            toNonNegativeInteger(
                                withdrawal.amount
                            );

                        if (
                            amount <
                                MINIMUM_WITHDRAWAL ||
                            amount %
                                WITHDRAWAL_MULTIPLE !==
                                0 ||
                            walletBefore.heldBalance <
                                amount
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "Held wallet balance is inconsistent."
                            );
                        }

                        const timestamp =
                            serverTimestamp();

                        const walletAfter =
                            withWalletOperation(
                                approved
                                    ? {
                                        ...walletBefore,

                                        heldBalance:
                                            walletBefore.heldBalance -
                                            amount,

                                        totalWithdrawn:
                                            walletBefore.totalWithdrawn +
                                            amount,

                                        lastWithdrawalAmount:
                                            amount,

                                        lastWithdrawalAt:
                                            timestamp,

                                        revision:
                                            walletBefore.revision +
                                            1
                                    }
                                    : {
                                        ...walletBefore,

                                        availableBalance:
                                            walletBefore.availableBalance +
                                            amount,

                                        heldBalance:
                                            walletBefore.heldBalance -
                                            amount,

                                        revision:
                                            walletBefore.revision +
                                            1
                                    },

                                ledgerId,

                                approved
                                    ? "withdraw_success"
                                    : "withdraw_refund",

                                timestamp
                            );

                        const withdrawalUpdate = {
                            ...withdrawal,

                            status:
                                targetStatus,

                            completionTransactionId:
                                approved
                                    ? ledgerId
                                    : "",

                            refundTransactionId:
                                approved
                                    ? ""
                                    : ledgerId,

                            paymentConfirmed:
                                withdrawal.paymentConfirmed ===
                                true,

                            paymentConfirmedAt:
                                withdrawal.paymentConfirmedAt ||
                                null,

                            paymentReference:
                                toSafeString(
                                    withdrawal.paymentReference
                                ),

                            reviewedAt:
                                timestamp,

                            approvedAt:
                                approved
                                    ? timestamp
                                    : null,

                            rejectedAt:
                                approved
                                    ? null
                                    : timestamp,

                            reviewedBy:
                                admin.uid,

                            adminNote,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SCHEMA_VERSION
                        };

                        transaction.set(
                            walletRef,
                            walletAfter
                        );

                        transaction.set(
                            withdrawalRef,
                            withdrawalUpdate
                        );

                        transaction.set(
                            ledgerRef,
                            createWalletTransaction({
                                transactionId:
                                    ledgerId,

                                uid,

                                type:
                                    approved
                                        ? "withdraw_success"
                                        : "withdraw_refund",

                                direction:
                                    approved
                                        ? "debit"
                                        : "credit",

                                amount,

                                referenceId:
                                    withdrawalId,

                                operationId:
                                    auditId,

                                before:
                                    walletBefore,

                                after:
                                    walletAfter,

                                admin,

                                note:
                                    adminNote,

                                metadata: {
                                    withdrawalId,

                                    provider:
                                        toSafeString(
                                            withdrawal.provider
                                        )
                                },

                                timestamp
                            })
                        );

                        transaction.set(
                            auditRef,
                            {
                                auditId,

                                action:
                                    approved
                                        ? "withdrawal_approved"
                                        : "withdrawal_rejected",

                                adminUid:
                                    admin.uid,

                                adminEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                adminRole:
                                    "admin",

                                targetUid:
                                    uid,

                                withdrawalId,

                                previousStatus:
                                    withdrawal.status,

                                newStatus:
                                    targetStatus,

                                amount,

                                walletTransactionId:
                                    ledgerId,

                                note:
                                    adminNote,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            reviewed:
                                true,

                            alreadyReviewed:
                                false,

                            withdrawalId,

                            status:
                                targetStatus,

                            withdrawal:
                                withdrawalUpdate,

                            wallet:
                                walletAfter,

                            walletTransactionId:
                                ledgerId,

                            auditId
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    function approveWithdrawal(
        payload = {}
    ) {
        return reviewWithdrawal(
            payload,
            true
        );
    }

    function rejectWithdrawal(
        payload = {}
    ) {
        return reviewWithdrawal(
            payload,
            false
        );
    }

    /* =====================================================
       ADMIN USER SUMMARY
    ===================================================== */

    function createAdminUserSummary(
        profile,
        uid,
        wallet,
        activity,
        stats
    ) {
        const normalizedActivity =
            readActivity(
                activity,
                uid
            );

        const normalizedStats =
            readStats(
                stats,
                uid
            );

        const activityResponse =
            activityForResponse(
                activity,
                uid
            );

        const activeDays =
            normalizedActivity.activeDays;

        return serializeValue({
            uid:
                toSafeString(
                    profile?.uid ||
                    uid
                ),

            name:
                toSafeString(
                    profile?.displayName ||
                    profile?.name
                ),

            displayName:
                toSafeString(
                    profile?.displayName ||
                    profile?.name
                ),

            username:
                toSafeString(
                    profile?.username
                ),

            email:
                normalizeEmail(
                    profile?.email
                ),

            photoURL:
                toSafeString(
                    profile?.photoURL ||
                    profile?.photo
                ),

            accountType:
                toSafeString(
                    profile?.accountType ||
                    "google"
                ),

            mobileNumber:
                toSafeString(
                    profile?.mobileNumber
                ),

            mobileAdded:
                profile?.mobileAdded ===
                    true ||
                Boolean(
                    profile?.mobileNumber
                ),

            mobileLocked:
                profile?.mobileLocked ===
                    true ||
                Boolean(
                    profile?.mobileNumber
                ),

            deviceId:
                toSafeString(
                    profile?.deviceId
                ),

            deviceAdded:
                profile?.deviceAdded ===
                    true &&
                isValidDeviceId(
                    profile?.deviceId
                ),

            deviceLocked:
                profile?.deviceLocked ===
                    true &&
                isValidDeviceId(
                    profile?.deviceId
                ),

            googleConnected:
                profile?.googleConnected ===
                    true ||
                profile?.isGoogleConnected ===
                    true,

            referralCode:
                normalizeReferralCode(
                    profile?.referralCode
                ),

            referralLink:
                toSafeString(
                    profile?.referralLink
                ),

            referredByUid:
                toSafeString(
                    profile?.referredByUid
                ),

            referredByCode:
                normalizeReferralCode(
                    profile?.referredByCode
                ),

            registrationDate:
                profile?.registrationDate ||
                profile?.createdAt ||
                null,

            lastLogin:
                profile?.lastLogin ||
                null,

            status:
                toSafeString(
                    profile?.status
                ) ||
                PROFILE_STATUS.ACTIVE,

            activity: {
                activeDays,

                requiredActiveDays:
                    ACTIVITY.REQUIRED_DAYS,

                currentDaySeconds:
                    normalizedActivity.currentDaySeconds,

                todayActiveSeconds:
                    normalizedActivity.currentDaySeconds,

                requiredDailySeconds:
                    ACTIVITY.REQUIRED_DAILY_SECONDS,

                remainingTodaySeconds:
                    activityResponse.remainingTodaySeconds,

                currentDayCompleted:
                    normalizedActivity.currentDayCompleted,

                remainingActiveDays:
                    Math.max(
                        0,
                        ACTIVITY.REQUIRED_DAYS -
                        activeDays
                    ),

                progressPercent:
                    activityResponse.progressPercent,

                dailyProgressPercent:
                    activityResponse.dailyProgressPercent,

                completed:
                    normalizedActivity.completed ===
                    true,

                lastActiveAt:
                    normalizedActivity.lastActiveAt,

                completedAt:
                    normalizedActivity.completedAt,

                activityPolicyVersion:
                    ACTIVITY.POLICY_VERSION
            },

            usingTime: {
                activeDays,

                requiredActiveDays:
                    ACTIVITY.REQUIRED_DAYS,

                remainingActiveDays:
                    Math.max(
                        0,
                        ACTIVITY.REQUIRED_DAYS -
                        activeDays
                    ),

                totalActiveSeconds:
                    activityResponse.totalActiveSeconds,

                requiredActiveSeconds:
                    ACTIVITY.REQUIRED_TOTAL_SECONDS,

                remainingActiveSeconds:
                    Math.max(
                        0,

                        ACTIVITY.REQUIRED_TOTAL_SECONDS -
                        activityResponse.totalActiveSeconds
                    ),

                currentDaySeconds:
                    normalizedActivity.currentDaySeconds,

                requiredDailySeconds:
                    ACTIVITY.REQUIRED_DAILY_SECONDS,

                progressPercent:
                    activityResponse.progressPercent,

                completed:
                    normalizedActivity.completed ===
                    true,

                completedAt:
                    normalizedActivity.completedAt
            },

            wallet: {
                availableBalance:
                    toNonNegativeInteger(
                        wallet?.availableBalance
                    ),

                heldBalance:
                    toNonNegativeInteger(
                        wallet?.heldBalance
                    ),

                totalEarned:
                    toNonNegativeInteger(
                        wallet?.totalEarned
                    ),

                totalWithdrawn:
                    toNonNegativeInteger(
                        wallet?.totalWithdrawn
                    )
            },

            referrals: {
                ...normalizedStats,

                observing:
                    normalizedStats.pending,

                pendingReview:
                    normalizedStats.qualified,

                valid:
                    normalizedStats.rewarded,

                invalid:
                    normalizedStats.rejected
            }
        });
    }

    /* =====================================================
       ADMIN SESSION
    ===================================================== */

    async function getAdminSession() {
        const admin =
            await requireAdmin();

        return {
            success:
                true,

            admin: {
                uid:
                    admin.uid,

                email:
                    normalizeEmail(
                        admin.email
                    ),

                displayName:
                    toSafeString(
                        admin.displayName
                    ) ||
                    "Admin",

                name:
                    toSafeString(
                        admin.displayName
                    ) ||
                    "Admin",

                photoURL:
                    toSafeString(
                        admin.photoURL
                    ),

                role:
                    "admin",

                isAdmin:
                    true,

                isSuperAdmin:
                    false
            }
        };
    }

    /* =====================================================
       ADMIN DASHBOARD
    ===================================================== */

    async function getAdminDashboardSummary() {
        await requireAdmin();

        const db =
            resolveFirestore();

        const [
            usersSnapshot,
            referralsSnapshot,
            withdrawalsSnapshot,
            walletsSnapshot,
            transactionCount
        ] =
            await Promise.all([
                db.collection(
                    COLLECTIONS.USERS
                ).get(),

                db.collection(
                    COLLECTIONS.REFERRALS
                ).get(),

                db.collection(
                    COLLECTIONS.WITHDRAWALS
                ).get(),

                db.collection(
                    COLLECTIONS.WALLETS
                ).get(),

                queryCount(
                    db.collection(
                        COLLECTIONS.WALLET_TRANSACTIONS
                    )
                )
            ]);

        const summary = {
            users: {
                total:
                    0,

                active:
                    0,

                suspended:
                    0,

                blocked:
                    0
            },

            referrals: {
                total:
                    0,

                captured:
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

            withdrawals: {
                total:
                    0,

                pending:
                    0,

                approved:
                    0,

                rejected:
                    0,

                cancelled:
                    0,

                pendingAmount:
                    0,

                approvedAmount:
                    0,

                rejectedAmount:
                    0,

                cancelledAmount:
                    0
            },

            wallets: {
                availableBalance:
                    0,

                heldBalance:
                    0,

                totalEarned:
                    0,

                totalWithdrawn:
                    0
            },

            transactions: {
                total:
                    transactionCount
            }
        };

        usersSnapshot.forEach(
            snapshot => {
                const status =
                    toSafeString(
                        snapshot
                            .data()
                            ?.status
                    ) ||
                    PROFILE_STATUS.ACTIVE;

                summary.users.total +=
                    1;

                if (
                    status ===
                    PROFILE_STATUS.SUSPENDED
                ) {
                    summary.users.suspended +=
                        1;
                } else if (
                    status ===
                    PROFILE_STATUS.BLOCKED
                ) {
                    summary.users.blocked +=
                        1;
                } else {
                    summary.users.active +=
                        1;
                }
            }
        );

        referralsSnapshot.forEach(
            snapshot => {
                const referral =
                    snapshot
                        .data() ||
                    {};

                const rawStatus =
                    toSafeString(
                        referral.status
                    ) ||
                    REFERRAL_STATUS.PENDING;

                const status =
                    rawStatus ===
                        REFERRAL_STATUS.CAPTURED
                        ? REFERRAL_STATUS.PENDING
                        : rawStatus;

                summary.referrals.total +=
                    1;

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            summary.referrals,
                            status
                        )
                ) {
                    summary.referrals[
                        status
                    ] +=
                        1;
                }

                if (
                    status ===
                        REFERRAL_STATUS.REWARDED ||
                    referral.rewardGranted ===
                        true
                ) {
                    summary.referrals.totalReward +=
                        (
                            toNonNegativeInteger(
                                referral.rewardAmount,
                                REWARD_AMOUNT
                            ) ||
                            REWARD_AMOUNT
                        );
                }
            }
        );

        summary.referrals.observing =
            summary.referrals.pending;

        summary.referrals.pendingReview =
            summary.referrals.qualified;

        summary.referrals.valid =
            summary.referrals.rewarded;

        summary.referrals.invalid =
            summary.referrals.rejected;

        withdrawalsSnapshot.forEach(
            snapshot => {
                const withdrawal =
                    snapshot
                        .data() ||
                    {};

                const status =
                    toSafeString(
                        withdrawal.status
                    ) ||
                    WITHDRAWAL_STATUS.PENDING;

                const amount =
                    toNonNegativeInteger(
                        withdrawal.amount
                    );

                summary.withdrawals.total +=
                    1;

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            summary.withdrawals,
                            status
                        )
                ) {
                    summary.withdrawals[
                        status
                    ] +=
                        1;
                }

                if (
                    status ===
                    WITHDRAWAL_STATUS.PENDING
                ) {
                    summary.withdrawals.pendingAmount +=
                        amount;
                } else if (
                    status ===
                    WITHDRAWAL_STATUS.APPROVED
                ) {
                    summary.withdrawals.approvedAmount +=
                        amount;
                } else if (
                    status ===
                    WITHDRAWAL_STATUS.REJECTED
                ) {
                    summary.withdrawals.rejectedAmount +=
                        amount;
                } else if (
                    status ===
                    WITHDRAWAL_STATUS.CANCELLED
                ) {
                    summary.withdrawals.cancelledAmount +=
                        amount;
                }
            }
        );

        summary.withdrawals.processing =
            summary.withdrawals.pending;

        summary.withdrawals.successful =
            summary.withdrawals.approved;

        summary.withdrawals.processingAmount =
            summary.withdrawals.pendingAmount;

        summary.withdrawals.successfulAmount =
            summary.withdrawals.approvedAmount;

        walletsSnapshot.forEach(
            snapshot => {
                const wallet =
                    snapshot
                        .data() ||
                    {};

                summary.wallets.availableBalance +=
                    toNonNegativeInteger(
                        wallet.availableBalance
                    );

                summary.wallets.heldBalance +=
                    toNonNegativeInteger(
                        wallet.heldBalance
                    );

                summary.wallets.totalEarned +=
                    toNonNegativeInteger(
                        wallet.totalEarned
                    );

                summary.wallets.totalWithdrawn +=
                    toNonNegativeInteger(
                        wallet.totalWithdrawn
                    );
            }
        );

        return {
            success:
                true,

            summary
        };
    }

    async function getAdminUsers(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.USERS
            );

        let query =
            collection;

        const status =
            toSafeString(
                payload.status
            )
                .toLowerCase();

        if (
            status
        ) {
            if (
                !VALID_PROFILE_STATUSES
                    .has(
                        status
                    )
            ) {
                throw clientError(
                    "invalid-argument",
                    "Profile status is invalid.",
                    "status"
                );
            }

            query =
                query.where(
                    "status",
                    "==",
                    status
                );
        }

        query =
            query.orderBy(
                "registrationDate",
                "desc"
            );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const users =
            await Promise.all(
                page.docs.map(
                    async profileSnapshot => {
                        const uid =
                            profileSnapshot.id;

                        const [
                            walletSnapshot,
                            activitySnapshot,
                            statsSnapshot
                        ] =
                            await Promise.all([
                                db.collection(
                                    COLLECTIONS.WALLETS
                                )
                                    .doc(
                                        uid
                                    )
                                    .get(),

                                db.collection(
                                    COLLECTIONS.ACTIVITY
                                )
                                    .doc(
                                        uid
                                    )
                                    .get(),

                                db.collection(
                                    COLLECTIONS.REFERRAL_STATS
                                )
                                    .doc(
                                        uid
                                    )
                                    .get()
                            ]);

                        return createAdminUserSummary(
                            profileSnapshot
                                .data() ||
                            {},

                            uid,

                            walletSnapshot.exists
                                ? walletSnapshot
                                    .data()
                                : {},

                            activitySnapshot.exists
                                ? activitySnapshot
                                    .data()
                                : {},

                            statsSnapshot.exists
                                ? statsSnapshot
                                    .data()
                                : {}
                        );
                    }
                )
            );

        let totalQuery =
            collection;

        if (
            status
        ) {
            totalQuery =
                totalQuery.where(
                    "status",
                    "==",
                    status
                );
        }

        const total =
            await queryCount(
                totalQuery
            );

        return {
            success:
                true,

            count:
                users.length,

            total,

            status,

            users,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor
        };
    }

    async function getAdminUserDetails(
        payload = {}
    ) {
        await requireAdmin();

        const userId =
            sanitizeId(
                payload.userId ||
                payload.uid,
                "userId"
            );

        const limit =
            toPositiveInteger(
                payload.limit
            );

        const db =
            resolveFirestore();

        const [
            profileSnapshot,
            walletSnapshot,
            activitySnapshot,
            statsSnapshot,
            referredBySnapshot,
            referralsSnapshot,
            withdrawalsSnapshot,
            transactionsSnapshot,
            sessionsSnapshot
        ] =
            await Promise.all([
                db.collection(
                    COLLECTIONS.USERS
                )
                    .doc(
                        userId
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.WALLETS
                )
                    .doc(
                        userId
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.ACTIVITY
                )
                    .doc(
                        userId
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.REFERRAL_STATS
                )
                    .doc(
                        userId
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.REFERRALS
                )
                    .doc(
                        userId
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.REFERRALS
                )
                    .where(
                        "referrerUid",
                        "==",
                        userId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(
                        limit
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.WITHDRAWALS
                )
                    .where(
                        "userId",
                        "==",
                        userId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(
                        limit
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.WALLET_TRANSACTIONS
                )
                    .where(
                        "userId",
                        "==",
                        userId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(
                        limit
                    )
                    .get(),

                db.collection(
                    COLLECTIONS.ACTIVITY_SESSIONS
                )
                    .where(
                        "userId",
                        "==",
                        userId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(
                        limit
                    )
                    .get()
            ]);

        if (
            !profileSnapshot.exists
        ) {
            throw clientError(
                "not-found",
                "User profile was not found."
            );
        }

        const mapDocuments =
            snapshot =>
                snapshot.docs.map(
                    item =>
                        snapshotData(
                            item
                        )
                );

        return {
            success:
                true,

            user:
                createAdminUserSummary(
                    profileSnapshot
                        .data() ||
                    {},

                    userId,

                    walletSnapshot.exists
                        ? walletSnapshot
                            .data()
                        : {},

                    activitySnapshot.exists
                        ? activitySnapshot
                            .data()
                        : {},

                    statsSnapshot.exists
                        ? statsSnapshot
                            .data()
                        : {}
                ),

            referredBy:
                referredBySnapshot.exists
                    ? normalizeReferralRecord(
                        referredBySnapshot
                            .data(),

                        referredBySnapshot.id
                    )
                    : null,

            referrals:
                referralsSnapshot.docs.map(
                    item =>
                        normalizeReferralRecord(
                            item.data(),
                            item.id
                        )
                ),

            withdrawals:
                withdrawalsSnapshot.docs.map(
                    item =>
                        normalizeWithdrawalRecord(
                            item.data(),
                            item.id
                        )
                ),

            transactions:
                mapDocuments(
                    transactionsSnapshot
                ),

            activitySessions:
                mapDocuments(
                    sessionsSnapshot
                )
        };
    }

    /* =====================================================
       ADMIN PROFILE STATUS
    ===================================================== */

    async function updateAdminUserProfile(
        payload = {}
    ) {
        const admin =
            await requireAdmin();

        const userId =
            sanitizeId(
                payload.userId ||
                payload.uid,
                "userId"
            );

        const status =
            toSafeString(
                payload.status ||
                payload
                    .updates
                    ?.status
            )
                .toLowerCase();

        const adminNote =
            normalizeAdminNote(
                payload.adminNote ||
                payload.note,
                true
            );

        if (
            !VALID_PROFILE_STATUSES
                .has(
                    status
                )
        ) {
            throw clientError(
                "invalid-argument",
                "Profile status is invalid.",
                "status"
            );
        }

        if (
            userId ===
                admin.uid &&
            status !==
                PROFILE_STATUS.ACTIVE
        ) {
            throw clientError(
                "failed-precondition",
                "The only Admin account cannot suspend or block itself."
            );
        }

        const dbRefs =
            refs();

        const profileRef =
            dbRefs.db
                .collection(
                    COLLECTIONS.USERS
                )
                .doc(
                    userId
                );

        const auditId =
            randomId(
                "profile_status"
            );

        const auditRef =
            dbRefs.audit(
                auditId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const [
                            profileSnapshot,
                            auditSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    profileRef
                                ),

                                transaction.get(
                                    auditRef
                                )
                            ]);

                        if (
                            !profileSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "User profile was not found."
                            );
                        }

                        if (
                            auditSnapshot.exists
                        ) {
                            throw clientError(
                                "aborted",
                                "A unique Admin audit ID could not be created."
                            );
                        }

                        const profile =
                            profileSnapshot
                                .data() ||
                            {};

                        if (
                            toNonNegativeInteger(
                                profile.schemaVersion
                            ) !==
                            SCHEMA_VERSION
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "This legacy profile must sign in once to migrate before Admin status changes."
                            );
                        }

                        const previousStatus =
                            toSafeString(
                                profile.status
                            ) ||
                            PROFILE_STATUS.ACTIVE;

                        if (
                            previousStatus ===
                            status
                        ) {
                            return {
                                updated:
                                    false,

                                unchanged:
                                    true,

                                userId,

                                previousStatus,

                                status,

                                auditId:
                                    ""
                            };
                        }

                        const timestamp =
                            serverTimestamp();

                        transaction.update(
                            profileRef,
                            {
                                status,

                                statusChangedAt:
                                    timestamp,

                                statusChangedBy:
                                    admin.uid,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        transaction.set(
                            auditRef,
                            {
                                auditId,

                                action:
                                    "profile_status_changed",

                                adminUid:
                                    admin.uid,

                                adminEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                adminRole:
                                    "admin",

                                targetUid:
                                    userId,

                                previousStatus,

                                newStatus:
                                    status,

                                note:
                                    adminNote,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            updated:
                                true,

                            unchanged:
                                false,

                            userId,

                            previousStatus,

                            status,

                            auditId
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    /* =====================================================
       ADMIN WALLET ADJUSTMENT
    ===================================================== */

    async function adjustAdminWallet(
        payload = {}
    ) {
        const admin =
            await requireAdmin();

        const userId =
            sanitizeId(
                payload.userId ||
                payload.uid,
                "userId"
            );

        const amount =
            normalizeAmount(
                payload.amount
            );

        const direction =
            toSafeString(
                payload.direction
            )
                .toLowerCase();

        const operationId =
            sanitizeId(
                payload.operationId ||
                payload.requestId,
                "operationId"
            );

        const adminNote =
            normalizeAdminNote(
                payload.adminNote ||
                payload.note,
                true
            );

        if (
            !new Set([
                "credit",
                "debit"
            ]).has(
                direction
            )
        ) {
            throw clientError(
                "invalid-argument",
                "Wallet direction must be credit or debit.",
                "direction"
            );
        }

        const dbRefs =
            refs();

        const profileRef =
            dbRefs.db
                .collection(
                    COLLECTIONS.USERS
                )
                .doc(
                    userId
                );

        const walletRef =
            dbRefs.wallet(
                userId
            );

        const transactionId =
            `admin_adjustment_${
                stableHash(
                    `${userId}:${operationId}`
                )
            }`;

        const transactionRef =
            dbRefs.walletTx(
                transactionId
            );

        const auditId =
            `wallet_adjusted_${
                stableHash(
                    `${userId}:${operationId}`
                )
            }`;

        const auditRef =
            dbRefs.audit(
                auditId
            );

        const result =
            await dbRefs
                .db
                .runTransaction(
                    async transaction => {
                        const [
                            profileSnapshot,
                            walletSnapshot,
                            ledgerSnapshot,
                            auditSnapshot
                        ] =
                            await Promise.all([
                                transaction.get(
                                    profileRef
                                ),

                                transaction.get(
                                    walletRef
                                ),

                                transaction.get(
                                    transactionRef
                                ),

                                transaction.get(
                                    auditRef
                                )
                            ]);

                        if (
                            !profileSnapshot.exists
                        ) {
                            throw clientError(
                                "not-found",
                                "User profile was not found."
                            );
                        }

                        if (
                            ledgerSnapshot.exists ||
                            auditSnapshot.exists
                        ) {
                            return {
                                applied:
                                    false,

                                duplicate:
                                    true,

                                userId,

                                transactionId,

                                direction,

                                amount,

                                wallet:
                                    walletSnapshot.exists
                                        ? walletSnapshot
                                            .data()
                                        : null,

                                auditId
                            };
                        }

                        const before =
                            readWallet(
                                walletSnapshot.exists
                                    ? walletSnapshot
                                        .data() ||
                                    {}
                                    : null,

                                userId
                            );

                        if (
                            direction ===
                                "debit" &&
                            before.availableBalance <
                                amount
                        ) {
                            throw clientError(
                                "failed-precondition",
                                "The wallet does not have enough available balance."
                            );
                        }

                        const timestamp =
                            serverTimestamp();

                        const after =
                            withWalletOperation(
                                {
                                    ...before,

                                    availableBalance:
                                        direction ===
                                            "credit"
                                            ? before.availableBalance +
                                            amount
                                            : before.availableBalance -
                                            amount,

                                    revision:
                                        before.revision +
                                        1,

                                    createdAt:
                                        before.createdAt ||
                                        timestamp
                                },

                                transactionId,

                                "admin_adjustment",

                                timestamp
                            );

                        transaction.set(
                            walletRef,
                            after
                        );

                        transaction.set(
                            transactionRef,
                            createWalletTransaction({
                                transactionId,

                                uid:
                                    userId,

                                type:
                                    "admin_adjustment",

                                direction,

                                amount,

                                referenceId:
                                    operationId,

                                operationId,

                                before,

                                after,

                                admin,

                                note:
                                    adminNote,

                                metadata: {
                                    source:
                                        "admin_adjustment"
                                },

                                timestamp
                            })
                        );

                        transaction.set(
                            auditRef,
                            {
                                auditId,

                                action:
                                    "wallet_adjusted",

                                adminUid:
                                    admin.uid,

                                adminEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                adminRole:
                                    "admin",

                                targetUid:
                                    userId,

                                direction,

                                amount,

                                operationId,

                                walletTransactionId:
                                    transactionId,

                                availableBalanceBefore:
                                    before.availableBalance,

                                availableBalanceAfter:
                                    after.availableBalance,

                                note:
                                    adminNote,

                                createdAt:
                                    timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            }
                        );

                        return {
                            applied:
                                true,

                            duplicate:
                                false,

                            userId,

                            transactionId,

                            direction,

                            amount,

                            wallet:
                                after,

                            auditId
                        };
                    }
                );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    }

    /* =====================================================
       ADMIN TRANSACTIONS / AUDIT
    ===================================================== */

    async function getAdminTransactions(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.WALLET_TRANSACTIONS
            );

        let query =
            collection;

        const userId =
            toSafeString(
                payload.userId ||
                payload.uid
            );

        const type =
            toSafeString(
                payload.type
            )
                .toLowerCase();

        if (
            userId
        ) {
            query =
                query.where(
                    "userId",
                    "==",
                    sanitizeId(
                        userId,
                        "userId"
                    )
                );
        }

        if (
            type
        ) {
            query =
                query.where(
                    "type",
                    "==",
                    type
                );
        }

        query =
            query.orderBy(
                "createdAt",
                "desc"
            );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const transactions =
            page.docs.map(
                snapshot =>
                    snapshotData(
                        snapshot
                    )
            );

        return {
            success:
                true,

            transactions,

            count:
                transactions.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            userId,

            type
        };
    }

    async function getAdminAuditLogs(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.AUDIT_LOGS
            );

        let query =
            collection;

        const adminUid =
            toSafeString(
                payload.adminUid
            );

        const action =
            toSafeString(
                payload.action
            )
                .toLowerCase();

        if (
            adminUid
        ) {
            query =
                query.where(
                    "adminUid",
                    "==",
                    sanitizeId(
                        adminUid,
                        "adminUid"
                    )
                );
        }

        if (
            action
        ) {
            query =
                query.where(
                    "action",
                    "==",
                    action
                );
        }

        query =
            query.orderBy(
                "createdAt",
                "desc"
            );

        const page =
            await pagedQuery({
                query,
                collection,

                cursor:
                    payload.cursor,

                limit:
                    payload.limit
            });

        const auditLogs =
            page.docs.map(
                snapshot =>
                    snapshotData(
                        snapshot
                    )
            );

        return {
            success:
                true,

            auditLogs,

            logs:
                auditLogs,

            count:
                auditLogs.length,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor,

            adminUid,

            action
        };
    }

    /* =====================================================
       LOCAL OPERATION ROUTER
    ===================================================== */

    const LOCAL_HANDLERS =
        Object.freeze({
            [FUNCTION_NAMES.ENSURE_PROFILE]:
                ensureProfile,

            [FUNCTION_NAMES.GET_MY_PROFILE]:
                getMyProfile,

            [FUNCTION_NAMES.GET_PUBLIC_ADMIN_REFERRAL]:
                getPublicAdminReferral,

            [FUNCTION_NAMES.SAVE_MOBILE_NUMBER]:
                payload =>
                    saveMobileNumber(
                        payload.mobileNumber
                    ),

            [FUNCTION_NAMES.RECORD_ACTIVITY_HEARTBEAT]:
                recordActivityHeartbeat,

            [FUNCTION_NAMES.GET_MY_ACTIVITY]:
                getMyActivity,

            [FUNCTION_NAMES.CLOSE_ACTIVITY_SESSION]:
                closeActivitySession,

            [FUNCTION_NAMES.GET_MY_REFERRAL_STATS]:
                getMyReferralStats,

            [FUNCTION_NAMES.GET_MY_REFERRALS]:
                getMyReferrals,

            [FUNCTION_NAMES.GET_PENDING_REFERRALS]:
                getPendingReferrals,

            [FUNCTION_NAMES.APPROVE_REFERRAL]:
                approveReferral,

            [FUNCTION_NAMES.REJECT_REFERRAL]:
                rejectReferral,

            [FUNCTION_NAMES.GET_MY_WALLET]:
                getMyWallet,

            [FUNCTION_NAMES.GET_MY_WALLET_TRANSACTIONS]:
                getMyWalletTransactions,

            [FUNCTION_NAMES.SUBMIT_WITHDRAWAL]:
                submitWithdrawal,

            [FUNCTION_NAMES.CANCEL_WITHDRAWAL]:
                cancelWithdrawal,

            [FUNCTION_NAMES.GET_MY_WITHDRAWALS]:
                getMyWithdrawals,

            [FUNCTION_NAMES.GET_MY_WITHDRAWAL_SUMMARY]:
                getMyWithdrawalSummary,

            [FUNCTION_NAMES.GET_PENDING_WITHDRAWALS]:
                getPendingWithdrawals,

            [FUNCTION_NAMES.APPROVE_WITHDRAWAL]:
                approveWithdrawal,

            [FUNCTION_NAMES.REJECT_WITHDRAWAL]:
                rejectWithdrawal,

            [FUNCTION_NAMES.GET_ADMIN_SESSION]:
                getAdminSession,

            [FUNCTION_NAMES.GET_ADMIN_DASHBOARD_SUMMARY]:
                getAdminDashboardSummary,

            [FUNCTION_NAMES.GET_ADMIN_USERS]:
                getAdminUsers,

            [FUNCTION_NAMES.GET_ADMIN_USER_DETAILS]:
                getAdminUserDetails,

            [FUNCTION_NAMES.UPDATE_ADMIN_USER_PROFILE]:
                updateAdminUserProfile,

            [FUNCTION_NAMES.ADJUST_ADMIN_WALLET]:
                adjustAdminWallet,

            [FUNCTION_NAMES.GET_ADMIN_TRANSACTIONS]:
                getAdminTransactions,

            [FUNCTION_NAMES.GET_ADMIN_AUDIT_LOGS]:
                getAdminAuditLogs
        });

    async function call(
        functionName,
        payload = {},
        options = {}
    ) {
        const normalizedFunctionName =
            toSafeString(
                functionName
            );

        if (
            !normalizedFunctionName
        ) {
            throw clientError(
                "invalid-argument",
                "Operation name is required."
            );
        }

        const handler =
            LOCAL_HANDLERS[
                normalizedFunctionName
            ];

        if (
            typeof handler !==
                "function"
        ) {
            throw clientError(
                "not-found",
                `Unsupported operation: ${normalizedFunctionName}`
            );
        }

        const normalizedPayload =
            normalizePayload(
                payload
            );

        const requireAuth =
            options.requireAuth !==
            false;

        try {
            if (
                requireAuth
            ) {
                await waitForAuthentication();
            }

            dispatchClientEvent(
                "profile:function-started",
                {
                    functionName:
                        normalizedFunctionName,

                    payload:
                        normalizedPayload,

                    requireAuth,

                    transport:
                        "firestore"
                }
            );

            const data =
                await handler(
                    normalizedPayload
                );

            dispatchClientEvent(
                "profile:function-success",
                {
                    functionName:
                        normalizedFunctionName,

                    data,

                    transport:
                        "firestore"
                }
            );

            return data;
        } catch (error) {
            const normalizedError =
                normalizeError(
                    error,
                    normalizedFunctionName
                );

            console.error(
                `[FunctionsClient] ${normalizedFunctionName} failed:`,
                normalizedError
            );

            dispatchClientEvent(
                "profile:function-error",
                {
                    functionName:
                        normalizedFunctionName,

                    error:
                        normalizedError,

                    transport:
                        "firestore"
                }
            );

            throw normalizedError;
        }
    }

    function callNamed(
        functionName,
        payload = {}
    ) {
        return call(
            functionName,
            payload,
            {
                requireAuth:
                    true
            }
        );
    }

    function callPublic(
        functionName,
        payload = {}
    ) {
        return call(
            functionName,
            payload,
            {
                requireAuth:
                    false
            }
        );
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        resolveFirestore();
        resolveAuth();

        initialized =
            true;

        console.info(
            "[FunctionsClient] Ready — Firebase Spark / secure Web Device / 7 days × 2 hours / schema v3."
        );

        return true;
    }

    function isReady() {
        return Boolean(
            initialized &&
            firestoreInstance &&
            authInstance
        );
    }

    function getRegion() {
        return COMPATIBILITY_REGION;
    }

    function getInstance() {
        return resolveFirestore();
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.FunctionsClient =
        Object.freeze({
            init,
            isReady,
            call,

            ensureProfile:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.ENSURE_PROFILE,
                        payload
                    ),

            getMyProfile:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_PROFILE
                    ),

            getPublicAdminReferral:
                () =>
                    callPublic(
                        FUNCTION_NAMES.GET_PUBLIC_ADMIN_REFERRAL
                    ),

            saveMobileNumber:
                mobileNumber =>
                    callNamed(
                        FUNCTION_NAMES.SAVE_MOBILE_NUMBER,
                        {
                            mobileNumber
                        }
                    ),

            recordActivityHeartbeat:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.RECORD_ACTIVITY_HEARTBEAT,
                        payload
                    ),

            getMyActivity:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_ACTIVITY
                    ),

            closeActivitySession:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.CLOSE_ACTIVITY_SESSION,
                        payload
                    ),

            getMyReferralStats:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_REFERRAL_STATS
                    ),

            getMyReferrals:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_REFERRALS,
                        payload
                    ),

            getPendingReferrals:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_PENDING_REFERRALS,
                        payload
                    ),

            approveReferral:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.APPROVE_REFERRAL,
                        payload
                    ),

            rejectReferral:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.REJECT_REFERRAL,
                        payload
                    ),

            getMyWallet:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_WALLET
                    ),

            getMyWalletTransactions:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_WALLET_TRANSACTIONS,
                        payload
                    ),

            submitWithdrawal:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.SUBMIT_WITHDRAWAL,
                        payload
                    ),

            cancelWithdrawal:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.CANCEL_WITHDRAWAL,
                        payload
                    ),

            getMyWithdrawals:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_WITHDRAWALS,
                        payload
                    ),

            getMyWithdrawalSummary:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_MY_WITHDRAWAL_SUMMARY
                    ),

            getPendingWithdrawals:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_PENDING_WITHDRAWALS,
                        payload
                    ),

            approveWithdrawal:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.APPROVE_WITHDRAWAL,
                        payload
                    ),

            rejectWithdrawal:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.REJECT_WITHDRAWAL,
                        payload
                    ),

            getAdminSession:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_SESSION
                    ),

            getAdminDashboardSummary:
                () =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_DASHBOARD_SUMMARY
                    ),

            getAdminUsers:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_USERS,
                        payload
                    ),

            getAdminUserDetails:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_USER_DETAILS,
                        payload
                    ),

            updateAdminUserProfile:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.UPDATE_ADMIN_USER_PROFILE,
                        payload
                    ),

            adjustAdminWallet:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.ADJUST_ADMIN_WALLET,
                        payload
                    ),

            getAdminTransactions:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_TRANSACTIONS,
                        payload
                    ),

            getAdminAuditLogs:
                payload =>
                    callNamed(
                        FUNCTION_NAMES.GET_ADMIN_AUDIT_LOGS,
                        payload
                    ),

            getRegion,
            getInstance,

            FunctionsClientError,
            FUNCTION_NAMES,

            ACTIVITY,
            SCHEMA_VERSION,
            ACTIVITY_POLICY_VERSION
        });
})();