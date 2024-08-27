// ==UserScript==
// @name         Twitter Media Downloader
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Download images and videos from Twitter posts and pack them into a ZIP archive with metadata.
// @author       Dramorian
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @downloadURL  https://update.greasyfork.org/scripts/503354/Twitter%20Media%20Downloader.user.js
// @updateURL    https://update.greasyfork.org/scripts/503354/Twitter%20Media%20Downloader.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const BASE_URL = 'https://x.com/i/api/graphql/QuBlQ6SxNAQCt6-kBiCXCQ/TweetDetail';

    function getCookie() {
        const cookies = document.cookie.split(';').reduce((acc, cookie) => {
            const [name, value] = cookie.split('=').map(part => part.trim());
            if (name) {
                acc[name] = value || ''; // Ensure empty string if value is undefined
            }
            return acc;
        }, {});

        return {
            lang: cookies.lang || 'en', // Default to 'en' if lang is not present
            ct0: cookies.ct0 || ''     // Default to empty string if ct0 is not present
        };
    }

    async function fetchTweetData(tweetId) {
        try {
            const url = buildTweetDataURL(tweetId);
            const headers = buildHeaders(getCookie());

            const response = await fetch(url, {method: 'GET', headers});

            if (!response.ok) {
                await logErrorResponse(response);
                return [];
            }

            const data = await response.json();
            return extractMediaFromTweetData(data, tweetId);
        } catch (error) {
            console.error('Failed to fetch tweet data:', error);
            return [];
        }
    }

    function buildTweetDataURL(tweetId) {
        const variables = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: "Relevance",
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true
        };

        const features = {
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            rweb_video_timestamps_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_enhance_cards_enabled: false
        };

        const fieldToggles = {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withGrokAnalyze: false,
            withDisallowedReplyControls: false
        };

        return encodeURI(`${BASE_URL}?variables=${JSON.stringify(variables)}&features=${JSON.stringify(features)}&fieldToggles=${JSON.stringify(fieldToggles)}`);
    }

    function buildHeaders(cookies) {
        return {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': cookies.lang,
            'x-csrf-token': cookies.ct0
        };
    }

    async function logErrorResponse(response) {
        const text = await response.text();
        console.error(`Error: ${text}`);
    }

    function extractMediaFromTweetData(data, tweetId) {
        const tweetEntry = data.data?.threaded_conversation_with_injections_v2?.instructions?.[0]?.entries?.find(n => n.entryId === `tweet-${tweetId}`);
        const tweetResult = tweetEntry?.content?.itemContent?.tweet_results?.result;

        if (!tweetResult) {
            console.error('Tweet result not found');
            return [];
        }

        const media = tweetResult.legacy?.entities?.media;

        if (!media || media.length === 0) {
            return [];
        }

        return media.flatMap(item => {
            if (item.type === 'photo') {
                return [item.media_url_https + '?name=orig'];
            } else if (item.type === 'video') {
                return extractHighestQualityVideo(item);
            } else if (item.type === 'animated_gif') {
                return extractGifVariant(item);
            }
            return [];
        });
    }

    function extractHighestQualityVideo(item) {
        const highestQuality = item.video_info.variants
            .filter(variant => variant.content_type === 'video/mp4')
            .reduce((max, variant) => variant.bitrate > max.bitrate ? variant : max, {bitrate: 0});

        return [{
            url: highestQuality.url,
            bitrate: highestQuality.bitrate,
            content_type: highestQuality.content_type
        }];
    }

    function extractGifVariant(item) {
        const gifVariant = item.video_info.variants
            .find(variant => variant.content_type === 'video/mp4');

        return gifVariant ? [{
            url: gifVariant.url,
            bitrate: gifVariant.bitrate,
            content_type: gifVariant.content_type
        }] : [];
    }

    async function downloadMedia(tweetElement, mediaData) {
        const zip = new JSZip();
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        const {authorHandle, tweetId, tweetLink} = extractTweetDetails(tweetLinkElement);

        const metadata = buildMetadata(tweetElement, tweetLink, authorHandle);
        await addMediaToZip(zip, mediaData, authorHandle, tweetId, metadata);

        await addMetadataAndSaveZip(zip, metadata, authorHandle, tweetId, tweetLink);
    }

    function extractTweetDetails(tweetLinkElement) {
        const tweetLink = tweetLinkElement.href;
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        const authorHandle = tweetParts[1];
        const tweetId = tweetParts[2];

        return {
            authorHandle,
            tweetId,
            tweetLink: `https://x.com/${authorHandle}/status/${tweetId}`
        };
    }

    function buildMetadata(tweetElement, tweetLink, authorHandle) {
        const authorCommentElement = tweetElement.querySelector('div[lang]');
        const authorComment = authorCommentElement ? authorCommentElement.innerText : '';
        const dateElement = tweetElement.querySelector('time');
        const postDateTime = dateElement ? new Date(dateElement.getAttribute('datetime')) : new Date();

        let metadata = `${tweetLink}\n`;
        if (authorComment) {
            metadata += `${authorComment}\n`;
        }
        metadata += `@${authorHandle}\n${postDateTime.toLocaleString()}\n`;

        return metadata;
    }

    async function addMediaToZip(zip, mediaData, authorHandle, tweetId, metadata) {
        let mediaIndex = 1;

        for (const media of mediaData) {
            try {
                const {fileName, fileData} = await fetchMediaFile(media, authorHandle, tweetId, mediaIndex);
                zip.file(fileName, fileData);
                metadata += `${media.url || media}\n`;
                mediaIndex++;
            } catch (error) {
                console.error('Failed to fetch media:', error);
            }
        }
    }

    async function fetchMediaFile(media, authorHandle, tweetId, mediaIndex) {
        let fileName, fileData;

        if (media.content_type === 'video/mp4') {
            fileData = await fetch(media.url).then(res => res.blob());
            fileName = `${authorHandle}_${tweetId}_${mediaIndex}.mp4`;
        } else {
            fileData = await fetch(media).then(res => res.blob());
            fileName = `${authorHandle}_${tweetId}_${mediaIndex}.jpg`;
        }

        return {fileName, fileData};
    }

    async function addMetadataAndSaveZip(zip, metadata, authorHandle, tweetId, tweetLink) {
        zip.file('metadata.txt', metadata.trim());
        zip.file(`${authorHandle}_${tweetId}.url`, `[InternetShortcut]\nURL=${tweetLink}`);

        const content = await zip.generateAsync({type: 'blob'});
        saveAs(content, `${authorHandle}_${tweetId}.zip`);
    }


    function addDownloadButton(tweetElement) {
        const tweetLinkElement = getTweetLinkElement(tweetElement);
        if (!tweetLinkElement) return;

        const tweetId = extractTweetId(tweetLinkElement);
        if (!tweetId || !hasMedia(tweetElement)) return;

        if (isTweetProcessed(tweetId) || tweetElement.querySelector('.download-media-btn')) return;

        const button = createDownloadButton(tweetId);
        attachButtonToActionBar(tweetElement, button);
    }

    function getTweetLinkElement(tweetElement) {
        return tweetElement.querySelector('a[href*="/status/"]');
    }

    function extractTweetId(tweetLinkElement) {
        const tweetLink = tweetLinkElement.href;
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        return tweetParts ? tweetParts[2] : null;
    }

    function hasMedia(tweetElement) {
        const mediaSelectors = [
            'a[href*="/photo/1"]',
            'div[role="progressbar"]',
            'button[data-testid="playButton"]',
        ];
        return mediaSelectors.some(selector => tweetElement.querySelector(selector));
    }

    function isTweetProcessed(tweetId) {
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        return processedTweets.includes(tweetId);
    }

    function createDownloadButton(tweetId) {
        const button = document.createElement('button');
        button.className = 'download-media-btn';
        Object.assign(button.style, {
            marginLeft: '10px',
            padding: '6px',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
        });

        const isProcessed = isTweetProcessed(tweetId);
        button.innerHTML = createButtonSVG(isProcessed);
        button.dataset.tweetId = tweetId;
        button.addEventListener('click', () => onDownloadButtonClick(button));

        return button;
    }

    function createButtonSVG(isProcessed) {
        const strokeColor = isProcessed ? '#28a745' : '#1da1f2';
        return `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-download">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;
    }

    function attachButtonToActionBar(tweetElement, button) {
        const actionBar = tweetElement.querySelector('[role="group"]');
        if (actionBar) {
            actionBar.appendChild(button);
        }
    }


    async function onDownloadButtonClick(button) {
        const tweetId = button.dataset.tweetId;

        // Log and show loading animation
        console.log(`Fetching media for tweetId: ${tweetId}`);
        showLoadingAnimation(button);

        // Optionally disable the button during fetch
        button.disabled = true;

        try {
            const mediaData = await fetchTweetData(tweetId);

            if (mediaData.length === 0) {
                console.warn('No media found for this tweet.');
                return;
            }

            const tweetElement = button.closest('article');
            if (tweetElement) {
                await downloadMedia(tweetElement, mediaData);
                markTweetAsProcessed(tweetId);
                updateButtonIcon(button, true);
            }
        } catch (error) {
            console.error('Failed to fetch or download media:', error);
        } finally {
            // Re-enable the button even if there was an error
            button.disabled = false;
        }
    }

    function showLoadingAnimation(button) {
        button.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg" fill="#1da1f2">
            <circle cx="15" cy="15" r="15">
                <animate attributeName="r" from="15" to="15" begin="0s" dur="0.8s"
                    values="15;9;15" calcMode="linear" repeatCount="indefinite" />
                <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s"
                    values="1;.5;1" calcMode="linear" repeatCount="indefinite" />
            </circle>
            <circle cx="60" cy="15" r="9" fill-opacity="0.3">
                <animate attributeName="r" from="9" to="9" begin="0s" dur="0.8s"
                    values="9;15;9" calcMode="linear" repeatCount="indefinite" />
                <animate attributeName="fill-opacity" from="0.5" to="0.5" begin="0s" dur="0.8s"
                    values=".5;1;.5" calcMode="linear" repeatCount="indefinite" />
            </circle>
            <circle cx="105" cy="15" r="15">
                <animate attributeName="r" from="15" to="15" begin="0s" dur="0.8s"
                    values="15;9;15" calcMode="linear" repeatCount="indefinite" />
                <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s"
                    values="1;.5;1" calcMode="linear" repeatCount="indefinite" />
            </circle>
        </svg>
    `;
    }

    function updateButtonIcon(button, isProcessed) {
        const strokeColor = isProcessed ? '#28a745' : '#1da1f2';
        button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-download">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;
    }

    function markTweetAsProcessed(tweetId) {
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        if (!processedTweets.includes(tweetId)) {
            processedTweets.push(tweetId);
            localStorage.setItem('processedTweets', JSON.stringify(processedTweets));
        }
    }


    const observer = new MutationObserver(handleMutations);

    function handleMutations(mutations) {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    processAddedNode(node);
                }
            });
        });
    }

    function processAddedNode(node) {
        // Check if the node itself is a tweet element or contains tweet elements
        const tweetElements = node.matches('article') ? [node] : node.querySelectorAll('article');
        tweetElements.forEach(tweetElement => addDownloadButton(tweetElement));
    }

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
