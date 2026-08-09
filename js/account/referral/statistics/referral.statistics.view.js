"use strict";

/* =========================================================
   11PLAY — REFERRAL STATISTICS VIEW
   File:
   js/account/referral/statistics/referral.statistics.view.js

   Responsibilities:
   - Render canonical referral-statistics placeholders
   - Render the user's referral list table
   - Provide loading, empty and pagination states
   - Provide the Shared Account Sections mount
   - Provide stable selectors for ReferralStatisticsModule
   - Avoid duplicating the page title already shown in Topbar

   Canonical referral statuses:
   - pending
   - qualified
   - approved
   - rejected
   - rewarded

   Important:
   - This file contains markup only
   - It does not read or write Firebase data
   - It does not calculate referral statistics
   - It does not approve or reject referrals
   - It does not perform account navigation
========================================================= */

const ReferralStatisticsView = (() => {
    "use strict";

    /* =====================================================
       PAGE TEMPLATE
    ===================================================== */

    function getTemplate() {
        return `
            <main
                id="referralStatisticsPage"
                class="profile-page referral-statistics-page"
                data-account-page="referral-statistics"
                data-account-state="guest"
                aria-labelledby="referralStatisticsTitle"
            >
                <!-- =========================================
                     REFERRAL STATISTICS
                ========================================== -->

                <section
                    id="referralStatisticsCard"
                    class="profile-card referral-statistics-card"
                    aria-labelledby="referralStatisticsTitle"
                >
                    <!--
                        The visible title and description are intentionally
                        omitted because the same page title and subtitle are
                        already rendered by the application Topbar.
                    -->

                    <h1
                        id="referralStatisticsTitle"
                        class="sr-only"
                    >
                        Referral Statistics
                    </h1>

                    <span
                        id="referralStatisticsRefreshState"
                        class="sr-only"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    ></span>

                    <div
                        id="referralSummaryGrid"
                        class="referral-summary-grid"
                        aria-label="Referral statistics summary"
                        aria-busy="true"
                    >
                        <!-- Total -->

                        <article
                            class="
                                referral-summary-item
                                referral-summary-total
                            "
                            data-referral-summary="total"
                        >
                            <span class="referral-summary-label">
                                Total Referrals
                            </span>

                            <strong
                                id="referralTotalCount"
                                class="referral-summary-value"
                                aria-live="polite"
                            >
                                0
                            </strong>
                        </article>

                        <!-- Pending -->

                        <article
                            class="
                                referral-summary-item
                                referral-summary-pending
                            "
                            data-referral-summary="pending"
                        >
                            <span class="referral-summary-label">
                                Pending
                            </span>

                            <div class="referral-summary-data">
                                <strong
                                    id="referralPendingCount"
                                    class="referral-summary-value"
                                    aria-live="polite"
                                >
                                    0
                                </strong>

                                <span
                                    class="referral-summary-indicator"
                                    aria-hidden="true"
                                >
                                    🟠
                                </span>
                            </div>
                        </article>

                        <!-- Qualified -->

                        <article
                            class="
                                referral-summary-item
                                referral-summary-qualified
                            "
                            data-referral-summary="qualified"
                        >
                            <span class="referral-summary-label">
                                Qualified
                            </span>

                            <div class="referral-summary-data">
                                <strong
                                    id="referralQualifiedCount"
                                    class="referral-summary-value"
                                    aria-live="polite"
                                >
                                    0
                                </strong>

                                <span
                                    class="referral-summary-indicator"
                                    aria-hidden="true"
                                >
                                    🔵
                                </span>
                            </div>
                        </article>

                        <!-- Rewarded -->

                        <article
                            class="
                                referral-summary-item
                                referral-summary-rewarded
                            "
                            data-referral-summary="rewarded"
                        >
                            <span class="referral-summary-label">
                                Rewarded
                            </span>

                            <div class="referral-summary-data">
                                <strong
                                    id="referralRewardedCount"
                                    class="referral-summary-value"
                                    aria-live="polite"
                                >
                                    0
                                </strong>

                                <span
                                    class="referral-summary-indicator"
                                    aria-hidden="true"
                                >
                                    🟢
                                </span>
                            </div>
                        </article>

                        <!-- Rejected -->

                        <article
                            class="
                                referral-summary-item
                                referral-summary-rejected
                            "
                            data-referral-summary="rejected"
                        >
                            <span class="referral-summary-label">
                                Rejected
                            </span>

                            <div class="referral-summary-data">
                                <strong
                                    id="referralRejectedCount"
                                    class="referral-summary-value"
                                    aria-live="polite"
                                >
                                    0
                                </strong>

                                <span
                                    class="referral-summary-indicator"
                                    aria-hidden="true"
                                >
                                    🔴
                                </span>
                            </div>
                        </article>
                    </div>

                    <div class="referral-reward-summary">
                        <span class="referral-reward-summary-label">
                            Credited Referral Reward
                        </span>

                        <strong
                            id="referralTotalReward"
                            class="referral-reward-summary-value"
                            aria-live="polite"
                        >
                            ৳0
                        </strong>
                    </div>
                </section>

                <!-- =========================================
                     REFERRAL LIST
                ========================================== -->

                <section
                    id="referralListSection"
                    class="profile-card referral-list-section"
                    aria-labelledby="referralListTitle"
                >
                    <header class="referral-list-header">
                        <div>
                            <h2
                                id="referralListTitle"
                                class="referral-list-title"
                            >
                                All Referrals
                            </h2>

                            <p class="referral-list-description">
                                People who joined through your permanent
                                referral link will appear here.
                            </p>
                        </div>

                        <span
                            id="referralListCount"
                            class="referral-list-count"
                            aria-label="Referral list count"
                            aria-live="polite"
                        >
                            0
                        </span>
                    </header>

                    <!-- Loading state -->

                    <div
                        id="referralStatisticsLoadingState"
                        class="referral-statistics-loading-state"
                        role="status"
                        aria-live="polite"
                    >
                        <span
                            class="profile-loading-spinner"
                            aria-hidden="true"
                        ></span>

                        <span>
                            Loading referral information...
                        </span>
                    </div>

                    <!-- Referral table -->

                    <div
                        id="referralStatisticsTableRegion"
                        class="referral-table-field"
                        role="region"
                        aria-label="Referral history"
                        tabindex="0"
                        hidden
                    >
                        <table class="referral-statistics-table">
                            <thead>
                                <tr>
                                    <th scope="col">
                                        Referred User
                                    </th>

                                    <th scope="col">
                                        Status
                                    </th>

                                    <th scope="col">
                                        Reward
                                    </th>
                                </tr>
                            </thead>

                            <tbody
                                id="referralStatisticsTableBody"
                                aria-live="polite"
                            ></tbody>
                        </table>
                    </div>

                    <!-- Load more -->

                    <div
                        id="referralStatisticsPagination"
                        class="referral-statistics-pagination"
                        aria-label="Referral history pagination"
                        aria-hidden="true"
                        hidden
                    >
                        <button
                            id="referralStatisticsLoadMoreButton"
                            class="referral-statistics-load-more-button"
                            type="button"
                            aria-controls="referralStatisticsTableBody"
                            aria-describedby="referralStatisticsLoadMoreState"
                            aria-busy="false"
                        >
                            Load More Referrals
                        </button>

                        <span
                            id="referralStatisticsLoadMoreState"
                            class="sr-only"
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                        ></span>
                    </div>

                    <!-- Empty state -->

                    <div
                        id="referralStatisticsEmptyState"
                        class="referral-statistics-empty-state"
                        role="status"
                        hidden
                    >
                        <span
                            class="referral-empty-state-icon"
                            aria-hidden="true"
                        >
                            👥
                        </span>

                        <strong class="referral-empty-state-title">
                            No referrals found
                        </strong>

                        <p class="referral-empty-state-text">
                            Referral information will appear here after
                            someone joins using your referral link.
                        </p>
                    </div>

                    <!-- Guest state -->

                    <div
                        id="referralStatisticsGuestState"
                        class="referral-statistics-empty-state"
                        role="status"
                        hidden
                    >
                        <span
                            class="referral-empty-state-icon"
                            aria-hidden="true"
                        >
                            🔐
                        </span>

                        <strong class="referral-empty-state-title">
                            Google sign-in required
                        </strong>

                        <p class="referral-empty-state-text">
                            Sign in with your verified Google account to view
                            referral statistics.
                        </p>
                    </div>
                </section>

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
                    id="referralStatisticsPageStatus"
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
                "[ReferralStatisticsView] A valid root element is required."
            );

            return false;
        }

        container.innerHTML =
            getTemplate();

        return (
            container.querySelector(
                "#referralStatisticsPage"
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
            "referralStatisticsPage"
        ) {
            page =
                container;
        } else if (container) {
            page =
                container.querySelector(
                    "#referralStatisticsPage"
                );
        } else {
            page =
                document.getElementById(
                    "referralStatisticsPage"
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

window.ReferralStatisticsView =
    ReferralStatisticsView;