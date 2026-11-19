// retrofit2 as ApiParser.kt and the *API classes use it. On Android, Retrofit.create() builds a
// dynamic proxy from the @POST annotations of UserService/BoxesService; Kotlin/Wasm has no
// proxies, so showcase.platform.Services implements both interfaces with the same routes.
package retrofit2

import okhttp3.RequestBody
import okhttp3.ResponseBody
import showcase.platform.JClass
import showcase.platform.jsPost

class Retrofit private constructor(val baseUrl: String) {
    class Builder {
        private var url = ""
        fun baseUrl(baseUrl: String): Builder { url = baseUrl; return this }
        fun build(): Retrofit = Retrofit(url)
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> create(service: JClass<T>): T = showcase.platform.createService(service.kclass, this) as T

    /** One POST with a JSON body, answered by the page's in-memory DichBox API. */
    fun post(path: String, body: RequestBody): Response<ResponseBody> {
        val raw = jsPost(baseUrl + path, body.content)
        val code = raw.substringBefore('\n').toInt()
        val json = ResponseBody(raw.substringAfter('\n'))
        return if (code in 200..299) Response(code, json, null) else Response(code, null, json)
    }
}

class Response<T>(private val code: Int, private val body: T?, private val errorBody: ResponseBody?) {
    val isSuccessful: Boolean get() = code in 200..299
    fun body(): T? = body
    fun errorBody(): ResponseBody? = errorBody
    fun code(): Int = code
}
