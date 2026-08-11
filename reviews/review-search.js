(function () {
    "use strict";

    const searchForm = document.getElementById("review-search-form");
    const searchInput = document.getElementById("review-search-input");
    const clearButton = document.getElementById("review-search-clear");
    const resetButton = document.getElementById("review-search-reset");

    const resultsContainer = document.getElementById("review-results");
    const resultCount = document.getElementById("review-result-count");
    const resultsSummary = document.getElementById(
        "review-results-summary"
    );

    const emptyState = document.getElementById("review-search-empty");
    const currentYear = document.getElementById(
        "reviews-current-year"
    );

    const buildPlaceholder = document.querySelector(
        "[data-build-placeholder]"
    );

    if (
        !searchForm ||
        !searchInput ||
        !resultsContainer ||
        !resultCount ||
        !resultsSummary ||
        !emptyState
    ) {
        return;
    }

    const reviewResults = Array.from(
        resultsContainer.querySelectorAll("[data-review-result]")
    );

    const banglaNumberFormatter = new Intl.NumberFormat("bn-BD");

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFKC")
            .toLocaleLowerCase("bn-BD")
            .replace(/\s+/g, " ")
            .trim();
    }

    function getSearchText(result) {
        const configuredSearchText =
            result.getAttribute("data-search-text") || "";

        return normalizeText(
            configuredSearchText + " " + result.textContent
        );
    }

    const searchableResults = reviewResults.map(function (result) {
        return {
            element: result,
            searchText: getSearchText(result)
        };
    });

    function formatCount(count) {
        const formattedCount =
            banglaNumberFormatter.format(count);

        return formattedCount + "টি রিভিউ";
    }

    function getCurrentQuery() {
        return normalizeText(searchInput.value);
    }

    function getQueryFromUrl() {
        try {
            const url = new URL(window.location.href);
            return url.searchParams.get("q") || "";
        } catch (error) {
            return "";
        }
    }

    function updateUrl(query, historyMode) {
        try {
            const url = new URL(window.location.href);

            if (query) {
                url.searchParams.set("q", query);
            } else {
                url.searchParams.delete("q");
            }

            const state = {
                reviewSearchQuery: query
            };

            if (historyMode === "push") {
                window.history.pushState(
                    state,
                    "",
                    url.toString()
                );
            } else {
                window.history.replaceState(
                    state,
                    "",
                    url.toString()
                );
            }
        } catch (error) {
            /*
             * URL বা History API পাওয়া না গেলেও
             * search filtering কাজ করবে।
             */
        }
    }

    function setResultVisibility(result, isVisible) {
        result.hidden = !isVisible;
        result.setAttribute(
            "aria-hidden",
            isVisible ? "false" : "true"
        );
    }

    function getVisibleResults() {
        return searchableResults.filter(function (item) {
            return !item.element.hidden;
        });
    }

    function updateSearchSummary(query, visibleCount) {
        resultsSummary.replaceChildren();

        if (!query) {
            resultsSummary.textContent =
                "বর্তমানে সব প্রকাশিত রিভিউ দেখানো হচ্ছে.";

            return;
        }

        const prefix = document.createTextNode("“");
        const queryNode = document.createElement("strong");
        const suffix = document.createTextNode(
            "” সার্চের জন্য " +
            formatCount(visibleCount) +
            " পাওয়া গেছে।"
        );

        queryNode.textContent = query;

        resultsSummary.append(
            prefix,
            queryNode,
            suffix
        );
    }

    function updateInterface(query) {
        const normalizedQuery = normalizeText(query);

        let visibleCount = 0;

        searchableResults.forEach(function (item) {
            const isVisible =
                !normalizedQuery ||
                item.searchText.includes(normalizedQuery);

            setResultVisibility(
                item.element,
                isVisible
            );

            if (isVisible) {
                visibleCount += 1;
            }
        });

        resultCount.textContent = formatCount(visibleCount);

        updateSearchSummary(
            normalizedQuery,
            visibleCount
        );

        emptyState.hidden = visibleCount !== 0;

        resultsContainer.hidden =
            visibleCount === 0;

        if (clearButton) {
            clearButton.hidden = !normalizedQuery;
        }

        searchInput.setAttribute(
            "aria-label",
            normalizedQuery
                ? "বর্তমান সার্চ: " + normalizedQuery
                : "রিভিউ খুঁজুন"
        );

        document.documentElement.classList.toggle(
            "review-search-has-query",
            Boolean(normalizedQuery)
        );

        document.documentElement.classList.toggle(
            "review-search-has-no-results",
            visibleCount === 0
        );

        return visibleCount;
    }

    function applySearch(options) {
        const settings = Object.assign(
            {
                updateHistory: true,
                historyMode: "replace",
                focusInput: false
            },
            options || {}
        );

        const query = getCurrentQuery();

        updateInterface(query);

        if (settings.updateHistory) {
            updateUrl(
                query,
                settings.historyMode
            );
        }

        if (settings.focusInput) {
            searchInput.focus();
        }
    }

    function resetSearch(options) {
        const settings = Object.assign(
            {
                updateHistory: true,
                focusInput: true
            },
            options || {}
        );

        searchInput.value = "";

        updateInterface("");

        if (settings.updateHistory) {
            updateUrl("", "push");
        }

        if (settings.focusInput) {
            searchInput.focus();
        }
    }

    function focusFirstVisibleResult() {
        const visibleResults = getVisibleResults();

        if (!visibleResults.length) {
            return;
        }

        const firstLink =
            visibleResults[0].element.querySelector("a");

        if (firstLink) {
            firstLink.focus();
        }
    }

    searchForm.addEventListener(
        "submit",
        function (event) {
            event.preventDefault();

            applySearch({
                updateHistory: true,
                historyMode: "push"
            });
        }
    );

    searchInput.addEventListener(
        "input",
        function () {
            applySearch({
                updateHistory: true,
                historyMode: "replace"
            });
        }
    );

    searchInput.addEventListener(
        "keydown",
        function (event) {
            if (
                event.key === "ArrowDown" &&
                getVisibleResults().length > 0
            ) {
                event.preventDefault();
                focusFirstVisibleResult();
            }

            if (
                event.key === "Escape" &&
                getCurrentQuery()
            ) {
                event.preventDefault();

                resetSearch({
                    updateHistory: true,
                    focusInput: true
                });
            }
        }
    );

    if (clearButton) {
        clearButton.addEventListener(
            "click",
            function () {
                resetSearch({
                    updateHistory: true,
                    focusInput: true
                });
            }
        );
    }

    if (resetButton) {
        resetButton.addEventListener(
            "click",
            function () {
                resetSearch({
                    updateHistory: true,
                    focusInput: true
                });
            }
        );
    }

    window.addEventListener(
        "popstate",
        function () {
            searchInput.value = getQueryFromUrl();

            applySearch({
                updateHistory: false,
                focusInput: false
            });
        }
    );

    if (currentYear) {
        currentYear.textContent =
            String(new Date().getFullYear());
    }

    if (buildPlaceholder) {
        buildPlaceholder.hidden =
            reviewResults.length > 0;
    }

    searchInput.value = getQueryFromUrl();

    applySearch({
        updateHistory: false,
        focusInput: false
    });

    document.dispatchEvent(
        new CustomEvent("reviews:search-ready", {
            detail: {
                totalReviews: reviewResults.length,
                currentQuery: getCurrentQuery()
            }
        })
    );
})();