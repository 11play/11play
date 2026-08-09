"use strict";

/* =========================================================
   11PLAY — REFERRAL RULES VIEW
   File:
   js/account/referral/rules/referral.rules.view.js

   Responsibilities:
   - Render the Referral Rules page
   - Display final referral qualification requirements
   - Explain Unique Web Device anti-abuse binding
   - Explain the 7 Days × 2 Hours activity requirement
   - Explain Admin review before reward credit
   - Provide the Shared Account Sections mount

   Final referral qualification:
   1. Valid referral attribution
   2. Verified unique Google-connected account
   3. Globally unique Bangladesh mobile number
   4. Unique Web Device binding
   5. 7 different eligible Bangladesh calendar days
      with at least 2 eligible active hours on EACH day

   Important:
   - APK installation is NOT a qualification condition
   - Direct browser use and APK/web-wrapper use follow
     exactly the same referral qualification rules
   - APK installation gives no additional qualification benefit
   - Web Device binding is an anti-abuse browser/device-
     installation binding, not a physical hardware ID
   - This file contains markup only
   - This file does not calculate referral eligibility
   - This file does not write Firebase data
   - This file does not perform account navigation
========================================================= */

const ReferralRulesView = (() => {
    "use strict";

    const REQUIRED_ACTIVE_DAYS =
        7;

    const REQUIRED_DAILY_MINUTES =
        120;

    const CHECKPOINT_MINUTES =
        15;

    const REWARD_AMOUNT =
        1000;

    /* =====================================================
       PAGE TEMPLATE
    ===================================================== */

    function getTemplate() {
        return `
            <main
                id="referralRulesPage"
                class="profile-page referral-rules-page"
                data-account-page="referral-rules"
                data-required-active-days="${REQUIRED_ACTIVE_DAYS}"
                data-required-daily-minutes="${REQUIRED_DAILY_MINUTES}"
                aria-labelledby="referralRulesCardTitle"
            >
                <section
                    id="referralRulesCard"
                    class="profile-card referral-rules-card"
                    aria-labelledby="referralRulesCardTitle"
                >
                    <!-- Page heading -->

                    <header class="referral-rules-header">
                        <div
                            class="referral-rules-header-icon"
                            aria-hidden="true"
                        >
                            📖
                        </div>

                        <div class="referral-rules-header-content">
                            <h1
                                id="referralRulesCardTitle"
                                class="referral-rules-title"
                            >
                                Referral Rules
                            </h1>

                            <p class="referral-rules-subtitle">
                                A referral must satisfy the required
                                referral, verified account, unique mobile,
                                Unique Web Device and Eligible Active Days
                                conditions before becoming
                                <strong>Qualified</strong>
                                for Admin review of the
                                <strong
                                    id="referralRuleRewardAmount"
                                    data-referral-reward-amount="${REWARD_AMOUNT}"
                                >
                                    ৳1,000 Cash Reward.
                                </strong>
                            </p>
                        </div>
                    </header>

                    <!-- Referral requirements -->

                    <div
                        class="referral-rules-list"
                        aria-label="Referral qualification requirements"
                    >
                        <!-- Rule 1 -->

                        <article
                            class="referral-rule-item"
                            data-referral-rule="valid-link"
                        >
                            <div
                                class="referral-rule-number"
                                aria-hidden="true"
                            >
                                1
                            </div>

                            <div class="referral-rule-content">
                                <h2 class="referral-rule-title">
                                    Use a Valid Referral Link
                                </h2>

                                <p class="referral-rule-description">
                                    The referred person must enter 11Play
                                    through a signed-in user's valid unique
                                    referral link. The referral code is
                                    captured before sign-in and, once accepted
                                    for that account, the referrer cannot be
                                    changed.
                                </p>
                            </div>
                        </article>

                        <!-- Rule 2 -->

                        <article
                            class="referral-rule-item"
                            data-referral-rule="google-account"
                        >
                            <div
                                class="referral-rule-number"
                                aria-hidden="true"
                            >
                                2
                            </div>

                            <div class="referral-rule-content">
                                <h2 class="referral-rule-title">
                                    Use a Verified Google Account
                                </h2>

                                <p class="referral-rule-description">
                                    The referred person must use a verified
                                    Google-connected 11Play account. The
                                    qualifying account must be the referred
                                    user's own unique account. Guest sharing
                                    uses only the main 11Play URL and does not
                                    create a referral reward for any account.
                                </p>
                            </div>
                        </article>

                        <!-- Rule 3 -->

                        <article
                            class="referral-rule-item"
                            data-referral-rule="mobile-number"
                        >
                            <div
                                class="referral-rule-number"
                                aria-hidden="true"
                            >
                                3
                            </div>

                            <div class="referral-rule-content">
                                <h2 class="referral-rule-title">
                                    Submit a Unique Bangladesh Mobile Number
                                </h2>

                                <p class="referral-rule-description">
                                    The referred user must submit a valid
                                    Bangladesh mobile number. One mobile number
                                    can be reserved by only one 11Play account.
                                    After the number is successfully saved and
                                    locked, the user cannot replace or edit it.
                                </p>
                            </div>
                        </article>

                        <!-- Rule 4 -->

                        <article
                            class="referral-rule-item"
                            data-referral-rule="unique-web-device"
                        >
                            <div
                                class="referral-rule-number"
                                aria-hidden="true"
                            >
                                4
                            </div>

                            <div class="referral-rule-content">
                                <h2 class="referral-rule-title">
                                    Use a Unique Web Device
                                </h2>

                                <p class="referral-rule-description">
                                    The referred account must have its own
                                    Unique Web Device binding. 11Play uses a
                                    browser/device-installation identifier as
                                    an anti-abuse control so that the same
                                    stored Web Device identity cannot qualify
                                    multiple accounts.
                                </p>

                                <p class="referral-rule-description">
                                    This is a web anti-abuse binding, not an
                                    IMEI, Android serial number or permanent
                                    physical hardware ID. Clearing browser
                                    data or using another browser profile may
                                    create a different Web Device identity.
                                </p>
                            </div>
                        </article>

                        <!-- Rule 5 -->

                        <article
                            class="referral-rule-item"
                            data-referral-rule="eligible-active-days"
                        >
                            <div
                                class="referral-rule-number"
                                aria-hidden="true"
                            >
                                5
                            </div>

                            <div class="referral-rule-content">
                                <h2 class="referral-rule-title">
                                    Complete 7 Eligible Active Days
                                </h2>

                                <p class="referral-rule-description">
                                    The referred user must complete
                                    <strong
                                        id="referralRuleRequiredUsingTime"
                                        data-required-active-days="${REQUIRED_ACTIVE_DAYS}"
                                        data-required-daily-minutes="${REQUIRED_DAILY_MINUTES}"
                                    >
                                        ${REQUIRED_ACTIVE_DAYS} Eligible Active Days
                                    </strong>,
                                    with at least
                                    <strong>${REQUIRED_DAILY_MINUTES} eligible active minutes</strong>
                                    on each qualifying Bangladesh calendar day.
                                </p>

                                <p class="referral-rule-description">
                                    A day counts only after the full
                                    ${REQUIRED_DAILY_MINUTES}-minute requirement
                                    for that Bangladesh date has been completed.
                                    Spending extra time on one date cannot
                                    replace another required date. For example,
                                    14 hours on one day still counts as a
                                    maximum of one Eligible Active Day.
                                </p>

                                <p class="referral-rule-description">
                                    Eligible activity is recorded through
                                    server-authorized checkpoints. A normal
                                    credited checkpoint represents
                                    ${CHECKPOINT_MINUTES} eligible minutes, and
                                    eight valid checkpoints are required to
                                    complete the daily ${REQUIRED_DAILY_MINUTES}-minute
                                    target. Firestore server time remains the
                                    authority for credited activity.
                                </p>
                            </div>
                        </article>
                    </div>

                    <!-- Referral validation rules -->

                    <section
                        class="referral-verification-section"
                        aria-labelledby="referralValidationTitle"
                    >
                        <header class="referral-verification-header">
                            <span
                                class="referral-verification-icon"
                                aria-hidden="true"
                            >
                                🛡️
                            </span>

                            <h2
                                id="referralValidationTitle"
                                class="referral-verification-title"
                            >
                                Referral Validation
                            </h2>
                        </header>

                        <ul class="referral-verification-list">
                            <li>
                                Self-referral is not allowed.
                            </li>

                            <li>
                                A referred account can be connected to
                                only one referrer.
                            </li>

                            <li>
                                The referrer cannot be changed after the
                                referral is bound.
                            </li>

                            <li>
                                A Bangladesh mobile number can be reserved
                                by only one 11Play account.
                            </li>

                            <li>
                                A stored Unique Web Device identity cannot
                                be used to qualify multiple accounts.
                            </li>

                            <li>
                                Invalid, duplicate or unsupported referral
                                codes do not qualify.
                            </li>

                            <li>
                                Each qualifying Bangladesh date requires at
                                least ${REQUIRED_DAILY_MINUTES} minutes of
                                eligible active use.
                            </li>

                            <li>
                                A maximum of one Eligible Active Day can be
                                earned for each Bangladesh calendar date.
                            </li>

                            <li>
                                Hidden, unfocused, offline, inactive,
                                excessively delayed, duplicated or abusive
                                activity does not automatically earn
                                qualifying activity credit.
                            </li>

                            <li>
                                Artificial, scripted or abusive activity
                                cannot legitimately accelerate the
                                ${REQUIRED_ACTIVE_DAYS}-day requirement.
                            </li>

                            <li>
                                APK installation is not required and gives
                                no additional referral qualification benefit.
                                Direct browser users and APK/web-wrapper users
                                follow the same qualification rules.
                            </li>

                            <li>
                                Becoming Qualified does not automatically
                                credit the reward to the wallet.
                            </li>

                            <li>
                                A referral reward can be credited only once
                                after Admin approval.
                            </li>
                        </ul>
                    </section>

                    <!-- Referral status guide -->

                    <section
                        class="referral-verification-section referral-status-guide"
                        aria-labelledby="referralStatusGuideTitle"
                    >
                        <header class="referral-verification-header">
                            <span
                                class="referral-verification-icon"
                                aria-hidden="true"
                            >
                                📊
                            </span>

                            <h2
                                id="referralStatusGuideTitle"
                                class="referral-verification-title"
                            >
                                Referral Status Guide
                            </h2>
                        </header>

                        <ul class="referral-verification-list">
                            <li>
                                <strong>Pending:</strong>
                                The referral has been captured, but one or
                                more required conditions are still incomplete.
                                These can include the verified Google account,
                                unique mobile number, Unique Web Device or the
                                ${REQUIRED_ACTIVE_DAYS}-day ×
                                ${REQUIRED_DAILY_MINUTES}-minute activity
                                requirement.
                            </li>

                            <li>
                                <strong>Qualified:</strong>
                                The required referral attribution, verified
                                account, unique mobile, Unique Web Device and
                                all ${REQUIRED_ACTIVE_DAYS} Eligible Active
                                Days have been completed, with at least
                                ${REQUIRED_DAILY_MINUTES} eligible minutes on
                                every qualifying day. The referral is now
                                waiting for Admin review.
                            </li>

                            <li>
                                <strong>Approved:</strong>
                                Admin has approved the qualified referral.
                                Reward processing must still remain consistent
                                with the server-authoritative referral and
                                wallet records.
                            </li>

                            <li>
                                <strong>Rewarded:</strong>
                                Admin approval has resulted in the corresponding
                                ৳${REWARD_AMOUNT.toLocaleString("en-BD")} reward
                                being credited exactly once to the referrer's
                                wallet.
                            </li>

                            <li>
                                <strong>Rejected:</strong>
                                Admin rejected the referral after validation.
                                No referral reward is credited.
                            </li>
                        </ul>
                    </section>

                    <!-- Important notice -->

                    <aside
                        class="referral-rules-notice"
                        role="note"
                        aria-labelledby="referralRulesNoticeTitle"
                    >
                        <div
                            class="referral-rules-notice-icon"
                            aria-hidden="true"
                        >
                            ⚠️
                        </div>

                        <div class="referral-rules-notice-content">
                            <h2
                                id="referralRulesNoticeTitle"
                                class="referral-rules-notice-title"
                            >
                                Important Notice
                            </h2>

                            <p class="referral-rules-notice-text">
                                Qualified status means the referral has
                                satisfied the current qualification conditions
                                and is ready for Admin review. It does not mean
                                that money has already been added to the wallet.
                                The reward becomes available only after the
                                authorized Admin approval process creates the
                                corresponding reward transaction.
                            </p>

                            <p class="referral-rules-notice-text">
                                A referral may be rejected for invalid,
                                duplicate, self-referred, incomplete,
                                device-conflicting or abusive activity.
                                Reward approval is a manual Admin review step,
                                and a referral can never be rewarded more than
                                once.
                            </p>

                            <p class="referral-rules-notice-text">
                                11Play does not require APK installation for
                                referral qualification. Opening the official
                                GitHub Pages website directly in a browser or
                                accessing the same website through a compatible
                                web wrapper follows the same account, mobile,
                                Web Device and activity requirements.
                            </p>
                        </div>
                    </aside>
                </section>

                <!-- Shared Account Sections -->

                <div
                    id="accountSectionsMount"
                    class="account-sections-mount"
                    aria-label="Account features"
                ></div>

                <!-- Page status -->

                <div
                    id="referralRulesPageStatus"
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
            !(container instanceof HTMLElement)
        ) {
            console.error(
                "[ReferralRulesView] A valid root element is required."
            );

            return false;
        }

        container.innerHTML =
            getTemplate();

        return (
            container.querySelector(
                "#referralRulesPage"
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
            "referralRulesPage"
        ) {
            page =
                container;
        } else if (container) {
            page =
                container.querySelector(
                    "#referralRulesPage"
                );
        } else {
            page =
                document.getElementById(
                    "referralRulesPage"
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

window.ReferralRulesView =
    ReferralRulesView;