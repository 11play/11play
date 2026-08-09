"use strict";

/* =========================================================
   11PLAY — WALLET BACKEND
   File: functions/lib/wallet.js

   Responsibilities:
   - Maintain available and held balances
   - Credit referral rewards
   - Hold withdrawal amounts
   - Complete approved withdrawals
   - Refund rejected withdrawals
   - Support secure Admin adjustments
   - Create permanent wallet ledger records
   - Make every financial operation idempotent
   - Prevent duplicate or conflicting transactions
   - Prevent negative or corrupted wallet balances
   - Return paginated wallet transaction history
========================================================= */

const {
    getFirestore,
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const {
    COLLECTIONS,
    WALLET,
    SYSTEM,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    validateUid,
    validateDocumentId,
    validateMoneyAmount,
    validateAdminNote,
    validatePaginationCursor,
    validatePaginationLimit,
    normalizeText,
    isPlainObject
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

function toSafeString(value) {
    return normalizeText(value);
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

function toNonNegativeSafeInteger(
    value,
    options = {}
) {
    const {
        fieldName = "value",
        fallback = 0,
        allowMissing = true
    } = options;

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        if (allowMissing) {
            return fallback;
        }

        throw createHttpsError(
            ERROR_CODES.INTERNAL,
            `Wallet field ${fieldName} is missing.`
        );
    }

    const number =
        Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        throw createHttpsError(
            ERROR_CODES.INTERNAL,
            `Wallet field ${fieldName} is invalid.`
        );
    }

    return number;
}

/* =========================================================
   SAFE DOCUMENT ID

   Existing readable transaction ID format is preserved.
   Unsupported characters are rejected instead of silently
   changing them, preventing ID collisions.
========================================================= */

function normalizeDocumentIdSegment(
    value,
    fieldName = "referenceId"
) {
    const documentId =
        validateDocumentId(
            value,
            fieldName
        );

    if (
        !/^[A-Za-z0-9_-]+$/.test(
            documentId
        )
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            `${fieldName} may contain only letters, numbers, hyphens and underscores.`,
            {
                field:
                    fieldName
            }
        );
    }

    return documentId;
}

/* =========================================================
   SAFE METADATA
========================================================= */

function sanitizeMetadataValue(
    value,
    depth = 0
) {
    if (depth > 4) {
        return null;
    }

    if (
        value === null ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (
        typeof value === "number"
    ) {
        return Number.isFinite(value)
            ? value
            : null;
    }

    if (
        typeof value === "string"
    ) {
        return value.slice(
            0,
            1000
        );
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, 25)
            .map(
                (item) =>
                    sanitizeMetadataValue(
                        item,
                        depth + 1
                    )
            );
    }

    if (isPlainObject(value)) {
        const cleanObject = {};

        const entries =
            Object.entries(value)
                .slice(0, 50);

        for (
            const [
                rawKey,
                rawValue
            ]
            of entries
        ) {
            const key =
                toSafeString(rawKey)
                    .slice(0, 100);

            if (
                !key ||
                key === "__proto__" ||
                key === "prototype" ||
                key === "constructor"
            ) {
                continue;
            }

            const cleanValue =
                sanitizeMetadataValue(
                    rawValue,
                    depth + 1
                );

            if (
                cleanValue !== undefined
            ) {
                cleanObject[key] =
                    cleanValue;
            }
        }

        return cleanObject;
    }

    return null;
}

function sanitizeMetadata(value) {
    if (!isPlainObject(value)) {
        return {};
    }

    return (
        sanitizeMetadataValue(
            value,
            0
        ) || {}
    );
}

/* =========================================================
   TRANSACTION TYPE
========================================================= */

function normalizeTransactionType(value) {
    const type =
        toSafeString(value)
            .toLowerCase();

    return Object
        .values(
            WALLET.TRANSACTION_TYPE
        )
        .includes(type)
        ? type
        : "";
}

function validateTransactionType(value) {
    const type =
        normalizeTransactionType(
            value
        );

    if (!type) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid wallet transaction type is required."
        );
    }

    return type;
}

/* =========================================================
   TRANSACTION DIRECTION
========================================================= */

function normalizeDirection(value) {
    const direction =
        toSafeString(value)
            .toLowerCase();

    return Object
        .values(
            WALLET
                .TRANSACTION_DIRECTION
        )
        .includes(direction)
        ? direction
        : "";
}

function validateDirection(value) {
    const direction =
        normalizeDirection(value);

    if (!direction) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet transaction direction must be credit or debit."
        );
    }

    return direction;
}

/* =========================================================
   FIRESTORE REFERENCES
========================================================= */

function getProfileReference(
    database,
    uid
) {
    const normalizedUid =
        validateUid(uid);

    return database
        .collection(
            COLLECTIONS.USERS
        )
        .doc(normalizedUid);
}

function getWalletReference(
    database,
    uid
) {
    const normalizedUid =
        validateUid(uid);

    return database
        .collection(
            COLLECTIONS.WALLETS
        )
        .doc(normalizedUid);
}

function getWalletTransactionReference(
    database,
    transactionId
) {
    const normalizedTransactionId =
        normalizeDocumentIdSegment(
            transactionId,
            "transactionId"
        );

    return database
        .collection(
            COLLECTIONS
                .WALLET_TRANSACTIONS
        )
        .doc(
            normalizedTransactionId
        );
}

/* =========================================================
   DETERMINISTIC TRANSACTION ID

   Examples:
   referral_reward_REFERRAL_ID
   withdraw_hold_WITHDRAWAL_ID
   withdraw_success_WITHDRAWAL_ID
   withdraw_refund_WITHDRAWAL_ID
========================================================= */

function buildWalletTransactionId({
    type,
    referenceId,
    operationId = ""
}) {
    const normalizedType =
        validateTransactionType(
            type
        );

    const normalizedReferenceId =
        normalizeDocumentIdSegment(
            referenceId,
            "referenceId"
        );

    const parts = [
        normalizedType,
        normalizedReferenceId
    ];

    const rawOperationId =
        toSafeString(operationId);

    if (rawOperationId) {
        const normalizedOperationId =
            normalizeDocumentIdSegment(
                rawOperationId,
                "operationId"
            );

        parts.push(
            normalizedOperationId
        );
    }

    const transactionId =
        parts.join("_");

    if (
        transactionId.length > 512
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet transaction ID is too long."
        );
    }

    return transactionId;
}

/* =========================================================
   WALLET DOCUMENT
========================================================= */

function createInitialWallet(
    uid,
    timestamp = Timestamp.now()
) {
    const normalizedUid =
        validateUid(uid);

    return {
        uid:
            normalizedUid,

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

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

function normalizeWallet(
    data,
    uid = ""
) {
    const source =
        isPlainObject(data)
            ? data
            : {};

    const expectedUid =
        toSafeString(uid);

    const storedUid =
        toSafeString(
            source.uid
        );

    if (
        expectedUid &&
        storedUid &&
        storedUid !== expectedUid
    ) {
        throw createHttpsError(
            ERROR_CODES.INTERNAL,
            "Wallet ownership information is invalid."
        );
    }

    return {
        uid:
            storedUid ||
            expectedUid,

        availableBalance:
            toNonNegativeSafeInteger(
                source.availableBalance,
                {
                    fieldName:
                        "availableBalance"
                }
            ),

        heldBalance:
            toNonNegativeSafeInteger(
                source.heldBalance,
                {
                    fieldName:
                        "heldBalance"
                }
            ),

        totalEarned:
            toNonNegativeSafeInteger(
                source.totalEarned,
                {
                    fieldName:
                        "totalEarned"
                }
            ),

        totalWithdrawn:
            toNonNegativeSafeInteger(
                source.totalWithdrawn,
                {
                    fieldName:
                        "totalWithdrawn"
                }
            ),

        lastWithdrawalAmount:
            toNonNegativeSafeInteger(
                source
                    .lastWithdrawalAmount,
                {
                    fieldName:
                        "lastWithdrawalAmount"
                }
            ),

        lastWithdrawalAt:
            source.lastWithdrawalAt ||
            null,

        revision:
            toNonNegativeSafeInteger(
                source.revision,
                {
                    fieldName:
                        "revision"
                }
            ),

        createdAt:
            source.createdAt ||
            null,

        updatedAt:
            source.updatedAt ||
            null,

        schemaVersion:
            toNonNegativeSafeInteger(
                source.schemaVersion,
                {
                    fieldName:
                        "schemaVersion",

                    fallback:
                        SYSTEM
                            .SCHEMA_VERSION
                }
            )
    };
}

/* =========================================================
   WALLET MUTATION CALCULATION
========================================================= */

function calculateWalletMutation({
    wallet,
    type,
    amount,
    direction = "",
    timestamp
}) {
    const normalizedType =
        validateTransactionType(
            type
        );

    const normalizedAmount =
        validateMoneyAmount(
            amount,
            {
                fieldName:
                    "amount",

                minimum:
                    1,

                integerOnly:
                    true
            }
        );

    const currentWallet =
        normalizeWallet(wallet);

    let availableBalance =
        currentWallet.availableBalance;

    let heldBalance =
        currentWallet.heldBalance;

    let totalEarned =
        currentWallet.totalEarned;

    let totalWithdrawn =
        currentWallet.totalWithdrawn;

    let lastWithdrawalAmount =
        currentWallet
            .lastWithdrawalAmount;

    let lastWithdrawalAt =
        currentWallet
            .lastWithdrawalAt;

    let transactionDirection =
        "";

    switch (normalizedType) {
        case WALLET
            .TRANSACTION_TYPE
            .REFERRAL_REWARD:

            availableBalance +=
                normalizedAmount;

            totalEarned +=
                normalizedAmount;

            transactionDirection =
                WALLET
                    .TRANSACTION_DIRECTION
                    .CREDIT;

            break;

        case WALLET
            .TRANSACTION_TYPE
            .WITHDRAW_HOLD:

            if (
                availableBalance <
                normalizedAmount
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .FAILED_PRECONDITION,

                    "Insufficient available wallet balance."
                );
            }

            availableBalance -=
                normalizedAmount;

            heldBalance +=
                normalizedAmount;

            transactionDirection =
                WALLET
                    .TRANSACTION_DIRECTION
                    .DEBIT;

            break;

        case WALLET
            .TRANSACTION_TYPE
            .WITHDRAW_SUCCESS:

            if (
                heldBalance <
                normalizedAmount
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .FAILED_PRECONDITION,

                    "The held wallet balance is insufficient."
                );
            }

            heldBalance -=
                normalizedAmount;

            totalWithdrawn +=
                normalizedAmount;

            lastWithdrawalAmount =
                normalizedAmount;

            lastWithdrawalAt =
                timestamp;

            transactionDirection =
                WALLET
                    .TRANSACTION_DIRECTION
                    .DEBIT;

            break;

        case WALLET
            .TRANSACTION_TYPE
            .WITHDRAW_REFUND:

            if (
                heldBalance <
                normalizedAmount
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .FAILED_PRECONDITION,

                    "The held wallet balance is insufficient for this refund."
                );
            }

            heldBalance -=
                normalizedAmount;

            availableBalance +=
                normalizedAmount;

            transactionDirection =
                WALLET
                    .TRANSACTION_DIRECTION
                    .CREDIT;

            break;

        case WALLET
            .TRANSACTION_TYPE
            .ADMIN_ADJUSTMENT: {
            const normalizedDirection =
                validateDirection(
                    direction
                );

            if (
                normalizedDirection ===
                WALLET
                    .TRANSACTION_DIRECTION
                    .CREDIT
            ) {
                availableBalance +=
                    normalizedAmount;
            } else {
                if (
                    availableBalance <
                    normalizedAmount
                ) {
                    throw createHttpsError(
                        ERROR_CODES
                            .FAILED_PRECONDITION,

                        "The wallet does not have enough available balance for this adjustment."
                    );
                }

                availableBalance -=
                    normalizedAmount;
            }

            transactionDirection =
                normalizedDirection;

            break;
        }

        default:
            throw createHttpsError(
                ERROR_CODES.INVALID_ARGUMENT,
                "Unsupported wallet transaction type."
            );
    }

    const finalAmounts = [
        availableBalance,
        heldBalance,
        totalEarned,
        totalWithdrawn,
        lastWithdrawalAmount
    ];

    if (
        finalAmounts.some(
            (value) =>
                !Number.isSafeInteger(
                    value
                ) ||
                value < 0
        )
    ) {
        throw createHttpsError(
            ERROR_CODES.INTERNAL,
            "Wallet balance calculation failed."
        );
    }

    return {
        type:
            normalizedType,

        direction:
            transactionDirection,

        amount:
            normalizedAmount,

        before: {
            availableBalance:
                currentWallet
                    .availableBalance,

            heldBalance:
                currentWallet
                    .heldBalance,

            totalEarned:
                currentWallet
                    .totalEarned,

            totalWithdrawn:
                currentWallet
                    .totalWithdrawn
        },

        after: {
            availableBalance,

            heldBalance,

            totalEarned,

            totalWithdrawn
        },

        walletUpdate: {
            availableBalance,

            heldBalance,

            totalEarned,

            totalWithdrawn,

            lastWithdrawalAmount,

            lastWithdrawalAt,

            revision:
                currentWallet.revision +
                1,

            updatedAt:
                timestamp,

            schemaVersion:
                SYSTEM.SCHEMA_VERSION
        }
    };
}

/* =========================================================
   LEDGER DOCUMENT
========================================================= */

function createWalletTransactionData({
    transactionId,
    userId,
    type,
    direction,
    amount,
    referenceId,
    operationId = "",
    before,
    after,
    timestamp,
    adminUid = "",
    note = "",
    metadata = {}
}) {
    return {
        transactionId,

        userId,

        uid:
            userId,

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
                adminUid
            ),

        note:
            validateAdminNote(
                note,
                {
                    required:
                        false,

                    maxLength:
                        500
                }
            ),

        metadata:
            sanitizeMetadata(
                metadata
            ),

        status:
            WALLET
                .TRANSACTION_STATUS
                .COMPLETED,

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   DUPLICATE LEDGER VERIFICATION

   An existing deterministic transaction is idempotent only
   when every important field matches the new request.
========================================================= */

function assertDuplicateLedgerMatches({
    ledgerSnapshot,
    userId,
    type,
    amount,
    direction,
    referenceId,
    operationId
}) {
    const ledger =
        ledgerSnapshot.data() ||
        {};

    const expectedType =
        validateTransactionType(
            type
        );

    const expectedAmount =
        validateMoneyAmount(
            amount,
            {
                fieldName:
                    "amount",

                minimum:
                    1,

                integerOnly:
                    true
            }
        );

    const storedUserId =
        toSafeString(
            ledger.userId ||
            ledger.uid
        );

    const storedType =
        normalizeTransactionType(
            ledger.type
        );

    const storedAmount =
        Number(ledger.amount);

    const storedReferenceId =
        toSafeString(
            ledger.referenceId
        );

    const storedOperationId =
        toSafeString(
            ledger.operationId
        );

    const expectedReferenceId =
        toSafeString(
            referenceId
        );

    const expectedOperationId =
        toSafeString(
            operationId
        );

    let expectedDirection = "";

    if (
        expectedType ===
        WALLET
            .TRANSACTION_TYPE
            .ADMIN_ADJUSTMENT
    ) {
        expectedDirection =
            validateDirection(
                direction
            );
    }

    const storedDirection =
        normalizeDirection(
            ledger.direction
        );

    const conflicting =
        storedUserId !== userId ||
        storedType !== expectedType ||
        storedAmount !== expectedAmount ||
        storedReferenceId !==
            expectedReferenceId ||
        storedOperationId !==
            expectedOperationId ||
        (
            expectedDirection &&
            storedDirection !==
                expectedDirection
        );

    if (conflicting) {
        throw createHttpsError(
            ERROR_CODES.ABORTED,
            "A conflicting wallet transaction already exists."
        );
    }

    return ledger;
}

/* =========================================================
   APPLY OPERATION INSIDE EXISTING FIRESTORE TRANSACTION

   Caller must read walletSnapshot and ledgerSnapshot before
   invoking this helper.
========================================================= */

function applyWalletOperationInTransaction({
    transaction,

    walletRef,
    walletSnapshot,

    ledgerRef,
    ledgerSnapshot,

    userId,
    type,
    amount,
    referenceId,

    timestamp = Timestamp.now(),

    operationId = "",
    direction = "",

    adminUid = "",
    note = "",
    metadata = {}
}) {
    const normalizedUserId =
        validateUid(userId);

    const normalizedType =
        validateTransactionType(
            type
        );

    const normalizedReferenceId =
        normalizeDocumentIdSegment(
            referenceId,
            "referenceId"
        );

    const normalizedOperationId =
        toSafeString(operationId)
            ? normalizeDocumentIdSegment(
                operationId,
                "operationId"
            )
            : "";

    if (
        !transaction ||
        typeof transaction.set !==
            "function" ||
        typeof transaction.create !==
            "function"
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid Firestore transaction is required."
        );
    }

    if (
        !walletRef ||
        !ledgerRef
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet and ledger references are required."
        );
    }

    if (
        walletRef.id !==
        normalizedUserId
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet reference does not match the user."
        );
    }

    const expectedTransactionId =
        buildWalletTransactionId({
            type:
                normalizedType,

            referenceId:
                normalizedReferenceId,

            operationId:
                normalizedOperationId
        });

    if (
        ledgerRef.id !==
        expectedTransactionId
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet ledger reference is invalid."
        );
    }

    if (
        ledgerSnapshot?.exists
    ) {
        const existingLedger =
            assertDuplicateLedgerMatches({
                ledgerSnapshot,

                userId:
                    normalizedUserId,

                type:
                    normalizedType,

                amount,

                direction,

                referenceId:
                    normalizedReferenceId,

                operationId:
                    normalizedOperationId
            });

        if (!walletSnapshot?.exists) {
            throw createHttpsError(
                ERROR_CODES.INTERNAL,
                "Wallet ledger exists but the wallet document is missing."
            );
        }

        return {
            applied:
                false,

            duplicate:
                true,

            transactionId:
                ledgerRef.id,

            wallet:
                normalizeWallet(
                    walletSnapshot.data(),
                    normalizedUserId
                ),

            ledger:
                existingLedger
        };
    }

    const timestampValue =
        timestamp ||
        Timestamp.now();

    const existingWallet =
        walletSnapshot?.exists
            ? normalizeWallet(
                walletSnapshot.data(),
                normalizedUserId
            )
            : createInitialWallet(
                normalizedUserId,
                timestampValue
            );

    const mutation =
        calculateWalletMutation({
            wallet:
                existingWallet,

            type:
                normalizedType,

            amount,

            direction,

            timestamp:
                timestampValue
        });

    const ledgerData =
        createWalletTransactionData({
            transactionId:
                ledgerRef.id,

            userId:
                normalizedUserId,

            type:
                mutation.type,

            direction:
                mutation.direction,

            amount:
                mutation.amount,

            referenceId:
                normalizedReferenceId,

            operationId:
                normalizedOperationId,

            before:
                mutation.before,

            after:
                mutation.after,

            timestamp:
                timestampValue,

            adminUid,

            note,

            metadata
        });

    const walletWrite = {
        uid:
            normalizedUserId,

        ...mutation.walletUpdate
    };

    if (!walletSnapshot?.exists) {
        walletWrite.createdAt =
            timestampValue;
    }

    transaction.set(
        walletRef,
        walletWrite,
        {
            merge:
                true
        }
    );

    transaction.create(
        ledgerRef,
        ledgerData
    );

    return {
        applied:
            true,

        duplicate:
            false,

        transactionId:
            ledgerRef.id,

        wallet: {
            ...existingWallet,
            ...walletWrite
        },

        ledger:
            ledgerData
    };
}

/* =========================================================
   GENERIC WALLET OPERATION
========================================================= */

async function runWalletOperation({
    database = null,

    userId,
    type,
    amount,
    referenceId,

    operationId = "",
    direction = "",

    adminUid = "",
    note = "",
    metadata = {}
}) {
    const databaseInstance =
        database ||
        getFirestore();

    const normalizedUserId =
        validateUid(userId);

    const normalizedType =
        validateTransactionType(
            type
        );

    const normalizedReferenceId =
        normalizeDocumentIdSegment(
            referenceId,
            "referenceId"
        );

    const normalizedOperationId =
        toSafeString(operationId)
            ? normalizeDocumentIdSegment(
                operationId,
                "operationId"
            )
            : "";

    const transactionId =
        buildWalletTransactionId({
            type:
                normalizedType,

            referenceId:
                normalizedReferenceId,

            operationId:
                normalizedOperationId
        });

    const walletRef =
        getWalletReference(
            databaseInstance,
            normalizedUserId
        );

    const ledgerRef =
        getWalletTransactionReference(
            databaseInstance,
            transactionId
        );

    const timestamp =
        Timestamp.now();

    return databaseInstance
        .runTransaction(
            async (transaction) => {
                const [
                    walletSnapshot,
                    ledgerSnapshot
                ] = await Promise.all([
                    transaction.get(
                        walletRef
                    ),

                    transaction.get(
                        ledgerRef
                    )
                ]);

                return applyWalletOperationInTransaction({
                    transaction,

                    walletRef,
                    walletSnapshot,

                    ledgerRef,
                    ledgerSnapshot,

                    userId:
                        normalizedUserId,

                    type:
                        normalizedType,

                    amount,

                    referenceId:
                        normalizedReferenceId,

                    operationId:
                        normalizedOperationId,

                    direction,

                    timestamp,

                    adminUid,
                    note,
                    metadata
                });
            }
        );
}

/* =========================================================
   REFERRAL REWARD
========================================================= */

async function creditReferralReward({
    database = null,
    userId,
    referralId,
    amount,
    metadata = {}
}) {
    return runWalletOperation({
        database,

        userId,

        type:
            WALLET
                .TRANSACTION_TYPE
                .REFERRAL_REWARD,

        amount,

        referenceId:
            referralId,

        metadata: {
            ...metadata,

            source:
                "referral"
        }
    });
}

/* =========================================================
   WITHDRAWAL HOLD
========================================================= */

async function holdWithdrawalAmount({
    database = null,
    userId,
    withdrawalId,
    amount,
    metadata = {}
}) {
    return runWalletOperation({
        database,

        userId,

        type:
            WALLET
                .TRANSACTION_TYPE
                .WITHDRAW_HOLD,

        amount,

        referenceId:
            withdrawalId,

        metadata: {
            ...metadata,

            source:
                "withdrawal"
        }
    });
}

/* =========================================================
   WITHDRAWAL SUCCESS
========================================================= */

async function completeWithdrawalAmount({
    database = null,
    userId,
    withdrawalId,
    amount,
    adminUid = "",
    note = "",
    metadata = {}
}) {
    return runWalletOperation({
        database,

        userId,

        type:
            WALLET
                .TRANSACTION_TYPE
                .WITHDRAW_SUCCESS,

        amount,

        referenceId:
            withdrawalId,

        adminUid,
        note,

        metadata: {
            ...metadata,

            source:
                "withdrawal_approval"
        }
    });
}

/* =========================================================
   WITHDRAWAL REFUND
========================================================= */

async function refundWithdrawalAmount({
    database = null,
    userId,
    withdrawalId,
    amount,
    adminUid = "",
    note = "",
    metadata = {}
}) {
    return runWalletOperation({
        database,

        userId,

        type:
            WALLET
                .TRANSACTION_TYPE
                .WITHDRAW_REFUND,

        amount,

        referenceId:
            withdrawalId,

        adminUid,
        note,

        metadata: {
            ...metadata,

            source:
                "withdrawal_rejection"
        }
    });
}

/* =========================================================
   ADMIN WALLET ADJUSTMENT
========================================================= */

async function adjustWalletBalance({
    database = null,
    userId,
    operationId,
    amount,
    direction,
    adminUid,
    note,
    metadata = {}
}) {
    const normalizedAdminUid =
        validateUid(
            adminUid,
            "adminUid"
        );

    const normalizedOperationId =
        normalizeDocumentIdSegment(
            operationId,
            "operationId"
        );

    const normalizedNote =
        validateAdminNote(
            note,
            {
                required:
                    true,

                maxLength:
                    500
            }
        );

    return runWalletOperation({
        database,

        userId,

        type:
            WALLET
                .TRANSACTION_TYPE
                .ADMIN_ADJUSTMENT,

        amount,

        referenceId:
            normalizedOperationId,

        operationId:
            normalizedOperationId,

        direction:
            validateDirection(
                direction
            ),

        adminUid:
            normalizedAdminUid,

        note:
            normalizedNote,

        metadata: {
            ...metadata,

            source:
                "admin_adjustment"
        }
    });
}

/* =========================================================
   SERIALIZATION
========================================================= */

function serializeTimestamp(value) {
    if (!value) {
        return null;
    }

    if (
        typeof value.toDate ===
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

    return value;
}

function serializeWallet(wallet) {
    const normalized =
        normalizeWallet(wallet);

    return {
        ...normalized,

        createdAt:
            serializeTimestamp(
                normalized.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                normalized.updatedAt
            ),

        lastWithdrawalAt:
            serializeTimestamp(
                normalized
                    .lastWithdrawalAt
            )
    };
}

function serializeWalletTransaction(
    transactionData,
    id = ""
) {
    const data =
        isPlainObject(
            transactionData
        )
            ? transactionData
            : {};

    return {
        id:
            id ||
            toSafeString(
                data.transactionId
            ),

        transactionId:
            toSafeString(
                data.transactionId ||
                id
            ),

        type:
            normalizeTransactionType(
                data.type
            ),

        direction:
            normalizeDirection(
                data.direction
            ),

        amount:
            toSafeNumber(
                data.amount,
                0
            ),

        status:
            toSafeString(
                data.status
            ),

        referenceId:
            toSafeString(
                data.referenceId
            ),

        operationId:
            toSafeString(
                data.operationId
            ),

        availableBalanceBefore:
            toSafeNumber(
                data
                    .availableBalanceBefore,
                0
            ),

        availableBalanceAfter:
            toSafeNumber(
                data
                    .availableBalanceAfter,
                0
            ),

        heldBalanceBefore:
            toSafeNumber(
                data
                    .heldBalanceBefore,
                0
            ),

        heldBalanceAfter:
            toSafeNumber(
                data
                    .heldBalanceAfter,
                0
            ),

        note:
            toSafeString(
                data.note
            ),

        metadata:
            sanitizeMetadata(
                data.metadata
            ),

        createdAt:
            serializeTimestamp(
                data.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                data.updatedAt
            )
    };
}

/* =========================================================
   GET CURRENT USER WALLET

   Missing wallet creation is performed inside a transaction,
   preventing a simultaneous reward credit from being reset.
========================================================= */

async function getMyWallet(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const database =
            getFirestore();

        const profileRef =
            getProfileReference(
                database,
                authenticatedUser.uid
            );

        const walletRef =
            getWalletReference(
                database,
                authenticatedUser.uid
            );

        const wallet =
            await database.runTransaction(
                async (transaction) => {
                    const [
                        profileSnapshot,
                        walletSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            profileRef
                        ),

                        transaction.get(
                            walletRef
                        )
                    ]);

                    if (
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Create the user profile before loading the wallet."
                        );
                    }

                    if (
                        walletSnapshot.exists
                    ) {
                        return normalizeWallet(
                            walletSnapshot.data(),
                            authenticatedUser.uid
                        );
                    }

                    const initialWallet =
                        createInitialWallet(
                            authenticatedUser.uid,
                            Timestamp.now()
                        );

                    transaction.create(
                        walletRef,
                        initialWallet
                    );

                    return initialWallet;
                }
            );

        return {
            success:
                true,

            wallet:
                serializeWallet(
                    wallet
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Wallet information could not be loaded."
        );
    }
}

/* =========================================================
   GET CURRENT USER WALLET TRANSACTIONS

   Newest records are returned first. Cursor-based pagination
   keeps all previous ledger records permanently available.
========================================================= */

async function getMyWalletTransactions(
    request
) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const cursor =
            validatePaginationCursor(
                request?.data?.cursor
            );

        const resultLimit =
            validatePaginationLimit(
                request?.data?.limit,
                {
                    defaultValue:
                        50,

                    minimum:
                        1,

                    maximum:
                        100
                }
            );

        const database =
            getFirestore();

        let cursorSnapshot =
            null;

        if (cursor) {
            cursorSnapshot =
                await getWalletTransactionReference(
                    database,
                    cursor
                ).get();

            if (
                !cursorSnapshot.exists
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            const cursorTransaction =
                cursorSnapshot.data() ||
                {};

            const cursorUserId =
                toSafeString(
                    cursorTransaction.userId ||
                    cursorTransaction.uid
                );

            if (
                cursorUserId !==
                authenticatedUser.uid
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor does not belong to this user.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                !cursorTransaction.createdAt
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor is missing its creation time.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let query =
            database
                .collection(
                    COLLECTIONS
                        .WALLET_TRANSACTIONS
                )
                .where(
                    "userId",
                    "==",
                    authenticatedUser.uid
                )
                .orderBy(
                    "createdAt",
                    "desc"
                );

        if (cursorSnapshot) {
            query =
                query.startAfter(
                    cursorSnapshot
                );
        }

        const snapshot =
            await query
                .limit(
                    resultLimit + 1
                )
                .get();

        const hasMore =
            snapshot.docs.length >
                resultLimit;

        const pageDocuments =
            hasMore
                ? snapshot.docs.slice(
                    0,
                    resultLimit
                )
                : snapshot.docs;

        const transactions =
            pageDocuments.map(
                (documentSnapshot) =>
                    serializeWalletTransaction(
                        documentSnapshot.data(),
                        documentSnapshot.id
                    )
            );

        return {
            success:
                true,

            count:
                transactions.length,

            transactions,

            hasMore,

            nextCursor:
                hasMore &&
                pageDocuments.length > 0
                    ? pageDocuments[
                        pageDocuments.length - 1
                    ].id
                    : ""
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Wallet transactions could not be loaded."
        );
    }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    getWalletReference,
    getWalletTransactionReference,

    normalizeTransactionType,
    validateTransactionType,

    normalizeDirection,
    validateDirection,

    buildWalletTransactionId,

    createInitialWallet,
    normalizeWallet,

    calculateWalletMutation,
    createWalletTransactionData,

    applyWalletOperationInTransaction,
    runWalletOperation,

    creditReferralReward,
    holdWithdrawalAmount,
    completeWithdrawalAmount,
    refundWithdrawalAmount,
    adjustWalletBalance,

    getMyWallet,
    getMyWalletTransactions,

    serializeWallet,
    serializeWalletTransaction
});