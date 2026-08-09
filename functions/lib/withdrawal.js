"use strict";

/* =========================================================
   11PLAY — WITHDRAWAL BACKEND
   File: functions/lib/withdrawal.js

   Responsibilities:
   - Submit secure and idempotent withdrawal requests
   - Move requested money from available to held balance
   - Return the user's withdrawal history and summary
   - Allow users to cancel pending withdrawals
   - Return pending withdrawals to the Admin
   - Approve withdrawals and finalize held money
   - Reject withdrawals and refund held money
   - Create permanent wallet ledger records
   - Create permanent Admin audit records

   Withdrawal flow:

   Submit
   → Pending
   → Available balance decreases
   → Held balance increases

   Admin approval
   → Approved
   → Held balance decreases
   → Total withdrawn increases

   Admin rejection
   → Rejected
   → Held balance decreases
   → Available balance is refunded

   User cancellation
   → Cancelled
   → Held balance decreases
   → Available balance is refunded
========================================================= */

const crypto =
    require("crypto");

const {
    getFirestore,
    Timestamp,
    AggregateField
} = require(
    "firebase-admin/firestore"
);

const {
    COLLECTIONS,
    PROFILE_STATUS,
    WALLET,
    WITHDRAWAL,
    ADMIN,
    SYSTEM,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    validateUid,
    validateDocumentId,
    validateRequestId,
    validateWithdrawalRequest,
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
    assertAdmin,
    createHttpsError,
    throwHttpsError
} = require(
    "./security"
);

const {
    getWalletReference,
    getWalletTransactionReference,
    buildWalletTransactionId,
    normalizeWallet,
    applyWalletOperationInTransaction
} = require(
    "./wallet"
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

function toNonNegativeInteger(
    value,
    fallback = 0
) {
    const number =
        toSafeNumber(
            value,
            fallback
        );

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        return Math.max(
            0,
            Math.floor(fallback)
        );
    }

    return number;
}

function timestampToMilliseconds(value) {
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
        typeof value.seconds ===
        "number"
    ) {
        return (
            value.seconds * 1000
        ) + Math.floor(
            toSafeNumber(
                value.nanoseconds,
                0
            ) / 1000000
        );
    }

    const milliseconds =
        new Date(value)
            .getTime();

    return Number.isFinite(
        milliseconds
    )
        ? milliseconds
        : 0;
}

/* =========================================================
   WITHDRAWAL DOCUMENT ID
========================================================= */

function validateWithdrawalId(value) {
    const withdrawalId =
        validateDocumentId(
            value,
            "withdrawalId"
        );

    if (
        withdrawalId.length < 8 ||
        withdrawalId.length > 512 ||
        !/^[A-Za-z0-9_-]+$/.test(
            withdrawalId
        )
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid withdrawal ID is required.",
            {
                field:
                    "withdrawalId"
            }
        );
    }

    return withdrawalId;
}

function buildWithdrawalDocumentId({
    uid,
    requestId
}) {
    const normalizedUid =
        validateUid(uid);

    const normalizedRequestId =
        validateRequestId(
            requestId,
            "requestId"
        );

    const digest =
        crypto
            .createHash("sha256")
            .update(
                `${normalizedUid}:${normalizedRequestId}`,
                "utf8"
            )
            .digest("hex");

    return `wd_${digest}`;
}

/* =========================================================
   WITHDRAWAL STATUS

   Legacy values are normalized for safe migration.
========================================================= */

function normalizeWithdrawalStatus(value) {
    const status =
        toSafeString(value)
            .toLowerCase();

    const legacyStatusMap =
        Object.freeze({
            processing:
                WITHDRAWAL.STATUS.PENDING,

            successful:
                WITHDRAWAL.STATUS.APPROVED
        });

    const normalizedStatus =
        legacyStatusMap[status] ||
        status;

    return Object
        .values(
            WITHDRAWAL.STATUS
        )
        .includes(
            normalizedStatus
        )
        ? normalizedStatus
        : "";
}

function requireWithdrawalStatus(
    value,
    fieldName = "status"
) {
    const status =
        normalizeWithdrawalStatus(
            value
        );

    if (!status) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid withdrawal status is required.",
            {
                field:
                    fieldName
            }
        );
    }

    return status;
}

function getStoredStatusesForQuery(
    canonicalStatus
) {
    switch (canonicalStatus) {
        case WITHDRAWAL.STATUS.PENDING:
            return [
                WITHDRAWAL.STATUS.PENDING,
                "processing"
            ];

        case WITHDRAWAL.STATUS.APPROVED:
            return [
                WITHDRAWAL.STATUS.APPROVED,
                "successful"
            ];

        case WITHDRAWAL.STATUS.REJECTED:
            return [
                WITHDRAWAL.STATUS.REJECTED
            ];

        case WITHDRAWAL.STATUS.CANCELLED:
            return [
                WITHDRAWAL.STATUS.CANCELLED
            ];

        default:
            return [];
    }
}

/* =========================================================
   PHONE NUMBER MASKING
========================================================= */

function maskWalletNumber(value) {
    const number =
        toSafeString(value)
            .replace(
                /\D/g,
                ""
            );

    if (!number) {
        return "";
    }

    const visibleDigits =
        number.slice(-4);

    return `${"*".repeat(
        Math.max(
            0,
            number.length -
            visibleDigits.length
        )
    )}${visibleDigits}`;
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
        .doc(
            validateUid(uid)
        );
}

function getWithdrawalCollection(
    database
) {
    return database.collection(
        COLLECTIONS.WITHDRAWALS
    );
}

function getWithdrawalReference(
    database,
    withdrawalId
) {
    return getWithdrawalCollection(
        database
    ).doc(
        validateWithdrawalId(
            withdrawalId
        )
    );
}

function getAuditLogReference(
    database
) {
    return database
        .collection(
            COLLECTIONS.AUDIT_LOGS
        )
        .doc();
}

/* =========================================================
   SERIALIZATION
========================================================= */

function serializeValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
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

    if (Array.isArray(value)) {
        return value.map(
            serializeValue
        );
    }

    if (
        typeof value === "object"
    ) {
        const result = {};

        for (
            const [
                key,
                nestedValue
            ]
            of Object.entries(value)
        ) {
            result[key] =
                serializeValue(
                    nestedValue
                );
        }

        return result;
    }

    return value;
}

/* =========================================================
   WITHDRAWAL NORMALIZATION
========================================================= */

function normalizeWithdrawalRecord(
    data,
    id = "",
    options = {}
) {
    const source =
        isPlainObject(data)
            ? data
            : {};

    const {
        includeFullNumber = true,
        includeAdminNote = true
    } = options;

    const provider =
        toSafeString(
            source.provider ||
            source.wallet
        ).toLowerCase();

    const walletNumber =
        toSafeString(
            source.walletNumber ||
            source.number ||
            source.accountNumber
        );

    const status =
        normalizeWithdrawalStatus(
            source.status
        ) ||
        WITHDRAWAL.STATUS.PENDING;

    const withdrawalId =
        id ||
        toSafeString(
            source.withdrawalId ||
            source.transactionId
        );

    return serializeValue({
        id:
            withdrawalId,

        withdrawalId,

        transactionId:
            toSafeString(
                source.transactionId ||
                withdrawalId
            ),

        requestId:
            toSafeString(
                source.requestId
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

        provider,

        wallet:
            provider,

        walletNumber:
            includeFullNumber
                ? walletNumber
                : maskWalletNumber(
                    walletNumber
                ),

        number:
            includeFullNumber
                ? walletNumber
                : maskWalletNumber(
                    walletNumber
                ),

        maskedNumber:
            maskWalletNumber(
                walletNumber
            ),

        amount:
            toNonNegativeInteger(
                source.amount
            ),

        status,

        holdTransactionId:
            toSafeString(
                source.holdTransactionId
            ),

        completionTransactionId:
            toSafeString(
                source.completionTransactionId
            ),

        refundTransactionId:
            toSafeString(
                source.refundTransactionId
            ),

        createdAt:
            source.createdAt ||
            source.date ||
            null,

        date:
            source.date ||
            source.createdAt ||
            null,

        updatedAt:
            source.updatedAt ||
            null,

        reviewedAt:
            source.reviewedAt ||
            null,

        approvedAt:
            source.approvedAt ||
            null,

        rejectedAt:
            source.rejectedAt ||
            null,

        cancelledAt:
            source.cancelledAt ||
            null,

        reviewedBy:
            toSafeString(
                source.reviewedBy
            ),

        adminNote:
            includeAdminNote
                ? toSafeString(
                    source.adminNote
                )
                : "",

        schemaVersion:
            toNonNegativeInteger(
                source.schemaVersion,
                SYSTEM.SCHEMA_VERSION
            )
    });
}

/* =========================================================
   ADMIN WITHDRAWAL USER PROFILE

   Only the fields required by the authorized Admin UI are
   returned. Missing profile records use the withdrawal UID as
   a stable fallback identity.
========================================================= */

function normalizeWithdrawalUserProfile(
    data,
    uid = ""
) {
    const source =
        isPlainObject(data)
            ? data
            : {};

    const userId =
        toSafeString(
            source.uid ||
            source.userId ||
            uid
        );

    return serializeValue({
        uid:
            userId,

        userId:
            userId,

        displayName:
            toSafeString(
                source.displayName ||
                source.name
            ),

        name:
            toSafeString(
                source.name ||
                source.displayName
            ),

        email:
            toSafeString(
                source.email
            ).toLowerCase(),

        photoURL:
            toSafeString(
                source.photoURL ||
                source.photo
            ),

        mobileNumber:
            toSafeString(
                source.mobileNumber ||
                source.mobile
            ),

        status:
            toSafeString(
                source.status
            ).toLowerCase(),

        referralCode:
            toSafeString(
                source.referralCode
            ).toUpperCase()
    });
}

/* =========================================================
   INITIAL WITHDRAWAL DATA
========================================================= */

function createWithdrawalData({
    withdrawalId,
    requestId,
    userId,
    provider,
    walletNumber,
    amount,
    holdTransactionId,
    timestamp
}) {
    return {
        withdrawalId,

        transactionId:
            withdrawalId,

        requestId,

        userId,

        uid:
            userId,

        provider,

        wallet:
            provider,

        walletNumber,

        number:
            walletNumber,

        amount,

        status:
            WITHDRAWAL.STATUS.PENDING,

        holdTransactionId,

        completionTransactionId:
            "",

        refundTransactionId:
            "",

        createdAt:
            timestamp,

        date:
            timestamp,

        updatedAt:
            timestamp,

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

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   DUPLICATE REQUEST VERIFICATION

   Reusing the same requestId with different withdrawal data
   is rejected as a conflicting request.
========================================================= */

function assertExistingWithdrawalMatches({
    withdrawal,
    userId,
    requestId,
    provider,
    walletNumber,
    amount
}) {
    const existingUserId =
        toSafeString(
            withdrawal.userId ||
            withdrawal.uid
        );

    const existingRequestId =
        toSafeString(
            withdrawal.requestId
        );

    const existingProvider =
        toSafeString(
            withdrawal.provider ||
            withdrawal.wallet
        ).toLowerCase();

    const existingWalletNumber =
        toSafeString(
            withdrawal.walletNumber ||
            withdrawal.number
        );

    const existingAmount =
        Number(
            withdrawal.amount
        );

    const matches =
        existingUserId === userId &&
        existingRequestId === requestId &&
        existingProvider === provider &&
        existingWalletNumber ===
            walletNumber &&
        existingAmount === amount;

    if (!matches) {
        throw createHttpsError(
            ERROR_CODES.ABORTED,
            "This request ID is already associated with a different withdrawal request."
        );
    }

    return true;
}

/* =========================================================
   HOLD LEDGER VERIFICATION
========================================================= */

function assertHoldLedgerMatches({
    ledgerSnapshot,
    withdrawalId,
    userId,
    amount
}) {
    if (!ledgerSnapshot.exists) {
        throw createHttpsError(
            ERROR_CODES.FAILED_PRECONDITION,
            "The withdrawal hold transaction does not exist."
        );
    }

    const ledger =
        ledgerSnapshot.data() ||
        {};

    const valid =
        toSafeString(
            ledger.userId ||
            ledger.uid
        ) === userId &&
        toSafeString(
            ledger.type
        ) ===
            WALLET
                .TRANSACTION_TYPE
                .WITHDRAW_HOLD &&
        toSafeString(
            ledger.referenceId
        ) === withdrawalId &&
        Number(
            ledger.amount
        ) === amount &&
        toSafeString(
            ledger.status
        ) ===
            WALLET
                .TRANSACTION_STATUS
                .COMPLETED;

    if (!valid) {
        throw createHttpsError(
            ERROR_CODES.FAILED_PRECONDITION,
            "The withdrawal hold transaction is invalid."
        );
    }

    return ledger;
}

/* =========================================================
   SUBMIT WITHDRAWAL

   A client-generated requestId is mandatory so retries cannot
   create multiple withdrawal requests.
========================================================= */

async function submitWithdrawal(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const requestId =
            validateRequestId(
                request?.data
                    ?.requestId,
                "requestId"
            );

        const input =
            validateWithdrawalRequest(
                {
                    ...(
                        isPlainObject(
                            request?.data
                        )
                            ? request.data
                            : {}
                    ),

                    requestId
                },
                {
                    minimumAmount:
                        WITHDRAWAL
                            .MINIMUM_AMOUNT
                }
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const withdrawalId =
            buildWithdrawalDocumentId({
                uid:
                    authenticatedUser.uid,

                requestId
            });

        const profileRef =
            getProfileReference(
                database,
                authenticatedUser.uid
            );

        const withdrawalRef =
            getWithdrawalReference(
                database,
                withdrawalId
            );

        const walletRef =
            getWalletReference(
                database,
                authenticatedUser.uid
            );

        const holdTransactionId =
            buildWalletTransactionId({
                type:
                    WALLET
                        .TRANSACTION_TYPE
                        .WITHDRAW_HOLD,

                referenceId:
                    withdrawalId
            });

        const holdLedgerRef =
            getWalletTransactionReference(
                database,
                holdTransactionId
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const [
                        profileSnapshot,
                        withdrawalSnapshot,
                        walletSnapshot,
                        holdLedgerSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            profileRef
                        ),

                        transaction.get(
                            withdrawalRef
                        ),

                        transaction.get(
                            walletRef
                        ),

                        transaction.get(
                            holdLedgerRef
                        )
                    ]);

                    if (
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Create the user profile before requesting a withdrawal."
                        );
                    }

                    const profile =
                        profileSnapshot.data() ||
                        {};

                    if (
                        toSafeString(
                            profile.status
                        ) !==
                        PROFILE_STATUS.ACTIVE
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This profile cannot currently submit withdrawals."
                        );
                    }

                    if (
                        withdrawalSnapshot.exists
                    ) {
                        const existing =
                            withdrawalSnapshot.data() ||
                            {};

                        assertExistingWithdrawalMatches({
                            withdrawal:
                                existing,

                            userId:
                                authenticatedUser.uid,

                            requestId,

                            provider:
                                input.provider,

                            walletNumber:
                                input.walletNumber,

                            amount:
                                input.amount
                        });

                        if (
                            !holdLedgerSnapshot.exists
                        ) {
                            throw createHttpsError(
                                ERROR_CODES.INTERNAL,
                                "The existing withdrawal request has no wallet hold transaction."
                            );
                        }

                        return {
                            created:
                                false,

                            duplicate:
                                true,

                            withdrawal:
                                normalizeWithdrawalRecord(
                                    existing,
                                    withdrawalSnapshot.id
                                ),

                            wallet:
                                walletSnapshot.exists
                                    ? serializeValue(
                                        normalizeWallet(
                                            walletSnapshot
                                                .data(),
                                            authenticatedUser
                                                .uid
                                        )
                                    )
                                    : null
                        };
                    }

                    if (
                        holdLedgerSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.ABORTED,
                            "A conflicting wallet hold transaction already exists."
                        );
                    }

                    if (
                        !walletSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Wallet information does not exist."
                        );
                    }

                    const wallet =
                        normalizeWallet(
                            walletSnapshot.data(),
                            authenticatedUser.uid
                        );

                    const validatedRequest =
                        validateWithdrawalRequest(
                            input,
                            {
                                availableBalance:
                                    wallet
                                        .availableBalance,

                                minimumAmount:
                                    WITHDRAWAL
                                        .MINIMUM_AMOUNT
                            }
                        );

                    const walletResult =
                        applyWalletOperationInTransaction({
                            transaction,

                            walletRef,
                            walletSnapshot,

                            ledgerRef:
                                holdLedgerRef,

                            ledgerSnapshot:
                                holdLedgerSnapshot,

                            userId:
                                authenticatedUser.uid,

                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .WITHDRAW_HOLD,

                            direction:
                                WALLET
                                    .TRANSACTION_DIRECTION
                                    .DEBIT,

                            amount:
                                validatedRequest
                                    .amount,

                            referenceId:
                                withdrawalId,

                            timestamp,

                            metadata: {
                                source:
                                    "withdrawal_request",

                                provider:
                                    validatedRequest
                                        .provider,

                                maskedNumber:
                                    maskWalletNumber(
                                        validatedRequest
                                            .walletNumber
                                    )
                            }
                        });

                    const withdrawalData =
                        createWithdrawalData({
                            withdrawalId,

                            requestId,

                            userId:
                                authenticatedUser.uid,

                            provider:
                                validatedRequest
                                    .provider,

                            walletNumber:
                                validatedRequest
                                    .walletNumber,

                            amount:
                                validatedRequest
                                    .amount,

                            holdTransactionId:
                                walletResult
                                    .transactionId,

                            timestamp
                        });

                    transaction.create(
                        withdrawalRef,
                        withdrawalData
                    );

                    return {
                        created:
                            true,

                        duplicate:
                            false,

                        withdrawal:
                            normalizeWithdrawalRecord(
                                withdrawalData,
                                withdrawalId
                            ),

                        wallet:
                            serializeValue(
                                walletResult.wallet
                            )
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
            "The withdrawal request could not be submitted."
        );
    }
}

/* =========================================================
   GET CURRENT USER WITHDRAWALS
========================================================= */

async function getMyWithdrawals(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const rawStatus =
            toSafeString(
                request?.data?.status
            );

        const requestedStatus =
            rawStatus
                ? requireWithdrawalStatus(
                    rawStatus
                )
                : "";

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
                await getWithdrawalReference(
                    database,
                    cursor
                ).get();

            if (
                !cursorSnapshot.exists
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Withdrawal pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            const cursorWithdrawal =
                cursorSnapshot.data() ||
                {};

            const cursorUserId =
                toSafeString(
                    cursorWithdrawal.userId ||
                    cursorWithdrawal.uid
                );

            if (
                cursorUserId !==
                authenticatedUser.uid
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Withdrawal pagination cursor does not belong to this user.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                requestedStatus &&
                normalizeWithdrawalStatus(
                    cursorWithdrawal.status
                ) !== requestedStatus
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Withdrawal pagination cursor does not match the requested status.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let query =
            getWithdrawalCollection(
                database
            ).where(
                "userId",
                "==",
                authenticatedUser.uid
            );

        if (requestedStatus) {
            const storedStatuses =
                getStoredStatusesForQuery(
                    requestedStatus
                );

            if (
                storedStatuses.length === 1
            ) {
                query =
                    query.where(
                        "status",
                        "==",
                        storedStatuses[0]
                    );
            } else {
                query =
                    query.where(
                        "status",
                        "in",
                        storedStatuses
                    );
            }
        }

        query =
            query.orderBy(
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

        const withdrawals =
            pageDocuments.map(
                (documentSnapshot) =>
                    normalizeWithdrawalRecord(
                        documentSnapshot.data(),
                        documentSnapshot.id,
                        {
                            includeFullNumber:
                                true,

                            includeAdminNote:
                                true
                        }
                    )
            );

        return {
            success:
                true,

            count:
                withdrawals.length,

            status:
                requestedStatus,

            withdrawals,

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
            "Withdrawal history could not be loaded."
        );
    }
}

/* =========================================================
   GET CURRENT USER WITHDRAWAL SUMMARY
========================================================= */

async function getMyWithdrawalSummary(
    request
) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const database =
            getFirestore();

        const snapshot =
            await getWithdrawalCollection(
                database
            )
                .where(
                    "userId",
                    "==",
                    authenticatedUser.uid
                )
                .get();

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

            lastWithdrawal:
                null
        };

        let latestCreatedAt =
            0;

        for (
            const documentSnapshot
            of snapshot.docs
        ) {
            const rawWithdrawal =
                documentSnapshot.data() ||
                {};

            const withdrawal =
                normalizeWithdrawalRecord(
                    rawWithdrawal,
                    documentSnapshot.id,
                    {
                        includeFullNumber:
                            false,

                        includeAdminNote:
                            true
                    }
                );

            const amount =
                toNonNegativeInteger(
                    withdrawal.amount
                );

            summary.total += 1;

            summary.totalRequestedAmount +=
                amount;

            switch (withdrawal.status) {
                case WITHDRAWAL
                    .STATUS
                    .PENDING:

                    summary.pending += 1;

                    summary.totalPendingAmount +=
                        amount;

                    break;

                case WITHDRAWAL
                    .STATUS
                    .APPROVED:

                    summary.approved += 1;

                    summary.totalApprovedAmount +=
                        amount;

                    break;

                case WITHDRAWAL
                    .STATUS
                    .REJECTED:

                    summary.rejected += 1;

                    summary.totalRejectedAmount +=
                        amount;

                    break;

                case WITHDRAWAL
                    .STATUS
                    .CANCELLED:

                    summary.cancelled += 1;

                    summary.totalCancelledAmount +=
                        amount;

                    break;

                default:
                    break;
            }

            const createdAtMilliseconds =
                timestampToMilliseconds(
                    rawWithdrawal.createdAt ||
                    rawWithdrawal.date
                );

            if (
                createdAtMilliseconds >
                latestCreatedAt
            ) {
                latestCreatedAt =
                    createdAtMilliseconds;

                summary.lastWithdrawal =
                    withdrawal;
            }
        }

        summary.processing =
            summary.pending;

        summary.successful =
            summary.approved;

        summary.totalProcessingAmount =
            summary.totalPendingAmount;

        summary.totalSuccessfulAmount =
            summary.totalApprovedAmount;

        return {
            success:
                true,

            summary
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Withdrawal summary could not be loaded."
        );
    }
}

/* =========================================================
   USER: CANCEL PENDING WITHDRAWAL
========================================================= */

async function cancelWithdrawal(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const withdrawalId =
            validateWithdrawalId(
                request?.data
                    ?.withdrawalId ||
                request?.data
                    ?.transactionId
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const withdrawalRef =
            getWithdrawalReference(
                database,
                withdrawalId
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const withdrawalSnapshot =
                        await transaction.get(
                            withdrawalRef
                        );

                    if (
                        !withdrawalSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.NOT_FOUND,
                            "Withdrawal record was not found."
                        );
                    }

                    const withdrawal =
                        withdrawalSnapshot.data() ||
                        {};

                    const userId =
                        validateUid(
                            withdrawal.userId ||
                            withdrawal.uid,
                            "userId"
                        );

                    if (
                        userId !==
                        authenticatedUser.uid
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This withdrawal belongs to another user."
                        );
                    }

                    const currentStatus =
                        normalizeWithdrawalStatus(
                            withdrawal.status
                        );

                    if (
                        currentStatus ===
                        WITHDRAWAL.STATUS.CANCELLED
                    ) {
                        return {
                            cancelled:
                                false,

                            alreadyCancelled:
                                true,

                            withdrawal:
                                normalizeWithdrawalRecord(
                                    withdrawal,
                                    withdrawalId
                                )
                        };
                    }

                    if (
                        currentStatus !==
                        WITHDRAWAL.STATUS.PENDING
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Only a pending withdrawal can be cancelled."
                        );
                    }

                    const amount =
                        toNonNegativeInteger(
                            withdrawal.amount
                        );

                    if (amount < 1) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The withdrawal amount is invalid."
                        );
                    }

                    const walletRef =
                        getWalletReference(
                            database,
                            userId
                        );

                    const holdTransactionId =
                        toSafeString(
                            withdrawal
                                .holdTransactionId
                        ) ||
                        buildWalletTransactionId({
                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .WITHDRAW_HOLD,

                            referenceId:
                                withdrawalId
                        });

                    const holdLedgerRef =
                        getWalletTransactionReference(
                            database,
                            holdTransactionId
                        );

                    const refundTransactionId =
                        buildWalletTransactionId({
                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .WITHDRAW_REFUND,

                            referenceId:
                                withdrawalId
                        });

                    const refundLedgerRef =
                        getWalletTransactionReference(
                            database,
                            refundTransactionId
                        );

                    const [
                        walletSnapshot,
                        holdLedgerSnapshot,
                        refundLedgerSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            walletRef
                        ),

                        transaction.get(
                            holdLedgerRef
                        ),

                        transaction.get(
                            refundLedgerRef
                        )
                    ]);

                    if (!walletSnapshot.exists) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Wallet information does not exist."
                        );
                    }

                    assertHoldLedgerMatches({
                        ledgerSnapshot:
                            holdLedgerSnapshot,

                        withdrawalId,

                        userId,

                        amount
                    });

                    const walletResult =
                        applyWalletOperationInTransaction({
                            transaction,

                            walletRef,
                            walletSnapshot,

                            ledgerRef:
                                refundLedgerRef,

                            ledgerSnapshot:
                                refundLedgerSnapshot,

                            userId,

                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .WITHDRAW_REFUND,

                            direction:
                                WALLET
                                    .TRANSACTION_DIRECTION
                                    .CREDIT,

                            amount,

                            referenceId:
                                withdrawalId,

                            timestamp,

                            metadata: {
                                source:
                                    "withdrawal_cancellation",

                                provider:
                                    toSafeString(
                                        withdrawal.provider ||
                                        withdrawal.wallet
                                    ),

                                maskedNumber:
                                    maskWalletNumber(
                                        withdrawal.walletNumber ||
                                        withdrawal.number
                                    )
                            }
                        });

                    const withdrawalUpdate = {
                        status:
                            WITHDRAWAL
                                .STATUS
                                .CANCELLED,

                        refundTransactionId:
                            walletResult
                                .transactionId,

                        completionTransactionId:
                            "",

                        cancelledAt:
                            timestamp,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    transaction.set(
                        withdrawalRef,
                        withdrawalUpdate,
                        {
                            merge:
                                true
                        }
                    );

                    return {
                        cancelled:
                            true,

                        alreadyCancelled:
                            false,

                        withdrawal:
                            normalizeWithdrawalRecord(
                                {
                                    ...withdrawal,
                                    ...withdrawalUpdate
                                },
                                withdrawalId
                            ),

                        wallet:
                            serializeValue(
                                walletResult.wallet
                            )
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
            "The withdrawal could not be cancelled."
        );
    }
}

/* =========================================================
   ADMIN: GET PENDING WITHDRAWALS
========================================================= */

async function getPendingWithdrawals(
    request
) {
    try {
        await assertAdmin(request);

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
                await getWithdrawalReference(
                    database,
                    cursor
                ).get();

            if (
                !cursorSnapshot.exists ||
                normalizeWithdrawalStatus(
                    cursorSnapshot
                        .data()
                        ?.status
                ) !==
                    WITHDRAWAL
                        .STATUS
                        .PENDING
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Pending withdrawal pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        const baseQuery =
            getWithdrawalCollection(
                database
            )
                .where(
                    "status",
                    "in",
                    [
                        WITHDRAWAL
                            .STATUS
                            .PENDING,

                        "processing"
                    ]
                );

        let query =
            baseQuery.orderBy(
                "createdAt",
                "desc"
            );

        if (cursorSnapshot) {
            query =
                query.startAfter(
                    cursorSnapshot
                );
        }

        const [
            snapshot,
            aggregateSnapshot
        ] = await Promise.all([
            query
                .limit(
                    resultLimit + 1
                )
                .get(),

            baseQuery
                .aggregate({
                    total:
                        AggregateField.count(),

                    pendingAmount:
                        AggregateField.sum(
                            "amount"
                        )
                })
                .get()
        ]);

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

        const withdrawalRows =
            pageDocuments.map(
                (documentSnapshot) => {
                    const rawWithdrawal =
                        documentSnapshot.data() ||
                        {};

                    const userId =
                        toSafeString(
                            rawWithdrawal.userId ||
                            rawWithdrawal.uid
                        );

                    return {
                        userId,

                        withdrawal:
                            normalizeWithdrawalRecord(
                                rawWithdrawal,
                                documentSnapshot.id,
                                {
                                    includeFullNumber:
                                        true,

                                    includeAdminNote:
                                        true
                                }
                            )
                    };
                }
            );

        const userIds =
            Array.from(
                new Set(
                    withdrawalRows
                        .map(
                            (row) =>
                                row.userId
                        )
                        .filter(Boolean)
                )
            );

        const profileSnapshots =
            userIds.length > 0
                ? await database.getAll(
                    ...userIds.map(
                        (userId) =>
                            getProfileReference(
                                database,
                                userId
                            )
                    )
                )
                : [];

        const profilesByUserId =
            new Map(
                profileSnapshots.map(
                    (profileSnapshot) => [
                        profileSnapshot.id,

                        profileSnapshot.exists
                            ? profileSnapshot.data() ||
                                {}
                            : {}
                    ]
                )
            );

        const withdrawals =
            withdrawalRows.map(
                (row) => ({
                    ...row.withdrawal,

                    userProfile:
                        normalizeWithdrawalUserProfile(
                            profilesByUserId.get(
                                row.userId
                            ) ||
                            {},
                            row.userId
                        )
                })
            );

        const aggregateData =
            aggregateSnapshot.data() ||
            {};

        const total =
            toNonNegativeInteger(
                aggregateData.total
            );

        const pendingAmount =
            toNonNegativeInteger(
                aggregateData
                    .pendingAmount
            );

        return {
            success:
                true,

            count:
                withdrawals.length,

            total,

            pendingAmount,

            withdrawals,

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
            "Pending withdrawals could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN AUDIT LOG
========================================================= */

function createWithdrawalAuditLog({
    auditId,
    withdrawalId,
    withdrawal,
    admin,
    decision,
    walletTransactionId,
    note,
    timestamp
}) {
    const approved =
        decision ===
        WITHDRAWAL.STATUS.APPROVED;

    return {
        auditId,

        action:
            approved
                ? ADMIN.ACTION
                    .WITHDRAWAL_APPROVED
                : ADMIN.ACTION
                    .WITHDRAWAL_REJECTED,

        adminUid:
            admin.uid,

        adminEmail:
            admin.email,

        adminRole:
            admin.role,

        targetUid:
            toSafeString(
                withdrawal.userId ||
                withdrawal.uid
            ),

        withdrawalId,

        previousStatus:
            normalizeWithdrawalStatus(
                withdrawal.status
            ),

        newStatus:
            decision,

        provider:
            toSafeString(
                withdrawal.provider ||
                withdrawal.wallet
            ),

        maskedNumber:
            maskWalletNumber(
                withdrawal.walletNumber ||
                withdrawal.number
            ),

        amount:
            toNonNegativeInteger(
                withdrawal.amount
            ),

        walletTransactionId,

        note,

        createdAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   ADMIN REVIEW WITHDRAWAL
========================================================= */

async function reviewWithdrawal(
    request,
    decision
) {
    try {
        const admin =
            await assertAdmin(request);

        const approved =
            decision ===
            WITHDRAWAL.STATUS.APPROVED;

        const rejected =
            decision ===
            WITHDRAWAL.STATUS.REJECTED;

        if (
            !approved &&
            !rejected
        ) {
            throw createHttpsError(
                ERROR_CODES.INVALID_ARGUMENT,
                "Withdrawal review decision is invalid."
            );
        }

        const withdrawalId =
            validateWithdrawalId(
                request?.data
                    ?.withdrawalId ||
                request?.data
                    ?.transactionId
            );

        const adminNote =
            validateAdminNote(
                request?.data
                    ?.adminNote ||
                request?.data
                    ?.note ||
                "",
                {
                    required:
                        rejected,

                    maxLength:
                        500
                }
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const withdrawalRef =
            getWithdrawalReference(
                database,
                withdrawalId
            );

        const auditRef =
            getAuditLogReference(
                database
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const withdrawalSnapshot =
                        await transaction.get(
                            withdrawalRef
                        );

                    if (
                        !withdrawalSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.NOT_FOUND,
                            "Withdrawal record was not found."
                        );
                    }

                    const withdrawal =
                        withdrawalSnapshot.data() ||
                        {};

                    const currentStatus =
                        normalizeWithdrawalStatus(
                            withdrawal.status
                        );

                    if (
                        currentStatus ===
                        decision
                    ) {
                        return {
                            reviewed:
                                false,

                            alreadyReviewed:
                                true,

                            withdrawalId,

                            status:
                                currentStatus,

                            withdrawal:
                                normalizeWithdrawalRecord(
                                    withdrawal,
                                    withdrawalId
                                )
                        };
                    }

                    if (
                        currentStatus ===
                            WITHDRAWAL.STATUS
                                .APPROVED ||
                        currentStatus ===
                            WITHDRAWAL.STATUS
                                .REJECTED ||
                        currentStatus ===
                            WITHDRAWAL.STATUS
                                .CANCELLED
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "This withdrawal already has a final status."
                        );
                    }

                    if (
                        currentStatus !==
                        WITHDRAWAL.STATUS.PENDING
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "This withdrawal is not awaiting review."
                        );
                    }

                    const userId =
                        validateUid(
                            withdrawal.userId ||
                            withdrawal.uid,
                            "userId"
                        );

                    const amount =
                        toNonNegativeInteger(
                            withdrawal.amount
                        );

                    if (amount < 1) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The withdrawal amount is invalid."
                        );
                    }

                    if (
                        approved &&
                        (
                            amount <
                                WITHDRAWAL
                                    .MINIMUM_AMOUNT ||
                            amount %
                                WITHDRAWAL
                                    .AMOUNT_MULTIPLE !==
                                0
                        )
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            `This withdrawal does not meet the current minimum ৳${WITHDRAWAL.MINIMUM_AMOUNT} and ৳${WITHDRAWAL.AMOUNT_MULTIPLE} multiple rules. Reject it instead.`
                        );
                    }

                    const profileRef =
                        getProfileReference(
                            database,
                            userId
                        );

                    const walletRef =
                        getWalletReference(
                            database,
                            userId
                        );

                    const holdTransactionId =
                        toSafeString(
                            withdrawal
                                .holdTransactionId
                        ) ||
                        buildWalletTransactionId({
                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .WITHDRAW_HOLD,

                            referenceId:
                                withdrawalId
                        });

                    const holdLedgerRef =
                        getWalletTransactionReference(
                            database,
                            holdTransactionId
                        );

                    const walletTransactionType =
                        approved
                            ? WALLET
                                .TRANSACTION_TYPE
                                .WITHDRAW_SUCCESS
                            : WALLET
                                .TRANSACTION_TYPE
                                .WITHDRAW_REFUND;

                    const walletTransactionId =
                        buildWalletTransactionId({
                            type:
                                walletTransactionType,

                            referenceId:
                                withdrawalId
                        });

                    const ledgerRef =
                        getWalletTransactionReference(
                            database,
                            walletTransactionId
                        );

                    const [
                        profileSnapshot,
                        walletSnapshot,
                        holdLedgerSnapshot,
                        ledgerSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            profileRef
                        ),

                        transaction.get(
                            walletRef
                        ),

                        transaction.get(
                            holdLedgerRef
                        ),

                        transaction.get(
                            ledgerRef
                        )
                    ]);

                    if (
                        approved &&
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The user's current profile does not exist."
                        );
                    }

                    if (approved) {
                        const currentProfile =
                            profileSnapshot.data() ||
                            {};

                        if (
                            toSafeString(
                                currentProfile.status
                            ).toLowerCase() !==
                            PROFILE_STATUS.ACTIVE
                        ) {
                            throw createHttpsError(
                                ERROR_CODES
                                    .FAILED_PRECONDITION,

                                "A suspended or blocked user withdrawal cannot be approved. Reject it to refund the held balance."
                            );
                        }
                    }

                    if (!walletSnapshot.exists) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The user's wallet does not exist."
                        );
                    }

                    const currentWallet =
                        normalizeWallet(
                            walletSnapshot.data(),
                            userId
                        );

                    if (
                        currentWallet.heldBalance <
                        amount
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The wallet does not contain enough held balance for this withdrawal."
                        );
                    }

                    assertHoldLedgerMatches({
                        ledgerSnapshot:
                            holdLedgerSnapshot,

                        withdrawalId,

                        userId,

                        amount
                    });

                    const walletResult =
                        applyWalletOperationInTransaction({
                            transaction,

                            walletRef,
                            walletSnapshot,

                            ledgerRef,
                            ledgerSnapshot,

                            userId,

                            type:
                                walletTransactionType,

                            direction:
                                approved
                                    ? WALLET
                                        .TRANSACTION_DIRECTION
                                        .DEBIT
                                    : WALLET
                                        .TRANSACTION_DIRECTION
                                        .CREDIT,

                            amount,

                            referenceId:
                                withdrawalId,

                            timestamp,

                            adminUid:
                                admin.uid,

                            note:
                                adminNote,

                            metadata: {
                                source:
                                    approved
                                        ? "withdrawal_approval"
                                        : "withdrawal_rejection",

                                provider:
                                    toSafeString(
                                        withdrawal.provider ||
                                        withdrawal.wallet
                                    ),

                                maskedNumber:
                                    maskWalletNumber(
                                        withdrawal.walletNumber ||
                                        withdrawal.number
                                    )
                            }
                        });

                    const withdrawalUpdate = {
                        status:
                            decision,

                        reviewedAt:
                            timestamp,

                        reviewedBy:
                            admin.uid,

                        adminNote,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    if (approved) {
                        withdrawalUpdate.approvedAt =
                            timestamp;

                        withdrawalUpdate.rejectedAt =
                            null;

                        withdrawalUpdate.cancelledAt =
                            null;

                        withdrawalUpdate
                            .completionTransactionId =
                            walletResult
                                .transactionId;

                        withdrawalUpdate
                            .refundTransactionId =
                            "";
                    } else {
                        withdrawalUpdate.rejectedAt =
                            timestamp;

                        withdrawalUpdate.approvedAt =
                            null;

                        withdrawalUpdate.cancelledAt =
                            null;

                        withdrawalUpdate
                            .refundTransactionId =
                            walletResult
                                .transactionId;

                        withdrawalUpdate
                            .completionTransactionId =
                            "";
                    }

                    transaction.set(
                        withdrawalRef,
                        withdrawalUpdate,
                        {
                            merge:
                                true
                        }
                    );

                    transaction.create(
                        auditRef,
                        createWithdrawalAuditLog({
                            auditId:
                                auditRef.id,

                            withdrawalId,

                            withdrawal,

                            admin,

                            decision,

                            walletTransactionId:
                                walletResult
                                    .transactionId,

                            note:
                                adminNote,

                            timestamp
                        })
                    );

                    return {
                        reviewed:
                            true,

                        alreadyReviewed:
                            false,

                        withdrawalId,

                        userId,

                        status:
                            decision,

                        walletTransactionId:
                            walletResult
                                .transactionId,

                        auditId:
                            auditRef.id,

                        withdrawal:
                            normalizeWithdrawalRecord(
                                {
                                    ...withdrawal,
                                    ...withdrawalUpdate
                                },
                                withdrawalId
                            ),

                        wallet:
                            serializeValue(
                                walletResult.wallet
                            )
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
    } catch (error) {
        throwHttpsError(
            error,

            decision ===
            WITHDRAWAL.STATUS.APPROVED
                ? "The withdrawal could not be approved."
                : "The withdrawal could not be rejected."
        );
    }
}

/* =========================================================
   ADMIN: APPROVE WITHDRAWAL
========================================================= */

async function approveWithdrawal(
    request
) {
    return reviewWithdrawal(
        request,
        WITHDRAWAL.STATUS.APPROVED
    );
}

/* =========================================================
   ADMIN: REJECT WITHDRAWAL
========================================================= */

async function rejectWithdrawal(
    request
) {
    return reviewWithdrawal(
        request,
        WITHDRAWAL.STATUS.REJECTED
    );
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    getWithdrawalCollection,
    getWithdrawalReference,

    validateWithdrawalId,
    buildWithdrawalDocumentId,

    normalizeWithdrawalStatus,
    requireWithdrawalStatus,
    normalizeWithdrawalRecord,
    maskWalletNumber,

    submitWithdrawal,
    cancelWithdrawal,

    getMyWithdrawals,
    getMyWithdrawalSummary,

    getPendingWithdrawals,
    approveWithdrawal,
    rejectWithdrawal
});