# DichBoxMobile

<p align="center">
  <a href="https://andrew1407.github.io/DichBoxMobile/" target="blank"><img src="https://raw.githubusercontent.com/Andrew1407/DichBox/main/client/src/styles/imgs/full-logo.png" width="140" alt="DichBox Logo" /></a>
</p>

[![pages deploy badge](https://github.com/andrew1407/DichBoxMobile/actions/workflows/pages.yml/badge.svg)](https://andrew1407.github.io/DichBoxMobile/)

Mobile client for DichBox server.

**[DichBox API](https://github.com/Andrew1407/DichBox)**.

**[Changes list](https://github.com/Andrew1407/DichBoxMobile/blob/main/changes-list.md)**.

## Showcase

**[Open the app in the browser](https://andrew1407.github.io/DichBoxMobile/)**. An Android app can't run in a browser (there is no Android runtime for the web), so the showcase is a faithful replica in a phone frame, with everything that doesn't depend on Android running for real:

- **Real Kotlin, compiled to WebAssembly** by [`web/kotlin`](web/kotlin) from the app's unchanged sources: the API client (`UserAPI`, `BoxesAPI`, `ApiParser`, the Retrofit service interfaces), the `UserContainer`/`BoxesContainer` data classes, `SignInVerifier`/`SignUpVerifier` with `FieldsVerifier` and `InputVerifier` (they drive the sign-in and sign-up forms), `FieldsTemplates`, `FieldsWarnings`, `MutableInputVerifier`, `NotificationsTypes`, `ViewDecorators`, `OpenedFilesViewModel`. Android, Retrofit, OkHttp, Gson, coroutines and JUnit are replaced by small stand-ins with the same API.
- **Replicated UI**: the screens are the app's own `res/layout` files, inflated in the browser with its colours, styles, drawables, icons and fonts from `res/` ([`web/android.js`](web/android.js)). The activity and fragment logic is ported to JavaScript from `view/` and `mv/` ([`web/app.js`](web/app.js)).
- **Server**: an in-browser imitation of the DichBox API ([`web/mock`](web/mock)), ported from the [DichBox showcase](https://github.com/Andrew1407/DichBox#showcase), with two demo users (the first one signed in) and seeded boxes. Data lives in memory and resets on reload.

Run it locally (needs JDK 17+):

```sh
cd web/kotlin && ./gradlew showcase && cd ../..   # builds web/kotlin-wasm/
```

then assemble `_site` as the [pages workflow](.github/workflows/pages.yml) does and serve it, e.g. `cd _site && python -m http.server`, and open http://localhost:8000/web/.
