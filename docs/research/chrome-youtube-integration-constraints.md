# Chrome and YouTube integration constraints

Research date: 2026-08-11

Issue: [#3 — Establish Chrome and YouTube integration constraints](https://github.com/loganprit/lingq-video-playback-chrome-extension/issues/3)

## Answer

The extension can reliably observe and control LingQ's sentence player only through YouTube's documented `YT.Player` API. A top-frame Chrome content script may find LingQ's iframe and operate LingQ's own DOM, but it cannot read the cross-origin YouTube document and, in Chrome's default isolated world, it cannot see LingQ's page-world `YT` object. Cross-origin `postMessage` is permitted, but YouTube documents it only as the transport required by the IFrame Player API; it does **not** document the raw `{event, func, args}` / `infoDelivery` wire format. Directly parsing or emitting that format is therefore an implementation-detail dependency, not a reliable integration contract.

The smallest reliable design is:

1. Keep UI, mode state, `chrome.storage`, LingQ selectors, and SPA/remount detection in one statically declared, top-frame `ISOLATED` content script.
2. Add one packaged, statically declared `MAIN`-world bridge on the same LingQ match. It may attach `YT.Player` to LingQ's existing eligible iframe and expose only a fixed set of player commands and state events to the isolated script.
3. Exchange those fixed messages through the shared page window/DOM, validating source, origin, message shape, command names, values, and the current iframe generation. Do not put extension privileges or secrets in the main-world bridge.
4. If LingQ's page does not already provide `YT.Player`, or the iframe is not API-enabled, fall back to LingQ's native controls and report that exact boundary state is unavailable. Do not retrofit the iframe or load remote API code from the extension.

This needs no YouTube content-script match, no `all_frames`, no service worker, and no `scripting` or YouTube host permission.

## Constraint matrix

| Mechanism | Permitted? | Reliable contract? | Constraint |
| --- | --- | --- | --- |
| Top-frame isolated content script reads/modifies LingQ DOM | Yes | Yes, subject to LingQ selector churn | Keep the existing narrow `https://www.lingq.com/*` match. Chrome gives content scripts DOM access but isolates their JavaScript globals from the page. [Chrome: content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) |
| Read `iframe.contentDocument`, YouTube DOM, or YouTube page globals from the LingQ frame | No | No | The iframe is cross-origin. The HTML Standard exposes only a small cross-origin `Window` surface; `postMessage` is included, arbitrary document/global access is not. [HTML Standard: cross-origin `Window`](https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-objects) |
| Inject the content script into every frame | Yes with matching frame URLs/permissions | Unnecessary and broader than needed | `all_frames` defaults to false, and every frame must independently match. Keep both extension scripts in the LingQ top frame. [Chrome: manifest content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#frames) |
| `iframe.contentWindow.postMessage(...)` across origins | Yes | Only for a documented protocol | The platform intentionally permits cross-origin messaging. Use an exact `targetOrigin`; receivers must validate `origin`, source, and data shape. [HTML Standard: cross-document messaging](https://html.spec.whatwg.org/multipage/web-messaging.html#crossDocumentMessages) |
| Handwritten YouTube `command` messages or parsed `infoDelivery` messages | Technically sendable/receivable | **No** | YouTube's public reference documents `YT.Player` methods and events, not those raw message schemas. Treat the raw protocol as private and changeable. [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) |
| Attach `YT.Player` to LingQ's existing iframe | Yes | Yes, when prerequisites hold | YouTube explicitly documents wrapping an existing iframe. Its URL must contain `enablejsapi=1`, or the iframe must have `enablejsapi=true`; wait for `onReady` before commands. [YouTube: existing iframe example](https://developers.google.com/youtube/iframe_api_reference#Example_Video_Player_Constructors) |
| Load `https://www.youtube.com/iframe_api` from extension code | Browser/page dependent | No for an MV3 extension distribution contract | Isolated-world CSP blocks external scripts, main-world code is governed by page CSP, and MV3 requires extension logic to be packaged; adding a remote script tag is a documented remote-hosted-code violation. Use LingQ's already-loaded page API or degrade. [Chrome: content-script CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy), [Chrome: remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) |

## YouTube player prerequisites

- `enablejsapi=1` enables IFrame Player API control; its default is disabled. [YouTube player parameters](https://developers.google.com/youtube/player_parameters#enablejsapi)
- Require `origin=https://www.lingq.com` on LingQ's iframe. YouTube calls `origin` an extra security measure and says API users should always specify their domain. Do not substitute the `chrome-extension://` origin: the embedding host page is LingQ. [YouTube player parameters: `origin`](https://developers.google.com/youtube/player_parameters#origin)
- Preserve the normal browser `Referer`; do not introduce a `Referrer-Policy` that suppresses it. YouTube now requires embedded-player client identification and reports error `153` when it is absent. [YouTube required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity), [YouTube `onError`](https://developers.google.com/youtube/iframe_api_reference#onError)
- Observe `onStateChange`, using the documented states `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, and `5` cued. Issue commands only after `onReady`. [YouTube events](https://developers.google.com/youtube/iframe_api_reference#Events)
- Use documented methods (`playVideo`, `pauseVideo`, `seekTo`, `getCurrentTime`, and `getPlayerState`) rather than serializing commands. `seekTo` can land on the nearest earlier keyframe, so exact frame-level seeking is not promised. [YouTube playback controls](https://developers.google.com/youtube/iframe_api_reference#Playback_controls)
- Handle `onAutoplayBlocked`. Continue mode may attempt a scripted `playVideo()` after the original user gesture has expired, and cross-origin autoplay also depends on the iframe's Permissions Policy. A blocked continuation must remain paused and ask for user action rather than claiming playback started. [YouTube `onAutoplayBlocked`](https://developers.google.com/youtube/iframe_api_reference#onAutoplayBlocked), [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay/#iframe_delegation)

If `enablejsapi` or the correct `origin` is absent, the extension should not edit `src` to add it: changing a LingQ-owned iframe URL reloads the player and can discard the sentence/player state the extension is trying to preserve. Eligibility is a gate, not a repair step.

## Chrome world and bridge constraints

Chrome's default isolated world is the right owner for extension behavior: the page cannot see its JavaScript variables, and it can use the limited content-script APIs including `chrome.storage`. That isolation also means `window.YT` in LingQ's page world is not visible there. [Chrome: isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#isolated_world)

A second static content-script declaration may select `world: "MAIN"`, which shares LingQ's JavaScript environment. Chrome warns that the host page can access and interfere with main-world scripts, and the page's CSP applies. Keep this bridge packaged, tiny, and unprivileged: attach to the current iframe, translate an allowlist of commands to `YT.Player` calls, and emit normalized state only. [Chrome: execution world](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#world-timings), [Chrome: content-script CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy)

The page and bridge share an origin, so a namespace or token placed in their shared DOM is not a security boundary; LingQ can observe or spoof it. Consequently:

- accept only fixed commands such as `play`, `pause`, `seek`, and `get-state`, with bounded numeric arguments;
- never accept code, selectors, URLs, arbitrary method names, or extension API requests;
- validate inbound bridge messages with `event.source === window`, `event.origin === location.origin`, an exact version/type, and a strict payload schema;
- validate YouTube iframe identity by comparing the current DOM node/player iframe and ignore stale generations;
- send cross-origin messages only to the iframe URL's exact HTTPS origin, never `*`.

The HTML messaging security guidance requires origin and data validation and warns against wildcard targets for sensitive data. [HTML Standard: messaging security](https://html.spec.whatwg.org/multipage/web-messaging.html#authors)

## Lifecycle and remount constraints

LingQ is an SPA. Chrome does not reinject a content script on a soft navigation, so the isolated adapter must observe the narrow reader/player subtree for sentence and iframe replacement. Chrome's own SPA tutorial recommends `MutationObserver` for this case and warns to observe sparingly. [Chrome: SPA content-script updates](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab#step-5), [DOM Standard: `MutationObserver`](https://dom.spec.whatwg.org/#interface-mutationobserver)

Preserve these invariants:

1. Treat the iframe DOM node, not merely its selector or `id`, as player identity.
2. On iframe removal, replacement, or relevant `src` change, increment a generation, discard the old wrapper, reset per-sentence playback state, and attach once to the new eligible iframe after `YT.Player` exists.
3. Ignore every event or command result whose iframe/generation is no longer current. This prevents a late `ENDED` event from advancing the replacement sentence.
4. Wait for the wrapper's `onReady`; do not infer readiness from iframe insertion or a timer.
5. Do not overwrite LingQ's `onYouTubeIframeAPIReady` callback. Wait for `window.YT?.Player` without taking ownership of page startup.
6. Do not call `player.destroy()` on a LingQ-owned player: YouTube documents that it removes the iframe. Remove only listeners owned by the bridge when possible, otherwise drop the stale reference and reject its events by generation. [YouTube player DOM methods](https://developers.google.com/youtube/iframe_api_reference#Accessing_and_Modifying_DOM_Nodes)
7. De-duplicate boundary handling: arm only after `PLAYING`, react once to the transition into `ENDED`, and disarm before Continue or Repeat starts asynchronous work.

## Specification decision

The product specification should require the official API eligibility gate (`YT.Player` present, API-enabled iframe, correct LingQ `origin`, ready event), a narrow unprivileged world bridge, strict message validation, remount generations, and explicit autoplay/error fallback. It should prohibit raw YouTube wire messages, cross-origin DOM access, remote API-script injection, iframe URL repair, and injection into YouTube frames.

If live LingQ inspection shows that any eligibility prerequisite is missing, reliable sentence-end automation is blocked at the integration boundary; native LingQ controls remain usable, but polling DOM or reverse-engineering YouTube messages should not be promoted to a supported architecture.
