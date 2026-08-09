"use strict";

/* =========================================================
   11PLAY — WITHDRAW HISTORY VIEW
   File:
   js/account/withdraw/withdraw.history.view.js

   Responsibilities:
   - Render the withdrawal-history page structure
   - Provide placeholders for server-authoritative records
   - Provide loading, guest and empty states
   - Provide a Details column for Admin notes / rejection reasons
   - Keep submitted withdrawals read-only for users
   - Preserve the existing Action column as a no-action placeholder
   - Provide a Load More control for cursor-based history
   - Provide the Shared Account Sections mount
   - Avoid duplicating the title already displayed in Topbar

   Final withdrawal workflow:
   - User submits a withdrawal request
   - Submitted request cannot be cancelled, edited or deleted by user
   - Pending amount remains reserved in Held Balance
   - Admin can Approve or Reject the pending request
   - Rejected requests are refunded to Available Balance server-side

   Canonical withdrawal statuses:
   - pending
   - approved
   - rejected
   - cancelled (historical read-only compatibility only)

   Important:
   - This file contains markup only
   - It does not read or write Firebase data
   - It does not calculate withdrawal totals
   - It does not cancel, edit or delete withdrawal requests
   - It does not perform account navigation
========================================================= */

const WithdrawHistoryView = (() => {
    "use strict";

    /* =====================================================
       PAGE TEMPLATE
    ===================================================== */

    function getTemplate() {
        return `
            <main
                id="withdrawHistoryPage"
                class="profile-page withdraw-history-page"
                data-account-page="withdraw-history"
                data-account-state="guest"
                data-withdrawal-user-actions="disabled"
                aria-labelledby="withdrawHistoryTitle"
            >
                <!-- =========================================
                     WITHDRAWAL HISTORY CARD
                ========================================== -->

                <section
                    id="withdrawHistoryCard"
                    class="profile-card withdraw-history-card"
                    aria-labelledby="withdrawHistoryTitle"
                    aria-busy="true"
                >
                    <!--
                        The visible page title and description are omitted
                        because Topbar already displays the same information.
                    -->

                    <header class="withdraw-history-header">
                        <h1
                            id="withdrawHistoryTitle"
                            class="sr-only"
                        >
                            Withdrawal History
                        </h1>

                        <div class="withdraw-history-header-meta">
                            <span
                                id="withdrawHistoryRefreshState"
                                class="sr-only"
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                            ></span>

                            <span
                                id="withdrawHistoryRecordCount"
                                class="withdraw-history-record-count"
                                aria-label="Withdrawal record count"
                                aria-live="polite"
                            >
                                0
                            </span>
                        </div>
                    </header>

                    <!-- =====================================
                         TRANSACTION RECORDS
                    ====================================== -->

                    <section
                        id="withdrawHistoryListSection"
                        class="withdraw-history-list-section"
                        aria-label="Withdrawal transaction records"
                    >
                        <!-- Loading state -->

                        <div
                            id="withdrawHistoryLoadingState"
                            class="withdraw-history-loading-state"
                            role="status"
                            aria-live="polite"
                        >
                            <span
                                class="profile-loading-spinner"
                                aria-hidden="true"
                            ></span>

                            <span>
                                Loading withdrawal records...
                            </span>
                        </div>

                        <!-- Guest state -->

                        <div
                            id="withdrawHistoryGuestState"
                            class="withdraw-history-empty-state"
                            role="status"
                            hidden
                        >
                            <span
                                class="withdraw-history-empty-icon"
                                aria-hidden="true"
                            >
                                🔐
                            </span>

                            <strong class="withdraw-history-empty-title">
                                Google sign-in required
                            </strong>

                            <p class="withdraw-history-empty-text">
                                Sign in with your verified Google account
                                to view withdrawal history.
                            </p>
                        </div>

                        <!-- Transaction table -->

                        <div
                            id="withdrawHistoryTableField"
                            class="withdraw-history-table-field"
                            role="region"
                            aria-label="Withdrawal transaction records"
                            tabindex="0"
                            hidden
                        >
                            <table class="withdraw-history-table">
                                <thead>
                                    <tr>
                                        <th scope="col">
                                            Date
                                        </th>

                                        <th scope="col">
                                            Wallet
                                        </th>

                                        <th scope="col">
                                            Number
                                        </th>

                                        <th scope="col">
                                            Amount
                                        </th>

                                        <th scope="col">
                                            Status
                                        </th>

                                        <th scope="col">
                                            Details
                                        </th>

                                        <!--
                                            Retained for compatibility with
                                            WithdrawHistoryModule row markup.
                                            User-side withdrawal actions are
                                            permanently disabled.
                                        -->
                                        <th scope="col">
                                            Action
                                        </th>
                                    </tr>
                                </thead>

                                <tbody
                                    id="withdrawHistoryTableBody"
                                    aria-live="polite"
                                ></tbody>
                            </table>
                        </div>

                        <!-- Load more -->

                        <div
                            id="withdrawHistoryLoadMoreField"
                            class="withdraw-history-load-more"
                            hidden
                        >
                            <button
                                id="withdrawHistoryLoadMoreButton"
                                class="withdraw-history-load-more-button"
                                type="button"
                                aria-controls="withdrawHistoryTableBody"
                                aria-busy="false"
                            >
                                Load More Withdrawals
                            </button>
                        </div>

                        <!-- Empty state -->

                        <div
                            id="withdrawHistoryEmptyState"
                            class="withdraw-history-empty-state"
                            role="status"
                            hidden
                        >
                            <span
                                class="withdraw-history-empty-icon"
                                aria-hidden="true"
                            >
                                🧾
                            </span>

                            <strong class="withdraw-history-empty-title">
                                No withdrawal records
                            </strong>

                            <p class="withdraw-history-empty-text">
                                Your withdrawal requests will appear here
                                after you submit your first request.
                            </p>
                        </div>
                    </section>
                </section>

                <!-- =========================================
                     STATUS INFORMATION
                ========================================== -->

                <aside
                    id="withdrawHistoryStatusGuide"
                    class="profile-card withdraw-history-status-guide"
                    role="note"
                    aria-labelledby="withdrawHistoryStatusGuideTitle"
                >
                    <h2
                        id="withdrawHistoryStatusGuideTitle"
                        class="withdraw-history-status-guide-title"
                    >
                        Withdrawal Status Guide
                    </h2>

                    <ul class="withdraw-history-status-guide-list">
                        <li>
                            <strong>Pending:</strong>
                            The requested amount is reserved in Held Balance
                            and is waiting for Admin review. After submission,
                            the user cannot cancel, edit or delete the request.
                        </li>

                        <li>
                            <strong>Approved:</strong>
                            Admin approved the withdrawal. The reserved amount
                            is finalized as withdrawn and is no longer held.
                        </li>

                        <li>
                            <strong>Rejected:</strong>
                            Admin rejected the request. The reserved amount is
                            released from Held Balance and returned to
                            Available Balance.
                        </li>

                        <li>
                            <strong>Cancelled:</strong>
                            Historical status only. New submitted withdrawal
                            requests cannot be cancelled by users.
                        </li>
                    </ul>
                </aside>

                <!-- =========================================
                     IMMUTABILITY NOTICE
                ========================================== -->

                <aside
                    id="withdrawHistorySubmissionNotice"
                    class="profile-card withdraw-history-status-guide"
                    role="note"
                    aria-labelledby="withdrawHistorySubmissionNoticeTitle"
                >
                    <h2
                        id="withdrawHistorySubmissionNoticeTitle"
                        class="withdraw-history-status-guide-title"
                    >
                        Submitted Requests Are Final
                    </h2>

                    <ul class="withdraw-history-status-guide-list">
                        <li>
                            Check the wallet provider, wallet number and amount
                            carefully before submitting a withdrawal request.
                        </li>

                        <li>
                            Once submitted, the request is read-only for the
                            user and cannot be cancelled, edited or deleted.
                        </li>

                        <li>
                            A pending request can be resolved only through
                            Admin approval or Admin rejection.
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
                    id="withdrawHistoryPageStatus"
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
            target instanceof
            HTMLElement
        ) {
            return target;
        }

        if (
            typeof target ===
                "string" &&
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
                "[WithdrawHistoryView] A valid root element is required."
            );

            return false;
        }

        container.innerHTML =
            getTemplate();

        return (
            container.querySelector(
                "#withdrawHistoryPage"
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

        let page = null;

        if (
            container?.id ===
            "withdrawHistoryPage"
        ) {
            page = container;
        } else if (container) {
            page =
                container.querySelector(
                    "#withdrawHistoryPage"
                );
        } else {
            page =
                document.getElementById(
                    "withdrawHistoryPage"
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

window.WithdrawHistoryView =
    WithdrawHistoryView;