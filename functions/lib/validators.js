"use strict";

/* =========================================================
   11PLAY — INPUT VALIDATORS
   File: functions/lib/validators.js

   Responsibilities:
   - Validate and normalize profile-related data
   - Validate Bangladesh mobile numbers
   - Validate referral codes and document IDs
   - Validate wallet and withdrawal information
   - Validate activity heartbeat payloads
   - Validate admin actions, notes and statuses
   - Validate idempotency keys, pagination cursors and limits
========================================================= */

const {
    PROFILE_STATUS,
    REFERRAL,
    ACTIVITY,
    REWARD,
    WALLET,
    WITHDRAWAL,
    ADMIN
} = require("./constants");

/* =========================================================
   VALIDATION ERROR
========================================================= */

class ValidationError extends Error {
    constructor(
        message,
        field = "",
        details = null
    ) {
        super(message);

        this.name = "ValidationError";
        this.code = "invalid-argument";
        this.field = field;
        this.details = details;

        Error.captureStackTrace?.(
            this,
            ValidationError
        );
    }
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function isPlainObject(value) {
    if (
        value === null ||
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

function requirePlainObject(
    value,
    fieldName = "data"
) {
    if (!isPlainObject(value)) {
        throw new ValidationError(
            `${fieldName} must be a valid object.`,
            fieldName
        );
    }

    return value;
}

function normalizeText(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    if (
        typeof value === "object" ||
        typeof value === "function"
    ) {
        return "";
    }

    return String(value)
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeLowercaseText(value) {
    return normalizeText(value)
        .toLowerCase();
}

function normalizeUppercaseText(value) {
    return normalizeText(value)
        .toUpperCase();
}

function validateRequiredText(
    value,
    options = {}
) {
    const {
        fieldName = "value",
        minimumLength = 1,
        maximumLength = 500
    } = options;

    const text =
        normalizeText(value);

    if (!text) {
        throw new ValidationError(
            `${fieldName} is required.`,
            fieldName
        );
    }

    if (
        text.length < minimumLength ||
        text.length > maximumLength
    ) {
        throw new ValidationError(
            `${fieldName} must be between ${minimumLength} and ${maximumLength} characters.`,
            fieldName
        );
    }

    return text;
}

/* =========================================================
   FIREBASE UID
========================================================= */

function normalizeUid(value) {
    return normalizeText(value);
}

function isValidUid(value) {
    const uid =
        normalizeUid(value);

    return (
        uid.length >= 1 &&
        uid.length <= 128 &&
        /^[A-Za-z0-9_-]+$/.test(uid)
    );
}

function validateUid(
    value,
    fieldName = "uid"
) {
    const uid =
        normalizeUid(value);

    if (!isValidUid(uid)) {
        throw new ValidationError(
            "A valid Firebase user ID is required.",
            fieldName
        );
    }

    return uid;
}

/* =========================================================
   FIRESTORE DOCUMENT ID
========================================================= */

function normalizeDocumentId(value) {
    return normalizeText(value);
}

function isValidDocumentId(value) {
    const documentId =
        normalizeDocumentId(value);

    return (
        documentId.length >= 1 &&
        documentId.length <= 512 &&
        documentId !== "." &&
        documentId !== ".." &&
        !documentId.includes("/") &&
        !/^__.*__$/.test(documentId)
    );
}

function validateDocumentId(
    value,
    fieldName = "documentId"
) {
    const documentId =
        normalizeDocumentId(value);

    if (!isValidDocumentId(documentId)) {
        throw new ValidationError(
            "A valid Firestore document ID is required.",
            fieldName
        );
    }

    return documentId;
}

/* =========================================================
   IDEMPOTENCY / REQUEST KEY

   একই referral reward, wallet transaction বা withdrawal
   request যেন দ্বিতীয়বার process না হয়।
========================================================= */

function normalizeRequestId(value) {
    return normalizeText(value);
}

function isValidRequestId(value) {
    const requestId =
        normalizeRequestId(value);

    return (
        requestId.length >= 8 &&
        requestId.length <= 128 &&
        /^[A-Za-z0-9:_-]+$/.test(
            requestId
        )
    );
}

function validateRequestId(
    value,
    fieldName = "requestId"
) {
    const requestId =
        normalizeRequestId(value);

    if (!isValidRequestId(requestId)) {
        throw new ValidationError(
            "A valid request ID is required.",
            fieldName
        );
    }

    return requestId;
}

/* =========================================================
   DISPLAY NAME
========================================================= */

function normalizeDisplayName(value) {
    return normalizeText(value);
}

function validateDisplayName(
    value,
    options = {}
) {
    const {
        required = true,
        minLength = 2,
        maxLength = 100
    } = options;

    const displayName =
        normalizeDisplayName(value);

    if (!displayName) {
        if (required) {
            throw new ValidationError(
                "Display name is required.",
                "displayName"
            );
        }

        return "";
    }

    if (
        displayName.length < minLength ||
        displayName.length > maxLength
    ) {
        throw new ValidationError(
            `Display name must be between ${minLength} and ${maxLength} characters.`,
            "displayName"
        );
    }

    return displayName;
}

/* =========================================================
   EMAIL
========================================================= */

function normalizeEmail(value) {
    return normalizeLowercaseText(value);
}

function isValidEmail(value) {
    const email =
        normalizeEmail(value);

    if (
        !email ||
        email.length > 254
    ) {
        return false;
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
    );
}

function validateEmail(
    value,
    options = {}
) {
    const {
        required = true,
        fieldName = "email"
    } = options;

    const email =
        normalizeEmail(value);

    if (!email) {
        if (required) {
            throw new ValidationError(
                "Email address is required.",
                fieldName
            );
        }

        return "";
    }

    if (!isValidEmail(email)) {
        throw new ValidationError(
            "A valid email address is required.",
            fieldName
        );
    }

    return email;
}

/* =========================================================
   PHOTO URL
========================================================= */

function normalizePhotoURL(value) {
    return normalizeText(value);
}

function validatePhotoURL(
    value,
    options = {}
) {
    const {
        required = false,
        allowHttp = false
    } = options;

    const photoURL =
        normalizePhotoURL(value);

    if (!photoURL) {
        if (required) {
            throw new ValidationError(
                "Photo URL is required.",
                "photoURL"
            );
        }

        return "";
    }

    let parsedURL;

    try {
        parsedURL =
            new URL(photoURL);
    } catch {
        throw new ValidationError(
            "Photo URL is invalid.",
            "photoURL"
        );
    }

    const allowedProtocols =
        allowHttp
            ? ["https:", "http:"]
            : ["https:"];

    if (
        !allowedProtocols.includes(
            parsedURL.protocol
        )
    ) {
        throw new ValidationError(
            allowHttp
                ? "Photo URL must use HTTP or HTTPS."
                : "Photo URL must use HTTPS.",
            "photoURL"
        );
    }

    if (
        parsedURL.username ||
        parsedURL.password
    ) {
        throw new ValidationError(
            "Photo URL cannot contain credentials.",
            "photoURL"
        );
    }

    return parsedURL.toString();
}

/* =========================================================
   BANGLADESH MOBILE NUMBER

   Accepted:
   01XXXXXXXXX
   8801XXXXXXXXX
   +8801XXXXXXXXX
   008801XXXXXXXXX

   Stored:
   +8801XXXXXXXXX
========================================================= */

function normalizeBangladeshMobile(value) {
    let mobile =
        normalizeText(value)
            .replace(
                /[\s\-().]/g,
                ""
            );

    if (!mobile) {
        return "";
    }

    if (
        mobile.startsWith(
            "00880"
        )
    ) {
        mobile =
            `+${mobile.slice(2)}`;
    } else if (
        mobile.startsWith(
            "880"
        )
    ) {
        mobile =
            `+${mobile}`;
    } else if (
        mobile.startsWith(
            "01"
        )
    ) {
        mobile =
            `+880${mobile.slice(1)}`;
    }

    return mobile;
}

function isValidBangladeshMobile(value) {
    const mobile =
        normalizeBangladeshMobile(value);

    return /^\+8801[3-9]\d{8}$/.test(
        mobile
    );
}

function validateBangladeshMobile(
    value,
    options = {}
) {
    const {
        required = true,
        fieldName = "mobileNumber"
    } = options;

    const mobile =
        normalizeBangladeshMobile(value);

    if (!mobile) {
        if (required) {
            throw new ValidationError(
                "Mobile number is required.",
                fieldName
            );
        }

        return "";
    }

    if (
        !isValidBangladeshMobile(
            mobile
        )
    ) {
        throw new ValidationError(
            "Enter a valid Bangladesh mobile number.",
            fieldName
        );
    }

    return mobile;
}

function toLocalBangladeshMobile(value) {
    const mobile =
        validateBangladeshMobile(value);

    return `0${mobile.slice(4)}`;
}

/* =========================================================
   REFERRAL CODE
========================================================= */

function normalizeReferralCode(value) {
    return normalizeUppercaseText(value)
        .replace(
            /[^A-Z0-9]/g,
            ""
        );
}

function isValidReferralCode(value) {
    const referralCode =
        normalizeReferralCode(value);

    return (
        referralCode.length ===
            REFERRAL.CODE_LENGTH &&
        /^[A-Z0-9]+$/.test(
            referralCode
        )
    );
}

function validateReferralCode(
    value,
    options = {}
) {
    const {
        required = true,
        fieldName = "referralCode"
    } = options;

    const referralCode =
        normalizeReferralCode(value);

    if (!referralCode) {
        if (required) {
            throw new ValidationError(
                "Referral code is required.",
                fieldName
            );
        }

        return "";
    }

    if (
        !isValidReferralCode(
            referralCode
        )
    ) {
        throw new ValidationError(
            `Referral code must contain exactly ${REFERRAL.CODE_LENGTH} letters or numbers.`,
            fieldName
        );
    }

    return referralCode;
}

/* =========================================================
   WALLET PROVIDER
========================================================= */

function normalizeWalletProvider(value) {
    const provider =
        normalizeLowercaseText(value);

    return (
        WALLET.SUPPORTED_PROVIDERS.find(
            (supportedProvider) =>
                supportedProvider === provider
        ) || ""
    );
}

function validateWalletProvider(
    value,
    fieldName = "walletProvider"
) {
    const provider =
        normalizeWalletProvider(value);

    if (!provider) {
        throw new ValidationError(
            `Wallet provider must be one of: ${WALLET.SUPPORTED_PROVIDERS.join(", ")}.`,
            fieldName
        );
    }

    return provider;
}

/* =========================================================
   WALLET ACCOUNT NUMBER
========================================================= */

function validateWalletNumber(
    value,
    options = {}
) {
    const {
        required = true,
        fieldName = "walletNumber"
    } = options;

    return validateBangladeshMobile(
        value,
        {
            required,
            fieldName
        }
    );
}

/* =========================================================
   MONEY AMOUNT
========================================================= */

function normalizeAmount(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return NaN;
    }

    if (
        typeof value === "number"
    ) {
        return value;
    }

    const normalized =
        normalizeText(value)
            .replace(
                /[৳,\s]/g,
                ""
            );

    if (
        !/^-?\d+(?:\.\d+)?$/.test(
            normalized
        )
    ) {
        return NaN;
    }

    return Number(normalized);
}

function validateMoneyAmount(
    value,
    options = {}
) {
    const {
        fieldName = "amount",
        minimum = 1,
        maximum =
            Number.MAX_SAFE_INTEGER,
        integerOnly = true,
        allowZero = false,
        multipleOf = null
    } = options;

    const amount =
        normalizeAmount(value);

    if (
        !Number.isFinite(amount)
    ) {
        throw new ValidationError(
            "A valid amount is required.",
            fieldName
        );
    }

    if (
        integerOnly &&
        !Number.isSafeInteger(amount)
    ) {
        throw new ValidationError(
            "Amount must be a safe whole number.",
            fieldName
        );
    }

    if (
        !integerOnly &&
        !Number.isSafeInteger(
            Math.round(
                amount * 100
            )
        )
    ) {
        throw new ValidationError(
            "Amount is outside the supported range.",
            fieldName
        );
    }

    if (
        amount === 0 &&
        allowZero
    ) {
        return amount;
    }

    if (
        amount < minimum
    ) {
        throw new ValidationError(
            `Amount must be at least ${minimum}.`,
            fieldName
        );
    }

    if (
        amount > maximum
    ) {
        throw new ValidationError(
            `Amount cannot exceed ${maximum}.`,
            fieldName
        );
    }

    if (
        multipleOf !== null &&
        multipleOf !== undefined
    ) {
        const normalizedMultiple =
            Number(multipleOf);

        if (
            !Number.isSafeInteger(
                normalizedMultiple
            ) ||
            normalizedMultiple <= 0
        ) {
            throw new ValidationError(
                "Amount multiple configuration is invalid.",
                fieldName
            );
        }

        if (
            amount % normalizedMultiple !== 0
        ) {
            throw new ValidationError(
                `Amount must be a multiple of ${normalizedMultiple}.`,
                fieldName,
                {
                    multipleOf:
                        normalizedMultiple
                }
            );
        }
    }

    return amount;
}

/* =========================================================
   WITHDRAWAL REQUEST
========================================================= */

function validateWithdrawalRequest(
    payload,
    options = {}
) {
    requirePlainObject(
        payload,
        "withdrawal"
    );

    const {
        availableBalance = null,
        minimumAmount =
            WITHDRAWAL.MINIMUM_AMOUNT,
        maximumAmount =
            Number.MAX_SAFE_INTEGER
    } = options;

    const effectiveMinimumAmount =
        Math.max(
            WITHDRAWAL.MINIMUM_AMOUNT,
            Number.isSafeInteger(
                Number(minimumAmount)
            )
                ? Number(minimumAmount)
                : WITHDRAWAL.MINIMUM_AMOUNT
        );

    const provider =
        validateWalletProvider(
            payload.provider ||
            payload.wallet ||
            payload.walletProvider
        );

    const walletNumber =
        validateWalletNumber(
            payload.walletNumber ||
            payload.number
        );

    const amount =
        validateMoneyAmount(
            payload.amount,
            {
                fieldName: "amount",
                minimum:
                    effectiveMinimumAmount,
                maximum: maximumAmount,
                integerOnly: true,
                multipleOf:
                    WITHDRAWAL.AMOUNT_MULTIPLE
            }
        );

    if (
        availableBalance !== null
    ) {
        const balance =
            validateMoneyAmount(
                availableBalance,
                {
                    fieldName:
                        "availableBalance",

                    minimum:
                        0,

                    allowZero:
                        true,

                    integerOnly:
                        true
                }
            );

        if (
            amount > balance
        ) {
            throw new ValidationError(
                "Withdrawal amount exceeds the available balance.",
                "amount"
            );
        }
    }

    const requestId =
        payload.requestId
            ? validateRequestId(
                  payload.requestId
              )
            : "";

    return Object.freeze({
        provider,
        walletNumber,
        amount,
        requestId
    });
}

/* =========================================================
   ACTIVITY SESSION
========================================================= */

function normalizeSessionId(value) {
    return normalizeText(value);
}

function validateSessionId(value) {
    const sessionId =
        normalizeSessionId(value);

    if (
        !sessionId ||
        sessionId.length < 8 ||
        sessionId.length > 128 ||
        !/^[A-Za-z0-9:_-]+$/.test(
            sessionId
        )
    ) {
        throw new ValidationError(
            "A valid activity session ID is required.",
            "sessionId"
        );
    }

    return sessionId;
}

function validateOptionalBoolean(
    value,
    fieldName,
    defaultValue = false
) {
    if (
        value === undefined ||
        value === null
    ) {
        return defaultValue;
    }

    if (
        typeof value !== "boolean"
    ) {
        throw new ValidationError(
            `${fieldName} must be true or false.`,
            fieldName
        );
    }

    return value;
}

function validateHeartbeatPayload(payload) {
    requirePlainObject(
        payload,
        "heartbeat"
    );

    const sessionId =
        validateSessionId(
            payload.sessionId
        );

    const visible =
        validateOptionalBoolean(
            payload.visible,
            "visible",
            false
        );

    const online =
        validateOptionalBoolean(
            payload.online,
            "online",
            false
        );

    const active =
        validateOptionalBoolean(
            payload.active,
            "active",
            false
        );

    let clientTimestamp = null;

    if (
        payload.clientTimestamp !==
            undefined &&
        payload.clientTimestamp !==
            null
    ) {
        const timestampValue =
            Number(
                payload.clientTimestamp
            );

        if (
            !Number.isSafeInteger(
                timestampValue
            ) ||
            timestampValue <= 0
        ) {
            throw new ValidationError(
                "Client timestamp is invalid.",
                "clientTimestamp"
            );
        }

        clientTimestamp =
            timestampValue;
    }

    return Object.freeze({
        sessionId,
        visible,
        online,
        active,
        clientTimestamp,
        heartbeatIntervalSeconds:
            ACTIVITY
                .HEARTBEAT_INTERVAL_SECONDS
    });
}

/* =========================================================
   STATUS VALIDATION
========================================================= */

function validateEnumValue(
    value,
    allowedValues,
    fieldName
) {
    const normalized =
        normalizeLowercaseText(value);

    if (
        !allowedValues.includes(
            normalized
        )
    ) {
        throw new ValidationError(
            `${fieldName} has an unsupported value.`,
            fieldName,
            {
                allowedValues
            }
        );
    }

    return normalized;
}

function validateProfileStatus(value) {
    return validateEnumValue(
        value,
        Object.values(
            PROFILE_STATUS
        ),
        "profileStatus"
    );
}

function validateReferralStatus(value) {
    return validateEnumValue(
        value,
        Object.values(
            REFERRAL.STATUS
        ),
        "referralStatus"
    );
}

function validateRewardStatus(value) {
    return validateEnumValue(
        value,
        Object.values(
            REWARD.STATUS
        ),
        "rewardStatus"
    );
}

function validateWalletTransactionStatus(
    value
) {
    return validateEnumValue(
        value,
        Object.values(
            WALLET.TRANSACTION_STATUS
        ),
        "transactionStatus"
    );
}

function validateWithdrawalStatus(value) {
    return validateEnumValue(
        value,
        Object.values(
            WITHDRAWAL.STATUS
        ),
        "withdrawalStatus"
    );
}

function validateAdminAction(value) {
    return validateEnumValue(
        value,
        Object.values(
            ADMIN.ACTION
        ),
        "adminAction"
    );
}

/* =========================================================
   ADMIN NOTE
========================================================= */

function validateAdminNote(
    value,
    options = {}
) {
    const {
        required = false,
        maxLength = 500,
        fieldName = "adminNote"
    } = options;

    const note =
        normalizeText(value);

    if (!note) {
        if (required) {
            throw new ValidationError(
                "Admin note is required.",
                fieldName
            );
        }

        return "";
    }

    if (
        note.length > maxLength
    ) {
        throw new ValidationError(
            `Admin note cannot exceed ${maxLength} characters.`,
            fieldName
        );
    }

    return note;
}

/* =========================================================
   BOOLEAN
========================================================= */

function validateBoolean(
    value,
    fieldName = "value"
) {
    if (
        typeof value !== "boolean"
    ) {
        throw new ValidationError(
            `${fieldName} must be true or false.`,
            fieldName
        );
    }

    return value;
}

/* =========================================================
   PAGINATION CURSOR

   Cursor হিসেবে সর্বশেষ loaded Firestore document ID
   ব্যবহার করা হবে। Empty cursor প্রথম page নির্দেশ করে।
========================================================= */

function normalizePaginationCursor(value) {
    return normalizeDocumentId(value);
}

function validatePaginationCursor(
    value,
    options = {}
) {
    const {
        required = false,
        fieldName = "cursor"
    } = options;

    const cursor =
        normalizePaginationCursor(
            value
        );

    if (!cursor) {
        if (required) {
            throw new ValidationError(
                "Pagination cursor is required.",
                fieldName
            );
        }

        return "";
    }

    return validateDocumentId(
        cursor,
        fieldName
    );
}

/* =========================================================
   PAGINATION LIMIT
========================================================= */

function validatePaginationLimit(
    value,
    options = {}
) {
    const {
        defaultValue = 25,
        minimum = 1,
        maximum = 100
    } = options;

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return defaultValue;
    }

    const limit =
        Number(value);

    if (
        !Number.isSafeInteger(limit) ||
        limit < minimum ||
        limit > maximum
    ) {
        throw new ValidationError(
            `Limit must be between ${minimum} and ${maximum}.`,
            "limit"
        );
    }

    return limit;
}

/* =========================================================
   SAFE ERROR RESPONSE
========================================================= */

function getValidationErrorData(error) {
    if (
        !(
            error instanceof
            ValidationError
        )
    ) {
        return null;
    }

    return Object.freeze({
        code:
            error.code,

        message:
            error.message,

        field:
            error.field,

        details:
            error.details
    });
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    ValidationError,

    isPlainObject,
    requirePlainObject,

    normalizeText,
    normalizeLowercaseText,
    normalizeUppercaseText,
    validateRequiredText,

    normalizeUid,
    isValidUid,
    validateUid,

    normalizeDocumentId,
    isValidDocumentId,
    validateDocumentId,

    normalizeRequestId,
    isValidRequestId,
    validateRequestId,

    normalizeDisplayName,
    validateDisplayName,

    normalizeEmail,
    isValidEmail,
    validateEmail,

    normalizePhotoURL,
    validatePhotoURL,

    normalizeBangladeshMobile,
    isValidBangladeshMobile,
    validateBangladeshMobile,
    toLocalBangladeshMobile,

    normalizeReferralCode,
    isValidReferralCode,
    validateReferralCode,

    normalizeWalletProvider,
    validateWalletProvider,
    validateWalletNumber,

    normalizeAmount,
    validateMoneyAmount,
    validateWithdrawalRequest,

    normalizeSessionId,
    validateSessionId,
    validateOptionalBoolean,
    validateHeartbeatPayload,

    validateEnumValue,
    validateProfileStatus,
    validateReferralStatus,
    validateRewardStatus,
    validateWalletTransactionStatus,
    validateWithdrawalStatus,
    validateAdminAction,

    validateAdminNote,
    validateBoolean,

    normalizePaginationCursor,
    validatePaginationCursor,
    validatePaginationLimit,

    getValidationErrorData
});