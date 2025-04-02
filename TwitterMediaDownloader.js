// ==UserScript==
// @name         Twitter Media Downloader
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Download images and videos from Twitter posts and pack them into a ZIP archive with metadata.
// @author       Dramorian
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'https://x.com/i/api/graphql/QuBlQ6SxNAQCt6-kBiCXCQ/TweetDetail';

    // ### Cookie Handling
    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        return parts.length === 2 ? parts.pop().split(';').shift() : null;
    };

    // ### API Interaction
    const createTweetUrl = (tweetId) => {
        const variables = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: 'Relevance',
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
        return `${API_URL}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
    };

    const createHeaders = () => {
        const lang = getCookie('lang') || 'en';
        const ct0 = getCookie('ct0') || '';
        return {
            authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': lang,
            'x-csrf-token': ct0
        };
    };

    const fetchTweetData = async (tweetId) => {
        const url = createTweetUrl(tweetId);
        const headers = createHeaders();
        try {
            const response = await fetch(url, { method: 'GET', headers });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return extractMediaFromTweet(data, tweetId);
        } catch (error) {
            console.error(`Failed to fetch tweet data for tweetId ${tweetId}:`, error);
            return [];
        }
    };

    const extractMediaFromTweet = (data, tweetId) => {
        const tweetEntry = data?.data?.threaded_conversation_with_injections_v2?.instructions?.[0]?.entries?.find(
            (entry) => entry.entryId === `tweet-${tweetId}`
        );
        const tweetResult = tweetEntry?.content?.itemContent?.tweet_results?.result;
        const tweet = tweetResult?.tweet || tweetResult;
        if (!tweet) return [];

        const media = tweet?.legacy?.entities?.media || [];
        return media.flatMap((item) => {
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
    };

    const extractVideoMedia = (item) => {
        const variants = item.video_info.variants.filter((v) => v.content_type === 'video/mp4');
        const highestQuality = variants.reduce((max, v) => (v.bitrate > max.bitrate ? v : max), { bitrate: 0 });
        return highestQuality.url ? [{ url: highestQuality.url, bitrate: highestQuality.bitrate, content_type: highestQuality.content_type }] : [];
    };

    const extractGifMedia = (item) => {
        const gifVariant = item.video_info.variants.find((v) => v.content_type === 'video/mp4');
        return gifVariant ? [{ url: gifVariant.url, bitrate: gifVariant.bitrate, content_type: gifVariant.content_type }] : [];
    };

    // ### Media Downloading
    const downloadMedia = async (tweetElement, mediaData) => {
    const zip = new JSZip();
    const { tweetLink, authorHandle, tweetId } = extractTweetInfo(tweetElement);
    const metadata = buildMetadata(tweetElement, tweetLink, authorHandle);

    await Promise.all(
        mediaData.map(async (media, index) => {
            const fileName = `${authorHandle}_${tweetId}_${index + 1}`;
            const mediaUrl = await fetchAndSaveMedia(zip, media, fileName);
            if (mediaUrl) {
                metadata.media.push({
                    url: mediaUrl,
                    type: media.content_type === 'video/mp4' ? 'video' : 'photo',
                    file_name: `${fileName}.${media.content_type === 'video/mp4' ? 'mp4' : 'jpg'}`
                });
            }
        })
    );

    addFilesToZip(zip, metadata, tweetLink, authorHandle, tweetId);
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${authorHandle}_${tweetId}.zip`);
};

    const extractTweetInfo = (tweetElement) => {
        const tweetLinkElement = tweetElement.querySelector('a[href*="/status/"]');
        if (!tweetLinkElement) return null;
        const tweetLink = tweetLinkElement.href;
        const match = tweetLink.match(/https:\/\/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
        if (!match) return null;
        return {
            tweetLink: `https://x.com/${match[1]}/status/${match[2]}`,
            authorHandle: match[1],
            tweetId: match[2]
        };
    };

    const buildMetadata = (tweetElement, tweetLink, authorHandle) => {
    const tweetId = tweetLink.match(/status\/(\d+)/)[1];
    const authorCommentElement = tweetElement.querySelector('div[lang]');
    const authorComment = authorCommentElement?.innerText || '';
    const dateElement = tweetElement.querySelector('time');
    const postDateTime = dateElement ? new Date(dateElement.getAttribute('datetime')) : new Date();

    // Extract hashtags and clean text
    const hashtagRegex = /#(\w+)/g;
    const hashtags = [...new Set([...authorComment.matchAll(hashtagRegex)].map(match => match[1]))];
    const cleanText = authorComment.replace(hashtagRegex, '').trim();

    const metadata = {
        tweet_url: tweetLink,
        author_handle: authorHandle,
        posted_at: postDateTime.toISOString(),
        text: cleanText,
        hashtags,
        media: []
    };

    return metadata;
};

    const fetchAndSaveMedia = async (zip, media, fileName) => {
        try {
            const isVideo = typeof media !== 'string' && media.content_type === 'video/mp4';
            const url = isVideo ? media.url : media;
            const mediaBlob = await fetch(url).then((res) => res.blob());
            const extension = isVideo ? 'mp4' : 'jpg';
            zip.file(`${fileName}.${extension}`, mediaBlob);
            return url;
        } catch (error) {
            console.error(`Failed to fetch media ${fileName}:`, error);
            return '';
        }
    };

    const addFilesToZip = (zip, metadata, tweetLink, authorHandle, tweetId) => {
    zip.file('metadata.json', JSON.stringify(metadata, null, 2)); // Pretty-print JSON
    zip.file(`${authorHandle}_${tweetId}.url`, `[InternetShortcut]\nURL=${tweetLink}`);
};

    // ### DOM Manipulation
    const addDownloadButton = (tweetElement) => {
        const tweetInfo = extractTweetInfo(tweetElement);
        if (!tweetInfo) return;
        const { tweetId } = tweetInfo;

        if (!hasMedia(tweetElement) || tweetElement.querySelector('.download-media-btn')) return;

        const isProcessed = checkIfTweetProcessed(tweetId);
        const buttonGroup = tweetElement.querySelector('div[role="group"]:last-of-type');
        if (!buttonGroup) return;

        const buttonShare = Array.from(buttonGroup.querySelectorAll(':scope > div > div')).pop()?.parentNode;
        if (!buttonShare) return;

        const buttonDownload = buttonShare.cloneNode(true);
        const svgElement = buttonDownload.querySelector('svg');
        if (svgElement) svgElement.outerHTML = getDownloadIcon(isProcessed);

        buttonDownload.style.marginLeft = '10px';
        buttonDownload.classList.add('download-media-btn');
        buttonDownload.dataset.tweetId = tweetId;
        buttonDownload.addEventListener('click', () => onDownloadButtonClick(buttonDownload));
        buttonShare.parentNode.insertBefore(buttonDownload, buttonShare.nextSibling);
    };

    const getDownloadIcon = (isProcessed) => `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
             fill="${isProcessed ? '#28a745' : '#1da1f2'}" stroke="${isProcessed ? '#28a745' : '#1da1f2'}"
             stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round" class="download-media-btn">
            <path d="M10.09 14.1L4.39 8.4 5.8 6.98 9.09 10.28V0.69h2v9.59l3.3-3.3 1.41 1.42zm9.01-1-0.02 3.51c0 1.38-1.12 2.49-2.5 2.49H3.6c-1.39 0-2.5-1.12-2.5-2.5v-3.5h2v3.5c0 0.28 0.22 0.5 0.5 0.5h12.98c0.28 0 0.5-0.22 0.5-0.5l0.02-3.5z"/>
        </svg>
    `;

    const onDownloadButtonClick = async (button) => {
        const tweetId = button.dataset.tweetId;
        console.log(`Fetching media for tweetId: ${tweetId}`);
        setButtonLoadingState(button, true);

        try {
            const mediaData = await retry(() => fetchTweetData(tweetId), 3, 1000);
            if (!mediaData.length) {
                console.warn(`No media found for tweetId: ${tweetId}`);
                return;
            }
            const tweetElement = button.closest('article');
            if (tweetElement) {
                await downloadMedia(tweetElement, mediaData);
                markTweetAsProcessed(tweetId);
                updateButtonIcon(button, true);
            }
        } catch (error) {
            console.error(`Failed to process tweetId ${tweetId}:`, error);
        } finally {
            setButtonLoadingState(button, false);
        }
    };

    const setButtonLoadingState = (button, isLoading) => {
        const svgElement = button.querySelector('svg');
        if (!svgElement) return;

        if (isLoading) {
            svgElement.outerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 120 30" fill="#1da1f2">
                    <circle cx="15" cy="15" r="15">
                        <animate attributeName="r" from="15" to="15" begin="0s" dur="0.8s" values="15;9;15" calcMode="linear" repeatCount="indefinite"/>
                        <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s" values="1;.5;1" calcMode="linear" repeatCount="indefinite"/>
                    </circle>
                    <circle cx="60" cy="15" r="9" fill-opacity="0.3">
                        <animate attributeName="r" from="9" to="9" begin="0s" dur="0.8s" values="9;15;9" calcMode="linear" repeatCount="indefinite"/>
                        <animate attributeName="fill-opacity" from="0.5" to="0.5" begin="0s" dur="0.8s" values=".5;1;.5" calcMode="linear" repeatCount="indefinite"/>
                    </circle>
                    <circle cx="105" cy="15" r="15">
                        <animate attributeName="r" from="15" to="15" begin="0s" dur="0.8s" values="15;9;15" calcMode="linear" repeatCount="indefinite"/>
                        <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s" values="1;.5;1" calcMode="linear" repeatCount="indefinite"/>
                    </circle>
                </svg>
            `;
            button.disabled = true;
        } else {
            button.disabled = false;
            updateButtonIcon(button, checkIfTweetProcessed(button.dataset.tweetId));
        }
    };

    const updateButtonIcon = (button, isSuccess) => {
        const svgElement = button.querySelector('svg');
        if (svgElement) svgElement.outerHTML = getDownloadIcon(isSuccess);
    };

    // ### Utility Functions
    const hasMedia = (tweetElement) => {
        const mediaSelectors = ['a[href*="/photo/1"]', 'div[role="progressbar"]', 'button[data-testid="playButton"]'];
        return mediaSelectors.some((selector) => tweetElement.querySelector(selector));
    };

    const checkIfTweetProcessed = (tweetId) => {
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        return processedTweets.includes(tweetId);
    };

    const markTweetAsProcessed = (tweetId) => {
        const processedTweets = JSON.parse(localStorage.getItem('processedTweets') || '[]');
        if (!processedTweets.includes(tweetId)) {
            processedTweets.push(tweetId);
            localStorage.setItem('processedTweets', JSON.stringify(processedTweets));
        }
    };

    const retry = async (fn, retries = 3, delay = 1000) => {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === retries - 1) throw error;
                console.warn(`Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    };

    // ### Observer Setup
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tweetElements = node.matches('article') ? [node] : node.querySelectorAll('article');
                    tweetElements.forEach(addDownloadButton);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
