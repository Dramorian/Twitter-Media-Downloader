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
            const [name, value] = cookie.split('=').map(c => c.trim());
            acc[name] = value;
            return acc;
        }, {});
        return {
            lang: cookies.lang || 'en', ct0: cookies.ct0 || ''
        };
    }

    async function fetchTweetData(tweetId) {
        const url = createTweetUrl(tweetId);
        const headers = createHeaders();

        try {
            const response = await fetch(url, {
                method: 'GET', headers
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch tweet: ${await response.text()}`);
            }

            const data = await response.json();
            return extractMediaFromTweet(data, tweetId);

        } catch (error) {
            console.error('Failed to fetch tweet data:', error);
            return [];
        }
    }

    function createTweetUrl(tweetId) {
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

    function createHeaders() {
        const cookies = getCookie();
        return {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': cookies.lang,
            'x-csrf-token': cookies.ct0
        };
    }

    function extractMediaFromTweet(data, tweetId) {
        const tweetEntry = data?.data?.threaded_conversation_with_injections_v2?.instructions?.[0]?.entries?.find(n => n.entryId === `tweet-${tweetId}`);
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
            switch (item.type) {
                case 'photo':
                    return [item.media_url_https + '?name=orig'];
                case 'video':
                    return extractVideoMedia(item);
                case 'animated_gif':
                    return extractGifMedia(item);
                default:
                    return [];
            }
        });
    }

    function extractVideoMedia(item) {
        const highestQuality = item.video_info.variants
            .filter(variant => variant.content_type === 'video/mp4')
            .reduce((max, variant) => variant.bitrate > max.bitrate ? variant : max, {
                bitrate: 0
            });

        return [{
            url: highestQuality.url, bitrate: highestQuality.bitrate, content_type: highestQuality.content_type
        }];
    }

    function extractGifMedia(item) {
        const gifVariant = item.video_info.variants.find(variant => variant.content_type === 'video/mp4');
        return gifVariant ? [{
            url: gifVariant.url, bitrate: gifVariant.bitrate, content_type: gifVariant.content_type
        }] : [];
    }

    async function downloadMedia(tweetElement, mediaData) {
        const zip = new JSZip();
        const {
            tweetLink, authorHandle, tweetId
        } = extractTweetInfo(tweetElement);
        const metadata = buildMetadata(tweetElement, tweetLink, authorHandle);

        await Promise.all(mediaData.map(async (media, index) => {
            const mediaIndex = index + 1;
            const fileName = `${authorHandle}_${tweetId}_${mediaIndex}`;
            const mediaUrl = await fetchAndSaveMedia(zip, media, fileName);
            metadata.push(`${mediaUrl}\n`);
        }));

        addFilesToZip(zip, metadata, tweetLink, authorHandle, tweetId);

        const content = await zip.generateAsync({
            type: 'blob'
        });
        saveAs(content, `${authorHandle}_${tweetId}.zip`);
    }

    function extractTweetInfo(tweetElement) {
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        const tweetLink = tweetLinkElement.href;
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);

        return {
            tweetLink: `https://x.com/${tweetParts[1]}/status/${tweetParts[2]}`,
            authorHandle: tweetParts[1],
            tweetId: tweetParts[2]
        };
    }

    function buildMetadata(tweetElement, tweetLink, authorHandle) {
        const metadata = [`${tweetLink}\n`];
        const authorCommentElement = tweetElement.querySelector('div[lang]');
        const authorComment = authorCommentElement ? authorCommentElement.innerText : '';
        const dateElement = tweetElement.querySelector('time');
        const postDateTime = dateElement ? new Date(dateElement.getAttribute('datetime')) : new Date();

        if (authorComment) {
            metadata.push(`${authorComment}\n`);
        }

        metadata.push(`@${authorHandle}\n${postDateTime.toLocaleString()}\n`);
        return metadata;
    }

    async function fetchAndSaveMedia(zip, media, fileName) {
        try {
            let mediaUrl;
            let mediaBlob;

            if (media.content_type === 'video/mp4') {
                mediaBlob = await fetch(media.url).then(res => res.blob());
                mediaUrl = media.url;
                zip.file(`${fileName}.mp4`, mediaBlob);
            } else {
                mediaBlob = await fetch(media).then(res => res.blob());
                mediaUrl = media;
                zip.file(`${fileName}.jpg`, mediaBlob);
            }

            return mediaUrl;
        } catch (error) {
            console.error('Failed to fetch media:', error);
            return '';
        }
    }

    function addFilesToZip(zip, metadata, tweetLink, authorHandle, tweetId) {
        zip.file('metadata.txt', metadata.join('').trim());
        zip.file(`${authorHandle}_${tweetId}.url`, `[InternetShortcut]\nURL=${tweetLink}`);
    }


    function addDownloadButton(tweetElement) {
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        if (!tweetLinkElement) return;

        const {
            tweetId, authorHandle
        } = extractTweetDetails(tweetLinkElement.href);

        if (!hasMedia(tweetElement)) return;

        if (tweetElement.querySelector('.download-media-btn')) return;

        const isProcessed = checkIfTweetProcessed(tweetId);

        // Locate the share button to clone
        const button_group = tweetElement.querySelector('div[role="group"]:last-of-type');
        const button_share = Array.from(button_group.querySelectorAll(':scope>div>div')).pop().parentNode;
        const button_download = button_share.cloneNode(true); // Clone the share button

        // Insert your SVG icon into the cloned button
        const svgElement = button_download.querySelector('svg');
        if (svgElement) {
            svgElement.outerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg"
            width="24px" height="24px"
            viewBox="0 0 24 24"
            fill="${isProcessed ? '#28a745' : '#1da1f2'}"
            stroke="${isProcessed ? '#28a745' : '#1da1f2'}" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"
            class="download-media-btn">
            <path d="M 10.09,14.1 4.39,8.4 5.8,6.98 9.09,10.28 V 0.69 h 2 v 9.59 l 3.3,-3.3 1.41,1.42 z m 9.01,-1 -0.02,3.51 c 0,1.38 -1.12,2.49 -2.5,2.49 H 3.6 c -1.39,0 -2.5,-1.12 -2.5,-2.5 v -3.5 h 2 v 3.5 c 0,0.28 0.22,0.5 0.5,0.5 h 12.98 c 0.28,0 0.5,-0.22 0.5,-0.5 l 0.02,-3.5 z"></path>
            </svg>
        `;
        }

        button_download.style.marginLeft = "10px";
        button_download.classList.add('download-media-btn'); // Add a class to identify the button
        button_download.dataset.tweetId = tweetId; // Store the tweetId

        // Add event listener to the cloned button
        button_download.addEventListener('click', () => onDownloadButtonClick(button_download));

        // Insert the download button before the original share button
        button_share.parentNode.insertBefore(button_download, button_share.nextSibling);
    }


    function extractTweetDetails(tweetLink) {
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        return {
            authorHandle: tweetParts[1], tweetId: tweetParts[2]
        };
    }

    function hasMedia(tweetElement) {
        const mediaSelectors = ['a[href*="/photo/1"]', 'div[role="progressbar"]', 'button[data-testid="playButton"]',];
        return mediaSelectors.some(selector => tweetElement.querySelector(selector));
    }

    function checkIfTweetProcessed(tweetId) {
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        return processedTweets.includes(tweetId);
    }

    async function onDownloadButtonClick(button) {
        const tweetId = button.dataset.tweetId;

        console.log(`Fetching media for tweetId: ${tweetId}`);

        setButtonLoadingState(button, true);

        try {
            const mediaData = await retry(async () => await fetchTweetData(tweetId), 3, 1000);

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
            setButtonLoadingState(button, false);
        }
    }

    async function retry(fn, retries = 3, delay = 1000) {
        let attempt = 0;
        while (attempt < retries) {
            try {
                return await fn();
            } catch (error) {
                attempt++;
                if (attempt >= retries) throw error;
                console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    function setButtonLoadingState(button, isLoading) {
        const svgElement = button.querySelector('svg');
        if (!svgElement) return;

        if (isLoading) {
            svgElement.outerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 120 30" fill="#1da1f2">
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
            button.disabled = true;
        } else {
            button.disabled = false;
        }
    }

    function updateButtonIcon(button, isSuccess) {
        const svgElement = button.querySelector('svg');
        if (!svgElement) return;

        svgElement.outerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg"
        width="24px" height="24px"
        viewBox="0 0 24 24"
        fill="${isSuccess ? '#28a745' : '#1da1f2'}"
        stroke="${isSuccess ? '#28a745' : '#1da1f2'}" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"
        class="completed">
        <path d="M 10.09,14.1 4.39,8.4 5.8,6.98 9.09,10.28 V 0.69 h 2 v 9.59 l 3.3,-3.3 1.41,1.42 z m 9.01,-1 -0.02,3.51 c 0,1.38 -1.12,2.49 -2.5,2.49 H 3.6 c -1.39,0 -2.5,-1.12 -2.5,-2.5 v -3.5 h 2 v 3.5 c 0,0.28 0.22,0.5 0.5,0.5 h 12.98 c 0.28,0 0.5,-0.22 0.5,-0.5 l 0.02,-3.5 z"></path>
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


    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const addedNode of mutation.addedNodes) {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    const tweetElements = addedNode.matches('article') ? [addedNode] : addedNode.querySelectorAll('article');
                    tweetElements.forEach(tweetElement => addDownloadButton(tweetElement));
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true, subtree: true
    });
})();