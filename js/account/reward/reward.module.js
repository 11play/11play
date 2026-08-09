"use strict";

/* =========================================================
   11PLAY — REWARD CENTER MODULE
   File: js/account/reward/reward.module.js

   Responsibilities:
   - Load server-authoritative wallet information
   - Load withdrawal summary and history
   - Render available, held and withdrawn balances
   - Validate the withdrawal-request form
   - Submit withdrawals through WithdrawDB
   - Prevent duplicate form submissions
   - Refresh WalletDB, WithdrawDB and RewardDB
   - Initialize Shared Account Sections
   - Clean up page-specific listeners and subscriptions

   Important:
   - No wallet data is stored in localStorage
   - No withdrawal request is stored in localStorage
   - No client-side balance mutation is performed
   - Pending withdrawals are not counted as completed withdrawals
   - Wallet number does not have to match the Profile mobile number
   - Main Router owns account-page navigation
========================================================= */

const RewardModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const PAGE_ID =
        "rewardCenterPage";

    const CURRENT_PAGE =
        "reward-center";

    const DEFAULT_MINIMUM_WITHDRAWAL =
        1000;

    const WITHDRAWAL_AMOUNT_MULTIPLE =
        1000;

    const WALLET_PROVIDERS =
        Object.freeze([
            "bkash",
            "nagad",
            "rocket"
        ]);

    const AUTH_EVENTS =
        Object.freeze([
            "auth:state-changed",
            "profile:auth-changed",
            "auth:signed-in",
            "auth:signed-out",
            "profile:logout"
        ]);

    const STORE_EVENTS =
        Object.freeze([
            "wallet:updated",
            "wallet:transactions-updated",
            "withdrawal:updated",
            "withdrawal:summary-updated",
            "reward:updated"
        ]);

    const LEGACY_STORAGE_PREFIXES =
        Object.freeze([
            "11play.reward.summary.v1",
            "11play.reward.withdrawals.v1"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        sharedMount:
            null,

        sharedSectionsInitialized:
            false,

        elements:
            {},

        controller:
            null,

        subscriptions:
            [],

        pageObserver:
            null,

        currentUid:
            "",

        profileMobile:
            "",

        loading:
            false,

        submitting:
            false,

        summary:
            createEmptySummary(),

        refreshPromise:
            null,

        storeSyncScheduled:
            false,

        lifecycleGeneration:
            0
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

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

    function normalizeString(
        value,
        fallback = ""
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }

        const normalizedValue =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
        );
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

    function safeAdd(
        firstValue,
        secondValue
    ) {
        const result =
            toNonNegativeInteger(
                firstValue
            ) +
            toNonNegativeInteger(
                secondValue
            );

        return Number.isSafeInteger(result)
            ? result
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
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    function formatMoney(value) {
        return `৳${new Intl.NumberFormat(
            "en-BD",
            {
                minimumFractionDigits:
                    0,

                maximumFractionDigits:
                    0
            }
        ).format(
            toNonNegativeInteger(value)
        )}`;
    }

    function normalizeError(error) {
        const details =
            isPlainObject(
                error?.details
            )
                ? error.details
                : null;

        return {
            code:
                normalizeString(
                    error?.code
                )
                    .replace(
                        /^functions\//,
                        ""
                    ) ||
                "reward-center-error",

            message:
                normalizeString(
                    error?.message ||
                    details?.message,
                    "The request could not be completed."
                ),

            field:
                normalizeString(
                    details?.field
                ),

            details
        };
    }

    /* =====================================================
       LEGACY STORAGE CLEANUP
    ===================================================== */

    function removeLegacyStorage() {
        try {
            const keysToRemove =
                [];

            for (
                let index = 0;
                index <
                window.localStorage.length;
                index += 1
            ) {
                const key =
                    window.localStorage.key(
                        index
                    );

                if (
                    key &&
                    LEGACY_STORAGE_PREFIXES
                        .some(
                            (prefix) =>
                                key.startsWith(
                                    prefix
                                )
                        )
                ) {
                    keysToRemove.push(
                        key
                    );
                }
            }

            keysToRemove.forEach(
                (key) => {
                    window.localStorage
                        .removeItem(key);
                }
            );
        } catch {
            /*
             * Storage may be unavailable.
             */
        }

        return true;
    }

    /* =====================================================
       EMPTY SUMMARY
    ===================================================== */

    function createEmptySummary() {
        return {
            availableBalance:
                0,

            heldBalance:
                0,

            totalBalance:
                0,

            lastApprovedWithdrawal:
                0,

            totalWithdrawn:
                0,

            minimumWithdrawalAmount:
                DEFAULT_MINIMUM_WITHDRAWAL
        };
    }

    /* =====================================================
       PAGE RESOLUTION
    ===================================================== */

    function resolvePage(root) {
        if (
            root instanceof HTMLElement &&
            root.id === PAGE_ID
        ) {
            return root;
        }

        if (
            root instanceof HTMLElement
        ) {
            return (
                root.querySelector(
                    `#${PAGE_ID}`
                ) ||
                null
            );
        }

        if (
            typeof root === "string" &&
            root.trim()
        ) {
            const resolvedRoot =
                document.querySelector(
                    root.trim()
                );

            if (
                resolvedRoot?.id ===
                PAGE_ID
            ) {
                return resolvedRoot;
            }

            return (
                resolvedRoot
                    ?.querySelector(
                        `#${PAGE_ID}`
                    ) ||
                null
            );
        }

        return document.getElementById(
            PAGE_ID
        );
    }

    /* =====================================================
       ELEMENT CACHE
    ===================================================== */

    function cacheElements() {
        if (!state.page) {
            return false;
        }

        state.elements = {
            summaryCard:
                state.page.querySelector(
                    "#rewardSummaryCard"
                ),

            summaryRefreshState:
                state.page.querySelector(
                    "#rewardSummaryRefreshState"
                ),

            mainBalance:
                state.page.querySelector(
                    "#rewardMainBalance"
                ),

            heldBalance:
                state.page.querySelector(
                    "#rewardHeldBalance"
                ),

            lastWithdraw:
                state.page.querySelector(
                    "#rewardLastWithdraw"
                ),

            totalWithdraw:
                state.page.querySelector(
                    "#rewardTotalWithdraw"
                ),

            loadingState:
                state.page.querySelector(
                    "#rewardWithdrawLoadingState"
                ),

            guestState:
                state.page.querySelector(
                    "#rewardWithdrawGuestState"
                ),

            form:
                state.page.querySelector(
                    "#rewardWithdrawForm"
                ),

            amount:
                state.page.querySelector(
                    "#rewardWithdrawAmount"
                ),

            amountHelp:
                state.page.querySelector(
                    "#rewardWithdrawAmountHelp"
                ),

            amountError:
                state.page.querySelector(
                    "#rewardWithdrawAmountError"
                ),

            provider:
                state.page.querySelector(
                    "#rewardWalletSelect"
                ),

            providerError:
                state.page.querySelector(
                    "#rewardWalletError"
                ),

            walletNumber:
                state.page.querySelector(
                    "#rewardAccountNumber"
                ),

            walletNumberError:
                state.page.querySelector(
                    "#rewardAccountNumberError"
                ),

            submitButton:
                state.page.querySelector(
                    "#rewardWithdrawSubmitButton"
                ),

            submitIcon:
                state.page.querySelector(
                    "#rewardWithdrawSubmitIcon"
                ),

            submitText:
                state.page.querySelector(
                    "#rewardWithdrawSubmitText"
                ),

            withdrawStatus:
                state.page.querySelector(
                    "#rewardWithdrawStatus"
                ),

            pageStatus:
                state.page.querySelector(
                    "#rewardCenterPageStatus"
                ),

            accountSectionsMount:
                state.page.querySelector(
                    "#accountSectionsMount"
                )
        };

        return true;
    }

    /* =====================================================
       CURRENT USER
    ===================================================== */

    function resolveCurrentUser() {
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

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue to another source.
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

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue to configured Firebase Auth.
                 */
            }
        }

        return (
            window.FirebaseConfig
                ?.auth
                ?.currentUser ||
            window.firebaseAuth
                ?.currentUser ||
            null
        );
    }

    function getProviderIds(user) {
        const providerIds =
            [];

        if (
            Array.isArray(
                user?.providerIds
            )
        ) {
            providerIds.push(
                ...user.providerIds
            );
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            user.providerData
                .forEach(
                    (provider) => {
                        if (
                            provider?.providerId
                        ) {
                            providerIds.push(
                                provider.providerId
                            );
                        }
                    }
                );
        }

        return [
            ...new Set(
                providerIds
                    .map(
                        (providerId) =>
                            normalizeString(
                                providerId
                            )
                                .toLowerCase()
                    )
                    .filter(Boolean)
            )
        ];
    }

    function isVerifiedGoogleUser(user) {
        if (!user?.uid) {
            return false;
        }

        const providerIds =
            getProviderIds(user);

        const signInProvider =
            normalizeString(
                user.signInProvider
            )
                .toLowerCase();

        const googleSession =
            user.isGoogleSignIn ===
                true ||
            signInProvider ===
                "google.com" ||
            providerIds.includes(
                "google.com"
            );

        const verified =
            user.emailVerified !==
                false &&
            user.isEmailVerified !==
                false;

        return (
            googleSession &&
            verified
        );
    }

    function extractEventUser(event) {
        if (
            event?.type ===
                "auth:signed-out" ||
            event?.type ===
                "profile:logout"
        ) {
            return null;
        }

        return (
            event?.detail?.user ||
            event?.detail?.profile ||
            (
                event?.detail?.uid
                    ? event.detail
                    : null
            ) ||
            resolveCurrentUser()
        );
    }

    /* =====================================================
       PROFILE MOBILE
    ===================================================== */

    function normalizeProfileMobile(
        value
    ) {
        const digits =
            normalizeString(value)
                .replace(
                    /\D/g,
                    ""
                );

        if (
            /^8801[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+${digits}`;
        }

        if (
            /^01[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+88${digits}`;
        }

        if (
            /^1[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+880${digits}`;
        }

        return "";
    }

    function readProfileMobile() {
        const profileSources = [
            window.ProfileDB
                ?.getProfile?.(),

            window.ProfileDB
                ?.getUser?.(),

            window.ProfileService
                ?.getUser?.(),

            window.ProfileService
                ?.getCurrentUser?.()
        ];

        for (
            const profile of
            profileSources
        ) {
            const mobile =
                normalizeProfileMobile(
                    profile?.mobileNumber ||
                    profile?.mobile
                );

            if (mobile) {
                return mobile;
            }
        }

        return "";
    }

    /* =====================================================
       WALLET DATA
    ===================================================== */

    function readWalletState() {
        if (
            window.WalletDB &&
            typeof window.WalletDB
                .getState ===
                "function"
        ) {
            try {
                return (
                    window.WalletDB
                        .getState() ||
                    null
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    function extractWallet(source) {
        if (!source) {
            return null;
        }

        if (
            isPlainObject(
                source.wallet
            )
        ) {
            return source.wallet;
        }

        if (
            isPlainObject(
                source.data?.wallet
            )
        ) {
            return source.data.wallet;
        }

        if (
            isPlainObject(
                source.summary?.wallet
            )
        ) {
            return source.summary.wallet;
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    source,
                    "availableBalance"
                )
        ) {
            return source;
        }

        return null;
    }

    function readWallet() {
        const walletState =
            readWalletState();

        const walletFromState =
            extractWallet(
                walletState
            );

        if (walletFromState) {
            return walletFromState;
        }

        if (
            window.WalletDB &&
            typeof window.WalletDB
                .getWallet ===
                "function"
        ) {
            try {
                return window.WalletDB
                    .getWallet();
            } catch {
                return null;
            }
        }

        return null;
    }

    function normalizeWallet(wallet) {
        const source =
            isPlainObject(wallet)
                ? wallet
                : {};

        const availableBalance =
            toNonNegativeInteger(
                source.availableBalance ??
                source.balance ??
                source.mainBalance
            );

        const heldBalance =
            toNonNegativeInteger(
                source.heldBalance ??
                source.reservedBalance
            );

        return {
            uid:
                normalizeString(
                    source.uid ||
                    source.userId
                ),

            availableBalance,

            heldBalance,

            totalBalance:
                toNonNegativeInteger(
                    source.totalBalance,
                    safeAdd(
                        availableBalance,
                        heldBalance
                    )
                ),

            totalWithdrawn:
                toNonNegativeInteger(
                    source.totalWithdrawn ??
                    source.withdrawn
                )
        };
    }

    /* =====================================================
       WITHDRAWAL DATA
    ===================================================== */

    function readWithdrawalState() {
        if (
            window.WithdrawDB &&
            typeof window.WithdrawDB
                .getState ===
                "function"
        ) {
            try {
                return (
                    window.WithdrawDB
                        .getState() ||
                    null
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    function normalizeWithdrawalStatus(
        value
    ) {
        const status =
            normalizeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "approved":
            case "successful":
            case "success":
            case "completed":
                return "approved";

            case "rejected":
            case "failed":
                return "rejected";

            case "cancelled":
            case "canceled":
                return "cancelled";

            case "pending":
            case "processing":
            default:
                return "pending";
        }
    }

    function extractWithdrawalList(
        source
    ) {
        if (Array.isArray(source)) {
            return source;
        }

        if (!isPlainObject(source)) {
            return [];
        }

        const candidates = [
            source.withdrawals,
            source.items,
            source.list,
            source.data?.withdrawals,
            source.data?.items
        ];

        for (
            const candidate of
            candidates
        ) {
            if (Array.isArray(candidate)) {
                return candidate;
            }
        }

        return [];
    }

    function extractWithdrawalSummary(
        source
    ) {
        if (!isPlainObject(source)) {
            return {};
        }

        if (
            isPlainObject(
                source.summary
            )
        ) {
            return source.summary;
        }

        if (
            isPlainObject(
                source.data?.summary
            )
        ) {
            return source.data.summary;
        }

        return {};
    }

    function getWithdrawalTime(
        withdrawal
    ) {
        const value =
            withdrawal.approvedAt ||
            withdrawal.completedAt ||
            withdrawal.updatedAt ||
            withdrawal.createdAt;

        if (
            value &&
            typeof value.toMillis ===
                "function"
        ) {
            try {
                return value.toMillis();
            } catch {
                return 0;
            }
        }

        if (
            value &&
            typeof value.toDate ===
                "function"
        ) {
            try {
                return value
                    .toDate()
                    .getTime();
            } catch {
                return 0;
            }
        }

        if (
            isPlainObject(value) &&
            typeof value.seconds ===
                "number"
        ) {
            return value.seconds *
                1000;
        }

        const parsedTime =
            new Date(value)
                .getTime();

        return Number.isFinite(
            parsedTime
        )
            ? parsedTime
            : 0;
    }

    function getLastApprovedWithdrawal(
        withdrawals
    ) {
        const approvedWithdrawals =
            withdrawals
                .filter(
                    (withdrawal) =>
                        normalizeWithdrawalStatus(
                            withdrawal.status
                        ) ===
                        "approved"
                )
                .sort(
                    (
                        firstWithdrawal,
                        secondWithdrawal
                    ) =>
                        getWithdrawalTime(
                            secondWithdrawal
                        ) -
                        getWithdrawalTime(
                            firstWithdrawal
                        )
                );

        return toNonNegativeInteger(
            approvedWithdrawals[0]
                ?.amount
        );
    }

    /* =====================================================
       REWARD SUMMARY FALLBACK
    ===================================================== */

    function readRewardSummary() {
        if (
            !window.RewardDB ||
            typeof window.RewardDB
                .getRewardSummary !==
                "function"
        ) {
            return {};
        }

        try {
            return (
                window.RewardDB
                    .getRewardSummary() ||
                {}
            );
        } catch {
            return {};
        }
    }

    /* =====================================================
       SUMMARY SYNCHRONIZATION
    ===================================================== */

    function stateBelongsToUser(
        source,
        expectedUid
    ) {
        if (!expectedUid) {
            return false;
        }

        const sourceUid =
            normalizeString(
                source?.currentUser?.uid ||
                source?.uid ||
                source?.wallet?.uid ||
                source?.stats?.uid
            );

        return (
            !sourceUid ||
            sourceUid === expectedUid
        );
    }

    function buildSummary() {
        const currentUser =
            resolveCurrentUser();

        if (!currentUser?.uid) {
            return createEmptySummary();
        }

        const walletState =
            readWalletState();

        const withdrawalState =
            readWithdrawalState();

        const wallet =
            stateBelongsToUser(
                walletState,
                currentUser.uid
            )
                ? normalizeWallet(
                    readWallet()
                )
                : normalizeWallet(
                    null
                );

        const withdrawals =
            stateBelongsToUser(
                withdrawalState,
                currentUser.uid
            )
                ? extractWithdrawalList(
                    withdrawalState
                )
                : [];

        const withdrawalSummary =
            stateBelongsToUser(
                withdrawalState,
                currentUser.uid
            )
                ? extractWithdrawalSummary(
                    withdrawalState
                )
                : {};

        const rewardSummary =
            readRewardSummary();

        const availableBalance =
            wallet.availableBalance ||
            toNonNegativeInteger(
                rewardSummary
                    .availableBalance ??
                rewardSummary
                    .wallet
                    ?.availableBalance
            );

        const heldBalance =
            wallet.heldBalance ||
            toNonNegativeInteger(
                rewardSummary
                    .heldBalance ??
                rewardSummary
                    .wallet
                    ?.heldBalance
            );

        const totalWithdrawn =
            wallet.totalWithdrawn ||
            toNonNegativeInteger(
                withdrawalSummary
                    .totalApprovedAmount ??
                withdrawalSummary
                    .approvedAmount ??
                withdrawalSummary
                    .totalWithdrawn ??
                rewardSummary
                    .totalWithdrawn
            );

        const lastApprovedWithdrawal =
            getLastApprovedWithdrawal(
                withdrawals
            ) ||
            toNonNegativeInteger(
                withdrawalSummary
                    .lastApprovedAmount ??
                withdrawalSummary
                    .lastWithdrawalAmount ??
                rewardSummary
                    .lastApprovedWithdrawal
            );

        const minimumWithdrawalAmount =
            Math.max(
                DEFAULT_MINIMUM_WITHDRAWAL,

                toNonNegativeInteger(
                    withdrawalSummary
                        .minimumWithdrawalAmount ??
                    withdrawalSummary
                        .minimumAmount,
                    getMinimumWithdrawalAmount()
                ) ||
                DEFAULT_MINIMUM_WITHDRAWAL
            );

        return {
            availableBalance,

            heldBalance,

            totalBalance:
                safeAdd(
                    availableBalance,
                    heldBalance
                ),

            lastApprovedWithdrawal,

            totalWithdrawn,

            minimumWithdrawalAmount
        };
    }

    function synchronizeFromStores() {
        if (!state.initialized) {
            return false;
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            state.currentUid =
                "";

            state.profileMobile =
                "";

            state.summary =
                createEmptySummary();

            renderSummary();
            renderAccessState();

            return true;
        }

        state.currentUid =
            currentUser.uid;

        state.profileMobile =
            readProfileMobile();

        state.summary =
            buildSummary();

        renderSummary();
        renderAccessState();

        return true;
    }

    function scheduleStoreSynchronization() {
        if (
            state.storeSyncScheduled ||
            !state.initialized
        ) {
            return false;
        }

        state.storeSyncScheduled =
            true;

        Promise.resolve()
            .then(
                () => {
                    state.storeSyncScheduled =
                        false;

                    synchronizeFromStores();
                }
            );

        return true;
    }

    /* =====================================================
       SUMMARY RENDERING
    ===================================================== */

    function setMoneyElement(
        element,
        amount,
        datasetName
    ) {
        if (!element) {
            return false;
        }

        const normalizedAmount =
            toNonNegativeInteger(
                amount
            );

        element.textContent =
            formatMoney(
                normalizedAmount
            );

        if (datasetName) {
            element.dataset[
                datasetName
            ] =
                String(
                    normalizedAmount
                );
        }

        return true;
    }

    function renderSummary() {
        setMoneyElement(
            state.elements.mainBalance,
            state.summary
                .availableBalance,
            "balanceValue"
        );

        setMoneyElement(
            state.elements.heldBalance,
            state.summary
                .heldBalance,
            "balanceValue"
        );

        setMoneyElement(
            state.elements.lastWithdraw,
            state.summary
                .lastApprovedWithdrawal,
            "withdrawValue"
        );

        setMoneyElement(
            state.elements.totalWithdraw,
            state.summary
                .totalWithdrawn,
            "withdrawValue"
        );

        if (
            state.elements.summaryCard
        ) {
            state.elements.summaryCard
                .setAttribute(
                    "aria-busy",
                    String(
                        state.loading
                    )
                );
        }

        if (
            state.elements.amount
        ) {
            state.elements.amount.min =
                String(
                    state.summary
                        .minimumWithdrawalAmount
                );

            state.elements.amount.step =
                String(
                    WITHDRAWAL_AMOUNT_MULTIPLE
                );

            state.elements.amount.max =
                String(
                    state.summary
                        .availableBalance
                );
        }

        if (
            state.elements.amountHelp
        ) {
            state.elements.amountHelp
                .textContent =
                `Minimum withdrawal: ${
                    formatMoney(
                        state.summary
                            .minimumWithdrawalAmount
                    )
                }. Amount must be a multiple of ${
                    formatMoney(
                        WITHDRAWAL_AMOUNT_MULTIPLE
                    )
                }. Available balance: ${
                    formatMoney(
                        state.summary
                            .availableBalance
                    )
                }.`;
        }

        return true;
    }

    /* =====================================================
       ACCESS AND LOADING STATES
    ===================================================== */

    function setFormEnabled(enabled) {
        const allowInput =
            enabled === true &&
            !state.loading &&
            !state.submitting;

        [
            state.elements.amount,
            state.elements.provider,
            state.elements.walletNumber
        ].forEach(
            (field) => {
                if (field) {
                    field.disabled =
                        !allowInput;
                }
            }
        );

        if (
            state.elements.submitButton
        ) {
            state.elements.submitButton
                .disabled =
                !allowInput;

            state.elements.submitButton
                .setAttribute(
                    "aria-disabled",
                    String(
                        !allowInput
                    )
                );
        }

        return true;
    }

    function renderAccessState() {
        const currentUser =
            resolveCurrentUser();

        const hasAccess =
            isVerifiedGoogleUser(
                currentUser
            );

        if (
            state.elements.loadingState
        ) {
            state.elements.loadingState
                .hidden =
                !state.loading;
        }

        if (
            state.elements.guestState
        ) {
            state.elements.guestState
                .hidden =
                state.loading ||
                hasAccess;
        }

        if (
            state.elements.form
        ) {
            state.elements.form.hidden =
                state.loading ||
                !hasAccess;

            state.elements.form
                .setAttribute(
                    "aria-busy",
                    String(
                        state.submitting
                    )
                );
        }

        if (state.page) {
            state.page.dataset
                .accountState =
                hasAccess
                    ? "google"
                    : "guest";
        }

        setFormEnabled(
            hasAccess
        );

        return hasAccess;
    }

    function setPageLoading(value) {
        state.loading =
            value === true;

        if (state.page) {
            state.page.classList.toggle(
                "is-loading",
                state.loading
            );

            state.page.setAttribute(
                "aria-busy",
                String(
                    state.loading
                )
            );
        }

        if (
            state.elements
                .summaryRefreshState
        ) {
            state.elements
                .summaryRefreshState
                .textContent =
                state.loading
                    ? "Refreshing..."
                    : "";
        }

        renderSummary();
        renderAccessState();

        return true;
    }

    function setSubmitLoading(value) {
        state.submitting =
            value === true;

        const {
            submitButton,
            submitIcon,
            submitText,
            form
        } =
            state.elements;

        if (form) {
            form.setAttribute(
                "aria-busy",
                String(
                    state.submitting
                )
            );
        }

        if (submitButton) {
            submitButton.classList.toggle(
                "is-loading",
                state.submitting
            );

            submitButton.setAttribute(
                "aria-busy",
                String(
                    state.submitting
                )
            );
        }

        if (submitIcon) {
            submitIcon.textContent =
                state.submitting
                    ? "…"
                    : "↗";
        }

        if (submitText) {
            submitText.textContent =
                state.submitting
                    ? "Submitting..."
                    : "Submit Withdrawal";
        }

        renderAccessState();

        return true;
    }

    /* =====================================================
       PAGE AND FORM STATUS
    ===================================================== */

    function showWithdrawStatus(
        message,
        type = "info"
    ) {
        const status =
            state.elements
                .withdrawStatus;

        if (!status) {
            return false;
        }

        const normalizedMessage =
            normalizeString(message);

        const normalizedType =
            [
                "success",
                "error",
                "info"
            ].includes(type)
                ? type
                : "info";

        status.textContent =
            normalizedMessage;

        status.classList.toggle(
            "is-success",
            normalizedType ===
                "success" &&
            Boolean(
                normalizedMessage
            )
        );

        status.classList.toggle(
            "is-error",
            normalizedType ===
                "error" &&
            Boolean(
                normalizedMessage
            )
        );

        status.classList.toggle(
            "is-info",
            normalizedType ===
                "info" &&
            Boolean(
                normalizedMessage
            )
        );

        return true;
    }

    function showPageStatus(
        message,
        type = "info"
    ) {
        const status =
            state.elements
                .pageStatus;

        if (!status) {
            return false;
        }

        const normalizedMessage =
            normalizeString(message);

        const normalizedType =
            [
                "success",
                "error",
                "info"
            ].includes(type)
                ? type
                : "info";

        status.textContent =
            normalizedMessage;

        status.hidden =
            !normalizedMessage;

        status.dataset.statusType =
            normalizedType;

        status.classList.toggle(
            "is-success",
            normalizedType ===
                "success"
        );

        status.classList.toggle(
            "is-error",
            normalizedType ===
                "error"
        );

        status.classList.toggle(
            "is-info",
            normalizedType ===
                "info"
        );

        return true;
    }

    function clearPageStatus() {
        return showPageStatus(
            "",
            "info"
        );
    }

    /* =====================================================
       FIELD ERRORS
    ===================================================== */

    function setFieldError(
        field,
        errorElement,
        message
    ) {
        const normalizedMessage =
            normalizeString(message);

        if (field) {
            field.classList.toggle(
                "has-error",
                Boolean(
                    normalizedMessage
                )
            );

            field.setAttribute(
                "aria-invalid",
                String(
                    Boolean(
                        normalizedMessage
                    )
                )
            );
        }

        if (errorElement) {
            errorElement.textContent =
                normalizedMessage;

            errorElement.hidden =
                !normalizedMessage;
        }

        return !normalizedMessage;
    }

    function clearErrors() {
        setFieldError(
            state.elements.amount,
            state.elements.amountError,
            ""
        );

        setFieldError(
            state.elements.provider,
            state.elements.providerError,
            ""
        );

        setFieldError(
            state.elements.walletNumber,
            state.elements
                .walletNumberError,
            ""
        );

        showWithdrawStatus("");

        return true;
    }

    /* =====================================================
       WALLET NUMBER
    ===================================================== */

    function normalizeWalletNumber(value) {
        let digits =
            normalizeString(value)
                .replace(
                    /\D/g,
                    ""
                );

        if (
            digits.startsWith(
                "880"
            ) &&
            digits.length ===
                13
        ) {
            digits =
                `0${digits.slice(3)}`;
        }

        if (
            digits.length ===
                10 &&
            digits.startsWith("1")
        ) {
            digits =
                `0${digits}`;
        }

        return digits.slice(
            0,
            11
        );
    }

    function isValidWalletNumber(value) {
        return /^01[3-9]\d{8}$/.test(
            normalizeWalletNumber(
                value
            )
        );
    }

    /* =====================================================
       FORM VALIDATION
    ===================================================== */

    function getMinimumWithdrawalAmount() {
        const formMinimum =
            toNonNegativeInteger(
                state.elements.form
                    ?.dataset
                    ?.minWithdrawalAmount,
                DEFAULT_MINIMUM_WITHDRAWAL
            );

        return Math.max(
            DEFAULT_MINIMUM_WITHDRAWAL,
            formMinimum ||
            DEFAULT_MINIMUM_WITHDRAWAL
        );
    }

    function validateForm() {
        clearErrors();

        const amount =
            Number(
                state.elements.amount
                    ?.value
            );

        const provider =
            normalizeString(
                state.elements.provider
                    ?.value
            )
                .toLowerCase();

        const walletNumber =
            normalizeWalletNumber(
                state.elements.walletNumber
                    ?.value
            );

        const minimumAmount =
            state.summary
                .minimumWithdrawalAmount ||
            getMinimumWithdrawalAmount();

        let valid =
            true;

        if (
            !Number.isSafeInteger(amount) ||
            amount <= 0
        ) {
            setFieldError(
                state.elements.amount,
                state.elements.amountError,
                "Enter a valid whole-number withdrawal amount."
            );

            valid =
                false;
        } else if (
            amount <
            minimumAmount
        ) {
            setFieldError(
                state.elements.amount,
                state.elements.amountError,
                `Minimum withdrawal amount is ${formatMoney(
                    minimumAmount
                )}.`
            );

            valid =
                false;
        } else if (
            amount %
                WITHDRAWAL_AMOUNT_MULTIPLE !==
            0
        ) {
            setFieldError(
                state.elements.amount,
                state.elements.amountError,
                `Withdrawal amount must be a multiple of ${formatMoney(
                    WITHDRAWAL_AMOUNT_MULTIPLE
                )}.`
            );

            valid =
                false;
        } else if (
            amount >
            state.summary
                .availableBalance
        ) {
            setFieldError(
                state.elements.amount,
                state.elements.amountError,
                "Withdrawal amount cannot exceed your available balance."
            );

            valid =
                false;
        }

        if (
            !WALLET_PROVIDERS
                .includes(provider)
        ) {
            setFieldError(
                state.elements.provider,
                state.elements.providerError,
                "Select bKash, Nagad or Rocket."
            );

            valid =
                false;
        }

        if (
            !isValidWalletNumber(
                walletNumber
            )
        ) {
            setFieldError(
                state.elements.walletNumber,
                state.elements
                    .walletNumberError,
                "Enter a valid 11-digit Bangladesh wallet number."
            );

            valid =
                false;
        }

        return valid
            ? {
                amount,
                provider,
                walletNumber
            }
            : null;
    }

    /* =====================================================
       DATA SERVICE INITIALIZATION
    ===================================================== */

    async function initializeService(
        service
    ) {
        if (
            !service ||
            typeof service.init !==
                "function"
        ) {
            return false;
        }

        await service.init();

        return true;
    }

    async function initializeDataServices() {
        const results =
            await Promise.allSettled([
                initializeService(
                    window.WalletDB
                ),

                initializeService(
                    window.WithdrawDB
                ),

                initializeService(
                    window.RewardDB
                )
            ]);

        return results;
    }

    async function callRefresh(
        service,
        options = {}
    ) {
        if (
            !service ||
            typeof service.refresh !==
                "function"
        ) {
            return null;
        }

        return service.refresh(
            options
        );
    }

    async function refreshDataServices(
        options = {}
    ) {
        return Promise.allSettled([
            callRefresh(
                window.WalletDB,
                options
            ),

            callRefresh(
                window.WithdrawDB,
                options
            ),

            callRefresh(
                window.RewardDB,
                options
            )
        ]);
    }

    /* =====================================================
       DATA SUBSCRIPTIONS
    ===================================================== */

    function addSubscription(
        service
    ) {
        if (
            !service ||
            typeof service.subscribe !==
                "function"
        ) {
            return false;
        }

        try {
            const unsubscribe =
                service.subscribe(
                    () => {
                        scheduleStoreSynchronization();
                    }
                );

            if (
                typeof unsubscribe ===
                    "function"
            ) {
                state.subscriptions.push(
                    unsubscribe
                );
            }

            return true;
        } catch {
            return false;
        }
    }

    function bindDataSubscriptions() {
        addSubscription(
            window.WalletDB
        );

        addSubscription(
            window.WithdrawDB
        );

        addSubscription(
            window.RewardDB
        );

        return true;
    }

    function removeDataSubscriptions() {
        state.subscriptions
            .forEach(
                (unsubscribe) => {
                    try {
                        unsubscribe();
                    } catch {
                        /*
                         * No further cleanup is required.
                         */
                    }
                }
            );

        state.subscriptions =
            [];

        return true;
    }

    /* =====================================================
       WITHDRAWAL SUBMISSION
    ===================================================== */

    function getWithdrawalSubmitMethod() {
        const withdrawDB =
            window.WithdrawDB;

        if (!withdrawDB) {
            return null;
        }

        const methodNames = [
            "submitWithdrawal",
            "requestWithdrawal",
            "submit"
        ];

        for (
            const methodName of
            methodNames
        ) {
            if (
                typeof withdrawDB[
                    methodName
                ] === "function"
            ) {
                return withdrawDB[
                    methodName
                ].bind(
                    withdrawDB
                );
            }
        }

        return null;
    }

    async function submitWithdrawal(
        formData
    ) {
        const submitMethod =
            getWithdrawalSubmitMethod();

        if (!submitMethod) {
            throw new Error(
                "Withdrawal service is unavailable."
            );
        }

        const result =
            await submitMethod({
                provider:
                    formData.provider,

                walletNumber:
                    formData.walletNumber,

                amount:
                    formData.amount
            });

        if (
            result === false ||
            result?.success ===
                false
        ) {
            throw new Error(
                normalizeString(
                    result?.message,
                    "Withdrawal request could not be submitted."
                )
            );
        }

        return result;
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (
            state.submitting ||
            state.loading
        ) {
            return;
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            showWithdrawStatus(
                "Sign in with a verified Google account before submitting a withdrawal.",
                "error"
            );

            renderAccessState();

            return;
        }

        const formData =
            validateForm();

        if (!formData) {
            showWithdrawStatus(
                "Please correct the highlighted information.",
                "error"
            );

            return;
        }

        const expectedUid =
            currentUser.uid;

        const expectedGeneration =
            state.lifecycleGeneration;

        setSubmitLoading(true);

        showWithdrawStatus(
            "Submitting your withdrawal request...",
            "info"
        );

        try {
            const result =
                await submitWithdrawal(
                    formData
                );

            if (
                !state.initialized ||
                expectedGeneration !==
                    state.lifecycleGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return;
            }

            state.elements.form
                ?.reset();

            showWithdrawStatus(
                "Withdrawal request submitted successfully. The requested amount is now reserved in Held Balance.",
                "success"
            );

            window.dispatchEvent(
                new CustomEvent(
                    "reward:withdrawal-submitted",
                    {
                        detail: {
                            uid:
                                expectedUid,

                            result
                        }
                    }
                )
            );

            window.dispatchEvent(
                new CustomEvent(
                    "withdrawal:submitted",
                    {
                        detail: {
                            uid:
                                expectedUid,

                            result
                        }
                    }
                )
            );

            await refreshDataServices({
                force:
                    true
            });

            if (
                state.initialized &&
                expectedGeneration ===
                    state.lifecycleGeneration &&
                resolveCurrentUser()
                    ?.uid ===
                    expectedUid
            ) {
                synchronizeFromStores();
            }
        } catch (error) {
            const normalizedError =
                normalizeError(error);

            console.error(
                "[RewardModule] Withdrawal submission failed.",
                error
            );

            if (
                normalizedError.field ===
                    "amount"
            ) {
                setFieldError(
                    state.elements.amount,
                    state.elements
                        .amountError,
                    normalizedError
                        .message
                );
            }

            if (
                normalizedError.field ===
                    "provider"
            ) {
                setFieldError(
                    state.elements.provider,
                    state.elements
                        .providerError,
                    normalizedError
                        .message
                );
            }

            if (
                normalizedError.field ===
                    "walletNumber"
            ) {
                setFieldError(
                    state.elements
                        .walletNumber,
                    state.elements
                        .walletNumberError,
                    normalizedError
                        .message
                );
            }

            showWithdrawStatus(
                normalizedError.message,
                "error"
            );
        } finally {
            setSubmitLoading(false);
        }
    }

    /* =====================================================
       INPUT HANDLERS
    ===================================================== */

    function handleAmountInput() {
        setFieldError(
            state.elements.amount,
            state.elements.amountError,
            ""
        );

        showWithdrawStatus("");
    }

    function handleProviderChange() {
        setFieldError(
            state.elements.provider,
            state.elements.providerError,
            ""
        );

        showWithdrawStatus("");
    }

    function handleWalletNumberInput(
        event
    ) {
        const input =
            event.currentTarget;

        input.value =
            normalizeWalletNumber(
                input.value
            );

        setFieldError(
            state.elements.walletNumber,
            state.elements
                .walletNumberError,
            ""
        );

        showWithdrawStatus("");
    }

    /* =====================================================
       SHARED ACCOUNT SECTIONS
    ===================================================== */

    function getReferralIdentity() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .getReferralIdentity ===
                "function"
        ) {
            try {
                return (
                    window.ReferralDB
                        .getReferralIdentity() ||
                    {}
                );
            } catch {
                return {};
            }
        }

        return {};
    }

    function initializeSharedSections() {
        const mount =
            state.elements
                .accountSectionsMount;

        if (!mount) {
            console.error(
                "[RewardModule] Shared Account Sections mount was not found."
            );

            return false;
        }

        if (
            !window.AccountSectionsView ||
            typeof window
                .AccountSectionsView
                .render !==
                "function"
        ) {
            console.error(
                "[RewardModule] AccountSectionsView is unavailable."
            );

            return false;
        }

        const identity =
            getReferralIdentity();

        const rendered =
            window.AccountSectionsView
                .render(
                    mount,
                    {
                        currentPage:
                            CURRENT_PAGE,

                        referralLink:
                            normalizeString(
                                identity
                                    .referralLink
                            )
                    }
                );

        if (rendered === false) {
            return false;
        }

        state.sharedMount =
            mount;

        if (
            !window.AccountSectionsModule ||
            typeof window
                .AccountSectionsModule
                .init !==
                "function"
        ) {
            return false;
        }

        const initialized =
            window.AccountSectionsModule
                .init({
                    root:
                        mount,

                    currentPage:
                        CURRENT_PAGE,

                    referralLink:
                        normalizeString(
                            identity
                                .referralLink
                        )
                });

        state.sharedSectionsInitialized =
            initialized !== false;

        return state
            .sharedSectionsInitialized;
    }

    function destroySharedSections() {
        if (
            !state.sharedSectionsInitialized
        ) {
            return true;
        }

        const sharedModule =
            window.AccountSectionsModule;

        if (
            sharedModule &&
            typeof sharedModule
                .destroy ===
                "function"
        ) {
            const currentPage =
                typeof sharedModule
                    .getCurrentPage ===
                    "function"
                    ? sharedModule
                        .getCurrentPage()
                    : CURRENT_PAGE;

            if (
                currentPage ===
                CURRENT_PAGE
            ) {
                sharedModule.destroy();
            }
        }

        state.sharedSectionsInitialized =
            false;

        state.sharedMount =
            null;

        return true;
    }

    /* =====================================================
       BROWSER EVENTS
    ===================================================== */

    function bindEvents() {
        state.controller =
            new AbortController();

        const signal =
            state.controller.signal;

        state.elements.form
            ?.addEventListener(
                "submit",
                handleSubmit,
                {
                    signal
                }
            );

        state.elements.amount
            ?.addEventListener(
                "input",
                handleAmountInput,
                {
                    signal
                }
            );

        state.elements.provider
            ?.addEventListener(
                "change",
                handleProviderChange,
                {
                    signal
                }
            );

        state.elements.walletNumber
            ?.addEventListener(
                "input",
                handleWalletNumberInput,
                {
                    signal
                }
            );

        AUTH_EVENTS.forEach(
            (eventName) => {
                window.addEventListener(
                    eventName,
                    handleAuthEvent,
                    {
                        signal
                    }
                );
            }
        );

        STORE_EVENTS.forEach(
            (eventName) => {
                window.addEventListener(
                    eventName,
                    scheduleStoreSynchronization,
                    {
                        signal
                    }
                );
            }
        );

        return true;
    }

    function handleAuthEvent(event) {
        if (!state.initialized) {
            return;
        }

        const user =
            extractEventUser(event);

        if (
            !isVerifiedGoogleUser(
                user
            )
        ) {
            state.currentUid =
                "";

            state.profileMobile =
                "";

            state.summary =
                createEmptySummary();

            clearErrors();
            renderSummary();
            renderAccessState();

            if (
                window.AccountSectionsModule &&
                typeof window
                    .AccountSectionsModule
                    .clearReferralLink ===
                    "function"
            ) {
                window.AccountSectionsModule
                    .clearReferralLink();
            }

            return;
        }

        void refresh({
            force:
                true
        });
    }

    /* =====================================================
       REFRESH
    ===================================================== */

    function refresh(options = {}) {
        if (state.refreshPromise) {
            return state.refreshPromise;
        }

        const expectedGeneration =
            state.lifecycleGeneration;

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            state.currentUid =
                "";

            state.summary =
                createEmptySummary();

            setPageLoading(false);
            renderSummary();
            renderAccessState();

            return Promise.resolve(
                getSummary()
            );
        }

        const expectedUid =
            currentUser.uid;

        state.currentUid =
            expectedUid;

        state.refreshPromise =
            (async () => {
                setPageLoading(true);
                clearPageStatus();

                try {
                    await initializeDataServices();

                    if (
                        !state.initialized ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getSummary();
                    }

                    const refreshResults =
                        await refreshDataServices({
                            force:
                                options.force ===
                                true
                        });

                    if (
                        !state.initialized ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getSummary();
                    }

                    synchronizeFromStores();

                    const successfulRefresh =
                        refreshResults.some(
                            (result) =>
                                result.status ===
                                "fulfilled"
                        );

                    if (!successfulRefresh) {
                        showPageStatus(
                            "Wallet information could not be refreshed. Please try again.",
                            "error"
                        );
                    }

                    return getSummary();
                } catch (error) {
                    const normalizedError =
                        normalizeError(error);

                    console.error(
                        "[RewardModule] Reward Center refresh failed.",
                        error
                    );

                    showPageStatus(
                        normalizedError.message,
                        "error"
                    );

                    synchronizeFromStores();

                    return getSummary();
                } finally {
                    if (
                        state.initialized &&
                        expectedGeneration ===
                            state.lifecycleGeneration
                    ) {
                        setPageLoading(false);
                    }

                    state.refreshPromise =
                        null;
                }
            })();

        return state.refreshPromise;
    }

    /* =====================================================
       PAGE REMOVAL OBSERVER
    ===================================================== */

    function observePageRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined"
        ) {
            return false;
        }

        const observedPage =
            state.page;

        const observedGeneration =
            state.lifecycleGeneration;

        state.pageObserver =
            new MutationObserver(
                () => {
                    if (
                        observedGeneration !==
                            state.lifecycleGeneration ||
                        !observedPage ||
                        observedPage.isConnected
                    ) {
                        return;
                    }

                    destroy();
                }
            );

        state.pageObserver.observe(
            document.body,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function init(options = {}) {
        destroy();

        const normalizedOptions =
            options instanceof
                HTMLElement ||
            typeof options ===
                "string"
                ? {
                    root:
                        options
                }
                : (
                    isPlainObject(options)
                        ? options
                        : {}
                );

        const page =
            resolvePage(
                normalizedOptions.root
            );

        if (!page) {
            console.error(
                "[RewardModule] Reward Center page was not found."
            );

            return false;
        }

        removeLegacyStorage();

        state.lifecycleGeneration +=
            1;

        const currentGeneration =
            state.lifecycleGeneration;

        state.page =
            page;

        state.initialized =
            true;

        cacheElements();
        bindEvents();
        observePageRemoval();

        if (
            !initializeSharedSections()
        ) {
            console.error(
                "[RewardModule] Shared Account Sections initialization failed."
            );
        }

        const currentUser =
            resolveCurrentUser();

        state.currentUid =
            isVerifiedGoogleUser(
                currentUser
            )
                ? currentUser.uid
                : "";

        state.profileMobile =
            readProfileMobile();

        renderSummary();
        setPageLoading(true);

        try {
            await initializeDataServices();

            if (
                !state.initialized ||
                currentGeneration !==
                    state.lifecycleGeneration
            ) {
                return false;
            }

            bindDataSubscriptions();

            await refresh({
                force:
                    normalizedOptions.force ===
                    true
            });
        } catch (error) {
            const normalizedError =
                normalizeError(error);

            console.error(
                "[RewardModule] Initialization failed.",
                error
            );

            showPageStatus(
                normalizedError.message,
                "error"
            );

            setPageLoading(false);
            synchronizeFromStores();
        }

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        state.controller
            ?.abort();

        state.controller =
            null;

        removeDataSubscriptions();

        if (state.pageObserver) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        destroySharedSections();

        state.initialized =
            false;

        state.page =
            null;

        state.elements =
            {};

        state.currentUid =
            "";

        state.profileMobile =
            "";

        state.loading =
            false;

        state.submitting =
            false;

        state.summary =
            createEmptySummary();

        state.refreshPromise =
            null;

        state.storeSyncScheduled =
            false;

        return true;
    }

    /* =====================================================
       PUBLIC STATE
    ===================================================== */

    function normalizeExternalSummary(
        summary
    ) {
        const source =
            isPlainObject(summary)
                ? (
                    summary.summary ||
                    summary.data ||
                    summary
                )
                : {};

        const availableBalance =
            toNonNegativeInteger(
                source.availableBalance ??
                source.mainBalance ??
                source.balance
            );

        const heldBalance =
            toNonNegativeInteger(
                source.heldBalance ??
                source.reservedBalance
            );

        return {
            availableBalance,

            heldBalance,

            totalBalance:
                toNonNegativeInteger(
                    source.totalBalance,
                    safeAdd(
                        availableBalance,
                        heldBalance
                    )
                ),

            lastApprovedWithdrawal:
                toNonNegativeInteger(
                    source
                        .lastApprovedWithdrawal ??
                    source
                        .lastWithdraw ??
                    source
                        .lastWithdrawal
                ),

            totalWithdrawn:
                toNonNegativeInteger(
                    source.totalWithdrawn ??
                    source.totalWithdraw
                ),

            minimumWithdrawalAmount:
                Math.max(
                    DEFAULT_MINIMUM_WITHDRAWAL,

                    toNonNegativeInteger(
                        source
                            .minimumWithdrawalAmount ??
                        source.minimumAmount,
                        DEFAULT_MINIMUM_WITHDRAWAL
                    ) ||
                    DEFAULT_MINIMUM_WITHDRAWAL
                )
        };
    }

    function getSummary() {
        return cloneValue(
            state.summary
        );
    }

    function setSummary(summary) {
        state.summary =
            normalizeExternalSummary(
                summary
            );

        renderSummary();

        return getSummary();
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        initialize:
            init,

        destroy,
        refresh,

        getSummary,
        setSummary,

        validateForm,
        normalizeWalletNumber,
        isValidWalletNumber,

        getProfileMobile() {
            return state.profileMobile;
        },

        getCurrentUid() {
            return state.currentUid;
        },

        isInitialized() {
            return state.initialized;
        },

        isSubmitting() {
            return state.submitting;
        },

        formatMoney,

        WALLET_PROVIDERS
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.RewardModule =
    RewardModule;
