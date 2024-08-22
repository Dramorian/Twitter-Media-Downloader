// ==UserScript==
// @name         Twitter Media Downloader
// @namespace    http://tampermonkey.net/
// @version      1.6
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

(function() {
    'use strict';

    const BASE_URL = 'https://x.com/i/api/graphql/QuBlQ6SxNAQCt6-kBiCXCQ/TweetDetail';

    function getCookie() {
        const cookies = document.cookie.split(';').reduce((acc, cookie) => {
            const [name, value] = cookie.split('=').map(c => c.trim());
            acc[name] = value;
            return acc;
        }, {});
        return {
            lang: cookies.lang || 'en',
            ct0: cookies.ct0 || ''
        };
    }

    async function fetchTweetData(tweetId) {
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

        const url = encodeURI(`${BASE_URL}?variables=${JSON.stringify(variables)}&features=${JSON.stringify(features)}&fieldToggles=${JSON.stringify(fieldToggles)}`);
        const cookies = getCookie();
        const headers = {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': cookies.lang,
            'x-csrf-token': cookies.ct0
        };

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                const text = await response.text();
                console.error(`Error: ${text}`);
                return [];
            }

            const data = await response.json();
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
                    const highestQuality = item.video_info.variants
                        .filter(variant => variant.content_type === 'video/mp4')
                        .reduce((max, variant) => variant.bitrate > max.bitrate ? variant : max, {
                            bitrate: 0
                        });

                    return [{
                        url: highestQuality.url,
                        bitrate: highestQuality.bitrate,
                        content_type: highestQuality.content_type
                    }];
                } else if (item.type === 'animated_gif') {
                    const gifVariant = item.video_info.variants
                        .find(variant => variant.content_type === 'video/mp4');

                    return gifVariant ? [{
                        url: gifVariant.url,
                        bitrate: gifVariant.bitrate,
                        content_type: gifVariant.content_type
                    }] : [];
                }
                return [];
            });

        } catch (error) {
            console.error('Failed to fetch tweet data:', error);
            return [];
        }
    }

    async function downloadMedia(tweetElement, mediaData) {
        const zip = new JSZip();
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        let tweetLink = tweetLinkElement.href;
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        const authorHandle = tweetParts[1];
        const tweetId = tweetParts[2];

        // Normalize the tweet URL to ensure it doesn't include media indexes
        tweetLink = `https://x.com/${authorHandle}/status/${tweetId}`;

        const authorCommentElement = tweetElement.querySelector('div[lang]');
        const authorComment = authorCommentElement ? authorCommentElement.innerText : '';
        const dateElement = tweetElement.querySelector('time');
        const postDateTime = dateElement ? new Date(dateElement.getAttribute('datetime')) : new Date();

        let metadata = `${tweetLink}\n`;
        if (authorComment) {
            metadata += `${authorComment}\n`;
        }
        metadata += `@${authorHandle}\n${postDateTime.toLocaleString()}\n`;

        let mediaIndex = 1;
        for (const media of mediaData) {
            try {
                if (media.content_type === 'video/mp4') {
                    const videoData = await fetch(media.url).then(res => res.blob());
                    const videoName = `${authorHandle}_${tweetId}_${mediaIndex}.mp4`;
                    zip.file(videoName, videoData);
                    metadata += `${media.url}\n`;
                } else {
                    const imageData = await fetch(media).then(res => res.blob());
                    const imageName = `${authorHandle}_${tweetId}_${mediaIndex}.jpg`;
                    zip.file(imageName, imageData);
                    metadata += `${media}\n`;
                }
                mediaIndex++;
            } catch (error) {
                console.error('Failed to fetch media:', error);
            }
        }

        zip.file('metadata.txt', metadata.trim());
        zip.file(`${authorHandle}_${tweetId}.url`, `[InternetShortcut]\nURL=${tweetLink}`);

        const content = await zip.generateAsync({
            type: 'blob'
        });
        saveAs(content, `${authorHandle}_${tweetId}.zip`);
    }

    function addDownloadButton(tweetElement) {
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        if (!tweetLinkElement) return;

        const tweetLink = tweetLinkElement.href;
        const tweetParts = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        const tweetId = tweetParts[2];

        // CSS selectors to determine if media is present
        const mediaSelectors = [
            'a[href*="/photo/1"]',
            'div[role="progressbar"]',
            'button[data-testid="playButton"]',
        ];

        // Check if any media selectors are present
        const hasMedia = mediaSelectors.some(selector => tweetElement.querySelector(selector));

        if (!hasMedia) return;

        // Check if tweet has been processed
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        const isProcessed = processedTweets.includes(tweetId);

        // Store the tweetId in a data attribute on the button
        if (tweetElement.querySelector('.download-media-btn')) return;

        const button = document.createElement('button');
        button.className = 'download-media-btn';
        button.style.marginLeft = '10px';
        button.style.padding = '6px';
        button.style.border = 'none';
        button.style.backgroundColor = 'transparent';
        button.style.cursor = 'pointer';

        // Insert the SVG icon with color based on processed status
        button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${isProcessed ? '#28a745' : '#1da1f2'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-download">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;
        button.dataset.tweetId = tweetId; // Store the tweet ID

        button.addEventListener('click', () => onDownloadButtonClick(button));

        const actionBar = tweetElement.querySelector('[role="group"]');
        if (actionBar) {
            actionBar.appendChild(button);
        }
    }

    async function onDownloadButtonClick(button) {
        const tweetId = button.dataset.tweetId;

        // Log the fetching process
        console.log(`Fetching media for tweetId: ${tweetId}`);

        // Change the SVG icon to a bouncing dots animation
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
        button.disabled = true; // Optionally disable the button during fetch

        try {
            // Fetch the tweet data when the button is clicked
            const mediaData = await fetchTweetData(tweetId);

            if (mediaData.length === 0) {
                console.warn('No media found for this tweet.');
                return;
            }

            // Find the tweet element containing the button
            const tweetElement = button.closest('article');
            if (tweetElement) {
                await downloadMedia(tweetElement, mediaData);

                // Mark the tweet as processed
                const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
                if (!processedTweets.includes(tweetId)) {
                    processedTweets.push(tweetId);
                    localStorage.setItem('processedTweets', JSON.stringify(processedTweets));
                }

                // Update the icon color to green
                button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#28a745" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-download">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
        `;
            }
        } catch (error) {
            console.error('Failed to fetch or download media:', error);
        } finally {
            // Ensure the button is re-enabled even if there was an error
            button.disabled = false;
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
        childList: true,
        subtree: true
    });
})();
