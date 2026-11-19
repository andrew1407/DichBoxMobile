// The only two ways the compiled app code reaches the page: every widget change goes
// through jsView (web/app.js applies it to the inflated layout), and every HTTP request
// goes through jsPost (answered by the in-browser DichBox API mock in web/mock/server.js).
package showcase.platform

@JsFun("(h, k, v) => globalThis.__ktView(h, k, v)")
internal external fun jsView(handle: Int, key: String, value: String)

@JsFun("(url, body) => globalThis.__dichboxPost(url, body)")
internal external fun jsPost(url: String, body: String): String

@JsFun("(name, uuid) => globalThis.__ktSigned(name, uuid)")
internal external fun jsSigned(name: String, uuid: String)

/** java.lang.Class stand-in: the app passes `X::class.java` tokens to Gson and Retrofit. */
class JClass<T>(val kclass: kotlin.reflect.KClass<*>)

internal fun hexColor(color: Int): String =
    "#" + (color and 0xFFFFFF).toString(16).padStart(6, '0')
