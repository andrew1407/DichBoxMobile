// android.text spans, recorded so the page can render coloured/styled runs of text.
package android.text

interface Spannable : CharSequence {
    fun setSpan(what: Any, start: Int, end: Int, flags: Int)

    companion object {
        const val SPAN_INCLUSIVE_INCLUSIVE = 18
    }
}

class SpannableString(source: CharSequence) : Spannable, CharSequence by source.toString() {
    private val text = source.toString()
    val spans = mutableListOf<Triple<Any, Int, Int>>()
    override fun setSpan(what: Any, start: Int, end: Int, flags: Int) { spans.add(Triple(what, start, end)) }
    override fun toString(): String = text
}

class Editable(private val s: String) : CharSequence by s {
    override fun toString(): String = s
}
