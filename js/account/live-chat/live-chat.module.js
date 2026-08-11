"use strict";

/* =========================================================
   11PLAY — LIVE CHAT MODULE
   File: js/account/live-chat/live-chat.module.js

   Responsibilities:
   - Initialize the Live Chat page runtime
   - Load the official tawk.to widget only when needed
   - Open the tawk.to chat inside the 11Play website
   - Keep the tawk.to floating widget hidden until the user
     explicitly presses "Start Live Chat"
   - Hide the widget when the Live Chat page is removed
   - Show Live Chat page status messages
   - Clean up only Live Chat page listeners
   - Destroy itself when the rendered page is removed

   Current provider:
   - tawk.to

   11Play tawk.to Property:
   - Property ID: 6a7b56cdc010c21d4b633898
   - Widget ID:   1jvosm4vd

   Important:
   - No Firebase read/write occurs here
   - No Firebase Cloud Functions are used
   - No separate 11Play chat database is used
   - Chat delivery/storage is handled by tawk.to
   - No referral/reward/wallet logic exists here
   - No user Google profile data is automatically sent
     to tawk.to by this module
========================================================= */

const LiveChatModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const PAGE_NAME =
        "live-chat";

    const STATUS_DURATION_MS =
        5000;

    const TAWK_LOAD_TIMEOUT_MS =
        20000;

    const TAWK_PROPERTY_ID =
        "6a7b56cdc010c21d4b633898";

    const TAWK_WIDGET_ID =
        "1jvosm4vd";

    const TAWK_SCRIPT_ID =
        "11play-tawk-widget-script";

    const TAWK_SCRIPT_URL =
        `https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        controller:
            null,

        pageObserver:
            null,

        statusTimer:
            null,

        lifecycleGeneration:
            0,

        tawkLoadPromise:
            null,

        tawkLoaded:
            false,

        openRequested:
            false
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

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

        const normalized =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalized ||
            fallback
        );
    }

    function getElement(
        selector
    ) {
        if (
            !state.page ||
            !selector
        ) {
            return null;
        }

        try {
            return state.page
                .querySelector(
                    selector
                );
        } catch {
            return null;
        }
    }

    /* =====================================================
       TAWK.TO HELPERS
    ===================================================== */

    function getTawkAPI() {
        if (
            !window.Tawk_API ||
            typeof window.Tawk_API !==
                "object"
        ) {
            window.Tawk_API = {};
        }

        return window.Tawk_API;
    }

    function hasTawkRuntime() {
        const api =
            window.Tawk_API;

        return Boolean(
            api &&
            typeof api.showWidget ===
                "function" &&
            typeof api.hideWidget ===
                "function" &&
            typeof api.maximize ===
                "function"
        );
    }

    function isLiveChatEnabled() {
        return Boolean(
            normalizeString(
                TAWK_PROPERTY_ID
            ) &&
            normalizeString(
                TAWK_WIDGET_ID
            ) &&
            normalizeString(
                TAWK_SCRIPT_URL
            )
        );
    }

    function hideTawkWidget() {
        if (
            !hasTawkRuntime()
        ) {
            return false;
        }

        try {
            if (
                typeof window.Tawk_API
                    .minimize ===
                    "function"
            ) {
                window.Tawk_API
                    .minimize();
            }

            window.Tawk_API
                .hideWidget();

            return true;
        } catch (error) {
            console.warn(
                "[LiveChatModule] tawk.to widget could not be hidden.",
                error
            );

            return false;
        }
    }

    function showAndMaximizeTawkWidget() {
        if (
            !hasTawkRuntime()
        ) {
            return false;
        }

        try {
            window.Tawk_API
                .showWidget();

            window.Tawk_API
                .maximize();

            return true;
        } catch (error) {
            console.error(
                "[LiveChatModule] tawk.to widget could not be opened.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       TAWK.TO SCRIPT LOADER
    ===================================================== */

    function loadTawkWidget() {
        if (
            hasTawkRuntime()
        ) {
            state.tawkLoaded =
                true;

            return Promise.resolve(
                true
            );
        }

        if (
            state.tawkLoadPromise
        ) {
            return state
                .tawkLoadPromise;
        }

        state.tawkLoadPromise =
            new Promise(
                (
                    resolve,
                    reject
                ) => {
                    let settled =
                        false;

                    let timeoutId =
                        null;

                    const settleSuccess =
                        () => {
                            if (
                                settled
                            ) {
                                return;
                            }

                            settled =
                                true;

                            if (
                                timeoutId !==
                                    null
                            ) {
                                window.clearTimeout(
                                    timeoutId
                                );

                                timeoutId =
                                    null;
                            }

                            state.tawkLoaded =
                                true;

                            resolve(
                                true
                            );
                        };

                    const settleFailure =
                        (
                            error
                        ) => {
                            if (
                                settled
                            ) {
                                return;
                            }

                            settled =
                                true;

                            if (
                                timeoutId !==
                                    null
                            ) {
                                window.clearTimeout(
                                    timeoutId
                                );

                                timeoutId =
                                    null;
                            }

                            state.tawkLoaded =
                                false;

                            state.tawkLoadPromise =
                                null;

                            reject(
                                error instanceof
                                    Error
                                    ? error
                                    : new Error(
                                        "tawk.to widget failed to load."
                                    )
                            );
                        };

                    const api =
                        getTawkAPI();

                    const previousOnLoad =
                        typeof api.onLoad ===
                            "function"
                            ? api.onLoad
                            : null;

                    api.onLoad =
                        function onTawkLoad() {
                            if (
                                previousOnLoad
                            ) {
                                try {
                                    previousOnLoad();
                                } catch (error) {
                                    console.warn(
                                        "[LiveChatModule] Existing tawk.to onLoad handler failed.",
                                        error
                                    );
                                }
                            }

                            /*
                             * Keep the third-party floating widget
                             * hidden by default.
                             *
                             * It will become visible only when the
                             * 11Play Start Live Chat button is pressed.
                             */

                            try {
                                if (
                                    typeof api
                                        .hideWidget ===
                                        "function"
                                ) {
                                    api.hideWidget();
                                }
                            } catch (error) {
                                console.warn(
                                    "[LiveChatModule] Initial tawk.to widget hide failed.",
                                    error
                                );
                            }

                            settleSuccess();
                        };

                    const existingScript =
                        document.getElementById(
                            TAWK_SCRIPT_ID
                        );

                    if (
                        existingScript
                    ) {
                        if (
                            hasTawkRuntime()
                        ) {
                            settleSuccess();

                            return;
                        }

                        existingScript
                            .addEventListener(
                                "error",
                                () => {
                                    settleFailure(
                                        new Error(
                                            "Existing tawk.to script failed to load."
                                        )
                                    );
                                },
                                {
                                    once:
                                        true
                                }
                            );
                    } else {
                        const script =
                            document.createElement(
                                "script"
                            );

                        script.id =
                            TAWK_SCRIPT_ID;

                        script.type =
                            "text/javascript";

                        script.async =
                            true;

                        script.src =
                            TAWK_SCRIPT_URL;

                        script.charset =
                            "UTF-8";

                        script.setAttribute(
                            "crossorigin",
                            "*"
                        );

                        script.addEventListener(
                            "error",
                            () => {
                                settleFailure(
                                    new Error(
                                        "tawk.to script request failed."
                                    )
                                );
                            },
                            {
                                once:
                                    true
                            }
                        );

                        const firstScript =
                            document
                                .getElementsByTagName(
                                    "script"
                                )[0];

                        if (
                            firstScript &&
                            firstScript.parentNode
                        ) {
                            firstScript
                                .parentNode
                                .insertBefore(
                                    script,
                                    firstScript
                                );
                        } else if (
                            document.head
                        ) {
                            document.head
                                .appendChild(
                                    script
                                );
                        } else if (
                            document.body
                        ) {
                            document.body
                                .appendChild(
                                    script
                                );
                        } else {
                            settleFailure(
                                new Error(
                                    "No valid document location exists for the tawk.to script."
                                )
                            );

                            return;
                        }
                    }

                    timeoutId =
                        window.setTimeout(
                            () => {
                                if (
                                    hasTawkRuntime()
                                ) {
                                    settleSuccess();

                                    return;
                                }

                                settleFailure(
                                    new Error(
                                        "tawk.to widget load timed out."
                                    )
                                );
                            },
                            TAWK_LOAD_TIMEOUT_MS
                        );
                }
            );

        return state
            .tawkLoadPromise;
    }

    /* =====================================================
       STATUS
    ===================================================== */

    function clearStatusTimer() {
        if (
            state.statusTimer !==
                null
        ) {
            window.clearTimeout(
                state.statusTimer
            );

            state.statusTimer =
                null;
        }
    }

    function getStatusElement() {
        return getElement(
            "#liveChatPageStatus"
        );
    }

    function hideStatus() {
        clearStatusTimer();

        const status =
            getStatusElement();

        if (!status) {
            return false;
        }

        status.hidden =
            true;

        status.textContent =
            "";

        delete status.dataset
            .statusType;

        status.classList.remove(
            "is-success",
            "is-error",
            "is-info"
        );

        return true;
    }

    function showStatus(
        message,
        type = "info",
        duration =
            STATUS_DURATION_MS
    ) {
        const status =
            getStatusElement();

        if (!status) {
            return false;
        }

        clearStatusTimer();

        const normalizedMessage =
            normalizeString(
                message
            );

        if (
            !normalizedMessage
        ) {
            return hideStatus();
        }

        const normalizedType =
            [
                "success",
                "error",
                "info"
            ].includes(
                type
            )
                ? type
                : "info";

        status.textContent =
            normalizedMessage;

        status.hidden =
            false;

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

        if (
            duration >
                0
        ) {
            state.statusTimer =
                window.setTimeout(
                    () => {
                        hideStatus();
                    },
                    duration
                );
        }

        return true;
    }

    /* =====================================================
       BUTTON STATE
    ===================================================== */

    function setButtonLoading(
        button,
        loading
    ) {
        if (
            !(
                button instanceof
                    HTMLButtonElement
            )
        ) {
            return false;
        }

        const isLoading =
            Boolean(
                loading
            );

        button.classList.toggle(
            "is-loading",
            isLoading
        );

        button.setAttribute(
            "aria-busy",
            String(
                isLoading
            )
        );

        if (
            isLoading
        ) {
            button.disabled =
                true;

            button.setAttribute(
                "aria-disabled",
                "true"
            );
        } else {
            button.disabled =
                false;

            button.setAttribute(
                "aria-disabled",
                "false"
            );
        }

        return true;
    }

    function enableStartButton() {
        const button =
            getElement(
                "#liveChatStartButton"
            );

        if (
            !(
                button instanceof
                    HTMLButtonElement
            )
        ) {
            return false;
        }

        button.disabled =
            false;

        button.setAttribute(
            "aria-disabled",
            "false"
        );

        button.setAttribute(
            "aria-busy",
            "false"
        );

        button.classList.remove(
            "is-loading"
        );

        /*
         * The old external URL implementation may have
         * left this data attribute empty.
         *
         * The tawk.to integration no longer depends on it.
         */

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    button.dataset,
                    "chatUrl"
                )
        ) {
            delete button.dataset
                .chatUrl;
        }

        button.dataset.chatProvider =
            "tawk";

        return true;
    }

    /* =====================================================
       OPEN LIVE CHAT
    ===================================================== */

    async function openLiveChat(
        button = null
    ) {
        if (
            !isLiveChatEnabled()
        ) {
            showStatus(
                "Live Chat is currently unavailable.",
                "error"
            );

            return false;
        }

        if (
            button instanceof
                HTMLButtonElement
        ) {
            setButtonLoading(
                button,
                true
            );
        }

        state.openRequested =
            true;

        showStatus(
            "Connecting to 11Play Live Chat...",
            "info",
            0
        );

        try {
            await loadTawkWidget();

            if (
                !state.openRequested
            ) {
                if (
                    button instanceof
                        HTMLButtonElement
                ) {
                    setButtonLoading(
                        button,
                        false
                    );
                }

                return false;
            }

            const opened =
                showAndMaximizeTawkWidget();

            if (
                button instanceof
                    HTMLButtonElement
            ) {
                setButtonLoading(
                    button,
                    false
                );
            }

            if (
                !opened
            ) {
                showStatus(
                    "Live Chat could not be opened.",
                    "error"
                );

                return false;
            }

            hideStatus();

            return true;
        } catch (error) {
            if (
                button instanceof
                    HTMLButtonElement
            ) {
                setButtonLoading(
                    button,
                    false
                );
            }

            console.error(
                "[LiveChatModule] tawk.to Live Chat failed to load.",
                error
            );

            showStatus(
                "Live Chat could not connect. Please check your internet connection and try again.",
                "error"
            );

            return false;
        }
    }

    /* =====================================================
       CLICK HANDLING
    ===================================================== */

    function handleClick(
        event
    ) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                    Element
            )
        ) {
            return;
        }

        const actionElement =
            event.target.closest(
                "[data-live-chat-action]"
            );

        if (
            !actionElement ||
            !state.page
                ?.contains(
                    actionElement
                )
        ) {
            return;
        }

        const action =
            normalizeString(
                actionElement
                    .dataset
                    .liveChatAction
            )
                .toLowerCase();

        if (
            action ===
                "start"
        ) {
            event.preventDefault();

            if (
                actionElement instanceof
                    HTMLButtonElement &&
                actionElement.classList
                    .contains(
                        "is-loading"
                    )
            ) {
                return;
            }

            void openLiveChat(
                actionElement
            );
        }
    }

    /* =====================================================
       KEYBOARD HANDLING
    ===================================================== */

    function handleKeydown(
        event
    ) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                    Element
            )
        ) {
            return;
        }

        if (
            event.key !==
                "Enter" &&
            event.key !==
                " "
        ) {
            return;
        }

        const actionElement =
            event.target.closest(
                "[data-live-chat-action]"
            );

        if (
            !actionElement ||
            !state.page
                ?.contains(
                    actionElement
                )
        ) {
            return;
        }

        /*
         * Native buttons already trigger click correctly.
         */

        if (
            actionElement instanceof
                HTMLButtonElement
        ) {
            return;
        }

        event.preventDefault();

        actionElement.click();
    }

    /* =====================================================
       EVENT BINDING
    ===================================================== */

    function bindEvents() {
        if (
            state.controller ||
            !state.page
        ) {
            return Boolean(
                state.controller
            );
        }

        state.controller =
            new AbortController();

        const signal =
            state.controller
                .signal;

        state.page
            .addEventListener(
                "click",
                handleClick,
                {
                    signal
                }
            );

        state.page
            .addEventListener(
                "keydown",
                handleKeydown,
                {
                    signal
                }
            );

        return true;
    }

    function unbindEvents() {
        if (
            state.controller
        ) {
            state.controller
                .abort();

            state.controller =
                null;
        }

        return true;
    }

    /* =====================================================
       PAGE REMOVAL OBSERVER
    ===================================================== */

    function observePageRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined" ||
            !state.page
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
                            state.lifecycleGeneration
                    ) {
                        return;
                    }

                    if (
                        !observedPage ||
                        observedPage
                            .isConnected
                    ) {
                        return;
                    }

                    destroy();
                }
            );

        state.pageObserver
            .observe(
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

    function init() {
        destroy();

        const page =
            document.getElementById(
                "liveChatPage"
            );

        if (!page) {
            console.error(
                "[LiveChatModule] LiveChatView must be rendered before LiveChatModule.init()."
            );

            return false;
        }

        state.lifecycleGeneration +=
            1;

        state.page =
            page;

        state.initialized =
            true;

        state.openRequested =
            false;

        bindEvents();

        observePageRemoval();

        /*
         * The previous external-URL implementation could
         * disable this button when SupportConfig.chatUrl
         * was empty.
         *
         * tawk.to is now the Live Chat provider, so the
         * button is enabled directly by this module.
         */

        if (
            isLiveChatEnabled()
        ) {
            enableStartButton();
        } else {
            const startButton =
                getElement(
                    "#liveChatStartButton"
                );

            if (
                startButton instanceof
                    HTMLButtonElement
            ) {
                startButton.disabled =
                    true;

                startButton.setAttribute(
                    "aria-disabled",
                    "true"
                );
            }

            showStatus(
                "Live Chat is currently unavailable.",
                "error",
                0
            );
        }

        /*
         * If the tawk.to runtime was already loaded during
         * an earlier visit to this SPA route, keep the
         * floating widget hidden until Start Live Chat is
         * pressed again.
         */

        hideTawkWidget();

        return true;
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        state.openRequested =
            false;

        clearStatusTimer();

        unbindEvents();

        if (
            state.pageObserver
        ) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        /*
         * The tawk.to script stays loaded for the lifetime
         * of the SPA document, but its visible widget is
         * hidden whenever the user leaves the Live Chat page.
         */

        hideTawkWidget();

        state.page =
            null;

        state.initialized =
            false;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        openLiveChat,

        showStatus,
        hideStatus,

        isLiveChatEnabled,

        isInitialized() {
            return state.initialized;
        },

        isTawkLoaded() {
            return Boolean(
                state.tawkLoaded ||
                hasTawkRuntime()
            );
        },

        getCurrentPage() {
            return state.initialized
                ? PAGE_NAME
                : "";
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.LiveChatModule =
    LiveChatModule;