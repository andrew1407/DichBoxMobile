// okhttp3 request/response bodies as ApiParser.kt builds and reads them.
package okhttp3

class MediaType(val value: String) {
    companion object {
        fun String.toMediaTypeOrNull(): MediaType? = MediaType(this)
    }
}

class RequestBody(val content: String, val contentType: MediaType?) {
    companion object {
        fun String.toRequestBody(contentType: MediaType? = null): RequestBody = RequestBody(this, contentType)
    }
}

class ResponseBody(private val content: String) {
    fun string(): String = content
}
