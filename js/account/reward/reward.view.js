"use strict";

/* =========================================================
   11PLAY — REWARD CENTER VIEW
   File: js/account/reward/reward.view.js

   Responsibilities:
   - Render server-authoritative wallet summary placeholders
   - Render the withdrawal-request form
   - Render guest, loading and operation states
   - Explain pending balance reservation and refund rules
   - Provide the Shared Account Sections mount
   - Provide stable selectors for RewardModule

   Important:
   - This file contains markup only
   - It does not read or write Firebase data
   - It does not calculate wallet balances
   - It does not submit withdrawal requests
   - It does not perform account navigation
========================================================= */

const RewardView = (() => {
    "use strict";

    /* =====================================================
       PAGE TEMPLATE
    ===================================================== */

    function getTemplate() {
        return `
            <main
                id="rewardCenterPage"
                class="profile-page reward-center-page"
                data-account-page="reward-center"
                data-account-state="guest"
                aria-labelledby="rewardCenterTitle"
            >
                <h1
                    id="rewardCenterTitle"
                    class="sr-only"
                >
                    Reward Center
                </h1>

                <!-- =========================================
                     WALLET SUMMARY
                ========================================== -->

                <section
                    id="rewardSummaryCard"
                    class="profile-card reward-summary-card"
                    aria-labelledby="rewardSummaryTitle"
                    aria-busy="true"
                >
                    <header class="reward-summary-header">
                        <h2
                            id="rewardSummaryTitle"
                            class="reward-summary-title"
                        >
                            Wallet Summary
                        </h2>

                        <span
                            id="rewardSummaryRefreshState"
                            class="reward-summary-refresh-state"
                            role="status"
                            aria-live="polite"
                        ></span>
                    </header>

                    <div
                        id="rewardBalanceGrid"
                        class="reward-balance-grid"
                        aria-label="Wallet balance summary"
                    >
                        <!-- Available balance -->

                        <article
                            class="
                                reward-balance-item
                                reward-main-balance-item
                            "
                            data-wallet-summary="available-balance"
                        >
                            <span
                                class="reward-balance-icon"
                                aria-hidden="true"
                            >
                                💰
                            </span>

                            <div class="reward-balance-content">
                                <span class="reward-balance-label">
                                    Available Balance
                                </span>

                                <strong
                                    id="rewardMainBalance"
                                    class="reward-balance-value"
                                    data-balance-value="0"
                                    aria-live="polite"
                                >
                                    ৳0
                                </strong>
                            </div>
                        </article>

                        <!-- Held balance -->

                        <article
                            class="reward-balance-item"
                            data-wallet-summary="held-balance"
                        >
                            <span
                                class="reward-balance-icon"
                                aria-hidden="true"
                            >
                                🔒
                            </span>

                            <div class="reward-balance-content">
                                <span class="reward-balance-label">
                                    Held Balance
                                </span>

                                <strong
                                    id="rewardHeldBalance"
                                    class="reward-balance-value"
                                    data-balance-value="0"
                                    aria-live="polite"
                                >
                                    ৳0
                                </strong>
                            </div>
                        </article>

                        <!-- Last approved withdrawal -->

                        <article
                            class="reward-balance-item"
                            data-wallet-summary="last-withdrawal"
                        >
                            <span
                                class="reward-balance-icon"
                                aria-hidden="true"
                            >
                                🕒
                            </span>

                            <div class="reward-balance-content">
                                <span class="reward-balance-label">
                                    Last Approved Withdrawal
                                </span>

                                <strong
                                    id="rewardLastWithdraw"
                                    class="reward-balance-value"
                                    data-withdraw-value="0"
                                    aria-live="polite"
                                >
                                    ৳0
                                </strong>
                            </div>
                        </article>

                        <!-- Total approved withdrawals -->

                        <article
                            class="reward-balance-item"
                            data-wallet-summary="total-withdrawn"
                        >
                            <span
                                class="reward-balance-icon"
                                aria-hidden="true"
                            >
                                📊
                            </span>

                            <div class="reward-balance-content">
                                <span class="reward-balance-label">
                                    Total Withdrawn
                                </span>

                                <strong
                                    id="rewardTotalWithdraw"
                                    class="reward-balance-value"
                                    data-withdraw-value="0"
                                    aria-live="polite"
                                >
                                    ৳0
                                </strong>
                            </div>
                        </article>
                    </div>
                </section>

                <!-- =========================================
                     WITHDRAWAL REQUEST
                ========================================== -->

                <section
                    id="rewardWithdrawCard"
                    class="profile-card reward-withdraw-card"
                    aria-labelledby="rewardWithdrawTitle"
                >
                    <header class="reward-withdraw-header">
                        <div class="reward-withdraw-heading-box">
                            <h2
                                id="rewardWithdrawTitle"
                                class="reward-withdraw-title"
                            >
                                Withdraw
                            </h2>
                        </div>

                        <p class="reward-withdraw-description">
                            Submit a withdrawal request using the correct
                            wallet provider, account number and amount.
                        </p>
                    </header>

                    <!-- Loading state -->

                    <div
                        id="rewardWithdrawLoadingState"
                        class="reward-withdraw-state"
                        role="status"
                        aria-live="polite"
                    >
                        <span
                            class="profile-loading-spinner"
                            aria-hidden="true"
                        ></span>

                        <span>
                            Loading wallet information...
                        </span>
                    </div>

                    <!-- Guest state -->

                    <div
                        id="rewardWithdrawGuestState"
                        class="reward-withdraw-state"
                        role="status"
                        hidden
                    >
                        <strong>
                            Google sign-in required
                        </strong>

                        <p>
                            Sign in with your verified Google account
                            before submitting a withdrawal request.
                        </p>
                    </div>

                    <!-- Withdrawal form -->

                    <form
                        id="rewardWithdrawForm"
                        class="reward-withdraw-form"
                        data-min-withdrawal-amount="1000"
                        aria-busy="false"
                        novalidate
                        hidden
                    >
                        <!-- Withdrawal amount -->

                        <div class="reward-form-field">
                            <label
                                class="reward-form-label"
                                for="rewardWithdrawAmount"
                            >
                                Withdraw Amount
                            </label>

                            <div class="reward-amount-input-group">
                                <span
                                    class="reward-amount-prefix"
                                    aria-hidden="true"
                                >
                                    ৳
                                </span>

                                <input
                                    id="rewardWithdrawAmount"
                                    class="
                                        reward-form-input
                                        reward-amount-input
                                    "
                                    name="amount"
                                    type="number"
                                    inputmode="numeric"
                                    min="1000"
                                    step="1000"
                                    placeholder="Enter amount"
                                    autocomplete="off"
                                    aria-describedby="
                                        rewardWithdrawAmountHelp
                                        rewardWithdrawAmountError
                                    "
                                    required
                                >
                            </div>

                            <small
                                id="rewardWithdrawAmountHelp"
                                class="reward-form-help"
                            >
                                Minimum withdrawal is ৳1,000. The amount
                                must be a multiple of ৳1,000 and cannot
                                exceed your available wallet balance.
                            </small>

                            <small
                                id="rewardWithdrawAmountError"
                                class="reward-form-error"
                                role="alert"
                                aria-live="assertive"
                                hidden
                            ></small>
                        </div>

                        <!-- Wallet provider -->

                        <div class="reward-form-field">
                            <label
                                class="reward-form-label"
                                for="rewardWalletSelect"
                            >
                                Wallet Provider
                            </label>

                            <div class="reward-select-wrapper">
                                <select
                                    id="rewardWalletSelect"
                                    class="reward-form-select"
                                    name="provider"
                                    aria-describedby="
                                        rewardWalletHelp
                                        rewardWalletError
                                    "
                                    required
                                >
                                    <option value="">
                                        Choose a wallet
                                    </option>

                                    <option value="bkash">
                                        bKash
                                    </option>

                                    <option value="nagad">
                                        Nagad
                                    </option>

                                    <option value="rocket">
                                        Rocket
                                    </option>
                                </select>

                                <span
                                    class="reward-select-arrow"
                                    aria-hidden="true"
                                >
                                    ▾
                                </span>
                            </div>

                            <small
                                id="rewardWalletHelp"
                                class="reward-form-help"
                            >
                                Select the provider that owns the wallet
                                account number entered below.
                            </small>

                            <small
                                id="rewardWalletError"
                                class="reward-form-error"
                                role="alert"
                                aria-live="assertive"
                                hidden
                            ></small>
                        </div>

                        <!-- Wallet account number -->

                        <div class="reward-form-field">
                            <label
                                class="reward-form-label"
                                for="rewardAccountNumber"
                            >
                                Wallet Account Number
                            </label>

                            <input
                                id="rewardAccountNumber"
                                class="reward-form-input"
                                name="walletNumber"
                                type="tel"
                                inputmode="numeric"
                                autocomplete="tel"
                                maxlength="11"
                                pattern="01[3-9][0-9]{8}"
                                placeholder="01XXXXXXXXX"
                                aria-describedby="
                                    rewardAccountNumberHelp
                                    rewardAccountNumberError
                                "
                                required
                            >

                            <small
                                id="rewardAccountNumberHelp"
                                class="reward-form-help"
                            >
                                Enter the correct 11-digit Bangladesh
                                wallet account number.
                            </small>

                            <small
                                id="rewardAccountNumberError"
                                class="reward-form-error"
                                role="alert"
                                aria-live="assertive"
                                hidden
                            ></small>
                        </div>

                        <!-- Submission action -->

                        <button
                            id="rewardWithdrawSubmitButton"
                            class="reward-withdraw-submit-button"
                            type="submit"
                            aria-busy="false"
                        >
                            <span
                                id="rewardWithdrawSubmitIcon"
                                class="reward-withdraw-submit-icon"
                                aria-hidden="true"
                            >
                                ↗
                            </span>

                            <span id="rewardWithdrawSubmitText">
                                Submit Withdrawal
                            </span>
                        </button>

                        <p
                            id="rewardWithdrawStatus"
                            class="reward-withdraw-status"
                            role="status"
                            aria-live="polite"
                        ></p>
                    </form>
                </section>

                <!-- =========================================
                     WITHDRAWAL NOTICE
                ========================================== -->

                <aside
                    id="rewardWithdrawNotice"
                    class="profile-card reward-withdraw-notice"
                    role="note"
                    aria-labelledby="rewardWithdrawNoticeTitle"
                >
                    <header class="reward-notice-header">
                        <span
                            class="reward-notice-icon"
                            aria-hidden="true"
                        >
                            ⚠️
                        </span>

                        <h2
                            id="rewardWithdrawNoticeTitle"
                            class="reward-notice-title"
                        >
                            গুরুত্বপূর্ণ নোটিশ
                        </h2>
                    </header>

                    <ul class="reward-notice-list">
                        <li>
                            Available Balance-এর চেয়ে বেশি পরিমাণ অর্থের
                            withdrawal request সাবমিট করা যাবে না।
                        </li>

                        <li>
                            Request সাবমিট হওয়ার পর অর্থটি Held Balance-এ
                            সংরক্ষিত থাকবে।
                        </li>

                        <li>
                            Withdrawal Approved হলে সংরক্ষিত অর্থটি
                            চূড়ান্তভাবে উত্তোলিত হবে।
                        </li>

                        <li>
                            Withdrawal Rejected অথবা Cancelled হলে
                            সংরক্ষিত অর্থ Available Balance-এ ফেরত যাবে।
                        </li>

                        <li>
                            ভুল wallet provider বা account number দিলে
                            অর্থ সঠিকভাবে পৌঁছানো নাও যেতে পারে। সাবমিটের
                            আগে তথ্য যাচাই করুন।
                        </li>

                        <li>
                            একই request বারবার সাবমিট করবেন না। Processing
                            চলাকালে Submit button নিষ্ক্রিয় থাকবে।
                        </li>
                    </ul>
                </aside>

                <!-- =========================================
                     SHARED ACCOUNT SECTIONS

                     AccountSectionsView renders:
                     - বন্ধু আমন্ত্রণ
                     - Live Reward Withdrawal
                     - Account Services
                ========================================== -->

                <div
                    id="accountSectionsMount"
                    class="account-sections-mount"
                    aria-label="Account features"
                ></div>

                <!-- =========================================
                     PAGE STATUS
                ========================================== -->

                <div
                    id="rewardCenterPageStatus"
                    class="profile-page-status"
                    role="status"
                    aria-live="polite"
                    hidden
                ></div>
            </main>
        `;
    }

    /* =====================================================
       TARGET RESOLUTION
    ===================================================== */

    function resolveTarget(target) {
        if (
            target instanceof HTMLElement
        ) {
            return target;
        }

        if (
            typeof target === "string" &&
            target.trim()
        ) {
            return document.querySelector(
                target.trim()
            );
        }

        return (
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
            null
        );
    }

    /* =====================================================
       RENDER
    ===================================================== */

    function render(target) {
        const container =
            resolveTarget(target);

        if (
            !(container instanceof
                HTMLElement)
        ) {
            console.error(
                "[RewardView] A valid root element is required."
            );

            return false;
        }

        container.innerHTML =
            getTemplate();

        return (
            container.querySelector(
                "#rewardCenterPage"
            ) ||
            false
        );
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy(target) {
        const container =
            resolveTarget(target);

        let page =
            null;

        if (
            container?.id ===
            "rewardCenterPage"
        ) {
            page =
                container;
        } else if (container) {
            page =
                container.querySelector(
                    "#rewardCenterPage"
                );
        } else {
            page =
                document.getElementById(
                    "rewardCenterPage"
                );
        }

        if (!page) {
            return false;
        }

        page.remove();

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        getTemplate,
        render,
        destroy
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.RewardView =
    RewardView;