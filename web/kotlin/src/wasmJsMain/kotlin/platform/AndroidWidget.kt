package android.widget

import android.text.Editable
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import showcase.platform.hexColor
import showcase.platform.jsView

open class TextView(handle: Int) : View(handle) {
    internal val textListeners = mutableListOf<(Editable?) -> Unit>()
    private var current: CharSequence = ""

    var text: CharSequence
        get() = current
        set(value) { current = value; jsView(handle, "text", spansJson(value)) }

    fun setText(value: CharSequence) { text = value; fireTextChanged() }

    fun setTextColor(color: Int) = jsView(handle, "textColor", hexColor(color))

    /** The user typed: update the model without echoing back, then run the listeners. */
    fun userInput(value: String) { current = value; fireTextChanged() }

    private fun fireTextChanged() = textListeners.toList().forEach { it(Editable(current.toString())) }
}

open class EditText(handle: Int) : TextView(handle)

open class Button(handle: Int) : TextView(handle)

private fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""

/** {"text":"…","spans":[{"start":0,"end":3,"color":"#00d9ff"},{"start":4,"end":9,"style":2}]} */
internal fun spansJson(value: CharSequence): String {
    val spans = (value as? SpannableString)?.spans.orEmpty().map { (what, start, end) ->
        when (what) {
            is ForegroundColorSpan -> """{"start":$start,"end":$end,"color":"${hexColor(what.foregroundColor)}"}"""
            is StyleSpan -> """{"start":$start,"end":$end,"style":${what.style}}"""
            else -> """{"start":$start,"end":$end}"""
        }
    }
    return """{"text":${q(value.toString())},"spans":[${spans.joinToString(",")}]}"""
}
