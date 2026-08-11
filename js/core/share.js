"use strict";

/* =========================================================
   11PLAY — SHARE
   File: js/core/share.js

   Responsibilities:
   - Share the official 11Play website
   - Promote the current 500 BDT new-user offer
   - Share the Offer image when browser support allows
   - Use the browser native Share API when available
   - Fall back to promotional text + official URL copy
   - Support Invite Your Friend controls

   Important:
   - This is promotional sharing only
   - No referral code is generated
   - No ?ref= parameter is added
   - No user ID is attached
   - No attribution or tracking is performed
   - No Firebase dependency exists here

   Official URL:
   https://11play.github.io/11play/

   Share Image:
   https://11play.github.io/11play/
   assets/seo/11play-500-bdt-offer-share.png
========================================================= */

const Share = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const CANONICAL_URL =
        "https://11play.github.io/11play/";

    const SHARE_IMAGE_URL =
        "https://11play.github.io/11play/assets/seo/11play-500-bdt-offer-share.png";

    const SHARE_IMAGE_FILENAME =
        "11play-500-bdt-offer-share.png";

    const DEFAULT_TITLE =
        "11Play — নতুন ইউজারের জন্য ৫০০৳ ক্যাশ বোনাস";

    const DEFAULT_TEXT =
        "🎁 নতুন ইউজারের জন্য ৫০০৳ ক্যাশ বোনাস। " +
        "অফার পেতে প্রথমে 11Play Live Chat থেকে সাইটের লিংক নিন, " +
        "তারপর শর্তসাপেক্ষে রেজিস্ট্রেশন ও প্রয়োজনীয় verification সম্পন্ন করুন। " +
        "আপনার বন্ধুকে ৫০০৳ অফার পেতে সাহায্য করতে 11Play শেয়ার করুন।";

    const COPY_SUCCESS_MESSAGE =
        "11Play ৫০০৳ Offer-এর তথ্য ও লিংক কপি হয়েছে।";

    const COPY_ERROR_MESSAGE =
        "11Play Offer-এর তথ্য কপি করা যায়নি।";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let initialized =
        false;

    let controller =
        null;

    let shareImageFilePromise =
        null;

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function toSafeString(
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

    function dispatchShareEvent(
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

    /* =====================================================
       CANONICAL SHARE DATA
    ===================================================== */

    function getShareURL() {
        /*
         * Always use the clean official URL.
         *
         * Current query strings, hashes, UID,
         * referral code or legacy referral data
         * are intentionally ignored.
         */

        return CANONICAL_URL;
    }

    function getShareImageURL() {
        return SHARE_IMAGE_URL;
    }

    function getShareData(
        overrides = {}
    ) {
        const title =
            toSafeString(
                overrides.title,
                DEFAULT_TITLE
            );

        const text =
            toSafeString(
                overrides.text,
                DEFAULT_TEXT
            );

        return Object.freeze({
            title,

            text,

            url:
                getShareURL(),

            image:
                getShareImageURL()
        });
    }

    function buildCopyText(
        shareData
    ) {
        return [
            shareData.title,
            "",
            shareData.text,
            "",
            shareData.url
        ]
            .filter(
                value =>
                    value !==
                    undefined &&
                    value !==
                    null
            )
            .join("\n")
            .trim();
    }

    /* =====================================================
       SHARE IMAGE FILE

       Used only when the browser supports Web Share files.

       If file sharing is unsupported or image loading fails,
       normal URL sharing continues automatically.
    ===================================================== */

    async function loadShareImageFile() {
        if (
            shareImageFilePromise
        ) {
            return shareImageFilePromise;
        }

        shareImageFilePromise =
            (async () => {
                if (
                    typeof window.File !==
                        "function" ||
                    typeof window.fetch !==
                        "function"
                ) {
                    return null;
                }

                try {
                    const response =
                        await fetch(
                            SHARE_IMAGE_URL,
                            {
                                method:
                                    "GET",

                                cache:
                                    "force-cache",

                                credentials:
                                    "omit"
                            }
                        );

                    if (
                        !response.ok
                    ) {
                        return null;
                    }

                    const blob =
                        await response.blob();

                    if (
                        !blob ||
                        !blob.size
                    ) {
                        return null;
                    }

                    const mimeType =
                        toSafeString(
                            blob.type,
                            "image/png"
                        );

                    return new File(
                        [
                            blob
                        ],
                        SHARE_IMAGE_FILENAME,
                        {
                            type:
                                mimeType,

                            lastModified:
                                Date.now()
                        }
                    );
                } catch (error) {
                    console.warn(
                        "[Share] Offer share image could not be loaded.",
                        error
                    );

                    return null;
                }
            })();

        return shareImageFilePromise;
    }

    function canShareFiles(
        files
    ) {
        if (
            !Array.isArray(
                files
            ) ||
            files.length ===
                0 ||
            typeof navigator.canShare !==
                "function"
        ) {
            return false;
        }

        try {
            return navigator.canShare({
                files
            });
        } catch {
            return false;
        }
    }

    /* =====================================================
       CLIPBOARD
    ===================================================== */

    async function copyWithClipboardAPI(
        text
    ) {
        if (
            !navigator.clipboard ||
            typeof navigator.clipboard
                .writeText !==
                "function"
        ) {
            return false;
        }

        try {
            await navigator.clipboard
                .writeText(
                    text
                );

            return true;
        } catch {
            return false;
        }
    }

    function copyWithFallback(
        text
    ) {
        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.value =
            text;

        textarea.setAttribute(
            "readonly",
            ""
        );

        textarea.setAttribute(
            "aria-hidden",
            "true"
        );

        textarea.style.position =
            "fixed";

        textarea.style.left =
            "-9999px";

        textarea.style.top =
            "0";

        textarea.style.opacity =
            "0";

        document.body.appendChild(
            textarea
        );

        try {
            textarea.focus();

            textarea.select();

            textarea.setSelectionRange(
                0,
                textarea.value.length
            );

            return document.execCommand(
                "copy"
            );
        } catch {
            return false;
        } finally {
            textarea.remove();
        }
    }

    async function copyInviteLink(
        overrides = {}
    ) {
        const shareData =
            getShareData(
                overrides
            );

        const copyText =
            buildCopyText(
                shareData
            );

        let copied =
            await copyWithClipboardAPI(
                copyText
            );

        if (
            !copied
        ) {
            copied =
                copyWithFallback(
                    copyText
                );
        }

        if (
            copied
        ) {
            dispatchShareEvent(
                "share:copied",
                {
                    title:
                        shareData.title,

                    text:
                        shareData.text,

                    url:
                        shareData.url,

                    image:
                        shareData.image,

                    message:
                        COPY_SUCCESS_MESSAGE
                }
            );

            return {
                success:
                    true,

                copied:
                    true,

                title:
                    shareData.title,

                text:
                    shareData.text,

                url:
                    shareData.url,

                image:
                    shareData.image,

                message:
                    COPY_SUCCESS_MESSAGE
            };
        }

        dispatchShareEvent(
            "share:error",
            {
                action:
                    "copy",

                url:
                    shareData.url,

                message:
                    COPY_ERROR_MESSAGE
            }
        );

        return {
            success:
                false,

            copied:
                false,

            url:
                shareData.url,

            message:
                COPY_ERROR_MESSAGE
        };
    }

    /* =====================================================
       NATIVE SHARE
    ===================================================== */

    function canNativeShare() {
        return (
            typeof navigator.share ===
                "function"
        );
    }

    function isShareCancelled(
        error
    ) {
        return (
            error?.name ===
                "AbortError"
        );
    }

    async function shareWithImage(
        shareData
    ) {
        if (
            !canNativeShare()
        ) {
            return {
                handled:
                    false
            };
        }

        const imageFile =
            await loadShareImageFile();

        if (
            !imageFile ||
            !canShareFiles([
                imageFile
            ])
        ) {
            return {
                handled:
                    false
            };
        }

        try {
            await navigator.share({
                title:
                    shareData.title,

                text:
                    shareData.text,

                url:
                    shareData.url,

                files: [
                    imageFile
                ]
            });

            dispatchShareEvent(
                "share:success",
                {
                    method:
                        "native-image",

                    ...shareData
                }
            );

            return {
                handled:
                    true,

                success:
                    true,

                method:
                    "native-image"
            };
        } catch (error) {
            if (
                isShareCancelled(
                    error
                )
            ) {
                dispatchShareEvent(
                    "share:cancelled",
                    {
                        method:
                            "native-image",

                        ...shareData
                    }
                );

                return {
                    handled:
                        true,

                    success:
                        false,

                    cancelled:
                        true,

                    method:
                        "native-image"
                };
            }

            console.warn(
                "[Share] Image sharing failed. Retrying with link sharing.",
                error
            );

            return {
                handled:
                    false
            };
        }
    }

    async function shareWithoutImage(
        shareData
    ) {
        if (
            !canNativeShare()
        ) {
            return {
                handled:
                    false
            };
        }

        try {
            await navigator.share({
                title:
                    shareData.title,

                text:
                    shareData.text,

                url:
                    shareData.url
            });

            dispatchShareEvent(
                "share:success",
                {
                    method:
                        "native",

                    ...shareData
                }
            );

            return {
                handled:
                    true,

                success:
                    true,

                method:
                    "native"
            };
        } catch (error) {
            if (
                isShareCancelled(
                    error
                )
            ) {
                dispatchShareEvent(
                    "share:cancelled",
                    {
                        method:
                            "native",

                        ...shareData
                    }
                );

                return {
                    handled:
                        true,

                    success:
                        false,

                    cancelled:
                        true,

                    method:
                        "native"
                };
            }

            console.warn(
                "[Share] Native sharing failed. Falling back to copy.",
                error
            );

            return {
                handled:
                    false
            };
        }
    }

    async function shareInvite(
        overrides = {}
    ) {
        const shareData =
            getShareData(
                overrides
            );

        /*
         * Priority 1:
         * Share Offer image + promotional text + URL.
         */

        const imageShareResult =
            await shareWithImage(
                shareData
            );

        if (
            imageShareResult.handled
        ) {
            return {
                success:
                    imageShareResult
                        .success ===
                    true,

                cancelled:
                    imageShareResult
                        .cancelled ===
                    true,

                method:
                    imageShareResult
                        .method,

                ...shareData
            };
        }

        /*
         * Priority 2:
         * Share promotional text + canonical URL.
         *
         * WhatsApp, Facebook, Telegram and similar services
         * may generate the Offer image from Open Graph
         * metadata configured in index.html.
         */

        const nativeShareResult =
            await shareWithoutImage(
                shareData
            );

        if (
            nativeShareResult.handled
        ) {
            return {
                success:
                    nativeShareResult
                        .success ===
                    true,

                cancelled:
                    nativeShareResult
                        .cancelled ===
                    true,

                method:
                    nativeShareResult
                        .method,

                ...shareData
            };
        }

        /*
         * Priority 3:
         * Copy promotional text + canonical URL.
         */

        const copyResult =
            await copyInviteLink(
                overrides
            );

        if (
            copyResult.success
        ) {
            dispatchShareEvent(
                "share:success",
                {
                    method:
                        "copy",

                    ...shareData
                }
            );

            return {
                success:
                    true,

                method:
                    "copy",

                ...shareData,

                message:
                    copyResult.message
            };
        }

        return {
            success:
                false,

            method:
                "copy",

            ...shareData,

            message:
                copyResult.message
        };
    }

    /* =====================================================
       UI FEEDBACK
    ===================================================== */

    function setControlBusy(
        control,
        busy
    ) {
        if (
            !(
                control instanceof
                    HTMLElement
            )
        ) {
            return false;
        }

        const isBusy =
            Boolean(
                busy
            );

        control.classList.toggle(
            "is-sharing",
            isBusy
        );

        control.setAttribute(
            "aria-busy",
            String(
                isBusy
            )
        );

        if (
            control instanceof
                HTMLButtonElement
        ) {
            if (
                isBusy
            ) {
                if (
                    !Object.prototype
                        .hasOwnProperty
                        .call(
                            control.dataset,
                            "sharePreviousDisabled"
                        )
                ) {
                    control.dataset
                        .sharePreviousDisabled =
                        String(
                            control.disabled
                        );
                }

                control.disabled =
                    true;
            } else {
                const wasDisabled =
                    control.dataset
                        .sharePreviousDisabled ===
                    "true";

                control.disabled =
                    wasDisabled;

                delete control.dataset
                    .sharePreviousDisabled;
            }
        }

        return true;
    }

    /* =====================================================
       CLICK HANDLING

       Supported controls:

       data-share-action="invite"

       or

       data-invite-share

       Optional custom content:
       data-share-title="..."
       data-share-text="..."
    ===================================================== */

    async function handleClick(
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

        const control =
            event.target.closest(
                [
                    '[data-share-action="invite"]',
                    "[data-invite-share]"
                ].join(",")
            );

        if (
            !control
        ) {
            return;
        }

        if (
            control.getAttribute(
                "aria-disabled"
            ) ===
                "true" ||
            control.disabled ===
                true
        ) {
            event.preventDefault();

            return;
        }

        event.preventDefault();

        setControlBusy(
            control,
            true
        );

        try {
            await shareInvite({
                title:
                    control.dataset
                        .shareTitle,

                text:
                    control.dataset
                        .shareText
            });
        } finally {
            setControlBusy(
                control,
                false
            );
        }
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            initialized
        ) {
            return true;
        }

        controller =
            new AbortController();

        document.addEventListener(
            "click",
            handleClick,
            {
                signal:
                    controller.signal
            }
        );

        initialized =
            true;

        return true;
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        if (
            controller
        ) {
            controller.abort();

            controller =
                null;
        }

        shareImageFilePromise =
            null;

        initialized =
            false;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        shareInvite,
        copyInviteLink,

        canNativeShare,
        getShareURL,
        getShareImageURL,
        getShareData,

        isInitialized() {
            return initialized;
        },

        CANONICAL_URL,
        SHARE_IMAGE_URL
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.Share =
    Share;